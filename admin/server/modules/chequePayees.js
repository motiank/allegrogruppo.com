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
//   3. the Priority cheque file (shared/priority_cheques.json — every cheque written in Priority before Hashavshevet,
//      April 2025 – March 2026; history, constant): the supplier of that cheque number, the amount on the cheque
//      (`net`) first when a number was used twice. payeeSource "priority": the name is known, the cheque is still
//      not in Hashavshevet;
//   4. the cheque archive in Drive (chequeArchive.js — the scanned cheques the bank paid, owner 2026-11-16): the name
//      READ FROM THE PICTURE of the cheque with that number and the same amount. payeeSource "image": the name is
//      known, the cheque is still not in Hashavshevet. An unsure reading (the index's payeeGuess) is "image_guess";
//   5. nothing — the cheque is not in Hashavshevet yet. The line gets payee null and payeeSource "missing": that
//      is the cheque the bookkeeper still has to enter (the loop the owner wants to close).
// Every cheque line that has a picture in the archive (same number and amount) also gets `imageId` (the Drive file)
// and `image` (its Drive link) — whoever its name came from — so the bookkeeper opens the scan from the line.
// The lookup runs when the lines are shown (not stored): the name is in Hashavshevet before the cheque clears, and a
// cheque entered late shows its name the next time the list opens. Every caller must survive a finance DB that is
// down — `addChequePayees` then leaves the rows as they are and reports it in `meta.payees` — and a Drive that is
// down (then the archive adds nothing and `meta.payees.archiveError` says why).
import { createRequire } from "module";
import { financeSql } from "../sources/financePool.js";
import { priorityChequesByNumber, PRIORITY_CHEQUES_META } from "./priorityCheques.js";
import { archiveChequesByNumber, archiveFolderOf, driveImageUrl } from "./chequeArchive.js";

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
export const PAYEE_SOURCE = { cheques: "cheques", journal: "journal", priority: "priority", image: "image", imageGuess: "image_guess", missing: "missing" };
/** The archive's picture of a cheque, as a candidate without a name (never picked as the payee; it carries the image). */
const ARCHIVE_ONLY = "archive";

/**
 * The candidates for the payee of each cheque number of one company: the cheques module first, then journal entries,
 * then (Pasta Lina only) the Priority cheque file, then the cheque archive in Drive (the name read from the picture).
 * @param {number} companyId  allegro_finance company id
 * @param {Array<{reference:any}|number|string>} refs  cheque numbers (strings or ints)
 * @param {{bankAccounts?: string[], archive?: object}} [opt]  the company's bank account keys (looked up when missing); `archive`
 *        collects the archive's error, when given ({ error } is set on it)
 * @returns {Promise<Map<string, Array<{payee:string|null, amount:number|null, source:'cheques'|'journal'|'priority'|'image'|'image_guess'|'archive', account?:string|null, supplierAccount?:string|null, chequeId?:number, dueDate?:string, transId?:number, payment?:string, chequeDate?:string, imageId?:string, date?:string}>>>}
 *          `account` = the Hashavshevet account the cheque was booked on (cheques module / the journal's other side);
 *          `supplierAccount` = Priority's own supplier number of the payee (108 = the employees' one supplier)
 *          keyed by the cheque number as a plain string; numbers not found are absent. Resolve one line with `pickPayee`
 *          and its picture with `pickImage`. An archive record without a confirmed name is a candidate with payee null
 *          (source "archive") — it only carries the image.
 */
export async function chequePayees(companyId, refs, { bankAccounts, archive } = {}) {
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
    `SELECT reference, payee_name, amount_to_pay, cheque_id, account_key, DATE_FORMAT(due_date, '%Y-%m-%d') AS due
       FROM cheques WHERE company_id = :companyId AND deleted_at IS NULL AND reference IN (${nlist1}) ORDER BY cheque_id`,
    p1,
  );
  for (const c of cheques) if (c.payee_name) push(c.reference, { payee: c.payee_name, amount: amt(c.amount_to_pay), source: PAYEE_SOURCE.cheques, chequeId: c.cheque_id, dueDate: c.due, account: c.account_key || null });

  // 2. the journal entry with that reference on the bank account (only for numbers the module does not know)
  const rest = numbers.filter((n) => !out.has(String(n)));
  const code = await financeCompanyCode(companyId);
  if (rest.length) {
    // 3. the Priority file — pushed after the journal candidates, so with the same amount Hashavshevet's name wins
    const priority = companyId === (await financeCompanyId(PRIORITY_CHEQUES_META.company)) ? priorityChequesByNumber(rest) : new Map();
    const pushPriority = () => {
      for (const [no, list] of priority) for (const c of list) push(no, { payee: c.supplier, amount: c.net, source: PAYEE_SOURCE.priority, payment: c.payment, chequeDate: c.chequeDate, supplierAccount: c.supplierAccount == null ? null : String(c.supplierAccount) });
    };
    let banks = bankAccounts;
    if (!banks) {
      const rows = await financeSql(`SELECT DISTINCT account_key FROM bank_lines WHERE company_id = :companyId AND deleted_at IS NULL`, { companyId });
      banks = rows.map((r) => r.account_key);
    }
    if (banks.length) {
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
        const bankIsCredit = banks.includes(e.credit_account);
        const name = bankIsCredit ? e.debit_name : e.credit_name;
        if (name) push(e.reference, { payee: name, amount: amt(e.amount), source: PAYEE_SOURCE.journal, transId: e.trans_id, account: (bankIsCredit ? e.debit_account : e.credit_account) || null });
      }
    }
    pushPriority();
  }

  // 4. the cheque archive in Drive — for EVERY number (the picture is wanted on named lines too). Only a name READ
  //    FROM THE PICTURE is a candidate (a name the archive copied from Hashavshevet or Priority at filing time is not:
  //    our own sources above are the live ones); a guess apart; any other record carries the image only
  if (code && archiveFolderOf(code)) {
    const { byNumber, error } = await archiveChequesByNumber(code, numbers);
    if (archive) archive.error = error;
    for (const [no, list] of byNumber)
      for (const c of list)
        push(no, {
          payee: c.fromImage ? c.payee : !c.payee && c.guess ? c.guess : null, amount: c.amount, date: c.date, imageId: c.imageId,
          source: c.fromImage ? PAYEE_SOURCE.image : !c.payee && c.guess ? PAYEE_SOURCE.imageGuess : ARCHIVE_ONLY,
        });
  }
  return out;
}

/**
 * The candidate for one bank line: the sure one with the same amount (Hashavshevet first, then Priority, then the
 * archive's name read from the picture); else the oldest cheque of the module with that number, else the Priority
 * cheque with that number (a cheque number names the payee even when the amount differs, e.g. a cheque corrected
 * after it was written); a journal entry or an archive record with another amount is not used (the archive's rows
 * ARE bank lines — another amount is another cheque that reused the number). Last, an unsure reading of the picture
 * with the same amount ("image_guess"). Nothing → null → "missing".
 */
export function pickPayee(candidates, amount) {
  if (!candidates?.length) return null;
  const a = amt(amount);
  const named = candidates.filter((c) => c.payee);
  const sure = named.filter((c) => c.source !== PAYEE_SOURCE.imageGuess);
  return (
    sure.find((c) => same(a, c.amount)) ||
    sure.find((c) => c.source === PAYEE_SOURCE.cheques) ||
    sure.find((c) => c.source === PAYEE_SOURCE.priority) ||
    named.find((c) => c.source === PAYEE_SOURCE.imageGuess && same(a, c.amount)) ||
    null
  );
}

/** The archive picture of one bank line: the record with the same amount, else the only record of that number. */
export function pickImage(candidates, amount) {
  const pics = (candidates || []).filter((c) => c.imageId);
  if (!pics.length) return null;
  const a = amt(amount);
  return pics.find((c) => same(a, c.amount)) || (pics.length === 1 ? pics[0] : null);
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
/** The finance company code ("pastalina") of an allegro_finance company id; null when unknown. */
export async function financeCompanyCode(companyId) {
  if (companyId == null) return null;
  for (const [code, id] of companyIdCache) if (id === companyId) return code;
  const [row] = await financeSql(`SELECT code FROM companies WHERE company_id = :companyId`, { companyId });
  if (!row) return null;
  companyIdCache.set(row.code, companyId);
  return row.code;
}

/**
 * Adds `payee` and `payeeSource` ("cheques" | "journal" | "priority" | "image" | "image_guess" | "missing") to the cheque
 * lines of `rows` (other rows are left alone), and `imageId` + `image` (the Drive link of the scanned cheque) where the
 * archive has the picture; `booksAccount` (the Hashavshevet account the cheque is booked on) when the name came from the
 * books and `payeeSupplier` (Priority's supplier number) when it came from the Priority file — bankLineAccounts.js turns
 * them into the line's card (כרטסת). Rows of several companies are grouped by `company(row)`; a finance DB error leaves the rows
 * unchanged. `found` counts every surely named line (`priority` and `image` = of them, named by that source only — not
 * in Hashavshevet), `imageGuess` the lines with an unsure name from the picture (not in `found`, not in `missing`),
 * `withImage` the lines that have a picture, `missing` the lines with no name at all.
 * @returns {Promise<{lines:number, found:number, priority:number, image:number, imageGuess:number, withImage:number, missing:number, error?:string, archiveError?:string}>}  what happened, for `meta.payees`
 */
export async function addChequePayees(rows, { company, text = (r) => r.details, reference = (r) => r.reference, amount = (r) => r.amount, bankAccounts } = {}) {
  const stats = { lines: 0, found: 0, priority: 0, image: 0, imageGuess: 0, withImage: 0, missing: 0 };
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
      const archive = {};
      const names = await chequePayees(companyId, list.map((r) => reference(r)), { bankAccounts, archive });
      if (archive.error) stats.archiveError = archive.error;
      for (const r of list) {
        const cands = names.get(chequeNo(reference(r)));
        const hit = pickPayee(cands, amount(r));
        stats.lines++;
        if (hit) {
          r.payee = hit.payee;
          r.payeeSource = hit.source;
          if (hit.account) r.booksAccount = hit.account;
          if (hit.supplierAccount) r.payeeSupplier = hit.supplierAccount;
          if (hit.source === PAYEE_SOURCE.imageGuess) stats.imageGuess++;
          else {
            stats.found++;
            if (hit.source === PAYEE_SOURCE.priority) stats.priority++;
            if (hit.source === PAYEE_SOURCE.image) stats.image++;
          }
        } else {
          r.payee = null;
          r.payeeSource = PAYEE_SOURCE.missing;
          stats.missing++;
        }
        const pic = pickImage(cands, amount(r));
        if (pic) {
          r.imageId = pic.imageId;
          r.image = driveImageUrl(pic.imageId);
          stats.withImage++;
        }
      }
    }
  } catch (err) {
    stats.error = `payees not looked up: ${err.code || err.message}`;
  }
  return stats;
}
