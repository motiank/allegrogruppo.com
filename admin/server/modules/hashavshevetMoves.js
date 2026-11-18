// Journal moves for Hashavshevet's import — the reversal (storno) of cheques that were never cashed (owner 2026-11-18:
// section 3ג of the bank reconciliation report, "cancelled, never reached the beneficiary → delete; or it appears in the
// bank but was rejected"; "export to Hashavshevet moves import excel").
//
// What Hashavshevet does itself when a cheque is cancelled in its cheques module (seen in the copy, allegro_finance): a
// second journal entry identical to the first with a NEGATIVE amount — same reference (the cheque number), debit the
// supplier / employees card, credit the bank, value date = the day of the cancellation. The import guide recommends the same
// for a storno ("pass negative amounts"). We write exactly that, one row per cheque, from the cheque's own entry in the copy.
// An imported move cannot carry Hashavshevet's cheque_id, so the cheques module keeps listing the cheque until the bookkeeper
// cancels it there too; the books (supplier card, bank account) are right after the import, and bankRecon.js recognises the
// reversal and stops showing the cheque.
//
// Two files (investigated 2026-11-18 — finance_api_readme.md → "Hashavshevet import"):
//   Excel  — Hashavshevet: כללי › ממשקים › יבוא תנועות הנה"ח › יבוא מטבלת ODBC › Excel Files. The sheet needs a header row,
//            a DEFINED NAME on the data range (Hashavshevet lists the table by that name; without it: "NONAME"), text cells for
//            keys and references, numbers for amounts. The bookkeeper maps the columns to Hashavshevet's fields once and saves the
//            mapping. Our headers are the field names of Hashavshevet's own staging table ImportJournal, so the mapping is 1:1.
//   movein.dat — the "short method" text file the bookkeeper already imports (ImportLog "ShortJournal"): fixed 90-character
//            records, Hebrew in ANSI (cp1255): debit key 1–8, credit key 9–16, reference 17–21, reference date ddmmyy 22–27,
//            reference 2 28–32, value date 33–38, amount 39–50, currency 51–53, details 54–75, foreign amount 76–87, filler, CRLF.
//            The 5-digit reference cannot hold a 6-digit cheque number — such a cheque is refused with a clear message.
import { createRequire } from "module";
import { financeSql } from "../sources/financePool.js";

const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs");
const iconv = require("iconv-lite");

export const ACTIONS = { cancel: "cancel", bounced: "bounced", keep: "keep" };
export const ACTION_LABEL = { cancel: "בוטל – לא הגיע למוטב", bounced: "חזר מהבנק", keep: "להשאיר" };

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const isoDay = (v) => (v ? String(v).slice(0, 10) : null);
const heDate = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split("-"); return `${d}/${m}/${y}`; };
const ddmmyy = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split("-"); return `${d}${m}${y.slice(2)}`; };
const isIso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

/**
 * The cheque entries the moves are built from: the POSITIVE journal entry of each cheque (the issue), with its accounts.
 * @returns {Promise<Map<number, {chequeId, transId, chequeNo, payee, amount, debit, credit, valueDate, year}>>} by chequeId
 */
export async function loadChequeEntries(companyId, chequeIds) {
  const ids = [...new Set((chequeIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  const out = new Map();
  if (!ids.length) return out;
  const p = { companyId };
  const list = ids.map((n, i) => ((p[`c${i}`] = n), `:c${i}`)).join(",");
  const rows = await financeSql(
    `SELECT e.cheque_id, e.trans_id, e.fiscal_year, e.reference, e.amount, e.debit_account, e.credit_account, e.debit_name, e.credit_name,
            DATE_FORMAT(e.value_date, '%Y-%m-%d') AS vd, c.payee_name, c.reference AS cheque_no, c.amount_to_pay
       FROM journal_entries e JOIN cheques c ON c.company_id = e.company_id AND c.cheque_id = e.cheque_id AND c.deleted_at IS NULL
      WHERE e.company_id = :companyId AND e.deleted_at IS NULL AND e.cheque_id IN (${list}) AND e.amount > 0
      ORDER BY e.cheque_id, e.trans_id`,
    p,
  );
  for (const r of rows) {
    if (out.has(r.cheque_id)) continue; // the first positive entry is the issue
    out.set(r.cheque_id, { chequeId: r.cheque_id, transId: r.trans_id, year: r.fiscal_year, chequeNo: String(r.cheque_no ?? r.reference), payee: r.payee_name || r.debit_name || "", amount: round2(r.amount), debit: String(r.debit_account), debitName: r.debit_name, credit: String(r.credit_account), creditName: r.credit_name, valueDate: r.vd });
  }
  return out;
}

/**
 * The reversal moves (pure). `entries` = the cheques' issue entries (loadChequeEntries values); `actions[chequeId]` =
 * { action: "cancel" | "bounced" | "keep", date?: "YYYY-MM-DD" } — "keep" and unknown cheques give no move; a missing date
 * is `today`. Each move: both sides NEGATIVE (Hashavshevet's own storno), reference = the cheque number.
 * @returns {{ moves: object[], skipped: Array<{chequeId, reason}> }}
 */
export function reversalMoves(entries, actions = {}, { today } = {}) {
  const day = today || new Date().toISOString().slice(0, 10);
  const moves = [];
  const skipped = [];
  for (const e of entries) {
    const a = actions[e.chequeId] || actions[String(e.chequeId)] || { action: ACTIONS.cancel };
    const action = a.action || ACTIONS.cancel;
    if (action === ACTIONS.keep) { skipped.push({ chequeId: e.chequeId, reason: "keep" }); continue; }
    if (!ACTION_LABEL[action]) { skipped.push({ chequeId: e.chequeId, reason: `unknown action ${action}` }); continue; }
    const date = isIso(a.date) ? a.date : day;
    if (date < isoDay(e.valueDate)) { skipped.push({ chequeId: e.chequeId, reason: `date ${date} is before the cheque's entry ${e.valueDate}` }); continue; }
    const description = action === ACTIONS.bounced ? `שיק ${e.chequeNo} חזר מהבנק ${heDate(date)}` : `ביטול שיק ${e.chequeNo} – לא נפרע`;
    moves.push({
      chequeId: e.chequeId, chequeNo: e.chequeNo, payee: e.payee, action,
      transType: "", reference: e.chequeNo, reference2: "", refDate: date, valueDate: date,
      debit: e.debit, debitAmount: -e.amount, credit: e.credit, creditAmount: -e.amount,
      description, details2: e.payee || "", originalDate: e.valueDate, originalTransId: e.transId,
    });
  }
  return { moves, skipped };
}

// the columns of the import sheet — the names of Hashavshevet's staging table ImportJournal, so the one-time mapping is 1:1
const COLUMNS = [
  { key: "transType", header: "TransType", he: "סוג תנועה", text: true },
  { key: "reference", header: "Reference", he: "אסמכתא", text: true },
  { key: "reference2", header: "Reference2", he: "אסמכתא 2", text: true },
  { key: "refDate", header: "DueDate", he: "תאריך אסמכתא", date: true },
  { key: "valueDate", header: "ValueDate", he: "תאריך ערך", date: true },
  { key: "description", header: "Description", he: "פרטים", text: true },
  { key: "debit", header: "DebID1", he: "חשבון חובה 1", text: true },
  { key: "debitAmount", header: "DebsuF1", he: "סכום חובה 1", money: true },
  { key: "credit", header: "CredID1", he: "חשבון זכות 1", text: true },
  { key: "creditAmount", header: "CredsuF1", he: "סכום זכות 1", money: true },
  { key: "details2", header: "DET2", he: "הערות נוספות", text: true },
];
export const IMPORT_COLUMNS = COLUMNS.map((c) => ({ header: c.header, he: c.he }));
export const RANGE_NAME = "jurnal";

/**
 * The Excel import file: sheet "תנועות" (header row + one row per move, keys / references / dates as TEXT, amounts as numbers,
 * the defined name `jurnal` on the whole data range) and sheet "הסבר" (the import steps for the bookkeeper).
 * @returns {Promise<Buffer>}
 */
export async function movesWorkbook(moves, { company = "", account = "", today } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Allegro admin";
  const ws = wb.addWorksheet("תנועות", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
  ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.key === "description" ? 36 : c.money ? 14 : 14 }));
  ws.getRow(1).font = { bold: true };
  for (const m of moves) {
    const row = ws.addRow({});
    for (const c of COLUMNS) {
      const cell = row.getCell(c.key);
      const v = m[c.key];
      if (c.money) { cell.value = round2(v); cell.numFmt = "#,##0.00;-#,##0.00"; }
      else if (c.date) { cell.value = v ? heDate(v) : ""; cell.numFmt = "@"; }
      else { cell.value = v == null ? "" : String(v); cell.numFmt = "@"; }
    }
  }
  const last = moves.length + 1;
  const colLetter = (n) => { let s = ""; for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s; return s; };
  wb.definedNames.add(`'תנועות'!$A$1:$${colLetter(COLUMNS.length)}$${last}`, RANGE_NAME);

  const help = wb.addWorksheet("הסבר", { views: [{ rightToLeft: true }] });
  help.columns = [{ header: "קובץ ייבוא תנועות יומן לחשבשבת", key: "a", width: 120 }];
  help.getRow(1).font = { bold: true, size: 13 };
  const lines = [
    `חברה: ${company}${account ? `, חשבון בנק ${account}` : ""}. הופק ${heDate(today || new Date().toISOString().slice(0, 10))}. ${moves.length} תנועות ביטול, כל אחת בסכום שלילי בחובה ובזכות (סטורנו כפי שחשבשבת עצמה רושמת ביטול שיק).`,
    "",
    "איך קולטים בחשבשבת:",
    "1. שומרים את הקובץ במחשב (מומלץ במחיצה המשותפת Rep).",
    "2. בתפריט כללי › ממשקים – יבוא נתוני הנה\"ח ו-CRM › יבוא תנועות הנה\"ח.",
    "3. מסמנים \"יבוא מטבלת ODBC\", בוחרים בסיס נתונים: Excel Files, את הקובץ הזה, ואת הטבלה בשם jurnal (הטווח המוגדר בגיליון \"תנועות\").",
    "4. בפעם הראשונה משדכים כל עמודה לשדה בחשבשבת – שמות העמודות הם שמות השדות של חשבשבת (Reference = אסמכתא, ValueDate = תאריך ערך, DueDate = תאריך אסמכתא, Description = פרטים, DebID1 / DebsuF1 = חשבון וסכום חובה, CredID1 / CredsuF1 = חשבון וסכום זכות, DET2 = הערות). שומרים את השידוך לפעמים הבאות.",
    "5. תצוגה מקדימה, ואז \"יבוא תנועות יומן\". התנועות נכנסות למנה חדשה במאגר הזמני – בודקים ומעדכנים את המנה.",
    "",
    "מה התנועה עושה: מחזירה את רישום הצ'ק – חובה לכרטיס הספק/העובד בסכום שלילי, זכות לחשבון הבנק בסכום שלילי, האסמכתא היא מספר הצ'ק. כרטיס הספק וחשבון הבנק חוזרים למצב שלפני הצ'ק.",
    "שימו לב: תנועה מיובאת אינה מסומנת במודול הצ'קים של חשבשבת; כדי שהצ'ק ייעלם גם מרשימת הצ'קים של חשבשבת יש לבטלו שם (מודול צ'קים › ביטול). דוח התאמת הבנק באדמין מזהה את תנועת הביטול ומפסיק להציג את הצ'ק.",
    "",
    "העמודות: " + COLUMNS.map((c) => `${c.header} = ${c.he}`).join("; "),
  ];
  for (const l of lines) help.addRow({ a: l });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * movein.dat in the short method (fixed 90-character records, cp1255). Throws when a value does not fit the format
 * (a reference longer than 5 digits, an account key longer than 8 characters, an amount over 12 characters).
 * @returns {Buffer}
 */
export function movesMovein(moves) {
  const pad = (s, n, right = false) => { const t = String(s ?? ""); if (t.length > n) throw new Error(`"${t}" is longer than ${n} characters`); return right ? t.padStart(n, " ") : t.padEnd(n, " "); };
  const num = (s, n) => { const t = String(s ?? ""); if (!/^\d*$/.test(t)) throw new Error(`"${t}" is not a number`); if (t.length > n) throw new Error(`reference ${t} has more than ${n} digits — movein.dat (short method) cannot hold it; use the Excel file`); return t.padStart(n, " "); };
  const amt = (v) => pad(round2(v).toFixed(2), 12, true);
  const lines = [];
  for (const m of moves) {
    // one line per move, both accounts on it: debit key, credit key, the NEGATIVE amount (the storno of the original entry)
    const line = pad(m.debit, 8) + pad(m.credit, 8) + num(m.reference, 5) + ddmmyy(m.refDate) + num(m.reference2 || "", 5) + ddmmyy(m.valueDate) + amt(m.debitAmount) + pad("", 3) + pad(String(m.description).slice(0, 22), 22) + pad("", 12) + " ";
    if (line.length !== 88) throw new Error(`record length ${line.length}, expected 88 + CRLF`);
    lines.push(line);
  }
  return iconv.encode(lines.join("\r\n") + (lines.length ? "\r\n" : ""), "win1255");
}
