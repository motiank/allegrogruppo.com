// A file attached to a chat question (owner 2026-11-10: "השוואת כרטסת — the user uploads the supplier's or customer's
// statement, PDF or Excel, and clicks send"). The server turns it into TEXT here, nothing else: the planner (Claude,
// through the runner) reads the text from context.attachment and extracts the rows. Joya keeps only the text
// (joya_ai_requests.meta_json.attachment), not the file.
//   Excel / CSV → one block per sheet, tab-separated cells (exceljs from the repo root, like answerExcel.js)
//   PDF        → `pdftotext -layout` when it is installed (best for Hebrew tables), else pdf-parse (pure JS)
import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import ExcelJS from 'exceljs';
import { err } from '../db.js';

const run = promisify(execFile);
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_TEXT_CHARS = 150_000; // ≈ 2,000 statement lines; more is cut and said
const KINDS = { pdf: ['application/pdf'], xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], xls: ['application/vnd.ms-excel'], csv: ['text/csv', 'text/plain'] };

export function kindOf(name, mime) {
  const ext = String(name || '').toLowerCase().split('.').pop();
  if (['pdf', 'xlsx', 'xls', 'csv', 'txt'].includes(ext)) return ext === 'txt' ? 'csv' : ext;
  for (const [k, mimes] of Object.entries(KINDS)) if (mimes.includes(String(mime || '').toLowerCase())) return k;
  return null;
}

let pdftotext = null; // null = not checked yet
async function hasPdftotext() {
  if (pdftotext != null) return pdftotext;
  try {
    await run('pdftotext', ['-v']);
    pdftotext = true;
  } catch (e) {
    pdftotext = e.code !== 'ENOENT'; // -v exits 0 or 99; only "not found" means no
  }
  return pdftotext;
}

async function pdfText(buffer) {
  if (await hasPdftotext()) {
    const tmp = path.join(os.tmpdir(), `joya-${process.pid}-${Date.now()}.pdf`);
    try {
      fs.writeFileSync(tmp, buffer, { mode: 0o600 });
      const { stdout } = await run('pdftotext', ['-layout', '-enc', 'UTF-8', tmp, '-'], { maxBuffer: 50 * 1024 * 1024 });
      return { text: stdout, tool: 'pdftotext' };
    } finally {
      try { fs.unlinkSync(tmp); } catch {}
    }
  }
  const { default: parse } = await import('pdf-parse/lib/pdf-parse.js');
  const out = await parse(buffer);
  return { text: out.text, tool: 'pdf-parse', pages: out.numpages };
}

const cell = (v) => {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((x) => x.text).join('');
    if (v.result != null) return cell(v.result);
    if (v.text != null) return String(v.text);
    if (v.hyperlink) return String(v.text ?? v.hyperlink);
    return JSON.stringify(v);
  }
  return String(v);
};

async function excelText(buffer, kind) {
  const wb = new ExcelJS.Workbook();
  if (kind === 'csv') {
    const text = buffer.toString('utf8').replace(/^﻿/, '');
    return { text, sheets: 1 };
  }
  if (kind === 'xls') throw err('BAD_REQUEST', 'an old .xls file cannot be read; save it as .xlsx or PDF and send again');
  await wb.xlsx.load(buffer);
  const parts = [];
  for (const ws of wb.worksheets) {
    const lines = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells = [];
      row.eachCell({ includeEmpty: true }, (c, i) => (cells[i - 1] = cell(c.value).replace(/\s+/g, ' ').trim()));
      if (cells.some(Boolean)) lines.push(cells.join('\t'));
    });
    if (lines.length) parts.push(`### ${ws.name}\n${lines.join('\n')}`);
  }
  return { text: parts.join('\n\n'), sheets: wb.worksheets.length };
}

/**
 * The attachment as the request keeps it: { name, kind, bytes, chars, cut, tool?, pages?, sheets?, text }.
 * Throws BAD_REQUEST for a kind we cannot read or an empty text (a scanned PDF).
 */
export async function extractAttachment({ name, mime, buffer }) {
  if (!buffer?.length) throw err('BAD_REQUEST', 'the file is empty');
  if (buffer.length > MAX_FILE_BYTES) throw err('BAD_REQUEST', `the file is bigger than ${MAX_FILE_BYTES / 1024 / 1024} MB`);
  const kind = kindOf(name, mime);
  if (!kind) throw err('BAD_REQUEST', 'only PDF, Excel (.xlsx) or CSV files can be read');
  const out = kind === 'pdf' ? await pdfText(buffer) : await excelText(buffer, kind);
  let text = String(out.text || '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) throw err('BAD_REQUEST', kind === 'pdf' ? 'no text in this PDF (a scanned image?) — send an Excel or a PDF with text' : 'the file has no text');
  const cut = text.length > MAX_TEXT_CHARS;
  if (cut) text = text.slice(0, MAX_TEXT_CHARS);
  return { name: String(name || 'file').slice(0, 200), kind, bytes: buffer.length, chars: text.length, cut, ...(out.tool ? { tool: out.tool } : {}), ...(out.pages ? { pages: out.pages } : {}), ...(out.sheets ? { sheets: out.sheets } : {}), text };
}
