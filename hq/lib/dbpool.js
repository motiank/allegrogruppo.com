// MySQL pool for Joya HQ (same settings as the Allegro admin pool: named placeholders, UTC).
// The joya_* tables live in DB_NAME (JOYA_DB_NAME overrides it).
import mysql from 'mysql2/promise';
import path from 'path';
import { readFileSync } from 'fs';

let pool = null;
export function getDbPool() {
  if (pool) return pool;
  let ssl = null;
  if (process.env.DB_SSL_CA) ssl = { ca: readFileSync(path.resolve(process.env.DB_SSL_CA.replace('~', process.env.HOME))) };
  pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.JOYA_DB_NAME || process.env.DB_NAME,
    port: process.env.DB_PORT,
    ssl,
    decimalNumbers: true,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 30_000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,
    namedPlaceholders: true,
    timezone: 'Z',
  });
  return pool;
}

export async function executeSql(sql, params = {}) {
  return getDbPool().execute(sql, params);
}

export async function endPool() {
  if (pool) await pool.end().catch(() => {});
  pool = null;
}
