import { google } from 'googleapis';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dal from './dal.js';
import { dirname, resolve } from 'path';

let credentialsPath = '../../../../../tradewit-fc46f051dc0d.json';

// Get __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
 credentialsPath = resolve(__dirname, '../../../../tradewit-fc46f051dc0d.json');
 console.log(credentialsPath);


export default async ({ sheetId, range, dalPush }, week_no) => {
  const credentials = JSON.parse(fs.readFileSync(credentialsPath));
  const auth = new google.auth.GoogleAuth({
    credentials,
    // keyFile: credentialsPath, //path.join(__dirname, credentialsPath),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  // Get list of sheet names
  const metadata = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const sheetNames = metadata.data.sheets.map((s) => s.properties.title);

  const allData = [];

  for (const title of sheetNames) {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${title}${range}`,
    });

    const rows = res.data.values;
    if (!rows || rows.length < 2) continue;

    const [headers, ...dataRows] = rows;

    dataRows.forEach((row) => {
      const rowObject = {};
      headers.forEach((key, i) => {
        rowObject[key] = row[i] || '';
      });
      //   rowObject._sheet = title;
      allData.push(rowObject);
    });
  }
  allData.forEach((row) => {
    dalPush(dal, row);
  });
  return allData;
};
