// Beneficiary names for the cheques that appear in a bank statement, from Hashavshevet (allegro_finance, read only).
//
// A bank "שיק" line carries the cheque number as its reference (אסמכתא). The name comes, in this order, from
//   1. the cheques module — `cheques.payee_name` by cheque number (cheques written since 2025-10-09). A number can
//      appear twice (a cheque cancelled and written again, sometimes to another payee), so the row with the bank
//      line's amount wins;
//   2. the journal entry on the bank account whose reference is the cheque number AND the same amount (older or
//      hand-written cheques): the name on the other side of the entry. The reference of an entry is a free field —
//      bank-fee entries (0.25 ₪, "עמלות") copy the cheque number too — so without the amount the name is only a guess
//      and is not used;
//   3. nothing — the cheque is not in Hashavshevet yet. The line gets payee null and payeeSource "missing": that
//      is the cheque the bookkeeper still has to enter (the loop the owner wants to close).
// The lookup runs when the lines are shown (not stored): the name is in Hashavshevet before the cheque clears, and a
// cheque entered late shows its name the next time the list opens. Every caller must survive a finance DB that is
// down — `addChequePayees` then leaves the rows as they are and reports it in `meta.payees`.
import { createRequire } from "module";
import { financeSql } from "../sources/financePool.js";

const require = createRequire(import.meta.url);
const FINANCE_MAP = require("../../../shared/finance_map.json");

// Bank texts that are a cheque we wrote (Hapoalim's `action` / Hashavshevet's `details`): "שיק", "החזרת שיק",
// "החזרת שיק-טכני", "עמ' בטול שיק". Not "קניית שיק" (a bank cheque bought), "הפ שיק-ממסרים" / "הפקדת שיקים"
// (cheques we received), "פנקסי שיקים" (cheque books).
const CHEQUE_RE = /^שיק(?![א-ת])|החזרת שיק|ב[יי]?טול שיק/; // \b does not know Hebrew letters
export const isChequeLine = (text) => CHEQUE_RE.test(String(text || "").trim());

const chequeNo = (reference) => {
  const s = String(reference ?? "").trim();
  return /^\d+$/.test(s) ? String(Number(s)) : null;
};
const amt = (v) => (v == null ? null : Math.abs(Number(v)));
const same = (a, b) => a != null && b != null && Math.abs(a - b) < 0.005;
const PAYEE_SOURCE = { cheques: "cheques", journal: "journal", missing: "missing" };

/**
 * The candidates for the payee of each cheque number of one company: the cheques module first, then journal entries.
 * @param {number} companyId  allegro_finance company id
 * @param {Array<{reference:any}|number|string>} refs  cheque numbers (strings or ints)
 * @param {{bankAccounts?: string[]}} [opt]  the company's bank account keys (looked up when missing)
 * @returns {Promise<Map<string, Array<{payee:string, amount:number|null, source:'cheques'|'journal', chequeId?:number, dueDate?:string, transId?:number}>>>}
 *          keyed by the cheque number as a plain string; numbers not found are absent. Resolve one line with `pickPayee`.
 */
export async function chequePayees(companyId, refs, { bankAccounts } = {}) {
  const out = new Map();
  const numbers = [...new Set((refs || []).map((r) => chequeNo(r && typeof r === "object" ? r.reference : r)).filter(Boolean))].map(Number);
  if (!numbers.length) return out;
  const push = (no, cand) => {
    const k = String(no);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(cand);
  };

  // 1. the cheques module
  const p1 = { companyId };
  const nlist1 = numbers.map((n, i) => ((p1[`n${i}`] = n), `:n${i}`)).join(",");
  const cheques = await financeSql(
    `SELECT reference, payee_name, amount_to_pay, cheque_id, DATE_FORMAT(due_date, '%Y-%m-%d') AS due
       FROM cheques WHERE company_id = :companyId AND deleted_at IS NULL AND reference IN (${nlist1}) ORDER BY cheque_id`,
    p1,
  );
  for (const c of cheques) if (c.payee_name) push(c.reference, { payee: c.payee_name, amount: amt(c.amount_to_pay), source: PAYEE_SOURCE.cheques, chequeId: c.cheque_id, dueDate: c.due });

  // 2. the journal entry with that reference on the bank account (only for numbers the module does not know)
  const rest = numbers.filter((n) => !out.has(String(n)));
  if (!rest.length) return out;
  let banks = bankAccounts;
  if (!banks) {
    const rows = await financeSql(`SELECT DISTINCT account_key FROM bank_lines WHERE company_id = :companyId AND deleted_at IS NULL`, { companyId });
    banks = rows.map((r) => r.account_key);
  }
  if (!banks.length) return out;
  const p2 = { companyId };
  const nlist = rest.map((n, i) => ((p2[`r${i}`] = n), `:r${i}`)).join(",");
  const blist = banks.map((b, i) => ((p2[`b${i}`] = b), `:b${i}`)).join(",");
  const entries = await financeSql(
    `SELECT reference, trans_id, status, amount, debit_account, credit_account, debit_name, credit_name
       FROM journal_entries
      WHERE company_id = :companyId AND deleted_at IS NULL AND reference IN (${nlist})
        AND (credit_account IN (${blist}) OR debit_account IN (${blist}))
      ORDER BY status DESC, trans_id DESC`,
    p2,
  );
  for (const e of entries) {
    const name = banks.includes(e.credit_account) ? e.debit_name : e.credit_name;
    if (name) push(e.reference, { payee: name, amount: amt(e.amount), source: PAYEE_SOURCE.journal, transId: e.trans_id });
  }
  return out;
}

/**
 * The candidate for one bank line: the one with the same amount; else the oldest cheque of the module with that number
 * (the number names the payee even when the amount differs, e.g. a cheque corrected after it was written); a journal
 * entry with another amount is not used (null → "missing").
 */
export function pickPayee(candidates, amount) {
  if (!candidates?.length) return null;
  const a = amt(amount);
  return candidates.find((c) => same(a, c.amount)) || candidates.find((c) => c.source === PAYEE_SOURCE.cheques) || null;
}

const companyIdCache = new Map(); // finance company code → company_id
/** The allegro_finance company id of a finance company code ("pastalina") or of an Allegro company key ("pastaLina"). */
export async function financeCompanyId(key) {
  if (!key) return null;
  const code = FINANCE_MAP.companies[key] ? key : Object.keys(FINANCE_MAP.companies).find((c) => FINANCE_MAP.companies[c].allegroKey === key);
  if (!code) return null;
  if (!companyIdCache.has(code)) {
    const [row] = await financeSql(`SELECT company_id FROM companies WHERE code = :code`, { code });
    if (!row) return null;
    companyIdCache.set(code, row.company_id);
  }
  return companyIdCache.get(code);
}

/**
 * Adds `payee` and `payeeSource` ("cheques" | "journal" | "missing") to the cheque lines of `rows` (other rows are
 * left alone). Rows of several companies are grouped by `company(row)`; a finance DB error leaves the rows unchanged.
 * @returns {Promise<{found:number, missing:number, lines:number, error?:string}>}  what happened, for `meta.payees`
 */
export async function addChequePayees(rows, { company, text = (r) => r.details, reference = (r) => r.reference, amount = (r) => r.amount, bankAccounts } = {}) {
  const stats = { lines: 0, found: 0, missing: 0 };
  const groups = new Map(); // company key → cheque rows
  for (const r of rows || []) {
    if (!isChequeLine(text(r)) || !chequeNo(reference(r))) continue;
    const k = typeof company === "function" ? company(r) : company;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  try {
    for (const [key, list] of groups) {
      const companyId = typeof key === "number" ? key : await financeCompanyId(key);
      if (!companyId) continue;
      const names = await chequePayees(companyId, list.map((r) => reference(r)), { bankAccounts });
      for (const r of list) {
        const hit = pickPayee(names.get(chequeNo(reference(r))), amount(r));
        stats.lines++;
        if (hit) {
          r.payee = hit.payee;
          r.payeeSource = hit.source;
          stats.found++;
        } else {
          r.payee = null;
          r.payeeSource = PAYEE_SOURCE.missing;
          stats.missing++;
        }
      }
    }
  } catch (err) {
    stats.error = `payees not looked up: ${err.code || err.message}`;
  }
  return stats;
}
