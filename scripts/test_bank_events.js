// Tests of the bank "transaction status" file (Bank Hapoalim "סטטוס עסקאות"): the parser (admin/server/uploads/parsers.js
// parseBankEvents), the recognizer and the merge with the bank statement (admin/server/modules/bankEvents.js
// matchTransfers). No network, no DB:  node --test scripts/test_bank_events.js
import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { parseBankEvents, parsePayee, eventTypeCode } from "../admin/server/uploads/parsers.js";
import { recognizeFile } from "../admin/server/uploads/recognize.js";
import { matchTransfers, isTransferLine, payeeOfDetails, fileAccountsOf, MATCH_WINDOW_DAYS } from "../admin/server/modules/bankEvents.js";

const d = (s) => new Date(`${s}Z`);
const sheet = (rows) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("גיליון1");
  ws.getRow(3).values = ["סטטוס עסקאות"];
  ws.getRow(4).values = ["מספר חשבון  12-584-136663  תאריך הפקה  13.11.2026  "];
  ws.getRow(5).values = ["סוג עסקה", "שם המוטב", "סכום", "מטבע", "מועד הזרמה", "תאריך ביצוע", "מזרים העסקה", "סטאטוס"];
  rows.forEach((r, i) => (ws.getRow(6 + i).values = r));
  wb.addWorksheet("גיליון2");
  return wb;
};
const ROWS = [
  ["העברה", 'אורי ארובות בע"מ 20-435-108233', 3304, "ils", d("2025-05-26T13:08:00"), d("2025-05-26T13:08:00"), "ברסקי נופר", "בוטלה"],
  ["העברה", 'פרימיום איטליה  בע"מ 12-407-56084', 150000, "ils", d("2025-04-24T11:16:00"), d("2025-04-24T11:16:00"), "אנקונינה מרדכי", "הועברה לביצוע"],
  ["העברה", "מיט2איט 17-627-61444369", 1500, "ils", d("2026-06-01T12:13:00"), d("2026-06-01T12:13:00"), "ברסקי נופר", "הועברה לביצוע"],
  ["העברה", "מיט2איט 17-627-61444369", 1500, "ils", d("2026-06-01T12:13:00"), d("2026-06-01T12:13:00"), "ברסקי נופר", "הועברה לביצוע"], // the same order twice
  ["הקמת הרשאה", 'עודד דניאל בע"מ                          - 50462', 10000, "ils", d("2025-03-30T12:42:00"), d("2025-03-30T12:42:00"), "אנקונינה מרדכי", "הועברה לביצוע"],
  ["הקמת הרשאה", "רחמים דניאל (משלוחה אינטראקטיב)          - 43467", "", "ils", d("2025-06-08T18:44:00"), d("2025-06-09T18:44:00"), "ברסקי נופר", "הועברה לביצוע"],
  ["ביטול שיק", null, 9000, "ils", d("2025-05-14T15:56:00"), d("2025-05-14T15:56:00"), "ברסקי נופר", "הועברה לביצוע"],
  ["תש. ממשלה", "רשות המסים - 1", 2500, "ils", d("2026-01-15T10:00:00"), d("2026-01-15T10:00:00"), "ברסקי נופר", "הועברה לביצוע"],
];

test("parsePayee: name + bank account, name + institution code, plain", () => {
  assert.deepEqual(parsePayee('אורי ארובות בע"מ 20-435-108233'), { raw: 'אורי ארובות בע"מ 20-435-108233', name: 'אורי ארובות בע"מ', account: "20-435-108233", code: null });
  assert.deepEqual(parsePayee('עודד דניאל בע"מ                          - 50462'), { raw: 'עודד דניאל בע"מ - 50462', name: 'עודד דניאל בע"מ', account: null, code: "50462" });
  assert.deepEqual(parsePayee("גורן י.ר. ובניו שיווק בע 12-648-652262").account, "12-648-652262");
  assert.deepEqual(parsePayee("מיט2איט 17-627-61444369"), { raw: "מיט2איט 17-627-61444369", name: "מיט2איט", account: "17-627-61444369", code: null });
  assert.deepEqual(parsePayee(null), { raw: null, name: null, account: null, code: null });
  assert.equal(parsePayee("שם בלי חשבון").name, "שם בלי חשבון");
  assert.equal(eventTypeCode("הקמת הרשאה"), "authorization");
  assert.equal(eventTypeCode("משהו"), "other");
});

test("parseBankEvents: account, dates, payees, cancelled, row keys", () => {
  const p = parseBankEvents(sheet(ROWS).worksheets[0]);
  assert.equal(p.account, "12-584-136663");
  assert.equal(p.produced, "2026-11-13");
  assert.equal(p.rows.length, 8);
  assert.deepEqual(p.counts, { transfer: 4, authorization: 2, cheque_cancel: 1, government: 1 });
  assert.equal(p.cancelled, 1);
  assert.deepEqual([p.from, p.to], ["2025-03-30", "2026-06-01"]);
  const t = p.rows[0];
  assert.equal(t.type_code, "transfer");
  assert.equal(t.payee_name, 'אורי ארובות בע"מ');
  assert.equal(t.payee_account, "20-435-108233");
  assert.equal(t.submitted_at, "2025-05-26 13:08:00");
  assert.equal(t.cancelled, 1);
  assert.equal(p.rows[1].cancelled, 0);
  assert.equal(p.rows[5].amount, null, "an authorization without an amount");
  assert.equal(p.rows[5].executed_at, "2025-06-09 18:44:00");
  assert.equal(p.rows[6].payee_raw, null);
  assert.equal(p.rows[4].payee_code, "50462");
  const keys = new Set(p.rows.map((r) => r.row_key));
  assert.equal(keys.size, 8, "the same order given twice keeps both rows");
  // a later export where an order changed status: the same key (the status is refreshed, not stored again)
  const later = parseBankEvents(sheet([[...ROWS[1].slice(0, 7), "בוצעה"]]).worksheets[0]);
  assert.equal(later.rows[0].row_key, p.rows[1].row_key);
  assert.equal(parseBankEvents(new ExcelJS.Workbook().addWorksheet("x")).error, "no header row (סוג עסקה / שם המוטב / סכום)");
});

test("recognizeFile: the status file is BANK_EVENTS, admin only, with a summary", async () => {
  const buf = Buffer.from(await sheet(ROWS).xlsx.writeBuffer());
  const r = await recognizeFile({ originalname: "eventsStatus (1).xlsx", buffer: buf }, { groups: [], nameIndex: new Map() }, { isAdmin: true });
  assert.equal(r.kind, "BANK_EVENTS");
  assert.equal(r.handler, "server");
  assert.equal(r.adminOnly, true);
  assert.equal(r.account, "12-584-136663");
  assert.match(r.summary, /8 events — 4 transfers \(1 cancelled\), 2 standing-order authorizations, 1 cheque cancellations, 1 government payments/);
  assert.deepEqual(r.period, { from: "2025-03-30", to: "2026-06-01" });
  assert.deepEqual(r.warnings, []);
  const big = await recognizeFile({ originalname: "x.xlsx", buffer: Buffer.from(await sheet(Array.from({ length: 1000 }, () => ROWS[2])).xlsx.writeBuffer()) }, { groups: [], nameIndex: new Map() }, { isAdmin: true });
  assert.ok(big.warnings.some((w) => /1,000 events at most/.test(w)));
});

test("isTransferLine / payeeOfDetails / fileAccountsOf", () => {
  for (const t of ["העברה מהבנק", "העברה לאחר", "העב' לאחר-נייד", 'העברת זה"ב נט']) assert.ok(isTransferLine(t), t);
  assert.ok(isTransferLine("משהו", "485"));
  for (const t of ["שיק", "עמ העברה/הפקדה", "ישראכרט"]) assert.equal(isTransferLine(t), t === "עמ העברה/הפקדה"); // the fee of a transfer is caught by the text; the amount rule leaves it unmatched
  assert.equal(payeeOfDetails('לטובת: גורן י.ר. ובניו שיווק בע עבור: חשבונית 12'), "גורן י.ר. ובניו שיווק בע");
  assert.equal(payeeOfDetails("לטובת: מיט2איט"), "מיט2איט");
  assert.equal(payeeOfDetails("עבור: נמסר בסניף"), null);
  assert.deepEqual(fileAccountsOf({ allegroKey: "pastaLina" }), ["12-584-136663"]);
  assert.deepEqual(fileAccountsOf({ financeCode: "pastalina" }), ["12-584-136663"]);
  assert.deepEqual(fileAccountsOf({ financeCode: "nope" }), []);
  assert.equal(MATCH_WINDOW_DAYS, 4);
});

const ev = (id, payee, amount, day, extra = {}) => ({ id, account: "12-584-136663", payee, payeeRaw: `${payee} 10-800-1`, payeeAccount: "10-800-1", amount, day, submittedAt: `${day} 10:00:00`, executedAt: `${day} 10:00:00`, submittedBy: "ברסקי נופר", status: "הועברה לביצוע", ...extra });

test("matchTransfers: amount + day window, same order twice, name tie-break, ambiguity, one use per event", () => {
  const events = [
    ev(1, 'אחת שתיים שלוש בע"מ', 6707, "2026-06-02"),
    ev(2, "מיט2איט", 1500, "2026-06-01"), ev(3, "מיט2איט", 1500, "2026-06-01"), // the same order twice
    ev(4, 'ר.ר.ג גלוז בע"מ', 2180, "2026-06-07"), ev(5, 'גורן י.ר. ובניו שיווק בע', 2180, "2026-06-07"), // two payees, one amount, one day
    ev(6, "שופרסל אמיגה", 2329.5, "2026-10-28"), // too early for a line on 2026-11-05
    ev(7, "אביתר חוליו", 11800, "2026-10-08", { account: "12-999-1" }), // another account
  ];
  const rows = [
    { d: "2026-06-02", out: 6707, details: "לטובת: אחת שתיים שלוש בע\"מ", acc: "12-584-136663" },
    { d: "2026-06-04", out: 1500, details: "לטובת: מיט2איט", acc: "12-584-136663" }, // posts 3 days later: within the window
    { d: "2026-06-01", out: 1500, details: "לטובת: מיט2איט", acc: "12-584-136663" },
    { d: "2026-06-01", out: 1500, details: "לטובת: מיט2איט", acc: "12-584-136663" }, // a third one: no event left
    { d: "2026-06-07", out: 2180, details: 'לטובת: ר.ר.ג גלוז בע"מ', acc: "12-584-136663" },
    { d: "2026-06-07", out: 2180, details: null, acc: "12-584-136663" }, // no name: the remaining candidate is unique after the first took its event
    { d: "2026-06-08", out: 2180, details: null, acc: "12-584-136663" }, // nothing left
    { d: "2026-11-05", out: 2329.5, details: null, acc: "12-584-136663" },
    { d: "2026-10-08", out: 11800, details: null, acc: "12-584-136663" },
    { d: "2026-06-02", out: null, details: "זיכוי", acc: "12-584-136663" }, // money in: not a transfer out
  ];
  const stats = matchTransfers(rows, events, { date: (r) => r.d, amount: (r) => r.out, name: (r) => payeeOfDetails(r.details), account: (r) => r.acc });
  assert.deepEqual(stats, { lines: 9, found: 5, ambiguous: 0, none: 4 });
  assert.equal(rows[0].event.id, 1);
  assert.equal(rows[0].payee, 'אחת שתיים שלוש בע"מ', "a row without a payee gets the event's payee");
  assert.equal(rows[0].payeeSource, "events");
  assert.equal(rows[1].event.id, 2);
  assert.equal(rows[2].event.id, 3);
  assert.equal(rows[3].event, undefined);
  assert.equal(rows[4].event.id, 4);
  assert.equal(rows[5].event.id, 5);
  assert.equal(rows[5].payee, 'גורן י.ר. ובניו שיווק בע');
  assert.equal(rows[5].payeeSource, "events");
  assert.equal(rows[6].event, undefined);
  assert.equal(rows[7].event, undefined, "an event older than the window is not taken");
  assert.equal(rows[8].event, undefined, "another account's event is not taken");
  // two different payees, same amount and day, no name on the line → ambiguous
  const amb = [{ d: "2026-06-07", out: 2180, details: null, acc: null }];
  assert.deepEqual(matchTransfers(amb, [ev(4, "א", 2180, "2026-06-07"), ev(5, "ב", 2180, "2026-06-07")], { date: (r) => r.d, amount: (r) => r.out }), { lines: 1, found: 0, ambiguous: 1, none: 0 });
  // a line with a name takes no order of another payee, even when it is the only one with that amount and day
  const other = [{ d: "2026-10-08", out: 2360, details: "לטובת: סרגיי מורין" }];
  assert.deepEqual(matchTransfers(other, [ev(9, 'סאו קריאטיב בע"מ', 2360, "2026-10-08")], { date: (r) => r.d, amount: (r) => r.out, name: (r) => payeeOfDetails(r.details) }), { lines: 1, found: 0, ambiguous: 0, none: 1 });
  const cut = [{ d: "2026-06-02", out: 3011, details: "לטובת: גורן י.ר. ובניו שיווק בע" }];
  matchTransfers(cut, [ev(10, 'גורן י.ר. ובניו שיווק בע"מ', 3011, "2026-06-02")], { date: (r) => r.d, amount: (r) => r.out, name: (r) => payeeOfDetails(r.details) });
  assert.equal(cut[0].event.id, 10, "a name the bank file cut short still agrees");
  // a row that already has a payee keeps it and still gets the event
  const named = [{ d: "2026-06-02", out: 6707, payee: "אחת שתיים שלוש", payeeSource: "bank_file" }];
  matchTransfers(named, [ev(1, 'אחת שתיים שלוש בע"מ', 6707, "2026-06-02")], { date: (r) => r.d, amount: (r) => r.out });
  assert.equal(named[0].payeeSource, "bank_file");
  assert.equal(named[0].event.payeeAccount, "10-800-1");
});
