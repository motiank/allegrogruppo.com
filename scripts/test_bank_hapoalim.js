// Test for the Bank Hapoalim transactions file (parseBankHapoalim in admin/server/uploads/parsers.js): the row
// key that stops a row from being stored twice in bank_transactions (UNIQUE row_key + INSERT IGNORE).
//
//   $ node scripts/test_bank_hapoalim.js
//
// The layout is the one of "excelNewTransactions.xlsx" (checked 2026-10-26 on a real Jan–Mar 2026 file: 1224
// rows, all keys different). No network, no DB.

import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { parseBankHapoalim } from "../admin/server/uploads/parsers.js";

const sheet = (rows) => {
  const ws = new ExcelJS.Workbook().addWorksheet("גיליון1");
  ws.getRow(3).values = ["תנועות בחשבון"];
  ws.getRow(4).values = ["מספר חשבון  12-584-136663  לתקופה:  01.01.2026 - 31.03.2026  תאריך הפקה  26.10.2026  "];
  ws.getRow(5).values = ["תאריך", "קוד פעולה", "הפעולה", "פרטים", "אסמכתא", "צרור", "חובה", "זכות", "יתרה בש''ח", "הערה"];
  rows.forEach((r, i) => (ws.getRow(6 + i).values = r));
  return ws;
};
const d = (s) => new Date(`${s}T00:00:00Z`);
const wolt = (credit, balance) => [d("2026-01-01"), 175, "זיכוי", "המבצע: SER LICENSE WOLT", 99022330, 99047, "", credit, balance];
const check = [d("2026-03-31"), 493, "שיק", null, 14649, 12855, 2197, "", -58288.05];

const a = parseBankHapoalim(sheet([check, wolt(100, 1200), wolt(100, 1100), wolt(50, 1000)]));
assert.equal(a.account, "12-584-136663");
assert.deepEqual([a.from, a.to], ["2026-01-01", "2026-03-31"]);
assert.equal(a.rows.length, 4);
assert.deepEqual(a.rows[0], { ...a.rows[0], tx_date: "2026-03-31", action_code: "493", reference: "14649", debit: 2197, credit: null, balance: -58288.05 });
assert.equal(new Set(a.rows.map((r) => r.row_key)).size, 4, "two equal real transactions are both kept");

// A later export: the same day's rows in another order, so other balances → the same keys (nothing new).
const b = parseBankHapoalim(sheet([wolt(50, 1150), wolt(100, 1100), wolt(100, 1000), check]));
assert.deepEqual(new Set(b.rows.map((r) => r.row_key)), new Set(a.rows.map((r) => r.row_key)));

// A file taken during the day had one of the two equal rows → the full file adds only the second one.
const early = parseBankHapoalim(sheet([wolt(100, 1100)]));
const keysA = new Set(a.rows.map((r) => r.row_key));
assert.ok(keysA.has(early.rows[0].row_key));
assert.equal(a.rows.filter((r) => r.row_key !== early.rows[0].row_key).length, 3);

console.log("test_bank_hapoalim: OK");
