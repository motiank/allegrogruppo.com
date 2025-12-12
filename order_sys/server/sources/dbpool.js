import promisifyAll from "util-promisifyall";
import mysql from "mysql2/promise";

import path from "path";
import FS from "fs";
var fs = promisifyAll(FS);
let db_pool = null;
const getDbPool = () => {
  if (!db_pool) {
    let caPath = "";
    if (process.env.DB_SSL_CA) {
      caPath = path.resolve(process.env.DB_SSL_CA.replace("~", process.env.HOME));
      console.log(`Create db pool using ssl file: ${caPath}`);
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
      connectionLimit: 10, // Limit the number of connections in the pool
      queueLimit: 0,
      keepAliveInitialDelay: 10000,
      namedPlaceholders: true,
      timezone: "Z",
    });
  }
  return db_pool;
};

const executeSql = async (sql_query, params = {}, callback = null) => {
  try {
    let pool = await getDbPool();
    const result = await pool.execute(sql_query, params);
    
    // Support callback pattern for backward compatibility
    if (callback) {
      const db_res = {
        getRes: () => ({
          meta: {
            err: null,
            resType: 'content'
          },
          rows: result[0] || [],
          rowCount: result[1]?.affectedRows || 0
        })
      };
      callback(db_res);
      return;
    }
    
    return result;
  } catch (e) {
    console.log(`==>>executeSql SQL error ${e}`);
    
    // Support callback pattern for errors
    if (callback) {
      const db_res = {
        getRes: () => ({
          meta: {
            err: e.message || 'SQL error',
            resType: 'error'
          },
          rows: []
        })
      };
      callback(db_res);
      return;
    }
    
    throw e;
  }
};

export { getDbPool, executeSql };
