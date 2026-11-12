// A file answer: the rows of the request's results as a Google Sheet in the owner's Drive folder (owner 2026-11-09:
// "don't show them, put them all in a file"). The sheet is built as an Excel workbook (exceljs, from the repo root
// like answerExcel.js) and uploaded to Drive with conversion, so only the Drive API is needed — with the invoice
// agent's Google login (the same files the admin uses: INVOICE_DRIVE_CREDENTIALS / INVOICE_DRIVE_TOKEN, scope
// drive.file). The folder (JOYA_SHEETS_FOLDER, the folder id) is shared with that login; the file is owned by the
// accountant's account and anyone with access to the folder can open it.
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';
import { google } from 'googleapis';
import { cellDate, tabsOf } from '../lib/sheetTabs.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SHEET = 'application/vnd.google-apps.spreadsheet';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_ROWS = 50000;

export function sheetSettings(env = process.env) {
  const p = (v, d) => path.resolve(repoRoot, v || d);
  return {
    folder: String(env.JOYA_SHEETS_FOLDER || '').trim() || null,
    credentials: p(env.INVOICE_DRIVE_CREDENTIALS, 'invoice-agent/credentials.json'),
    token: p(env.INVOICE_DRIVE_TOKEN, 'invoice-agent/data/token.json'),
  };
}

/** Why a sheet cannot be made, or null. */
export function sheetsUnavailable(env = process.env) {
  const s = sheetSettings(env);
  if (!s.folder) return 'no Drive folder for files is set (JOYA_SHEETS_FOLDER)';
  if (!fs.existsSync(s.credentials)) return 'the Google OAuth client file is missing (INVOICE_DRIVE_CREDENTIALS)';
  if (!fs.existsSync(s.token)) return 'the Google login of the invoice agent is missing (INVOICE_DRIVE_TOKEN)';
  return null;
}

let client = null;
function auth() {
  if (client) return client;
  const s = sheetSettings();
  const raw = JSON.parse(fs.readFileSync(s.credentials, 'utf8'));
  const c = raw.installed ?? raw.web;
  if (!c) throw new Error('INVOICE_DRIVE_CREDENTIALS is not an OAuth client file');
  const saved = JSON.parse(fs.readFileSync(s.token, 'utf8'));
  client = new google.auth.OAuth2(c.client_id, c.client_secret);
  client.setCredentials(saved);
  return client;
}

/**
 * The workbook of the results: one tab per row list (lib/sheetTabs.js), a last tab "Joya" with the question, the date,
 * the calculations and their params. Numbers as numbers, YYYY-MM-DD as dates.
 */
export async function workbookOf({ question, lang = 'he', today, calcs = [], columns = null }, results) {
  const tabs = tabsOf(results, columns);
  if (!tabs.length) throw Object.assign(new Error('the results have no rows to put in a file'), { code: 'NO_ROWS' });
  const he = lang !== 'en';
  const about = [[he ? 'שאלה' : 'Question', question], [he ? 'תאריך' : 'Date', today || new Date().toISOString().slice(0, 10)], ...calcs.map((c) => [c.calc, JSON.stringify(c.params || {})]), [he ? 'מקור' : 'Source', 'Joya HQ']];
  const { buffer, rows } = await workbookFromTabs(tabs, { he, about });
  return { buffer, tabs: tabs.map((t) => ({ name: t.name, calc: t.calc, rows: Math.min(t.rows.length, MAX_ROWS), columns: t.columns.length })), rows };
}

const TONE_COLOR = { actual: 'FF1E7B34', expected: 'FFC00000' };

/** One worksheet: a bold header row, dates as dates, numbers formatted, a filter on the header, fitted widths; `_style` and `_tone` rows are styled. */
function writeTab(wb, t, he) {
  const ws = wb.addWorksheet(t.name, { views: [{ rightToLeft: he, state: 'frozen', ySplit: 1 }] });
  const head = ws.addRow(t.columns);
  head.font = { bold: true };
  head.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
    c.border = { bottom: { style: 'thin' } };
  });
  for (const r of t.rows.slice(0, MAX_ROWS)) {
    const x = ws.addRow(t.columns.map((k) => cellDate(r[k]) ?? (r[k] === true ? 'yes' : r[k] === false ? 'no' : r[k] ?? null)));
    // a sum row (_style total = a day, grand = the whole tab): bold, shaded
    if (r._style) {
      x.font = { bold: true };
      if (r._style === 'grand') x.eachCell({ includeEmpty: true }, (c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } }; c.border = { top: { style: 'thin' } }; });
      else x.eachCell({ includeEmpty: true }, (c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } }; });
    }
    // the row's tone (owner 2026-11-12, the cheques file): actual = a real bank balance → green; expected → red
    if (TONE_COLOR[r._tone]) x.font = { ...(x.font || {}), color: { argb: TONE_COLOR[r._tone] } };
    t.columns.forEach((k, i) => {
      const cell = x.getCell(i + 1);
      if (cellDate(r[k])) cell.numFmt = 'dd.mm.yyyy';
      else if (typeof r[k] === 'number' && !Number.isInteger(r[k])) cell.numFmt = '#,##0.00';
      else if (typeof r[k] === 'number' && Math.abs(r[k]) >= 1000) cell.numFmt = '#,##0';
    });
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: t.columns.length } };
  t.columns.forEach((k, i) => {
    const w = Math.max(String(k).length, ...t.rows.slice(0, 200).map((r) => String(r[k] ?? '').length));
    ws.getColumn(i + 1).width = Math.min(Math.max(w + 2, 8), 50);
  });
  return Math.min(t.rows.length, MAX_ROWS);
}

/**
 * An Excel workbook of ready tabs [{ name, columns, rows }] plus a last tab "Joya" with `about` = [[label, value]…].
 * @returns {Promise<{ buffer: Buffer, rows: number }>}
 */
export async function workbookFromTabs(tabs, { he = true, about = [] } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Joya HQ';
  let total = 0;
  for (const t of tabs) total += writeTab(wb, t, he);
  const ws = wb.addWorksheet('Joya', { views: [{ rightToLeft: he }] });
  for (const [k, v] of about) ws.addRow([k, v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : v]);
  ws.getColumn(1).width = 22;
  ws.getColumn(2).width = 90;
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), rows: total };
}

/** The file's name in Drive: the plan's title or the question, then "· Joya · date time". */
export function fileNameOf(title, question, when = new Date()) {
  const base = String(title || question || 'Joya').replace(/\s+/g, ' ').trim().slice(0, 80);
  const d = when.toISOString().slice(0, 16).replace('T', ' ');
  return `${base} · Joya · ${d}`;
}

/**
 * Builds the sheet and uploads it to the folder → { id, url, name, tabs, rows }. Throws with .code NO_ROWS when there
 * is nothing to export, FILE_UNAVAILABLE when the login or folder is not set up.
 */
export async function createSheet({ title, question, lang, today, calcs, columns = null }, results) {
  const why = sheetsUnavailable();
  if (why) throw Object.assign(new Error(why), { code: 'FILE_UNAVAILABLE' });
  const { buffer, tabs, rows } = await workbookOf({ question, lang, today, calcs, columns }, results);
  return { ...(await uploadWorkbook(fileNameOf(title, question), buffer)), tabs, rows };
}

const FIXED_PROP = 'joyaFixed'; // appProperties key that marks a fixed file (readable with scope drive.file: the app made it)

/**
 * A FIXED file (owner 2026-11-11: "a fixed file that is updated all the time"): the Google Sheet marked
 * appProperties.joyaFixed = key in the folder is replaced with the new workbook — same id, same link; when there is
 * none yet it is created. → { kind, id, url, name, created }.
 */
export async function upsertFixedSheet({ key, name, buffer }) {
  const why = sheetsUnavailable();
  if (why) throw Object.assign(new Error(why), { code: 'FILE_UNAVAILABLE' });
  const drive = google.drive({ version: 'v3', auth: auth() });
  const found = await drive.files.list({
    q: `appProperties has { key='${FIXED_PROP}' and value='${String(key).replace(/'/g, '')}' } and trashed = false`,
    fields: 'files(id,name,webViewLink)',
    pageSize: 5,
  });
  const existing = found.data.files?.[0] || null;
  if (existing) {
    const r = await drive.files.update({ fileId: existing.id, requestBody: { name }, media: { mimeType: XLSX, body: Readable.from([buffer]) }, fields: 'id,name,webViewLink' });
    return { kind: 'sheet', id: r.data.id, url: r.data.webViewLink, name: r.data.name, created: false };
  }
  const r = await drive.files.create({
    requestBody: { name, mimeType: SHEET, parents: [sheetSettings().folder], appProperties: { [FIXED_PROP]: String(key) } },
    media: { mimeType: XLSX, body: Readable.from([buffer]) },
    fields: 'id,name,webViewLink',
  });
  return { kind: 'sheet', id: r.data.id, url: r.data.webViewLink, name: r.data.name, created: true };
}

/** Any Excel workbook (a buffer) → a Google Sheet in the folder: { kind, id, url, name, createdAt }. */
export async function uploadWorkbook(name, buffer) {
  const why = sheetsUnavailable();
  if (why) throw Object.assign(new Error(why), { code: 'FILE_UNAVAILABLE' });
  const drive = google.drive({ version: 'v3', auth: auth() });
  const r = await drive.files.create({
    requestBody: { name, mimeType: SHEET, parents: [sheetSettings().folder] },
    media: { mimeType: XLSX, body: Readable.from([buffer]) },
    fields: 'id,name,webViewLink',
  });
  return { kind: 'sheet', id: r.data.id, url: r.data.webViewLink, name: r.data.name, createdAt: new Date().toISOString() };
}
