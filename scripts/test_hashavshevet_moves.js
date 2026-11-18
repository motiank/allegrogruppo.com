// Tests of the Hashavshevet import files for cheque reversals (admin/server/modules/hashavshevetMoves.js). No database:
// made-up cheque entries in the shape loadChequeEntries() returns.   node --test scripts/test_hashavshevet_moves.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { reversalMoves, movesWorkbook, movesMovein, IMPORT_COLUMNS, RANGE_NAME, ACTIONS } from "../admin/server/modules/hashavshevetMoves.js";

const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs");
const iconv = require("iconv-lite");

const ENTRIES = [
  { chequeId: 2102, transId: 18115, year: 2026, chequeNo: "17556", payee: 'יקבי רמת הגולן והגליל מכירות והפצה בע"מ', amount: 6221.3, debit: "500207", credit: "110011", valueDate: "2026-11-04" },
  { chequeId: 675, transId: 675, year: 2025, chequeNo: "102030", payee: "עובד", amount: 3000, debit: "450001", credit: "110011", valueDate: "2025-10-09" },
  { chequeId: 9922, transId: 9922, year: 2026, chequeNo: "102032", payee: 'חצרי א.ב ארזים בע"מ', amount: 4720, debit: "500084", credit: "110011", valueDate: "2026-02-23" },
];

test("reversalMoves: one storno per cheque — both sides negative, the cheque number as reference, the action's date and text", () => {
  const { moves, skipped } = reversalMoves(ENTRIES, { 2102: { action: ACTIONS.cancel, date: "2026-11-18" }, 675: { action: ACTIONS.bounced, date: "2025-12-01" }, 9922: { action: ACTIONS.keep } }, { today: "2026-11-18" });
  assert.equal(moves.length, 2);
  assert.deepEqual(skipped, [{ chequeId: 9922, reason: "keep" }]);
  const [a, b] = moves;
  assert.deepEqual([a.reference, a.debit, a.debitAmount, a.credit, a.creditAmount, a.valueDate, a.refDate, a.transType, a.details2], ["17556", "500207", -6221.3, "110011", -6221.3, "2026-11-18", "2026-11-18", "", 'יקבי רמת הגולן והגליל מכירות והפצה בע"מ']);
  assert.equal(a.description, "ביטול שיק 17556 – לא נפרע");
  assert.deepEqual([b.reference, b.debitAmount, b.valueDate, b.description], ["102030", -3000, "2025-12-01", "שיק 102030 חזר מהבנק 01/12/2025"]);
  assert.equal(a.debitAmount, a.creditAmount, "balanced: Hashavshevet's check Journal.014");
  // defaults: no action = cancel today; a date before the cheque's entry is refused; an unknown action is refused
  const d = reversalMoves(ENTRIES.slice(0, 1), {}, { today: "2026-11-18" });
  assert.deepEqual([d.moves[0].action, d.moves[0].valueDate], ["cancel", "2026-11-18"]);
  assert.deepEqual(reversalMoves(ENTRIES.slice(0, 1), { 2102: { action: "cancel", date: "2026-01-01" } }, { today: "2026-11-18" }).skipped[0].reason.startsWith("date 2026-01-01 is before"), true);
  assert.equal(reversalMoves(ENTRIES.slice(0, 1), { 2102: { action: "delete" } }, { today: "2026-11-18" }).skipped.length, 1);
});

test("movesWorkbook: Hashavshevet's field names as headers, text keys and references, number amounts, the defined name on the range, a help sheet", async () => {
  const { moves } = reversalMoves(ENTRIES, {}, { today: "2026-11-18" });
  const buf = await movesWorkbook(moves, { company: "Pastalina", account: "110011", today: "2026-11-18" });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet("תנועות");
  assert.ok(ws, "the data sheet");
  assert.deepEqual(ws.getRow(1).values.slice(1), IMPORT_COLUMNS.map((c) => c.header));
  assert.deepEqual(ws.getRow(1).values.slice(1, 4), ["TransType", "Reference", "Reference2"]);
  assert.equal(ws.rowCount, moves.length + 1);
  const r2 = ws.getRow(2);
  const col = (h) => IMPORT_COLUMNS.findIndex((c) => c.header === h) + 1;
  assert.equal(typeof r2.getCell(col("Reference")).value, "string", "the reference is text (no decimals, no lost zeros)");
  assert.equal(r2.getCell(col("Reference")).value, "17556");
  assert.equal(typeof r2.getCell(col("DebID1")).value, "string");
  assert.equal(r2.getCell(col("DebsuF1")).value, -6221.3);
  assert.equal(r2.getCell(col("CredsuF1")).value, -6221.3);
  assert.equal(r2.getCell(col("ValueDate")).value, "18/11/2026");
  assert.equal(r2.getCell(col("Description")).value, "ביטול שיק 17556 – לא נפרע");
  assert.ok(ws.views[0].rightToLeft);
  // the defined name Hashavshevet lists the table by
  const ranges = wb.definedNames.getRanges(RANGE_NAME);
  assert.ok(ranges && ranges.ranges.length === 1, "one defined name jurnal");
  assert.match(ranges.ranges[0], /תנועות'?!\$A\$1:\$K\$4$/);
  const help = wb.getWorksheet("הסבר");
  assert.ok(help && help.rowCount > 5);
  assert.match(String(help.getRow(2).values[1]), /3 תנועות ביטול/);
});

test("movesMovein: fixed 90-character records in cp1255; a 6-digit cheque number is refused", () => {
  const { moves } = reversalMoves(ENTRIES.slice(0, 1), { 2102: { action: "cancel", date: "2026-11-18" } });
  const buf = movesMovein(moves);
  const text = iconv.decode(buf, "win1255");
  const lines = text.split("\r\n").filter(Boolean);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].length, 88, "88 characters + CRLF = 90");
  assert.equal(lines[0].slice(0, 8), "500207  ");
  assert.equal(lines[0].slice(8, 16), "110011  ");
  assert.equal(lines[0].slice(16, 21), "17556");
  assert.equal(lines[0].slice(21, 27), "181126");
  assert.equal(lines[0].slice(32, 38), "181126");
  assert.equal(lines[0].slice(38, 50).trim(), "-6221.30");
  assert.equal(lines[0].slice(53, 75).trim(), "ביטול שיק 17556 – לא נ".trim().slice(0, 22).trim());
  assert.ok(buf.length === 90, "bytes: cp1255 is one byte per letter");
  const six = reversalMoves(ENTRIES.slice(1, 2), { 675: { action: "cancel", date: "2026-11-18" } });
  assert.throws(() => movesMovein(six.moves), /reference 102030 has more than 5 digits/);
});
