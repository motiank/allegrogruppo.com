// The cheques Pasta Lina wrote in Priority before Hashavshevet — history, from shared/priority_cheques.json (built by
// scripts/priority_cheques_import.js from the owner's Priority export; a constant file, nothing updates it).
//
// Used when the books do not know a cheque: the bank reconciliation's "לא נמצא בחשבשבת" lines (chequePayees.js, source
// "priority"), and the Finance API's /cheques/priority for Joya's questions ("what was cheque 10777 for").
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const FILE = require("../../../shared/priority_cheques.json");

const { cheques: _list, ...meta } = FILE;
/** What the file is: source, company (Allegro key), file, builtAt, payDates, chequeDates, count, withoutNumber, net. */
export const PRIORITY_CHEQUES_META = Object.freeze(meta);
/** Every record, one per payment (= one cheque), ordered by cheque number. */
export const PRIORITY_CHEQUES = FILE.cheques;

const byNumber = new Map();
for (const c of PRIORITY_CHEQUES) {
  if (c.cheque == null) continue;
  const k = String(c.cheque);
  if (!byNumber.has(k)) byNumber.set(k, []);
  byNumber.get(k).push(c);
}

const chequeNo = (v) => {
  const s = String(v ?? "").trim();
  return /^\d+$/.test(s) ? String(Number(s)) : null;
};

/**
 * The Priority records of cheque numbers (strings or ints). A number can appear twice (10777 was written to two
 * payees); the caller picks by amount (`net` = the amount on the cheque).
 * @returns {Map<string, object[]>} keyed by the number as a plain string; numbers not in the file are absent
 */
export function priorityChequesByNumber(numbers) {
  const out = new Map();
  for (const n of numbers || []) {
    const k = chequeNo(n);
    if (k && byNumber.has(k) && !out.has(k)) out.set(k, byNumber.get(k));
  }
  return out;
}

const norm = (s) => String(s ?? "").replace(/["'`״׳]/g, "").toLowerCase();
const sameAmount = (a, b) => Math.abs(a - b) < 0.01;

/**
 * Search the file. All filters are optional and combine (AND):
 *   cheque = cheque number(s) · q = part of the supplier name, the details or an invoice number · supplierAccount ·
 *   amount = the amount on the cheque (net) or before withholding (amount), ±0.01 · from / to on `dateField`
 *   ("chequeDate" = the date written on the cheque, default; "payDate" = when it was made in Priority).
 * @returns {{ rows: object[], total: number, totals: { count: number, amount: number, withholding: number, net: number } }}
 *          rows = the page (limit / offset), totals over every match
 */
export function searchPriorityCheques({ cheque = null, q = null, supplierAccount = null, amount = null, from = null, to = null, dateField = "chequeDate", limit = 100, offset = 0 } = {}) {
  const numbers = cheque == null ? null : new Set((Array.isArray(cheque) ? cheque : String(cheque).split(",")).map(chequeNo).filter(Boolean));
  const words = q ? norm(q).split(/\s+/).filter(Boolean) : [];
  const amt = amount == null || amount === "" ? null : Math.abs(Number(amount));
  const field = dateField === "payDate" ? "payDate" : "chequeDate";
  const matches = PRIORITY_CHEQUES.filter((c) => {
    if (numbers && !(c.cheque != null && numbers.has(String(c.cheque)))) return false;
    if (supplierAccount && c.supplierAccount !== String(supplierAccount).trim()) return false;
    if (amt != null && !(sameAmount(c.net, amt) || sameAmount(c.amount, amt))) return false;
    if (from && (!c[field] || c[field] < from)) return false;
    if (to && (!c[field] || c[field] > to)) return false;
    if (words.length) {
      const hay = norm([c.supplier, c.details, c.payment, ...c.lines.map((l) => `${l.invoice ?? ""} ${l.internal ?? ""}`)].join(" "));
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  const r2 = (n) => Math.round(n * 100) / 100;
  const totals = { count: matches.length, amount: 0, withholding: 0, net: 0 };
  for (const c of matches) { totals.amount += c.amount; totals.withholding += c.withholding; totals.net += c.net; }
  totals.amount = r2(totals.amount); totals.withholding = r2(totals.withholding); totals.net = r2(totals.net);
  return { rows: matches.slice(offset, offset + limit), total: matches.length, totals };
}
