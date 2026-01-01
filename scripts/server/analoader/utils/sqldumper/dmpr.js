import Debug from "debug";
var debug = Debug("dmpr");
var error = Debug("reports-server:dumpmngr:error");

import util from "util";
import _ from "lodash";

import os from "os";
var endOfLine = os.EOL;
import fs from "fs";
var appendFileAsync = util.promisify(fs.appendFile); // Promise.promisifyAll(FS);
import path from "path";
import { mkdirp } from "mkdirp";
import child_process from "child_process";

import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
var dataFolder = __dirname;
console.log(`dir name ${__dirname}`);

var getReportFilename = function (report) {
    return util.format("%s_%d.sql", report.rid, new Date().getTime());
  },
  dumpToFile = function (report, sqlString, fileName, callback) {
    debug(util.format("writing report %s data to file %s", report.rid, fileName));
    fs.appendFile(path.resolve(dataFolder, "./data", fileName), sqlString, callback);
  },
  getSQLFields = function (report) {
    var sqlFields = Object.keys(report.columns);
    if (report.aggregate) {
      sqlFields = sqlFields.concat(
        report.aggregate.map(function (aggColumnSettings) {
          return aggColumnSettings.dbcolumn;
        }),
      );
    }
    sqlFields = sqlFields
      .map(function (columnName) {
        return util.format("`%s`", columnName);
      })
      .join(", ");
    sqlFields = util.format("(%s)", sqlFields);

    return sqlFields;
  },
  prepareSQLstatement = function (report, sqlValues, sqlFields) {
    var statement = util.format(report.statement, sqlFields, util.format("%s%s", endOfLine, sqlValues)).trim();
    if (!/;$/.test(statement)) {
      statement += ";";
    }

    return statement;
  },
  getEntrySQLValues = function (report, currentEntry, entryBag) {
    var dbColumns, sqlValues;
    dbColumns = Object.keys(report.columns);
    sqlValues = currentEntry.split("@@@").concat(_.values(entryBag) /*add the values of the aggregation fields */).join(",");
    sqlValues = util.format("(%s)", sqlValues);

    return sqlValues;
  },
  getAllEntriesSQLValues = function (report) {
    var allValues = _.map(report.counters.entries, function (entryBag, entryKey) {
      return getEntrySQLValues(report, entryKey, entryBag);
    });

    return allValues.join(util.format(",%s", endOfLine));
  },
  getAllrecordsSQLValues = function (report) {
    var sqlValues = report.counters.records.join(util.format(",%s", endOfLine));
    return sqlValues;
  },
  createFolders = function () {
    mkdirp(path.join(dataFolder, "./data/archive")).then((err) => {
      if (err) console.error(err);
    });

    mkdirp(path.join(dataFolder, "./data/error")).then((err) => {
      if (err) console.error(err);
    });

    //var worker = createFileDropWorker();
  };

// createFolders();

export default {
  init: function (dmpr_cnfig) {
    // if (os.platform() == "win32") {
    //   dataFolder = dmpr_cnfig.win32.baseDir;
    // } else {
    //   dataFolder = dmpr_cnfig.linux.baseDir;
    // }
    dataFolder = process.env.DUMP_FOLDER;
    console.log(dataFolder);
    createFolders();
  },

  flushReportAsync: function (report) {
    var that = this,
      sqlValues,
      sqlFields,
      dumpStatement;

    //debug("flushReportAsync")

    return new Promise(function (resolve, reject) {
      if (report.counters) {
        if (report.aggregate) {
          if (!_.isEmpty(report.counters.entries)) {
            sqlValues = getAllEntriesSQLValues(report);
          }
        } else {
          if (report.counters.records && report.counters.records.length) {
            sqlValues = getAllrecordsSQLValues(report);
          }
        }
      }
      // console.log("sql values " + sqlValues);
      if (sqlValues) {
        sqlFields = getSQLFields(report);
        dumpStatement = prepareSQLstatement(report, sqlValues, sqlFields);
        let dumpFile = getReportFilename(report);
        debug("Writing to :" + dataFolder);
        appendFileAsync(path.resolve(dataFolder, "./data", dumpFile), dumpStatement)
          .then(
            function () {
              var done_msg = util.format("report %s successfully saved to file %s.", report.rid, dumpFile);
              resolve(done_msg);
            },
            function (e) {
              reject(e);
            },
          )
          .catch(function (error) {
            reject(new Error(util.format("error saving report %s to file %s: %j.", report.rid, dumpFile, error)));
          });
      } else {
        //var errorMessage = new Error(util.format("report %s is empty, no data to save.",report.rid));
        //throw errorMessage;
        console.log(util.format("report %s is empty, no data to save.", report.rid));
        resolve();
      }
    });
  },
  createFileDropWorker: function (cb_) {
    debug("creating new file dump worker");
    debug(path.join(__dirname, "/dbinsert.js"));
    var cmnd_ = util.format("node %s %s", path.join(__dirname, "dbinsert.js"), dataFolder);
    console.log("command  " + cmnd_);
    var worker = child_process.exec(cmnd_);
    worker.stderr.on("error", function (data) {
      console.log("****************** error ******************");
      console.log(data);
      console.log("*******************************************");

      debug("worker filedrop error: %j", data);

      try {
        worker.kill("SIGTERM");
      } catch (e) {}
    });

    worker.stdout.on("data", function (data) {
      debug("worker filedrop data: %j", data);
    });

    worker.stderr.on("data", function (data) {
      error("worker filedrop error: %s", data);
    });

    worker.on("exit", function (data) {
      debug("worker filedrop exited: %j", data);
      //createFileDropWorker();
      cb_();
    });

    return worker;
  },
};
