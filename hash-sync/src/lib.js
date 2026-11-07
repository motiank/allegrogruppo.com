import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import sql from 'mssql';
import { NOT_COPIED } from './mapping.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// HASH_ENV_FILE picks another settings file, for example one that points at production.
dotenv.config({ path: process.env.HASH_ENV_FILE || join(ROOT, '.env') });

export function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
}
export const hasFlag = (name) => process.argv.includes(`--${name}`);

const isLocal = (host) => ['localhost', '127.0.0.1', '::1'].includes(host);

// Connects to the target. Any server that is not local needs --production, so a test run cannot touch production.
export async function connectTarget({ multipleStatements = false } = {}) {
  const { TARGET_DB_HOST: host, TARGET_DB_PORT, TARGET_DB_USER: user, TARGET_DB_PASSWORD: password,
    TARGET_DB_NAME: database, TARGET_DB_SSL_CA: ca } = process.env;
  if (!host || !database) throw new Error('TARGET_DB_HOST and TARGET_DB_NAME are required');
  if (!isLocal(host) && !hasFlag('production')) throw new Error(`Refusing to use ${host} without --production`);
  const config = { host, port: Number(TARGET_DB_PORT || 3306), user, password, charset: 'utf8mb4', timezone: 'Z',
    dateStrings: true, decimalNumbers: true, multipleStatements };
  // A relative CA path is read from the hash-sync folder, so the same .env works wherever the folder is.
  if (ca) config.ssl = { ca: readFileSync(isAbsolute(ca) ? ca : join(ROOT, ca)) };
  const db = await mysql.createConnection(config);
  // The same rules as production, so a local test shows what production will do.
  await db.query("SET SESSION sql_mode = 'REAL_AS_FLOAT,PIPES_AS_CONCAT,ANSI_QUOTES,IGNORE_SPACE,ONLY_FULL_GROUP_BY,ANSI,STRICT_ALL_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'");
  return { db, database };
}

export function connectSource() {
  const { HASH_MSSQL_HOST, HASH_MSSQL_PORT, HASH_MSSQL_INSTANCE, HASH_MSSQL_USER, HASH_MSSQL_PASSWORD, HASH_MSSQL_DATABASE,
    HASH_MSSQL_OLD_TLS } = process.env;
  // A named instance (the server's WIZSOFT) finds its own port, so a port is used only without one.
  const where = HASH_MSSQL_INSTANCE ? {} : { port: Number(HASH_MSSQL_PORT || 1433) };
  // HASH_MSSQL_OLD_TLS=1 lets a current Node talk to an old SQL Server (2008-2014 without the TLS 1.2 update).
  const oldTls = ['1', 'true', 'yes'].includes(String(HASH_MSSQL_OLD_TLS || '').toLowerCase());
  return new sql.ConnectionPool({
    server: HASH_MSSQL_HOST || 'localhost', ...where, user: HASH_MSSQL_USER,
    password: HASH_MSSQL_PASSWORD, database: HASH_MSSQL_DATABASE, requestTimeout: 300000,
    options: { encrypt: true, trustServerCertificate: true, useUTC: true, instanceName: HASH_MSSQL_INSTANCE || undefined,
      cryptoCredentialsDetails: oldTls ? { minVersion: 'TLSv1', ciphers: 'DEFAULT:@SECLEVEL=0' } : undefined },
  }).connect();
}

// One text form per value, so a source row and a row rebuilt from the target can be compared exactly.
export function canonValue(value, where) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 23).replace('T', ' ');
  if (Buffer.isBuffer(value)) return { $base64: value.toString('base64') };
  if (['string', 'number', 'boolean'].includes(typeof value)) return value;
  throw new Error(`Unsupported value type ${typeof value} in ${where}`);
}

// A source row without its NULL values and without the NOT_COPIED columns. A missing field means NULL.
export function canonRow(row, table) {
  const out = {};
  for (const name of Object.keys(row).sort()) {
    if (NOT_COPIED[table]?.includes(name)) continue;
    const value = canonValue(row[name], `${table}.${name}`);
    if (value !== null) out[name] = value;
  }
  return out;
}

export const hashRow = (canon) => createHash('sha256').update(JSON.stringify(sortKeys(canon))).digest('hex');

function sortKeys(row) {
  return Object.fromEntries(Object.keys(row).sort().map((key) => [key, row[key]]));
}

const significantDigits = (n) => String(Math.abs(n)).replace(/e.*$/, '').replace('.', '').replace(/^0+/, '').replace(/0+$/, '').length;

// MySQL's JSON parser can change the last digit of a number with more than 15 significant digits, so those go in as text.
export function packJson(row) {
  const out = {};
  for (const [name, value] of Object.entries(row)) {
    out[name] = typeof value === 'number' && significantDigits(value) > 15 ? { $double: String(value) } : value;
  }
  return out;
}

export function unpackJson(row) {
  const out = {};
  for (const [name, value] of Object.entries(row)) {
    out[name] = value !== null && typeof value === 'object' && '$double' in value ? Number(value.$double) : value;
  }
  return out;
}

// The binary protocol leaves out a zero fraction of a second.
function padDateTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(\.\d*)?$/.test(value)) return value;
  const [time, fraction = ''] = value.split('.');
  return `${time}.${fraction.padEnd(3, '0')}`;
}

// Rebuilds the source row from a clean-table row: `extra` plus the mapped columns.
export function rebuildRow(mapping, targetRow) {
  const out = unpackJson(targetRow.extra || {});
  for (const [column, sourceColumn] of Object.entries(mapping.columns)) {
    let value = targetRow[column];
    if (value === null || value === undefined) continue;
    const map = mapping.enums?.[column];
    if (map) value = Number(Object.keys(map).find((key) => map[key] === value));
    out[sourceColumn] = padDateTime(value);
  }
  return out;
}

// SQL Server error 8645: no memory free for the query right now. It says to run the query again.
export async function sourceQuery(pool, text) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await pool.request().query(text);
    } catch (error) {
      if (error.number !== 8645 || attempt >= 20) throw error;
      console.log(`SQL Server is short of memory, try ${attempt} of 20`);
      await new Promise((resolve) => { setTimeout(resolve, 15000); });
    }
  }
}

export async function sourceCatalog(pool) {
  const { recordset } = await sourceQuery(pool, `
    SELECT t.name AS tbl, c.name AS col, c.column_id AS ordinal, ty.name AS data_type, c.max_length, c.is_nullable,
           c.is_identity, CASE WHEN ic.column_id IS NULL THEN 0 ELSE 1 END AS is_pk, ic.key_ordinal
    FROM sys.tables t
    JOIN sys.columns c ON c.object_id = t.object_id
    JOIN sys.types ty ON ty.user_type_id = c.user_type_id
    LEFT JOIN sys.indexes i ON i.object_id = t.object_id AND i.is_primary_key = 1
    LEFT JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.column_id = c.column_id
    WHERE t.is_ms_shipped = 0
    ORDER BY t.name, c.column_id`);
  const tables = new Map();
  for (const row of recordset) {
    if (!tables.has(row.tbl)) tables.set(row.tbl, []);
    tables.get(row.tbl).push(row);
  }
  return tables;
}

// A stable key for a source_rows row: primary key, else identity column, else row hash + its number among equal rows.
export function makeRowKeyer(columns) {
  const pk = columns.filter((c) => c.is_pk).sort((a, b) => a.key_ordinal - b.key_ordinal).map((c) => c.col);
  const identity = columns.filter((c) => c.is_identity).map((c) => c.col);
  const keyColumns = pk.length ? pk : identity;
  const seen = new Map();
  return (row, hash) => {
    if (keyColumns.length) {
      const key = keyColumns.map((c) => String(canonValue(row[c], c))).join('|');
      if (key.length <= 190) return key;
      return `h:${createHash('sha256').update(key).digest('hex')}`;
    }
    const n = (seen.get(hash) || 0) + 1;
    seen.set(hash, n);
    return `h:${hash}#${n}`;
  };
}

export function yearOf(value, fallback) {
  if (!value) return fallback;
  const year = (value instanceof Date ? value : new Date(value)).getUTCFullYear();
  return year;
}
