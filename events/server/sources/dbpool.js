import promisifyAll from "util-promisifyall";
import mysql from "mysql2/promise";

import path from "path";
import FS from "fs";
var fs = promisifyAll(FS);

// Shared MySQL connection pool for the events service.
// Mirrors admin/server/sources/dbpool.js so all services use the same DB
// (the `allegro` database) and the same connection conventions.
let db_pool = null;

const getDbPool = () => {
  if (!db_pool) {
    let caPath = "";
    if (process.env.DB_SSL_CA) {
      caPath = path.resolve(process.env.DB_SSL_CA.replace("~", process.env.HOME));
      console.log(`[events] Create db pool using ssl file: ${caPath}`);
    }

    db_pool = mysql.createPool({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT,
      ssl: process.env.DB_SSL_CA
        ? {
            ca: fs.readFileSync(caPath),
          }
        : null,
      decimalNumbers: true,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      keepAliveInitialDelay: 10000,
      namedPlaceholders: true,
      timezone: "Z",
    });
  }
  return db_pool;
};

// Promise-style query helper. Returns the raw mysql2 result tuple
// [rows, fields] so callers can destructure: const [rows] = await executeSql(...)
const executeSql = async (sql_query, params = {}) => {
  try {
    const pool = await getDbPool();
    return await pool.execute(sql_query, params);
  } catch (e) {
    console.log(`[events] ==>>executeSql SQL error ${e}`);
    throw e;
  }
};

export { getDbPool, executeSql };
