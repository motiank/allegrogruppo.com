import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });
import minimist from 'minimist';
import { executeSql } from './utils/db.js';

class App {
  constructor(argv_) {
    this.argv = argv_;
  }
  async getBrnaches() {
    try {
      const q_ = `select branchId, branchName from allegro.branches`;
      let [rows, db_fields] = await executeSql(q_);
      return rows;
    } catch (e) {
      console.log(e);
    }
  }

  async updateMA(branchId) {
    const ma_tail = 28;
    const q_ = `insert ignore  into allegro.bcom_ma (branchId, openat, total, diners, orders)
                SELECT
                    branchId,
                    dt,
                    AVG(total) OVER (
                        ORDER BY dt
                        ROWS BETWEEN ${ma_tail} PRECEDING AND CURRENT ROW
                    ) AS total_ma,
                    AVG(diners) OVER (
                        ORDER BY dt
                        ROWS BETWEEN ${ma_tail} PRECEDING AND CURRENT ROW
                    ) AS diners_ma,
                    AVG(orders) OVER (
                        ORDER BY dt
                        ROWS BETWEEN ${ma_tail} PRECEDING AND CURRENT ROW
                    ) AS orders_ma
                FROM (select branchId  , DATE(openat) as dt,  SUM(diners) as diners, SUM(total) as total, count(*) as orders  
                                from allegro.bcom b 
                                where branchId='${branchId}'   GROUP BY branchId, dt order by dt desc) as t
                ORDER BY dt;`;
    // console.log(q_);
    await executeSql(q_);
  }

  async main() {
    try {
      let branches_ = await this.getBrnaches();
      for (var branch of branches_) {
        console.log(`update moving average for branch ${branch.branchName}`);
        await this.updateMA(branch.branchId);
      }
    } catch (e) {
      console.log(`Global error ${e}`);
    }
  }
}

//command line sample
//node ./admin/scripts/backtest/databuild/ngloader.js   -t indices --loc
try {
  var argv = minimist(process.argv.slice(2));
  var app_ = new App(argv);
  await app_.main();
  console.log('App is done ');
  setTimeout(function () {
    process.exit(0);
  }, 3000);
} catch (e) {
  console.log(e);
}
