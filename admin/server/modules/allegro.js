import moment from "moment";
import express from "express";
import { executeSql } from "../sources/dbpool.js";
import e from "express";

const names = {
  "64be1926335ee46a739a1ba2": "joya-eatalia",
  "65cda80518611cc1cab248ca": "la-braza",
  "5fd7022862f93c0cf1df8b63": "pasta-lina",
  "5ff41825105007954144ed8d": "pasta-lina",
  "601261162dd7db3f39ca2049": "pasta-lina",
  "655eeb44d541bee19f59e444": "pasta-lina",
  "64251a17042cbcc5928813fd": "eatalia",
  "65bb3fe41ed2912aa9034a18": "or-yam-group",
  "60335c8306f5f03947387bd0": "verda-ono",
  "6322b7febdafdceae5b84cf9": "verda-ono",
  "60b46a83a62b1748e7b3d8a1": "shei",
  "62f48c2a7f9095f113a7add3": "shei",
  "64251a9f37dc3d5093d7ab53": "piemonte",
  "64ddcfdc674a1d497fe49bf8": "pascara",
  "5fd7030f4f421bfe0e2e13bd": "herzliya",
  "5ff419934676f0fddabaef3a": "joya-raanana",
  "6012624f0d491ef6429e127c": "ramat-hayil",
  "60335d23cac0e25c17fe0544": "tel-aviv",
  "60b46ca4e8418d9c860b2b2f": "netanya",
  "62f48ec8ab47895a757e1c76": "modiin",
  "67b6c458d809d6fa30bbdcaa": "rout",
  "6322b93aaf5f6e3b92830433": "petah-tikva",
  "655ef6eb9df0c279bbfb7482": "rosh-pina",
  "65bb40ae6729db482e2ed6f2": "or-yam",
};

export default () => {
  var apiRouter = express.Router();

  const getProperName = (name) => {
    if (name in names) {
      return names[name];
    }
    return name;
  };

  const getDateQryFormat = (groupBy, tableName) => {
    if (tableName === "astrateg" || tableName === "ontopo") {
      return "ts";
    }
    switch (groupBy) {
      case "week":
        return "DATE_FORMAT(DATE_SUB(ts, INTERVAL DAYOFWEEK(ts) - 1 DAY), '%Y-%m-%d')";
      case "month":
        return "DATE_FORMAT(DATE_SUB(ts, INTERVAL DAYOFMONTH(ts) - 1 DAY), '%Y-%m-%d')";
    }
    return "DATE_FORMAT(b.ts, '%Y-%m-%d')";
  };
  const getTotalQryFormat = (metric) => {
    console.log("getTotalQryFormat", metric);
    switch (metric) {
      case "diners":
        return "SUM(b.diners) as total";
      case "income":
        return "SUM(b.total) as total";
      case "ontopo-diners":
        return "SUM(b.diners) as total";
      case "astrateg":
        return "SUM(b.ast_cost) as total";
    }
  };

  const getRestQry = ({ restaurants, groupBy, metric, tableName }) => {
    if (restaurants.length > 0) {
      let rest_qry = ` and c.branchId in ('${restaurants.join("','")}')`;
      return `select c.branchId as gname, ${getDateQryFormat(groupBy, tableName)} as date, ${getTotalQryFormat(metric)}
            from allegro.${tableName} b left JOIN allegro.branches c on b.branchId=c.branchId 
            where  ts BETWEEN :start and :end  ${rest_qry}
            GROUP BY c.branchId, date  order by date ;`;
    }
    return "";
  };

  const getCompanyQry = ({ companies, groupBy, metric, tableName }) => {
    if (companies.length > 0) {
      let cmpn_qry = ` and c.groupId in ('${companies.join("','")}')`;
      return `select c.groupId as gname, ${getDateQryFormat(groupBy, tableName)} as date,  ${getTotalQryFormat(metric)}
            from allegro.${tableName} b left JOIN allegro.branches c on b.branchId=c.branchId 
            where  ts BETWEEN :start and :end  ${cmpn_qry} 
            GROUP BY c.groupId, date  order by date ;`;
    }
    return "";
  };

  const getBrandsQry = ({ brands, groupBy, metric, tableName }) => {
    if (brands[0] == "allegro") {
      return `select 'allegro' as gname, ${getDateQryFormat(groupBy, tableName)} as date, ${getTotalQryFormat(metric)}
            from allegro.${tableName} b left JOIN allegro.branches c on b.branchId=c.branchId 
            where  ts BETWEEN :start and :end  and c.branchId is not NULL
            GROUP BY  date  order by date ;`;
    }
    return "";
  };

  /* 
  const getRestIncomeQry = ({ restaurants, groupBy, metric  }) => {
    if (restaurants.length > 0) {
      let rest_qry = ` and c.branchId in ('${restaurants.join("','")}')`;
      return `select c.branchId as gname, ${getDateQryFormat(groupBy)} as date, ${getTotalQryFormat(metric)}
            from allegro.bcom_cash b left JOIN allegro.branches c on b.branchId=c.branchId 
            where  openat BETWEEN :start and :end  ${rest_qry}
            GROUP BY c.branchId, date  order by date ;`;
    }
    return "";
  };

  const getCompanyIncomeQry = ({ companies, groupBy, metric }) => {
    if (companies.length > 0) {
      let cmpn_qry = ` and c.groupId in ('${companies.join("','")}')`;
      return `select c.groupId as gname, ${getDateQryFormat(groupBy)} as date,  ${getTotalQryFormat(metric)}
            from allegro.bcom_cash b left JOIN allegro.branches c on b.branchId=c.branchId 
            where  openat BETWEEN :start and :end  ${cmpn_qry} 
            GROUP BY c.groupId, date  order by date ;`;
    }
    return "";
  };

  const getBrandsIncomeQry = ({ brands, groupBy, metric }) => {
    if (brands[0] == "allegro") {
      return `select 'allegro' as gname, ${getDateQryFormat(groupBy)} as date, ${getTotalQryFormat(metric)}
            from allegro.bcom_cash b left JOIN allegro.branches c on b.branchId=c.branchId 
            where  openat BETWEEN :start and :end  and c.branchId is not NULL
            GROUP BY  date  order by date ;`;
    }
    return "";
  };

  // and \`source\` not in ('Organic','null')

  const getRestDinersQry = ({ restaurants }) => {
    if (restaurants.length > 0) {
      let rest_qry = ` and c.branchId in ('${restaurants.join("','")}')`;
      return `select c.branchId as gname, week as date, sum(diners) as total
               from allegro.ontopo b LEFT JOIN allegro.branches c on c.branchId=b.branchId 
               where  week BETWEEN :start_week and :end_week ${rest_qry}
               GROUP BY  c.branchId,week
               ORDER BY  week  ;`;
    }
    return "";
  };

  const getCompanyDinersQry = ({ companies }) => {
    if (companies.length > 0) {
      let cmpn_qry = ` and c.groupId in ('${companies.join("','")}')`;
      return `select c.groupId as gname, week as date, sum(diners) as total
               from allegro.ontopo b LEFT JOIN allegro.branches c on c.branchId=b.branchId 
               where   week BETWEEN :start_week and :end_week  ${cmpn_qry} 
               GROUP BY  c.groupId,week
               ORDER BY  week  ;`;
    }
    return "";
  };

  const getBrandsDinersQry = ({ brands }) => {
    if (brands[0] == "allegro") {
      return `select 'allegro' as gname, week as date, sum(diners) as total
      from allegro.ontopo b LEFT JOIN allegro.branches c on c.branchId=b.branchId 
      where  week BETWEEN :start_week and :end_week
      GROUP BY  week
      ORDER BY  week  ;`;
    }
    return "";
  };

  const getRestAstrategQry = ({ restaurants }) => {
    if (restaurants.length > 0) {
      let rest_qry = ` and c.branchId in ('${restaurants.join("','")}')`;
      return `select c.branchId as gname, week as date, sum(diners) as total
               from allegro.astrateg b LEFT JOIN allegro.branches c on c.branchId=b.branchId 
               where  week BETWEEN :start_week and :end_week ${rest_qry}
               GROUP BY  c.branchId,week
               ORDER BY  week  ;`;
    }
    return "";
  };

  const getCompanyAstrategQry = ({ companies }) => {
    if (companies.length > 0) {
      let cmpn_qry = ` and c.groupId in ('${companies.join("','")}')`;
      return `select c.groupId as gname, week as date, sum(diners) as total
               from allegro.ontopo b LEFT JOIN allegro.branches c on c.branchId=b.branchId 
               where   week BETWEEN :start_week and :end_week  ${cmpn_qry} 
               GROUP BY  c.groupId,week
               ORDER BY  week  ;`;
    }
    return "";
  };

  const getBrandsAstrategQry = ({ brands }) => {
    if (brands[0] == "allegro") {
      return `select 'allegro' as gname, week date, sum(diners) as total
      from allegro.ontopo b LEFT JOIN allegro.branches c on c.branchId=b.branchId 
      where  week BETWEEN :start_week and :end_week
      GROUP BY  week
      ORDER BY  week  ;`;
    }
    return "";
  };
*/
  const fillMissingDates = (map, groupBy) => {
    if (map.size === 0) return;
    try {
      const dates = Array.from(map.keys()).sort();
      const start = moment(dates[0]);
      const end = moment(dates[dates.length - 1]);

      const step = 1; //parseInt(groupBy) ? 7 : 1;

      for (let m = start.clone(); m.isSameOrBefore(end); m.add(step, `${groupBy}s`)) {
        const dateStr = m.format("YYYY-MM-DD");
        if (!map.has(dateStr)) {
          console.log(`Filling missing date: ${dateStr}`);
          map.set(dateStr, { date: m.format("MM-DD"), fullDate: m.format("YYYY-MM-DD") });
        }
      }
      console.log("Filling missing dates -Done");
    } catch (error) {
      console.error("Error filling missing dates:", error);
    }
  };

  const mergeArraysByDate = (arrays, groupBy) => {
    const map = new Map();
    const distinctNames = new Set();

    arrays.forEach((arr) => {
      for (const obj of arr) {
        const { date, fullDate, ...rest } = obj;
        Object.keys(rest).forEach((item) => distinctNames.add(item));
        if (!map.has(date)) map.set(fullDate, { date, fullDate });
        Object.assign(map.get(fullDate), rest);
      }
    });

    fillMissingDates(map, groupBy);
    // After processing, fill in missing keys with 0
    for (const row of map.values()) {
      for (const name of distinctNames) {
        if (!(name in row)) {
          row[name] = 0;
        }
      }
    }
    console.log("distinctNames", distinctNames);
    console.log("map values", map.values());
    return [Array.from(map.values()).sort((a, b) => a.fullDate.localeCompare(b.fullDate)), Array.from(distinctNames)];
  };

  const getQry = ({ entities, metric, ...form }) => {
    let companies = [],
      restaurants = [],
      brands = [];

    entities.split(",").forEach((e) => {
      const [type, id] = e.split(":");
      if (type === "c") {
        companies.push(id);
      } else if (type === "r") {
        restaurants.push(id);
      } else if (type === "allegro") {
        brands.push("allegro");
      }
      7;
    });

    switch (metric) {
      case "income":
      case "diners":
        return [
          getRestQry({ ...form, metric, restaurants, companies, tableName: "bcom_cash" }),
          getCompanyQry({ ...form, metric, restaurants, companies, tableName: "bcom_cash" }),
          getBrandsQry({ ...form, metric, restaurants, brands, tableName: "bcom_cash" }),
        ];

      case "ontopo-diners":
        return [
          getRestQry({ ...form, metric, restaurants, companies, tableName: "ontopo" }),
          getCompanyQry({ ...form, metric, restaurants, companies, tableName: "ontopo" }),
          getBrandsQry({ ...form, restaurants, brands, tableName: "ontopo" }),
        ];

      case "astrateg":
        return [
          getRestQry({ ...form, metric, restaurants, companies, tableName: "astrateg" }),
          getCompanyQry({ ...form, metric, restaurants, companies, tableName: "astrateg" }),
          getBrandsQry({ ...form, metric, restaurants, brands, tableName: "astrateg" }),
        ];
      default:
        throw new Error("Unknown metric type");
    }
  };

  const getSundayFromYYYYWW = (yyyyww) => {
    const year = yyyyww.slice(0, 4);
    const week = yyyyww.slice(4);

    // Get Monday of the ISO week
    const monday = moment().isoWeekYear(Number(year)).isoWeek(Number(week)).startOf("isoWeek");

    // Move to Sunday (1 day before Monday)
    const sunday = monday.clone().subtract(1, "days");

    return sunday.format("YYYY-MM-DD"); // or return `sunday` as moment object
  };

  const movingAverage = ([mergedData, dataKeys], windowSize = 7) => {
    const windowQueue = {};
    let windowSum = {};
    dataKeys.forEach((key) => {
      windowQueue[key] = [];
      windowSum[key] = 0;
    });

    mergedData.forEach((row, i) => {
      dataKeys.forEach((key) => {
        const value = row[key] || 0;
        windowQueue[key].push(value);
        windowSum[key] += value;

        // Once our window is larger than windowSize, remove the oldest element
        if (windowQueue[key].length > windowSize) {
          windowSum[key] -= windowQueue[key].shift();
        }

        // Only compute the average if we have a full windowSize-day window
        if (i >= windowSize - 1) {
          const avg = windowSum[key] / windowSize;
          row[key] = parseInt(avg);
        }
      });
    });

    return [mergedData, dataKeys];
  };

  const getNormalizedNergedData = (data, weekDayDiff) => {
    // console.log("getNormalizedDate", date, weekDayDiff);
    return data.map((row) => {
      const { fullDate, date, ...rest } = row;
      const originalDate = moment(fullDate, "YYYY-MM-DD");
      const normalizedDate = originalDate.clone().subtract(weekDayDiff, "days");
      // console.log("getNormalizedDate", date, weekDayDiff, normalizedDate.format("YYYY-MM-DD"));
      return { ...rest, date: normalizedDate.format("MM-DD"), fullDate: normalizedDate.add(1, "year").format("YYYY-MM-DD") };
    });
  };
  const getDates = ({ start, end, compare, ma }) => {
    let weekDayDiff = Number.MAX_VALUE;
    let start_date = moment(start, "YYYY-MM-DD").subtract(parseInt(ma), "days");
    let end_date = moment(end, "YYYY-MM-DD");
    let period_len = end_date.diff(start_date, "days");

    if (parseInt(compare)) {
      const oneYearAgo = start_date.clone().subtract(1, "year"); // 2024-03-28 in this example
      const targetWeekday = start_date.day(); // 0=Sunday, 1=Monday, etc.

      // We'll search ±3 days around oneYearAgo for a date with the same .day() as `targetWeekday`.
      let bestCandidate = oneYearAgo.clone();

      for (let i = -3; i <= 3; i++) {
        const candidate = oneYearAgo.clone().add(i, "days");
        if (candidate.day() === targetWeekday) {
          const diff = Math.abs(i);
          if (diff < weekDayDiff) {
            weekDayDiff = diff;
            bestCandidate = candidate;
          }
        }
      }

      // If we didn't find any match (unlikely), fallback to oneYearAgo
      if (weekDayDiff === Number.MAX_VALUE) {
        bestCandidate = oneYearAgo.clone();
      }
      // weekDayDiff = start_date.diff(bestCandidate, "days");
      start_date = bestCandidate;
      end_date = bestCandidate.clone().add(period_len + 28, "days");
    }

    let start_week = start_date.format("GGGGWW");
    let end_week = end_date.format("GGGGWW");

    return { start: start_date.format("YYYY-MM-DD"), end: end_date.format("YYYY-MM-DD"), start_week, end_week, period_len, weekDayDiff };
  };

  apiRouter.get("/getData/:run_count/:entities/:start/:end/:metric/:ma/:compare/:groupBy", async (req, res) => {
    console.log("allegro getData", req.params);
    const { metric, ma, run_count, groupBy, compare } = req.params;
    const moving_average = parseInt(ma);
    try {
      // let start_date = moment(start, "YYYY-MM-DD").subtract(moving_average, "days").format("YYYY-MM-DD");
      // let start_week = moment(start_date, "YYYY-MM-DD").format("GGGGWW");
      // let end_week = moment(end, "YYYY-MM-DD").format("GGGGWW");

      const { start, end, start_week, end_week, period_len, weekDayDiff } = getDates(req.params);
      console.log(`start: ${start} start_week: ${start_week}, end:${end} end_week: ${end_week}`);
      const weekly_source = metric === "ontopo-diners" || metric == "astrateg";

      const queries = getQry(req.params);
      console.log(queries);
      const qry_params = { ...(weekly_source ? { start: start_week, end: end_week } : { start, end }), period_len, run_count };

      const acc_rows = await Promise.all(queries.map((qry) => (qry ? executeSql(qry, qry_params) : Promise.resolve([[], []]))));

      let temp_map = {};
      const acc_data = acc_rows.map(([rows, fields]) => {
        console.log(`g : ${rows.length}`);
        return rows.map((row, ix) => {
          const { gname, date, total } = row;
          const vname = `${getProperName(gname)}[${run_count}]`;
          temp_map[date] = temp_map[date] || {};
          temp_map[date][vname] = (temp_map[date][vname] || 0) + parseInt(total || "0");
          let dt = weekly_source ? getSundayFromYYYYWW(date) : date;
          let date_str = moment(dt).format("MM-DD");
          return { date: date_str, [vname]: temp_map[date][vname], fullDate: date };
        });
      });

      let [mergedData, dataKeys] = mergeArraysByDate(acc_data, groupBy);
      if (ma && ma !== "none") {
        const windowSize = groupBy == "month" ? parseInt(moving_average / 28) : groupBy == "week" ? parseInt(moving_average / 7) : moving_average;
        [mergedData, dataKeys] = movingAverage([mergedData, dataKeys], windowSize);
        mergedData = mergedData.slice(moving_average);
      }
      mergedData = parseInt(compare) ? getNormalizedNergedData(mergedData, weekDayDiff) : mergedData;

      res.json([mergedData, dataKeys]);
    } catch (error) {
      console.error("Error fetching data:", error);
      res.status(500).json({ error: `Internal Server Error ${error}` });
    }
  });

  return apiRouter;
};
