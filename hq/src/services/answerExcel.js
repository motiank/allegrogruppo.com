// One table of an AI answer as an Excel file (the chat's "Download Excel" link under each table).
// exceljs comes from the repo root's node_modules (the admin uses it), like shared/wage.js.
import ExcelJS from 'exceljs';
import { answerTables, cellNumber } from '../../lib/answerTables.js';
import { err } from '../db.js';
import { getRequest } from './ai.js';

export async function answerTableXlsx(access, requestId, n) {
  const r = await getRequest(access, requestId);
  const t = answerTables(r.answer)[Number(n)];
  if (!t) throw err('NOT_FOUND', 'no such table in this answer');
  return { fileName: `joya-${r.id}-${Number(n) + 1}.xlsx`, buffer: await tableXlsx(r, t) };
}

/** The workbook of one table: the question and the date on top, then the table; number cells as numbers. */
export async function tableXlsx(r, t) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Joya HQ';
  const he = r.lang !== 'en';
  const ws = wb.addWorksheet('Joya', { views: [{ rightToLeft: he, state: 'frozen', ySplit: 3 }] });
  ws.addRow([r.question]).font = { bold: true };
  ws.addRow([`${new Date(r.answeredAt || r.createdAt).toISOString().slice(0, 10)} · Joya HQ`]).font = { color: { argb: 'FF666666' }, size: 9 };
  const head = ws.addRow(t.header);
  head.font = { bold: true };
  head.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
    c.border = { bottom: { style: 'thin' } };
  });
  for (const row of t.rows) {
    const x = ws.addRow(row.map((c) => cellNumber(c)?.value ?? c));
    row.forEach((c, i) => {
      const num = cellNumber(c);
      if (!num) return;
      const cell = x.getCell(i + 1);
      const base = Number.isInteger(num.value) ? '#,##0' : '#,##0.00';
      cell.numFmt = num.percent ? `${Number.isInteger(num.value) ? '0' : '0.0'}"%"` : num.money ? `${base}" ₪"` : base;
    });
  }
  t.header.forEach((h, i) => {
    const w = Math.max(String(h).length, ...t.rows.map((r) => String(r[i] ?? '').length));
    ws.getColumn(i + 1).width = Math.min(Math.max(w + 2, 8), 50);
  });
  return wb.xlsx.writeBuffer();
}
