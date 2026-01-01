import dotenv from 'dotenv';
//dotenv.config({ path: "./.localenv" });
dotenv.config({ path: '../.env' });

import moment from 'moment';
import minimist from 'minimist';
import bcomApiLoad, { getRecord } from './bcom_api_loader.js';
import gglSheetLoader from './ggl_sheet_loader.js';
import dal from './dal.js';
import astrateg from './astrateg.js';
import ontopo from './ontopo.js';

const src_path = '/home/moti/dataSrc/algro';

const csv_fields = ['הנחה', 'הנחה(סכום)', 'מספר הזמנה', 'מספר שולחן', 'מקור הזמנה', 'נסגרה', 'נפתחה', 'סה״כ הזמנה', 'סועדים', 'סניף', 'שירות(סכום)'];

class App {
  constructor(argv_) {
    this.argv = argv_;
    this.start_time = new moment();
  }

  flush() {
    return new Promise((resolve, reject) => {
      dal.flush(() => {
        console.log(`dal flush!! after ${moment().diff(this.start_time, 'seconds')} sec. wait for 1 sec ...`);
        dal.dump(() => {
          console.log('FINAL DUMP IS DONE!!');
          resolve();
        });
      });
    });
  }

  async main() {
    let dates = { startDate: '01/01/2025', endDate: '31/12/2025' };
    // let dates = { startDate: '01/01/2023', endDate: '31/12/2023' };
    try {
      const dalPush = async (src, rows) => {
        const table_name = 'bcom_cash'; // this.argv.t;
        // console.log(file, table_name, rows.length);
        return new Promise((resolve, reject) => {
          try {
            console.log(rows.length, moment().diff(this.start_time, 'seconds'));
            rows.forEach((row, ix_) => {
              const bcm_row = getRecord(row);
              dal.push(table_name, bcm_row);
            });
          } catch (e) {
            console.log(`Error pushing record ${src} ${rows.length} ${e}`);
            console.log(e);
          }
          resolve();
        });
      };
      await bcomApiLoad(dates, dalPush);
      await gglSheetLoader(ontopo, dates);
      await gglSheetLoader(astrateg, dates);
      await this.flush();
      console.log(`Main is don ${moment().diff(this.start_time, 'seconds')} sec.`);
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
