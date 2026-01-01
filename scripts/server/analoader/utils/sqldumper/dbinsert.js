//var debug = require('debug')('reports-server:filedrop-worker');

import util from "util";
import promisifyAll from "util-promisifyall";
import path from "path";
import mysql from "mysql2/promise";
import FS from "fs";

var fs = promisifyAll(FS);

// var pool = mysql.createPool({
// 	host: 'localhost',
// 	user: 'moti',
// 	port: 3306,
// 	password: '2272',
// 	database: 'everest',
// })
let caPath = "";
if (process.env.DB_SSL_CA) {
  caPath = path.resolve(process.env.DB_SSL_CA.replace("~", process.env.HOME));
  console.log("env: ", process.env.DB_SSL_CA, caPath);
}
console.log(`Mysql connection  ${process.env.DB_HOST} `);

var pool = mysql.createPool({
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
  waitForConnections: true,
  connectionLimit: 10, // Adjust the connection limit as needed
  queueLimit: 0,
});

// var queryAsync = util.promisify(pool.query);

// const getConnection = () => {
//   return pool.getConnectionAsync().disposer(function (connection) {
//     try {
//       connection.release();
//     } catch (e) {}
//   });
// };

Promise.each = async function (arr, fn) {
  // take an array and a function
  for (const item of arr) await fn(item);
};

function enumReportFiles(reportsFolder) {
  return fs.readdirAsync(reportsFolder).then(function (files) {
    // filter .sql files only from data folder
    var sqlFiles = files.filter(function (file) {
      return /\.sql$/i.test(file);
    });

    return sqlFiles.map(function (file) {
      return path.join(reportsFolder, file); //return each files with its full path.
    });
  });
}

async function processReports() {
  var dir_name = process.env.DUMP_FOLDER; //"/home/moti/reports"; //process.argv[2] || __dirname;
  var reportsFolder = path.join(dir_name, "./data");

  console.log("processReports started. data dir:" + reportsFolder);

  let connection = await pool.getConnection();

  ///////////////////////////////////////////////////////////////////////////////////////////
  const files = await enumReportFiles(reportsFolder);
  for (let file of files) {
    try {
      var new_file = file + "_" + process.pid;
      fs.renameSync(file, new_file);
      file = new_file;
      console.log("new file is " + file);
      const fileContent = await fs.readFileAsync(file, "utf8");
      const [rows, fields] = await connection.query(fileContent);
      await fs.unlinkAsync(file);
      console.log(util.format("file %s successfully persisted to db and removed.", file));
    } catch (err) {
      console.error(`Error proccesing file: ${file} ${err}`, err);
      process.stderr.write(`moving to error folder. ${file}`);
      await fs.renameAsync(file, path.join(reportsFolder, "error", path.basename(file)));
    }
  }

  console.log("processReports ended");
  process.exit(0);
}

console.log("sql file drop module loaded");
await processReports();
