import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });
import { google } from 'googleapis';
import { executeSql } from './utils/db.js';
import { Parser } from 'json2csv';

import moment from 'moment';
import minimist from 'minimist';
import fs from 'fs';

const credentialsPath = '../../tradewit-fc46f051dc0d.json';
const spreadsheetId = '1pCKOcPJOJUpMaeEMu9lJD_jX_KjFM2EoKy_gdOAE3So';
const range = 'weekly_data!A1:F';
const range_values = [
  ['Name', 'Week1', 'Week2', 'Week3'],
  ['Alice', 10, 20, 30],
  ['Bob', 5, 15, 25],
  ['Carol', 7, 14, 21],
  ['Dave', 9, 18, 27],
];

const q_ = `select c.branchName  , DATE(openat) as dt,  DATE_FORMAT(openat, '%Y-%u') AS  wk,  SUM(diners) as diners, SUM(total) as total, count(*) as orders  
                from allegro.bcom b left join allegro.branches c on b.branchId=c.branchId 
                where diners > 0 and total > 0  GROUP BY branchName, dt, wk order by wk `;

class App {
  constructor(argv_) {
    this.argv = argv_;
    this.start_time = new moment();
    this.createSheets();
  }

  createSheets() {
    this.credentials = JSON.parse(fs.readFileSync(credentialsPath));
    this.folderId = '15Hk4gtVlNObDJPDMZLNHbR4X3if9gXXG';
    this.auth = new google.auth.GoogleAuth({
      credentials: this.credentials,
      scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'],
    });
    this.sheets = google.sheets({ version: 'v4', auth: this.auth });
    this.drive = google.drive({ version: 'v3', auth: this.auth });
  }

  async updateGGLSheet(values) {
    try {
      const result = await this.sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'RAW', // or 'USER_ENTERED' if you want Sheets to evaluate or format data
        requestBody: {
          values,
        },
      });

      console.log(`Cells updated: ${result.data.updatedCells}`);
    } catch (error) {
      console.error('Error updating sheet:', error);
    }
  }

  async getRawData() {
    try {
      const fields = ['branchName', 'dt', 'wk', 'diners', 'total', 'orders'];
      let [rows, db_fields] = await executeSql(q_);
      console.log(`getRawData results length :${rows.length}`);
      //   return [rows, { fields }];
      rows = rows.map((row) => {
        return [row.branchName, row.dt, row.wk, row.diners, row.total, row.orders];
      });
      return [fields, ...rows];
    } catch (e) {
      console.log(e);
    }
  }

  updateCSVFile(jsno4csv) {
    const outputPath = './output.csv';
    if (jsno4csv && jsno4csv.length) {
      // Convert JSON array to CSV
      const json2csvParser = new Parser(jsno4csv[1] || {});
      let csv_text = json2csvParser.parse(jsno4csv[0]);
      fs.writeFileSync(outputPath, csv_text);
      console.log(`CSV file saved to ${outputPath}`);
    } else {
      return { error: `empty results set from getGglSheetCSV ${jsno4csv[0].length}` };
    }
  }

  async main() {
    try {
      let raw_data = await this.getRawData();
      await this.updateGGLSheet(raw_data);

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
