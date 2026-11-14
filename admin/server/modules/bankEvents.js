// Bank events (Bank Hapoalim "סטטוס עסקאות", table bank_events, uploaded on the Upload files page): the orders given
// on the bank site — transfers with the payee's name and bank account, who submitted them and when, cancelled or not.
// Owner (2026-11-13): "support this file through the upload page, a specific table, and merge the data with the
// bank sheet for completion".
//
// The merge: a transfer line of a bank statement (the admin's bank file, Hashavshevet's bank_lines) is named by the
// one event with the same amount whose execution day is the line's day or up to 4 days before it (a transfer given
// after the cutoff posts on the next business day). Two candidates with the same payee are the same order given
// twice, so the first unused one is taken; otherwise the line stays unnamed (ambiguous). Lines of the bank file that
// already carry "לטובת: <name>" keep that name and gain the event (payee account, submitter, time).
import { createRequire } from "module";
import { executeSql } from "../sources/dbpool.js";
import { normName } from "../../../shared/bankReconFilter.js";
import { eventTypeCode } from "../uploads/parsers.js";

const require = createRequire(import.meta.url);
const RESTAURANTS = require("../../../shared/restaurants.json");
const FINANCE_MAP = require("../../../shared/finance_map.json");

export const PAYEE_SOURCE_EVENTS = "events";
// the bank's own text of a transfer we made (Hapoalim's `action`, Hashavshevet's `details`)
const TRANSFER_RE = /העבר|^העב'|זה"ב/;
export const isTransferLine = (text, actionCode) => String(actionCode ?? "") === "485" || TRANSFER_RE.test(String(text || "").trim());
/** The payee's name in a bank file line: the text after "לטובת:" (up to "עבור:"). */
export const payeeOfDetails = (details) => {
  const m = String(details || "").match(/לטובת:\s*(.*?)(?:\s+עבור:|$)/s);
  return m ? m[1].trim() || null : null;
};

// two spellings of one payee: one starts with the other (the bank file cuts long names), or the first 10 letters agree
const sameName = (a, b) => Boolean(a && b) && (a.startsWith(b) || b.startsWith(a) || a.slice(0, 10) === b.slice(0, 10));
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
// The admin's pool returns DATETIME columns as JS Date objects (no dateStrings), the parsers give strings: one
// formatter for both, in local time (mysql2 parses the stored wall-clock time with the server's own zone, so the local
// getters give the stored value back). Bug found 2026-11-14: String(Date).slice(0, 19) gave " hu Nov 12 2026 21:" and
// no event had a day, so the report named no transfer at all.
const pad = (n) => String(n).padStart(2, "0");
export const stamp = (v) => {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())} ${pad(v.getHours())}:${pad(v.getMinutes())}:${pad(v.getSeconds())}`;
  return String(v).slice(0, 19).replace("T", " ");
};
const day = (v) => (v == null ? null : stamp(v)?.slice(0, 10) ?? null);
const num = (v) => (v == null || v === "" ? null : Number(v));
export const MATCH_WINDOW_DAYS = 4;

/** The bank accounts (as in the bank files) of an Allegro company, or of a finance company code (shared/finance_map.json → allegroKey). */
export function fileAccountsOf({ allegroKey = null, financeCode = null } = {}) {
  const key = allegroKey || FINANCE_MAP.companies?.[financeCode]?.allegroKey || null;
  const g = (RESTAURANTS.restaurants || []).find((x) => x.key === key);
  return (g?.bank_accounts || []).map((a) => a.account).filter(Boolean);
}

const eventOut = (r) => ({
  id: r.id, bank: r.bank, account: r.account, type: r.event_type, typeCode: eventTypeCode(r.event_type),
  payee: r.payee_name, payeeRaw: r.payee_raw, payeeAccount: r.payee_account, payeeCode: r.payee_code,
  amount: num(r.amount), currency: r.currency, submittedAt: stamp(r.submitted_at),
  executedAt: stamp(r.executed_at), submittedBy: r.submitted_by,
  status: r.status, cancelled: Boolean(Number(r.cancelled)), loadedAt: r.created_at,
});

/**
 * The stored events: accounts (ours), from / to on the execution day (submitted day when there is none), type
 * (transfer | authorization | cheque_cancel | government, or the Hebrew text), status (active | cancelled | all),
 * q (payee / submitter text), limit. Newest first.
 */
export async function listBankEvents({ accounts = [], from, to, type = null, status = "all", q = null, limit = 2000 } = {}) {
  const params = { from, to };
  let where = `WHERE DATE(COALESCE(executed_at, submitted_at)) BETWEEN :from AND :to`;
  if (accounts.length) {
    accounts.forEach((a, i) => (params[`a${i}`] = a));
    where += ` AND account IN (${accounts.map((_, i) => `:a${i}`).join(",")})`;
  }
  if (type) {
    const heb = Object.entries({ "העברה": "transfer", "הקמת הרשאה": "authorization", "ביטול שיק": "cheque_cancel", "תש. ממשלה": "government" }).find(([h, c]) => c === type || h === type)?.[0];
    params.type = heb || type;
    where += ` AND event_type = :type`;
  }
  if (status === "active") where += ` AND cancelled = 0`;
  else if (status === "cancelled") where += ` AND cancelled = 1`;
  if (q) {
    params.q = `%${q}%`;
    where += ` AND (payee_raw LIKE :q OR submitted_by LIKE :q OR status LIKE :q)`;
  }
  const [rows] = await executeSql(
    `SELECT id, bank, account, event_type, payee_raw, payee_name, payee_account, payee_code, amount, currency, submitted_at, executed_at, submitted_by, status, cancelled, created_at
       FROM bank_events ${where} ORDER BY COALESCE(executed_at, submitted_at) DESC, id DESC LIMIT ${Math.max(1, Math.min(Number(limit) || 2000, 10000))}`,
    params,
  );
  return rows.map(eventOut);
}

/** The transfer events (not cancelled) of the accounts whose execution day is in [from − window, to], for the merge. */
async function transferEvents(accounts, from, to) {
  const params = { from: addDays(from, -MATCH_WINDOW_DAYS), to };
  accounts.forEach((a, i) => (params[`a${i}`] = a));
  const [rows] = await executeSql(
    `SELECT id, account, payee_name, payee_raw, payee_account, amount, submitted_at, executed_at, submitted_by, status
       FROM bank_events WHERE event_type = 'העברה' AND cancelled = 0 AND amount IS NOT NULL
        AND DATE(COALESCE(executed_at, submitted_at)) BETWEEN :from AND :to
        ${accounts.length ? `AND account IN (${accounts.map((_, i) => `:a${i}`).join(",")})` : ""}`,
    params,
  );
  return rows.map((r) => ({ id: r.id, account: r.account, payee: r.payee_name, payeeRaw: r.payee_raw, payeeAccount: r.payee_account, amount: Number(r.amount), day: day(r.executed_at || r.submitted_at), submittedAt: stamp(r.submitted_at), executedAt: stamp(r.executed_at), submittedBy: r.submitted_by, status: r.status }));
}

/**
 * Pure: pairs money-out rows with transfer events — the same account (when the row knows it), the same amount, the
 * event's day within MATCH_WINDOW_DAYS before the row's day. accessors: date(r) → 'YYYY-MM-DD', amount(r) → the
 * money out as a positive number (null = not a money-out row), name(r) → a payee name on the row, if any (used to
 * choose between candidates), account(r) → our account (optional). Each event is used once. Returns the stats and
 * sets r.event = { id, payee, payeeAccount, submittedAt, executedAt, submittedBy, status } (and r.payee /
 * r.payeeSource "events" when the row had no payee).
 */
export function matchTransfers(rows, events, { date, amount, name = () => null, account = () => null } = {}) {
  const stats = { lines: 0, found: 0, ambiguous: 0, none: 0 };
  const used = new Set();
  const byAmount = new Map();
  for (const e of events) {
    const k = Math.round(e.amount * 100);
    if (!byAmount.has(k)) byAmount.set(k, []);
    byAmount.get(k).push(e);
  }
  for (const r of rows) {
    const amt = amount(r);
    const d = date(r);
    if (!(amt > 0) || !d) continue;
    stats.lines++;
    const acc = account(r);
    let cands = (byAmount.get(Math.round(amt * 100)) || []).filter((e) => !used.has(e.id) && e.day && e.day <= d && e.day >= addDays(d, -MATCH_WINDOW_DAYS) && (!acc || !e.account || e.account === acc));
    // a line that carries a name (the bank file's "לטובת: …") takes only an order with that name: two payees paid the
    // same amount on the same day are told apart, and never swapped
    const n = normName(name(r));
    if (n && cands.length) cands = cands.filter((e) => !e.payee || sameName(n, normName(e.payee)));
    // the same order given twice (same payee and account): the first unused one is as good as the other
    if (cands.length > 1 && new Set(cands.map((e) => `${normName(e.payee)}|${e.payeeAccount || ""}`)).size === 1) cands = [cands[0]];
    if (cands.length === 1) {
      const e = cands[0];
      used.add(e.id);
      r.event = { id: e.id, payee: e.payee, payeeAccount: e.payeeAccount, submittedAt: e.submittedAt, executedAt: e.executedAt, submittedBy: e.submittedBy, status: e.status };
      if (!r.payee) {
        r.payee = e.payee;
        r.payeeSource = PAYEE_SOURCE_EVENTS;
      }
      stats.found++;
    } else if (cands.length > 1) stats.ambiguous++;
    else stats.none++;
  }
  return stats;
}

/**
 * Names the transfer lines of `rows` from the stored events (see matchTransfers). accounts = our bank accounts (as
 * in the bank files) or a function of the row; transfer(r) says which rows are transfers (default: the bank's
 * transfer texts; pass () => true for book lines, which carry no instrument word). A missing table or a DB error
 * leaves the rows unchanged and is reported in the stats. @returns {Promise<{lines:number, found:number, ambiguous:number, none:number, error?:string}>}
 */
export async function addTransferEvents(rows, { accounts = [], date, amount, name = () => null, account = () => null, text = (r) => r.details, actionCode = () => null, transfer = null } = {}) {
  const isTransfer = transfer || ((r) => isTransferLine(text(r), actionCode(r)));
  const list = (rows || []).filter((r) => amount(r) > 0 && date(r) && isTransfer(r));
  if (!list.length) return { lines: 0, found: 0, ambiguous: 0, none: 0 };
  const accs = [...new Set((typeof accounts === "function" ? list.map(accounts) : accounts).filter(Boolean))];
  const days = list.map(date).sort();
  try {
    const events = await transferEvents(accs, days[0], days[days.length - 1]);
    return matchTransfers(list, events, { date, amount, name, account });
  } catch (err) {
    return { lines: list.length, found: 0, ambiguous: 0, none: 0, error: `events not looked up: ${err.code || err.message}` };
  }
}
