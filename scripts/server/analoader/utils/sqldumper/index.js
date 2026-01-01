var reportsConfig;// = require("../config/reports.json");
var dumpConfig = {};// require("./config/dump.json");
import util from "util";
import _ from 'lodash';
import dmpr from "./dmpr.js";
import serverVariables from "./servervariables.js";
import formatter from "./formatter.js";



var rptObj = function (rid) {


	this.total = 0;
	this.entries = {};
	this.records = [];
	this.startTime = new Date();
	this.totalCounters = 0;

	this.getConfig = function () {
		return reportsConfig.reports[rid]
	};


	this.getColumnsValues = function (columns, request) {

		var values = {};
		_.forEach(columns, function (columnDescription, columnName) {

			// Progressive Enhancement of the value from default to the desired value. 
			var tmpVal, columnValue = columnDescription.defaultValue || "";
			if (_.isString(columnDescription.fromServerVariable) && _.isFunction(serverVariables[columnDescription.fromServerVariable])) {

				tmpVal = serverVariables[columnDescription.fromServerVariable](request);
			}

			else if (_.isString(columnDescription.fromQueryString)) {
				// try to get from querystring based on defined name mapping
				tmpVal = request.query[columnDescription.fromQueryString];
			}

			else if (!_.isUndefined(request.query[columnName])) {
				// try to get from querystring based on the column name
				tmpVal = request.query[columnName];
			}

			else if (!_.isUndefined(columnDescription.defaultValue)) {
				// try to get from the column default value
				tmpVal = columnDescription.defaultValue;
			}

			columnValue = !_.isUndefined(tmpVal) ? tmpVal : columnValue;
			values[columnName] = columnValue;

		});

		return values

	};

	this.formatValue = function (report, key, value) {

		var columnDescription = report.columns[key],
			columnFormatting = columnDescription.formatting;
		if (columnFormatting) {

			return formatter(columnFormatting, value);

		}

		else {

			return value;
		}

	};



	this.addToRecords = function (currentValues) {
		var cnfg_ = this.getConfig();
		//1.format the record values prior to saving.
		var formatterValues = _.mapValues(currentValues, function (value, key, obj) {

			return this.formatValue(cnfg_, key, value);

		}.bind(this));
		//2. add the formatter values to the report collection
		const rec_=util.format("(%s)", _.values(formatterValues).join(",")	);
		// console.log("rec_ "+rec_);
		this.records.push(rec_);

	};



	this.addToCounters = function (currentValues, request) {

		var cnfg_ = this.getConfig();

		var entryKey = _.map(currentValues, function (value, key) {

			return formatValue(cnfg_, key, value);

		}).join("@@@"),
			entryBag = this.entries[entryKey] = this.entries[entryKey] || {};
		this.aggregate.forEach(function (aggColumn) {

			entryBag[aggColumn.dbcolumn] = entryBag[aggColumn.dbcolumn] || 0;
			if (!aggColumn.match) {
				// no special matching pattern, increase counter for every hit to this bag.
				entryBag[aggColumn.dbcolumn]++;

			}

			else {
				// matching pattern column, increase hits if the column linking field and value from query string match.
				if (request.query[aggColumn.match.queryField] === aggColumn.match.value.toString()) {

					entryBag[aggColumn.dbcolumn]++;

				}
			}

		});


	};

	this.addReportValues = function (currentValues, request, flush_cb) {
		// add total hits if not exists yet.
		var cnfg_ = this.getConfig();

		this.total++;
		if (cnfg_.aggregate) {
			// add report values to counter on aggregate report
			this.addToCounters(currentValues, request);

		} else {
			this.addToRecords(currentValues);
		}

		// should we dump the report into a file now ?
		this.lastDump = this.lastDump || (new Date()).getTime();
		var dump_elps = (new Date()).getTime() - this.lastDump;
		//debug("dumping check total %d, max %d, elapse %d ",this.total , dumpConfig.maxRecords,dump_elps )
		if (this.total >= dumpConfig.maxRecords || dump_elps > (dumpConfig.interval || 5 * 60 * 1000)) {
			//debug("dumping time total %d, max %d",this.total , dumpConfig.maxRecords)
			//this.flush();
			this.lastDump = (new Date()).getTime();
			if (flush_cb)
				flush_cb();
		}
	}


	this.push = function (req, flush_cb) {
		var cnfg_ = this.getConfig();
		if (cnfg_) {
			var currentValues = this.getColumnsValues(cnfg_.columns, req);
			this.addReportValues(currentValues, req, flush_cb);
		}

	};

	this.flush = function () {
		return dmpr.flushReportAsync(this.getConfig());
	}

	return this;
}



const sqlDumpr = (reports_config, dump_settings) => {


	const init = () => {

		reportsConfig = reports_config;
		dumpConfig = dump_settings || dumpConfig;

		_.forEach(reportsConfig.reports, function (reportObject, rid) {
			reportObject.rid = rid;
			//initReportSettings(reportObject);
		});

		// setInterval(function flushAllReports() {

		// 	debug("flushing all reports...");
		// 	async.forEachOf(reportsConfig, function (report, rid, cb) {
		// 		report.flushPromise =  report.flushPromise || createFlushPromise(report);
		// 		return report.flushPromise.then(function () {

		// 			cb(null);

		// 		});

		// 	});

		// }, dumpConfig.interval);
		dmpr.init(reports_config.dmpr)
	};


	init();
	return {
		"pushReport": function (req) {

			var rid = (req.params && req.params.rid) || (req.query && req.query.rid) || req.rid;
			// console.log("pushReport "+rid)
			var report_ = reportsConfig.reports[rid];
			if (report_) {
				if (!report_.counters)
					report_.counters = new rptObj(rid);
				report_.counters.push(req, () => {
					this.flush(null);
				});
			} else {
				// debug("pushReport reports id is missing")
			}

		},

		"reportStatus": function (req, fullStats) {


		},

		"flush": function (callback_) {
			// debug("sync flushing all reports...");
			var flush_promises = [];
			_.forEach(reportsConfig.reports, function (report, rid) {
				if (report.counters && report.counters.records) {
					// debug("flush report %s %d", rid, report.counters.records.length);
					flush_promises.push(report.counters.flush());
					report.counters = new rptObj(rid);
				}
			});

			Promise.all(flush_promises).then(() => {
				console.log("flush all done!");
				setTimeout(() => {
					this.dump(callback_)
				}, 2000)

			}, (e) => {
				console.log("sql dmpr flush error:" + e)
			});

			return true;

		},
		"dump": function (callback_) {
			console.log("Start drop work ...")
			dmpr.createFileDropWorker(() => {
				console.log("Done drop work")
				if (callback_)
					callback_();
			});
		}


	};

};

export default sqlDumpr;