// Parsers for the file kinds that the "Upload files" page imports itself.
// Pure functions: workbook in, rows out. No database here.
import crypto from "crypto";
import { norm, cellText, cellNum, dateOf, dateTimeOf, findHeaderRow, headerMap, hebMonth } from "./workbook.js";

// The value after "label:" inside a cell that may hold several "label: value" lines.
const labelValue = (text, label) => {
  for (const line of String(text || "").split(/\n/)) {
    const t = norm(line);
    if (t.startsWith(label)) return norm(t.slice(label.length).replace(/^\s*:/, ""));
  }
  return "";
};

// ── Tabit detailed report ("דוח מפורט"): one sheet per employee ─────────────
// Sheet layout (real export): r2 title "דוח מפורט" + "תאריך הוצאה:", r3 "שם עובד: X\nחודש: יולי 2026"
// | "ימי עבודה: N" | "מזהה שעון: N" (sometimes), r5 header
// "יום | תאריך | תפקיד | כניסה | יציאה | הערות | [תפקיד | כניסה | יציאה | הערות]... | רגילות | ...".
// Days end at a repeated header or the "סיכום ..." rows. Times are full date-times; a clock-out
// earlier than the clock-in is the next day.
export const parseTabitDetailed = (wb) => {
  const employees = [];
  const skipped = [];
  const monthVotes = new Map();
  for (const ws of wb.worksheets) {
    let name = "";
    let clockId = "";
    let month = null;
    const metaRows = Math.min(ws.rowCount, 6);
    for (let r = 1; r <= metaRows; r++) {
      const row = ws.getRow(r);
      for (let c = 1; c <= ws.columnCount; c++) {
        const raw = cellText(row.getCell(c).value);
        if (!raw) continue;
        if (!name) name = labelValue(raw, "שם עובד");
        if (!clockId) clockId = labelValue(raw, "מזהה שעון");
        if (!month) month = hebMonth(labelValue(raw, "חודש"));
      }
    }
    const hRow = findHeaderRow(ws, ["תאריך", "כניסה", "יציאה"], 12);
    if (!name || !hRow) {
      skipped.push({ sheet: ws.name, reason: !name ? "no employee name (שם עובד)" : "no header row (תאריך / כניסה / יציאה)" });
      continue;
    }
    const header = ws.getRow(hRow);
    let dateCol = 0;
    const blocks = [];
    for (let c = 1; c <= ws.columnCount; c++) {
      const h = norm(cellText(header.getCell(c).value));
      if (h === "תאריך" && !dateCol) dateCol = c;
      if (h === "כניסה") {
        const at = (k) => norm(cellText(header.getCell(c + k).value));
        blocks.push({
          inCol: c,
          roleCol: at(-1) === "תפקיד" ? c - 1 : 0,
          outCol: at(1) === "יציאה" ? c + 1 : 0,
          noteCol: at(2) === "הערות" ? c + 2 : 0,
        });
      }
    }
    const shifts = [];
    for (let r = hRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const first = norm(cellText(row.getCell(1).value));
      if (first.startsWith("סיכום") || first === "יום") break;
      const day = dateOf(row.getCell(dateCol).value);
      if (!day) continue;
      blocks.forEach((b, i) => {
        let clockIn = dateTimeOf(row.getCell(b.inCol).value, day);
        let clockOut = b.outCol ? dateTimeOf(row.getCell(b.outCol).value, day) : null;
        if (!clockIn && !clockOut) return;
        if (clockIn && clockOut && clockOut < clockIn && clockOut.slice(0, 10) === clockIn.slice(0, 10)) {
          // a bare time past midnight: move it to the next day
          const d = new Date(`${clockOut.replace(" ", "T")}Z`);
          d.setUTCDate(d.getUTCDate() + 1);
          clockOut = d.toISOString().slice(0, 19).replace("T", " ");
        }
        shifts.push({
          work_date: day,
          block_no: i + 1,
          role: b.roleCol ? norm(cellText(row.getCell(b.roleCol).value)) || null : null,
          clock_in: clockIn,
          clock_out: clockOut,
          note: b.noteCol ? norm(cellText(row.getCell(b.noteCol).value)).slice(0, 255) || null : null,
        });
      });
      const ym = day.slice(0, 7);
      if (!month) monthVotes.set(ym, (monthVotes.get(ym) || 0) + 1);
    }
    if (month) monthVotes.set(month, (monthVotes.get(month) || 0) + 1000);
    employees.push({ sheet: ws.name, name, clockId: clockId || null, shifts });
  }
  const month = [...monthVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  return { month, employees, skipped };
};

// ── Bank Hapoalim "תנועות בחשבון" ─────────────────────────────────────────
// r3 "תנועות בחשבון", r4 "מספר חשבון 12-407-NNNNN לתקופה: dd.mm.yyyy - dd.mm.yyyy ...",
// r5 header "תאריך | קוד פעולה | הפעולה | פרטים | אסמכתא | צרור | חובה | זכות | יתרה בש''ח | הערה".
export const parseBankHapoalim = (ws) => {
  const hRow = findHeaderRow(ws, ["תאריך", "חובה", "זכות"], 12);
  if (!hRow) return { rows: [], error: "no header row (תאריך / חובה / זכות)" };
  let account = "";
  let from = null;
  let to = null;
  for (let r = 1; r < hRow; r++) {
    const t = norm(ws.getRow(r).values.map((v) => cellText(v)).join(" "));
    const a = t.match(/מספר חשבון\s+([\d-]+)/);
    if (a) account = a[1];
    const p = t.match(/לתקופה:\s*([\d./]+)\s*-\s*([\d./]+)/);
    if (p) {
      from = dateOf(p[1]);
      to = dateOf(p[2]);
    }
  }
  const cols = headerMap(ws, hRow);
  const col = (prefix) => [...cols.entries()].find(([h]) => h.startsWith(prefix))?.[1] || 0;
  const c = {
    date: col("תאריך"),
    code: col("קוד פעולה"),
    action: col("הפעולה"),
    details: col("פרטים"),
    reference: col("אסמכתא"),
    bundle: col("צרור"),
    debit: col("חובה"),
    credit: col("זכות"),
    balance: col("יתרה"),
    note: col("הערה"),
  };
  const text = (row, k) => (c[k] ? norm(cellText(row.getCell(c[k]).value)) || null : null);
  const num = (row, k) => (c[k] ? cellNum(row.getCell(c[k]).value) : null);
  const rows = [];
  const seen = new Map(); // key fields → how many rows with them so far
  for (let r = hRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const tx_date = dateOf(row.getCell(c.date).value);
    if (!tx_date) continue;
    const out = {
      account,
      tx_date,
      action_code: text(row, "code"),
      action: text(row, "action"),
      details: text(row, "details"),
      reference: text(row, "reference"),
      bundle: text(row, "bundle"),
      debit: num(row, "debit"),
      credit: num(row, "credit"),
      balance: num(row, "balance"),
      note: text(row, "note"),
    };
    // The key that stops a row from being stored twice (files of overlapping periods). Not the balance: it
    // is a running total, and a later export can list the same day's rows in another order (a file taken
    // during the day, then a full one), so the balances change. Rows with the same fields (two real equal
    // transactions) get their number in the file: 1st, 2nd, …
    const fields = JSON.stringify([out.account, out.tx_date, out.action_code, out.action, out.details, out.reference, out.bundle, out.debit, out.credit]);
    const n = (seen.get(fields) || 0) + 1;
    seen.set(fields, n);
    out.row_key = crypto.createHash("sha256").update(`${fields}#${n}`).digest("hex");
    rows.push(out);
  }
  const dates = rows.map((x) => x.tx_date).sort();
  return { account, rows, from: from || dates[0] || null, to: to || dates[dates.length - 1] || null };
};

// ── Tabit employee list ("רשימת עובדים"): only counted here; the existing
// /admin/payroll/shift-employees/* endpoints import it. Returns the names for the branch guess.
export const peekTabitRoster = (ws) => {
  const hRow = findHeaderRow(ws, ["שם משתמש"], 15);
  if (!hRow) return { count: 0, names: [] };
  const cols = headerMap(ws, hRow);
  const first = cols.get("שם פרטי") || cols.get("שם מלא");
  const family = cols.get("שם משפחה");
  const names = [];
  for (let r = hRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const n = [first && cellText(row.getCell(first).value), family && cellText(row.getCell(family).value)].filter(Boolean).join(" ");
    if (norm(n)) names.push(n);
  }
  return { count: names.length, names };
};

// ── Bank Hapoalim "סטטוס עסקאות" (transaction status: the orders given on the bank site) ──────────
// r3 "סטטוס עסקאות", r4 "מספר חשבון 12-584-136663 תאריך הפקה dd.mm.yyyy",
// r5 header "סוג עסקה | שם המוטב | סכום | מטבע | מועד הזרמה | תאריך ביצוע | מזרים העסקה | סטאטוס".
// שם המוטב = "name bank-branch-account" for a transfer, "name - code" for a standing-order authorization, empty for
// a cheque cancellation. Dates are date-time cells (local time). The export holds the last 1,000 events at most.
export const EVENT_TYPES = { "העברה": "transfer", "הקמת הרשאה": "authorization", "ביטול שיק": "cheque_cancel", "תש. ממשלה": "government" };
export const eventTypeCode = (t) => EVENT_TYPES[norm(t)] || "other";
export const CANCELLED_RE = /בוטל|נדחת|לא בוצע|נכשל/;

export const parsePayee = (raw) => {
  const t = norm(cellText(raw)).replace(/\s+-\s+/g, " - ");
  if (!t) return { raw: null, name: null, account: null, code: null };
  let m = t.match(/^(.*?)\s+(\d{1,2}-\d{1,4}-\d{3,})\s*$/);
  if (m) return { raw: t, name: norm(m[1]) || null, account: m[2], code: null };
  m = t.match(/^(.*?)\s+-\s+(\d+)\s*$/);
  if (m) return { raw: t, name: norm(m[1]) || null, account: null, code: m[2] };
  return { raw: t, name: t, account: null, code: null };
};

export const parseBankEvents = (ws) => {
  const hRow = findHeaderRow(ws, ["סוג עסקה", "שם המוטב", "סכום"], 12);
  if (!hRow) return { rows: [], error: "no header row (סוג עסקה / שם המוטב / סכום)" };
  let account = "";
  let produced = null;
  for (let r = 1; r < hRow; r++) {
    const t = norm(ws.getRow(r).values.map((v) => cellText(v)).join(" "));
    const a = t.match(/מספר חשבון\s+([\d-]+)/);
    if (a) account = a[1];
    const p = t.match(/תאריך הפקה\s+([\d./]+)/);
    if (p) produced = dateOf(p[1]);
  }
  const cols = headerMap(ws, hRow);
  const col = (prefix) => [...cols.entries()].find(([h]) => h.startsWith(prefix))?.[1] || 0;
  const c = { type: col("סוג עסקה"), payee: col("שם המוטב"), amount: col("סכום"), currency: col("מטבע"), submitted: col("מועד הזרמה"), executed: col("תאריך ביצוע"), by: col("מזרים"), status: col("סט") };
  const text = (row, k) => (c[k] ? norm(cellText(row.getCell(c[k]).value)) || null : null);
  const rows = [];
  const seen = new Map();
  for (let r = hRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const event_type = text(row, "type");
    if (!event_type) continue;
    const payee = parsePayee(row.getCell(c.payee).value);
    const out = {
      account,
      event_type,
      type_code: eventTypeCode(event_type),
      payee_raw: payee.raw,
      payee_name: payee.name,
      payee_account: payee.account,
      payee_code: payee.code,
      amount: c.amount ? cellNum(row.getCell(c.amount).value) : null,
      currency: text(row, "currency"),
      submitted_at: c.submitted ? dateTimeOf(row.getCell(c.submitted).value) : null,
      executed_at: c.executed ? dateTimeOf(row.getCell(c.executed).value) : null,
      submitted_by: text(row, "by"),
      status: text(row, "status"),
    };
    out.cancelled = CANCELLED_RE.test(out.status || "") ? 1 : 0;
    // the key that stops a row from being stored twice: not the status or the execution date (they change while an
    // order waits; a stored row is refreshed instead); equal rows (the same order given twice) get their number
    const fields = JSON.stringify([out.account, out.event_type, out.payee_raw, out.amount, out.submitted_at, out.submitted_by]);
    const n = (seen.get(fields) || 0) + 1;
    seen.set(fields, n);
    out.row_key = crypto.createHash("sha256").update(`${fields}#${n}`).digest("hex");
    rows.push(out);
  }
  const days = rows.map((x) => (x.submitted_at || "").slice(0, 10)).filter(Boolean).sort();
  const counts = {};
  for (const x of rows) counts[x.type_code] = (counts[x.type_code] || 0) + 1;
  return { account, produced, rows, from: days[0] || null, to: days[days.length - 1] || null, counts, cancelled: rows.filter((x) => x.cancelled).length };
};
