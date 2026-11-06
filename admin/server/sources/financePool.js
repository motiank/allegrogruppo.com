import mysql from "mysql2/promise";
import path from "path";
import fs from "fs";

// Connection pool of the Finance API over allegro_finance (written only by hash-sync; the API only reads).
//
// Settings: FINANCE_DB_HOST, FINANCE_DB_PORT, FINANCE_DB_USER, FINANCE_DB_PASSWORD, FINANCE_DB_NAME, FINANCE_DB_SSL_CA.
// When FINANCE_DB_HOST is not set, the pool uses the admin's own DB_* settings (the same MySQL server) with the
// database FINANCE_DB_NAME, default `allegro_finance`. A read-only MySQL user is planned (finance_api_readme.md,
// decision 6): put it in FINANCE_DB_USER / FINANCE_DB_PASSWORD.

export function financeDbConfig(env = process.env) {
  const own = Boolean(env.FINANCE_DB_HOST);
  const pick = (name) => (own ? env[`FINANCE_${name}`] : env[`FINANCE_${name}`] ?? env[name]);
  return {
    host: pick("DB_HOST"),
    port: Number(pick("DB_PORT") || 3306),
    user: pick("DB_USER"),
    password: pick("DB_PASSWORD"),
    database: env.FINANCE_DB_NAME || "allegro_finance",
    sslCa: own ? env.FINANCE_DB_SSL_CA : env.FINANCE_DB_SSL_CA ?? env.DB_SSL_CA,
  };
}

let pool = null;

export function getFinancePool() {
  if (pool) return pool;
  const cfg = financeDbConfig();
  let ssl = null;
  if (cfg.sslCa) {
    const caPath = path.resolve(cfg.sslCa.replace("~", process.env.HOME || ""));
    ssl = { ca: fs.readFileSync(caPath) };
  }
  pool = mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    ssl,
    decimalNumbers: true,
    dateStrings: true, // DATETIME → 'YYYY-MM-DD HH:MM:SS.sss', no time-zone shift
    namedPlaceholders: true,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    keepAliveInitialDelay: 10000,
    timezone: "Z",
  });
  return pool;
}

// execute(), not query(): query() rounds DOUBLE values (hash-sync/README.md).
export async function financeSql(sql, params = {}) {
  const [rows] = await getFinancePool().execute(sql, params);
  return rows;
}

export async function closeFinancePool() {
  if (!pool) return;
  const p = pool;
  pool = null;
  await p.end();
}
