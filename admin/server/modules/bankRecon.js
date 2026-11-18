// Detailed bank reconciliation report (דוח התאמת בנק מפורט) over allegro_finance (the Hashavshevet copy).
// Read only. Three sections for one bank account and a date range, as of the range's end date:
//   1. bank lines with no book match          (bank_lines open as of `to`)
//   2. book lines with no bank match, cheques excluded (journal lines on the bank account, no bank_matches row)
//   3. cheques: cleared in the period (paired to their bank line), issued but not yet cleared (3ב), and not cleared more
//      than 60 days after their date (3ג — the ones to cancel or re-issue; POST /export writes their reversal moves for
//      Hashavshevet's import, hashavshevetMoves.js)
// Summary: bank balance − (1) + (2) + (3b) = expected book balance; the rest is "unexplained".
// Signs: money into the bank is plus on both sides (bank_lines.signed_amount; journal_lines.signed_amount is
// debit-plus, and a debit on the bank account is money in).
//
// Mounted by auth/roles/admin.js at /admin/bank-recon (admin role only):
//   GET /admin/bank-recon/accounts                      → companies and their bank accounts, default dates
//   GET /admin/bank-recon/report?company=&account=&from=&to=&format=json|html|xlsx
//       [&kind=cheque,transfer,…][&party=<account key | name>][&q=<text>][&amount=<number>][&sections=…][&noise=hide][&older=hide][&facets=1]
//       — the filters of shared/bankReconFilter.js: the sections keep only the matching rows, the summary stays whole
//   GET /admin/bank-recon/facets?company=&account=&from=&to= → the kinds and the parties of the report, for the pickers
//   GET /admin/bank-recon/cheque-image/:id                   → the scanned cheque (Drive archive, chequeArchive.js), for the 📷 links
//   POST /admin/bank-recon/export                            → the chosen rows of a section as Excel, or the Hashavshevet import file (3ג)
// Every row carries its card (כרטסת, owner 2026-11-18): counterAccount / counterName — the books' own on sections 2 and 3,
// bankLineAccounts.js's on section 1 (counterSource books | name | employee | history | employee_guess | text, counterBasis
// = why); counterEmployee = the one employees card (finance_map employees.account), colored blue on the pages.
// HTML comes from shared/bankReconHtml.js (also used by the admin page); Excel from exceljs.

import express from "express";
import { createRequire } from "module";
import { financeSql } from "../sources/financePool.js";
import { ApiError, badRequest, isIsoDate } from "./localApi.js";
import { today, daysBetween, financeErrorResponse } from "./financeApi.js";
import { renderBankReconHtml, fmtDate, CHEQUE_STATUS_LABEL, SECTION_TITLES, payeeText } from "../../../shared/bankReconHtml.js";
import { parseFilter, applyFilter, KIND_LABEL } from "../../../shared/bankReconFilter.js";
import { NOISE_LABEL, TODO_LABEL, STALE_DAYS } from "../../../shared/bankReconNoise.js";
import { loadChequeEntries, reversalMoves, movesWorkbook, movesMovein, ACTIONS } from "./hashavshevetMoves.js";
import { addChequePayees } from "./chequePayees.js";
import { readChequeImage } from "./chequeArchive.js";
import { addTransferEvents, fileAccountsOf } from "./bankEvents.js";
import { addBankFileNames } from "./bankFileNames.js";
import { addBankLineAccounts, companyAccounts, employeesRule, ACCOUNT_SOURCE_LABEL } from "./bankLineAccounts.js";

const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs");

const MAX_RANGE_DAYS = 800;
const num = (v) => (v == null || v === "" ? 0 : Number(v) || 0);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const day = (v) => (v == null ? null : String(v).slice(0, 10));
const sum = (rows, f) => round2(rows.reduce((a, r) => a + num(f(r)), 0));

// ── parameters ───────────────────────────────────────────────────────────

export async function listBankReportAccounts() {
  const rows = await financeSql(
    `SELECT c.company_id, c.code, c.name FROM companies c ORDER BY c.company_id`,
  );
  const out = [];
  for (const c of rows) {
    const banks = await financeSql(
      `SELECT b.account_key, MIN(b.line_date) AS d0, MAX(b.line_date) AS d1, COUNT(*) AS n,
              (SELECT a.name FROM accounts a WHERE a.company_id = b.company_id AND a.account_key = b.account_key AND a.deleted_at IS NULL
                ORDER BY a.fiscal_year DESC LIMIT 1) AS name
         FROM bank_lines b WHERE b.company_id = :companyId AND b.deleted_at IS NULL AND b.account_key IS NOT NULL
        GROUP BY b.company_id, b.account_key ORDER BY b.account_key`,
      { companyId: c.company_id },
    );
    out.push({
      companyId: c.company_id,
      code: c.code,
      name: c.name,
      banks: banks.map((b) => ({ key: b.account_key, name: b.name || b.account_key, from: day(b.d0), dataUpTo: day(b.d1), lines: num(b.n) })),
    });
  }
  return out;
}

export async function resolveParams(query = {}) {
  const all = await listBankReportAccounts();
  const withBooks = all.filter((c) => c.banks.length);
  if (!withBooks.length) throw new ApiError(404, "not_found", "no bank lines in allegro_finance yet");
  const code = String(query.company || "").trim() || withBooks[0].code;
  const company = all.find((c) => c.code === code);
  if (!company) throw new ApiError(404, "not_found", `unknown company ${code}`);
  const accountKey = String(query.account || "").trim() || company.banks[0]?.key;
  const bank = company.banks.find((b) => b.key === accountKey);
  if (!bank) throw badRequest(`${accountKey || "(none)"} is not a bank account of ${code} (bank accounts: ${company.banks.map((b) => b.key).join(", ") || "none"})`);
  const to = String(query.to || "").trim() || today();
  const from = String(query.from || "").trim() || `${to.slice(0, 4)}-01-01`;
  if (!isIsoDate(from) || !isIsoDate(to)) throw badRequest("from and to must be YYYY-MM-DD");
  if (from > to) throw badRequest("from must not be after to");
  if (daysBetween(from, to) > MAX_RANGE_DAYS) throw badRequest(`the range is longer than ${MAX_RANGE_DAYS} days`);
  let filter;
  try { filter = parseFilter(query); } catch (err) { if (err.code === "bad_request") throw badRequest(err.message); throw err; }
  return { company, bank, accountKey, from, to, filter };
}

// ── the report ───────────────────────────────────────────────────────────

export async function buildBankReconReport(query = {}) {
  const { company, bank, accountKey, from, to, filter } = await resolveParams(query);
  const p = { companyId: company.companyId, acc: accountKey, from, to };

  const [sync] = await financeSql(`SELECT MAX(finished_at) AS t FROM sync_runs WHERE status = 'done' AND company_id = :companyId`, p);
  const [chqStart] = await financeSql(
    `SELECT MIN(e.value_date) AS d FROM cheques c JOIN journal_entries e ON e.company_id = c.company_id AND e.cheque_id = c.cheque_id AND e.deleted_at IS NULL
      WHERE c.company_id = :companyId AND c.bank_key = :acc AND c.deleted_at IS NULL`,
    p,
  );

  // Bank balance: Hashavshevet's running balance after the last line up to `to`.
  const [lastLine] = await financeSql(
    `SELECT running_balance, line_date FROM bank_lines
      WHERE company_id = :companyId AND account_key = :acc AND deleted_at IS NULL AND line_date <= :to
      ORDER BY line_date DESC, bank_line_id DESC LIMIT 1`,
    p,
  );
  const [bankSum] = await financeSql(
    `SELECT SUM(signed_amount) AS s, COUNT(*) AS n FROM bank_lines
      WHERE company_id = :companyId AND account_key = :acc AND deleted_at IS NULL AND line_date <= :to`,
    p,
  );
  // Book balance: every journal line on the bank account up to `to` (posted and unposted; unposted are counted).
  const [book] = await financeSql(
    `SELECT SUM(l.signed_amount) AS s, SUM(e.status <> 1) AS unposted, COUNT(*) AS n
       FROM journal_lines l JOIN journal_entries e ON e.company_id = l.company_id AND e.fiscal_year = l.fiscal_year AND e.trans_id = l.trans_id
      WHERE l.company_id = :companyId AND l.account_key = :acc AND l.deleted_at IS NULL AND e.deleted_at IS NULL AND e.value_date <= :to`,
    p,
  );

  // 1. Bank lines open as of `to`: Hashavshevet's flag, less matches made after `to`.
  const bankOpenRows = await financeSql(
    `SELECT b.bank_line_id, b.fiscal_year, DATE_FORMAT(b.line_date, '%Y-%m-%d') AS d, b.reference, b.details, b.signed_amount
       FROM bank_lines b
      WHERE b.company_id = :companyId AND b.account_key = :acc AND b.deleted_at IS NULL AND b.line_date <= :to
        AND (b.is_matched = 0 OR b.is_matched IS NULL
             OR EXISTS (SELECT 1 FROM bank_matches m WHERE m.company_id = b.company_id AND m.side = 'bank' AND m.linked_id = b.bank_line_id
                          AND m.deleted_at IS NULL AND DATE(m.matched_on) > :to))
      ORDER BY b.line_date, b.bank_line_id`,
    p,
  );

  // Book lines open as of `to` (no bank match made up to `to`), with the counter account and the cheque, if any.
  const bookOpenRows = await financeSql(
    `SELECT l.line_id, l.fiscal_year, l.trans_id, DATE_FORMAT(e.value_date, '%Y-%m-%d') AS d, e.reference, e.trans_type, e.description, e.details,
            e.batch_no, e.status, e.cheque_id, l.side, l.signed_amount,
            IF(l.side = 'credit', e.debit_account, e.credit_account) AS counter_account,
            IF(l.side = 'credit', e.debit_name, e.credit_name) AS counter_name
       FROM journal_lines l JOIN journal_entries e ON e.company_id = l.company_id AND e.fiscal_year = l.fiscal_year AND e.trans_id = l.trans_id
      WHERE l.company_id = :companyId AND l.account_key = :acc AND l.deleted_at IS NULL AND e.deleted_at IS NULL AND e.value_date <= :to
        AND NOT EXISTS (SELECT 1 FROM bank_matches m WHERE m.company_id = l.company_id AND m.side = 'book' AND m.linked_id = l.line_id
                          AND m.deleted_at IS NULL AND (m.matched_on IS NULL OR DATE(m.matched_on) <= :to))
      ORDER BY e.value_date, l.line_id`,
    p,
  );

  // Book lines dated after `to` that Hashavshevet already matched to the bank up to `to` (the bank has the money
  // movement, the books as of `to` do not yet — usually a cheque entered with a later value date).
  const futureMatchedRows = await financeSql(
    `SELECT l.line_id, l.fiscal_year, l.trans_id, DATE_FORMAT(e.value_date, '%Y-%m-%d') AS d, e.reference, e.trans_type, e.description, e.details, e.batch_no, e.status,
            e.cheque_id, l.signed_amount, IF(l.side = 'credit', e.debit_account, e.credit_account) AS counter_account, IF(l.side = 'credit', e.debit_name, e.credit_name) AS counter_name
       FROM journal_lines l JOIN journal_entries e ON e.company_id = l.company_id AND e.fiscal_year = l.fiscal_year AND e.trans_id = l.trans_id
      WHERE l.company_id = :companyId AND l.account_key = :acc AND l.deleted_at IS NULL AND e.deleted_at IS NULL AND e.value_date > :to
        AND EXISTS (SELECT 1 FROM bank_matches m WHERE m.company_id = l.company_id AND m.side = 'book' AND m.linked_id = l.line_id
                      AND m.deleted_at IS NULL AND (m.matched_on IS NULL OR DATE(m.matched_on) <= :to))
      ORDER BY e.value_date, l.line_id`,
    p,
  );

  // 3. Cheques of this bank account. journal_entries has no index on cheque_id, so the cheque entries are read once
  // (all entries with a cheque) and joined to the cheques in JS. Cancelled cheques (a second entry with a negative
  // amount) are left out.
  const chequeMaster = await financeSql(
    `SELECT c.cheque_id, c.reference AS cheque_no, c.payee_name, c.amount_to_pay, c.account_key, DATE_FORMAT(c.due_date, '%Y-%m-%d') AS due
       FROM cheques c WHERE c.company_id = :companyId AND c.bank_key = :acc AND c.deleted_at IS NULL ORDER BY c.due_date, c.cheque_id`,
    p,
  );
  // the card (כרטסת) of every row: the accounts list for the names, the one employees card (finance_map employees.account)
  const accountNames = await companyAccounts(company.companyId);
  const employees = employeesRule(company.code);
  const isEmployeesCard = (key) => Boolean(employees && key != null && String(key) === employees.account);
  const cardOf = (key) => (key == null || key === "" ? {} : { counterAccount: String(key), counterName: accountNames.get(String(key))?.name || null, counterSource: "books", ...(isEmployeesCard(key) ? { counterEmployee: true } : {}) });
  const chequeEntries = await financeSql(
    `SELECT e.cheque_id, e.trans_id, e.amount, DATE_FORMAT(e.value_date, '%Y-%m-%d') AS issued, e.status, l.line_id, l.signed_amount,
            mk.fiscal_year AS m_year, mk.match_num, DATE_FORMAT(mk.matched_on, '%Y-%m-%d') AS matched_on
       FROM journal_entries e
       LEFT JOIN journal_lines l ON l.company_id = e.company_id AND l.fiscal_year = e.fiscal_year AND l.trans_id = e.trans_id AND l.account_key = :acc AND l.deleted_at IS NULL
       LEFT JOIN bank_matches mk ON mk.company_id = l.company_id AND mk.side = 'book' AND mk.linked_id = l.line_id AND mk.deleted_at IS NULL
                                 AND (mk.matched_on IS NULL OR DATE(mk.matched_on) <= :to)
      WHERE e.company_id = :companyId AND e.cheque_id > 0 AND e.deleted_at IS NULL`,
    p,
  );
  const entriesByCheque = new Map();
  for (const e of chequeEntries) {
    if (!entriesByCheque.has(e.cheque_id)) entriesByCheque.set(e.cheque_id, []);
    entriesByCheque.get(e.cheque_id).push(e);
  }
  const chequeRows = [];
  for (const c of chequeMaster) {
    const es = entriesByCheque.get(c.cheque_id) || [];
    const cancelled = es.some((e) => num(e.amount) < 0);
    const e = es.find((x) => num(x.amount) > 0 && x.line_id != null && x.issued <= to);
    if (!e) { if (cancelled) chequeRows.push({ ...c, cancelled: 1, line_id: null }); continue; }
    chequeRows.push({ ...c, cancelled: cancelled ? 1 : 0, trans_id: e.trans_id, issued: e.issued, status: e.status, line_id: e.line_id, signed_amount: e.signed_amount,
      m_year: e.m_year, match_num: e.match_num, matched_on: e.matched_on });
  }
  const groupKeys = [...new Set(chequeRows.filter((r) => r.match_num != null).map((r) => `${r.m_year}:${r.match_num}`))];
  const groupBank = new Map(); // "year:num" → bank lines of the group
  if (groupKeys.length) {
    const rows = await financeSql(
      `SELECT CONCAT(m.fiscal_year, ':', m.match_num) AS k, b.bank_line_id, DATE_FORMAT(b.line_date, '%Y-%m-%d') AS d, b.reference, b.details, b.amount, b.signed_amount
         FROM bank_matches m JOIN bank_lines b ON b.company_id = m.company_id AND b.bank_line_id = m.linked_id AND b.deleted_at IS NULL
        WHERE m.company_id = :companyId AND m.side = 'bank' AND m.deleted_at IS NULL AND CONCAT(m.fiscal_year, ':', m.match_num) IN (${groupKeys.map((_, i) => `:g${i}`).join(",")})`,
      { ...p, ...Object.fromEntries(groupKeys.map((k, i) => [`g${i}`, k])) },
    );
    for (const r of rows) {
      if (!groupBank.has(r.k)) groupBank.set(r.k, []);
      groupBank.get(r.k).push(r);
    }
  }
  // Bank lines of cheques by cheque number (details שיק), for cheques the bookkeeper has not matched yet.
  const chequeBankLines = await financeSql(
    `SELECT b.reference, DATE_FORMAT(b.line_date, '%Y-%m-%d') AS d, b.amount, b.signed_amount, b.bank_line_id
       FROM bank_lines b WHERE b.company_id = :companyId AND b.account_key = :acc AND b.deleted_at IS NULL AND b.line_date <= :to AND b.details LIKE 'שיק%'`,
    p,
  );
  const bankByChequeNo = new Map();
  for (const r of chequeBankLines) {
    const k = String(r.reference);
    if (!bankByChequeNo.has(k)) bankByChequeNo.set(k, []);
    bankByChequeNo.get(k).push(r);
  }

  // A cheque reversed by a plain journal entry (our export, imported in Hashavshevet — hashavshevetMoves.js: same reference,
  // the same accounts with a negative amount, or the accounts swapped with a positive one, no cheque_id) is cancelled too,
  // although Hashavshevet's cheques module does not know it: it must not stay open in 3ב / 3ג.
  const unmatchedNos = [...new Set(chequeRows.filter((c) => !num(c.cancelled) && c.line_id != null && c.match_num == null).map((c) => String(c.cheque_no)))];
  const reversedByEntry = new Set(); // "chequeNo|amount"
  if (unmatchedNos.length) {
    const p3 = { companyId: company.companyId, acc: accountKey };
    const rlist = unmatchedNos.map((n, i) => ((p3[`r${i}`] = n), `:r${i}`)).join(",");
    const rows = await financeSql(
      `SELECT e.reference, e.amount, e.debit_account, e.credit_account, DATE_FORMAT(e.value_date, '%Y-%m-%d') AS d FROM journal_entries e
        WHERE e.company_id = :companyId AND e.deleted_at IS NULL AND e.status = 1 AND (e.cheque_id IS NULL OR e.cheque_id = 0) AND e.reference IN (${rlist})
          AND (e.credit_account = :acc OR e.debit_account = :acc)`,
      p3,
    );
    for (const r of rows) {
      // the storno: bank credited with a minus (both sides negative), or the bank debited with a plus
      const a = num(r.amount);
      if ((r.credit_account === accountKey && a < 0) || (r.debit_account === accountKey && a > 0)) reversedByEntry.add(`${r.reference}|${round2(Math.abs(a))}|${r.credit_account === accountKey ? r.debit_account : r.credit_account}`);
    }
  }
  const cheques = { cleared: [], open: [] };
  let cancelledCount = 0;
  let reversedCount = 0;
  const chequeLineIds = new Set();
  for (const c of chequeRows) {
    if (num(c.cancelled)) { cancelledCount++; continue; }
    if (c.line_id == null) continue;
    if (c.match_num == null && reversedByEntry.has(`${c.cheque_no}|${round2(Math.abs(num(c.amount_to_pay)))}|${c.account_key}`)) { reversedCount++; chequeLineIds.add(c.line_id); continue; }
    chequeLineIds.add(c.line_id);
    const amount = round2(c.signed_amount); // minus: money out
    const base = {
      chequeId: c.cheque_id, chequeNo: c.cheque_no, payee: c.payee_name, issueDate: c.issued, dueDate: c.due, amount,
      posted: num(c.status) === 1, lineId: c.line_id, transId: c.trans_id, ...cardOf(c.account_key),
    };
    if (c.match_num != null) {
      const lines = groupBank.get(`${c.m_year}:${c.match_num}`) || [];
      const byNo = lines.filter((b) => String(b.reference) === String(c.cheque_no));
      const sameAmount = (b) => Math.abs(num(b.amount) - num(c.amount_to_pay)) < 0.005;
      // The bank line of this cheque: the same cheque number and amount; else the group's only bank line.
      const exact = byNo.find(sameAmount) || (lines.length === 1 && sameAmount(lines[0]) ? lines[0] : null);
      const pick = exact || (lines.length === 1 ? lines[0] : byNo.length === 1 ? byNo[0] : null);
      const clearedDate = pick ? pick.d : c.matched_on;
      cheques.cleared.push({
        ...base, status: exact ? "cleared" : "cleared_group", clearedDate, bankAmount: pick ? round2(pick.signed_amount) : null,
        bankReference: pick ? pick.reference : null, bankLineId: pick ? pick.bank_line_id : null,
        daysAfterDue: clearedDate && c.due ? daysBetween(c.due, clearedDate) : null, groupSize: lines.length,
      });
    } else {
      const seen = (bankByChequeNo.get(String(c.cheque_no)) || []).find((b) => Math.abs(num(b.amount) - num(c.amount_to_pay)) < 0.005);
      const status = seen ? "cleared_unmatched" : c.due > to ? "not_due" : "past_due";
      cheques.open.push({ ...base, status, clearedDate: seen ? seen.d : null, daysAfterDue: c.due ? daysBetween(c.due, to) : null });
    }
  }
  const chequesCleared = cheques.cleared.filter((x) => x.clearedDate && x.clearedDate >= from && x.clearedDate <= to).sort((a, b) => (a.clearedDate < b.clearedDate ? -1 : a.clearedDate > b.clearedDate ? 1 : 0));

  // Section 2 = open book lines that are not (live) cheque lines. A cheque entry that is cancelled stays here with its
  // reversal, so the two cancel out in the total.
  const bookOpen = bookOpenRows
    .filter((r) => !chequeLineIds.has(r.line_id))
    .map((r) => ({
      lineId: r.line_id, year: r.fiscal_year, transId: r.trans_id, date: r.d, reference: r.reference, type: r.trans_type, description: r.description || r.details,
      counterAccount: r.counter_account, counterName: r.counter_name, amount: round2(r.signed_amount), ageDays: daysBetween(r.d, to), batch: r.batch_no,
      posted: num(r.status) === 1, chequeId: r.cheque_id || null, ...(isEmployeesCard(r.counter_account) ? { counterEmployee: true } : {}),
    }));
  const bankOpen = bankOpenRows.map((r) => ({
    bankLineId: r.bank_line_id, year: r.fiscal_year, date: r.d, reference: r.reference, details: r.details, amount: round2(r.signed_amount), ageDays: daysBetween(r.d, to),
  }));
  // the beneficiary of every cheque line, from Hashavshevet, the Priority file or the cheque archive in Drive (payee / payeeSource:
  // cheques, journal, priority, image = read from the scanned cheque, image_guess, missing) + imageId / image = the scanned cheque
  const payeeStats = await addChequePayees(bankOpen, { company: company.companyId, bankAccounts: [accountKey] });
  // the beneficiary of every transfer line, from the bank's transaction status file (bank_events; payeeSource events, + event:
  // the payee's bank account, who gave the order and when); Hashavshevet's bank lines carry no name for a transfer
  const fileAccounts = fileAccountsOf({ financeCode: company.code });
  const eventStats = await addTransferEvents(bankOpen, { accounts: fileAccounts, date: (r) => r.date, amount: (r) => (r.amount < 0 ? -r.amount : null) });
  // the lines still without a name — money that came IN above all — get the other side from the bank file uploaded in the
  // admin (bank_transactions: "המבצע: <name>" = from, "לטובת: <name>" = to; payeeSource bank_file, payeeRole from | to)
  const fileNameStats = await addBankFileNames(bankOpen, { accounts: fileAccounts, date: (r) => r.date, reference: (r) => r.reference, amount: (r) => r.amount });
  // the card (כרטסת) to book every line on (bankLineAccounts.js: counterAccount / counterName / counterSource / counterBasis;
  // counterEmployee = the one employees card, shown in blue): the books, an account with the payee's name, the employees
  // (Priority's employees supplier, the admin's employee tables), past journal entries with that name, a person's name
  // with no card = probably an employee (to check), the bank text's past matches
  const accountStats = await addBankLineAccounts(bankOpen, { companyId: company.companyId, code: company.code, bankAccounts: [accountKey] });

  const bookFutureMatched = futureMatchedRows.map((r) => ({
    lineId: r.line_id, year: r.fiscal_year, transId: r.trans_id, date: r.d, reference: r.reference, type: r.trans_type, description: r.description || r.details,
    counterAccount: r.counter_account, counterName: r.counter_name, amount: round2(r.signed_amount), ageDays: daysBetween(r.d, to), batch: r.batch_no,
    posted: num(r.status) === 1, chequeId: r.cheque_id || null, ...(isEmployeesCard(r.counter_account) ? { counterEmployee: true } : {}),
  }));
  // a book line paid by transfer (no cheque, money out) gets the matching order too — the books carry no instrument
  // word for a transfer; the event (same amount, given up to 4 days before the value date) says it was one
  const bookEventStats = await addTransferEvents(bookOpen, { accounts: fileAccounts, date: (r) => r.date, amount: (r) => (r.amount < 0 && !r.chequeId ? -r.amount : null), name: (r) => r.counterName, transfer: () => true });
  for (const r of bookOpen) if (r.event) { r.payeeSource = r.payeeSource || "events"; r.kind = "transfer"; }
  const older = (rows) => rows.filter((x) => x.date < from);
  // Section 3ג (owner 2026-11-18): the cheques past their date by more than STALE_DAYS and not cleared, out of 3ב. Each one
  // says whether the bank already shows it returned ("החזרת שיק" open line with the same number and amount → bounced) and the
  // action the bookkeeper will most likely take (bounced → "חזר מהבנק", else "בוטל"); the export (POST /export) writes the moves.
  const returnedByNo = new Map();
  for (const b of bankOpen) if (/החזרת שיק/.test(String(b.details || "")) && b.amount > 0) returnedByNo.set(`${b.reference}|${round2(b.amount)}`, b);
  const chequesStale = [];
  const chequesOpen = [];
  for (const x of cheques.open) {
    if (x.status === "past_due" && Number(x.daysAfterDue) > STALE_DAYS) {
      const ret = returnedByNo.get(`${x.chequeNo}|${round2(Math.abs(x.amount))}`) || null;
      chequesStale.push({ ...x, bounced: ret ? { date: ret.date, bankLineId: ret.bankLineId } : null, suggestedAction: ret ? ACTIONS.bounced : ACTIONS.cancel });
    } else chequesOpen.push(x);
  }
  const pastDue = chequesOpen.filter((x) => x.status === "past_due");
  const notDue = chequesOpen.filter((x) => x.status === "not_due");
  const clearedUnmatched = chequesOpen.filter((x) => x.status === "cleared_unmatched");
  const bankBalance = lastLine ? round2(lastLine.running_balance) : 0;
  const bookBalance = round2(book?.s);
  const summary = {
    bankBalance, bankBalanceDate: day(lastLine?.line_date), bankLinesSum: round2(bankSum?.s), bankLinesCount: num(bankSum?.n),
    bookBalance, bookLinesCount: num(book?.n), unpostedCount: num(book?.unposted),
    bankOpen: {
      count: bankOpen.length, total: sum(bankOpen, (x) => x.amount), beforeCount: older(bankOpen).length, beforeTotal: sum(older(bankOpen), (x) => x.amount),
      cheques: {
        count: payeeStats.lines, found: payeeStats.found, missing: payeeStats.missing, missingTotal: sum(bankOpen.filter((x) => x.payeeSource === "missing"), (x) => x.amount),
        priority: payeeStats.priority || 0, priorityTotal: sum(bankOpen.filter((x) => x.payeeSource === "priority"), (x) => x.amount),
        image: payeeStats.image || 0, imageTotal: sum(bankOpen.filter((x) => x.payeeSource === "image"), (x) => x.amount),
        imageGuess: payeeStats.imageGuess || 0, imageGuessTotal: sum(bankOpen.filter((x) => x.payeeSource === "image_guess"), (x) => x.amount),
        withImage: payeeStats.withImage || 0, missingWithImage: bankOpen.filter((x) => x.payeeSource === "missing" && x.imageId).length,
      },
      // the cards (כרטסת) of section 1: found of rows, and by source (books, name, employee, history, employeeGuess, text)
      accounts: { ...accountStats, missingTotal: sum(bankOpen.filter((x) => !x.counterAccount), (x) => x.amount), employeeTotal: sum(bankOpen.filter((x) => x.counterEmployee), (x) => x.amount) },
    },
    bookOpen: { count: bookOpen.length, total: sum(bookOpen, (x) => x.amount), beforeCount: older(bookOpen).length, beforeTotal: sum(older(bookOpen), (x) => x.amount) },
    chequesOpen: {
      count: chequesOpen.length, total: sum(chequesOpen, (x) => x.amount),
      pastDueCount: pastDue.length, pastDueTotal: sum(pastDue, (x) => x.amount),
      notDueCount: notDue.length, notDueTotal: sum(notDue, (x) => x.amount),
      clearedUnmatchedCount: clearedUnmatched.length, clearedUnmatchedTotal: sum(clearedUnmatched, (x) => x.amount),
    },
    bookFutureMatched: { count: bookFutureMatched.length, total: sum(bookFutureMatched, (x) => x.amount) },
    // 3ג: not cleared more than STALE_DAYS after the cheque's date — part of the tie-out like 3ב (the books still carry them)
    chequesStale: {
      count: chequesStale.length, total: sum(chequesStale, (x) => x.amount), staleDays: STALE_DAYS,
      bounced: chequesStale.filter((x) => x.bounced).length, bouncedTotal: sum(chequesStale.filter((x) => x.bounced), (x) => x.amount),
      employees: chequesStale.filter((x) => x.counterEmployee).length,
      buckets: { "61-120": chequesStale.filter((x) => x.daysAfterDue <= 120).length, "121-240": chequesStale.filter((x) => x.daysAfterDue > 120 && x.daysAfterDue <= 240).length, "241+": chequesStale.filter((x) => x.daysAfterDue > 240).length },
    },
    chequesCleared: { count: chequesCleared.length, total: sum(chequesCleared, (x) => x.amount), groupOnly: chequesCleared.filter((x) => x.status === "cleared_group").length },
    cancelledCheques: cancelledCount, reversedCheques: reversedCount,
  };
  summary.expectedBookBalance = round2(bankBalance - summary.bankOpen.total + summary.bookOpen.total + summary.chequesOpen.total + summary.chequesStale.total - summary.bookFutureMatched.total);
  summary.unexplained = round2(bookBalance - summary.expectedBookBalance);

  const notes = [];
  if (Math.abs(summary.unexplained) > 0.005)
    notes.push(`נשאר הפרש לא מוסבר של ${summary.unexplained.toLocaleString("he-IL", { minimumFractionDigits: 2 })} ₪: התאמות שבהן סכום צד הבנק שונה מסכום צד הספרים.`);
  if (Math.abs(summary.bankLinesSum - bankBalance) > 0.005)
    notes.push(`סכום כל תנועות הבנק (${summary.bankLinesSum.toLocaleString("he-IL", { minimumFractionDigits: 2 })}) שונה מהיתרה לפי דף הבנק (${bankBalance.toLocaleString("he-IL", { minimumFractionDigits: 2 })}). היתרה בדוח היא היתרה הרצה של חשבשבת אחרי התנועה האחרונה עד ${fmtDate(to)}.`);
  if (summary.unpostedCount) notes.push(`${summary.unpostedCount} תנועות ספרים עד התאריך עדיין לא נקלטו (מנה פתוחה); הן נכללות ביתרת הספרים ומסומנות "לא נקלט".`);
  if (bookFutureMatched.length)
    notes.push(`${bookFutureMatched.length} תנועות ספרים בתאריך מאוחר מ-${fmtDate(to)} כבר הותאמו לתנועות בנק עד תאריך זה (למשל צ'ק שנרשם בתאריך ערך מאוחר); הן מוצגות בסוף סעיף 2 ומנוכות בסיכום.`);
  if (payeeStats.priority)
    notes.push(`${payeeStats.priority} צ'קים שנפרעו בבנק אינם בחשבשבת אך נמצאו בקובץ הצ'קים של פריוריטי (ההיסטוריה שלפני חשבשבת); שם המוטב מוצג עם הסימון "פריוריטי" בסעיף 1 – גם אותם יש לרשום בחשבשבת.`);
  if (payeeStats.image)
    notes.push(`${payeeStats.image} צ'קים שנפרעו בבנק אינם בחשבשבת ולא בפריוריטי, ושם המוטב נקרא מתמונת הצ'ק הסרוק בארכיון הצ'קים בדרייב; הם מסומנים "(מהצ'ק)" בסעיף 1 – גם אותם יש לרשום בחשבשבת.`);
  if (payeeStats.imageGuess)
    notes.push(`${payeeStats.imageGuess} צ'קים קיבלו שם לא ודאי מתמונת הצ'ק (מסומנים "? (מהצ'ק, לא ודאי)"); יש לאשר את השם מול התמונה.`);
  if (payeeStats.missing)
    notes.push(`${payeeStats.missing} צ'קים שנפרעו בבנק לא נמצאו בחשבשבת (לא במודול הצ'קים ולא בפקודת יומן עם מספר הצ'ק); הם מסומנים "${payeeText({ payeeSource: "missing" })}" בסעיף 1 – אלה הצ'קים שיש לרשום${summary.bankOpen.cheques.missingWithImage ? ` (ל-${summary.bankOpen.cheques.missingWithImage} מהם יש תמונה סרוקה – 📷)` : ""}.`);
  if (payeeStats.withImage) notes.push(`ל-${payeeStats.withImage} צ'קים בסעיף 1 יש תמונה סרוקה בארכיון הצ'קים בדרייב – הסימן 📷 ליד שם המוטב פותח אותה.`);
  if (payeeStats.error) notes.push(`שמות המוטבים של הצ'קים לא נשלפו הפעם (${payeeStats.error}).`);
  if (payeeStats.archiveError) notes.push(`ארכיון הצ'קים בדרייב לא נקרא הפעם (${payeeStats.archiveError}); השמות מתמונות הצ'קים והקישורים לתמונות חסרים.`);
  if (eventStats.found || bookEventStats.found)
    notes.push(`${eventStats.found + bookEventStats.found} העברות זוהו בקובץ סטטוס העסקאות של הבנק (שם המוטב, חשבון היעד, מי הזרים ומתי): ${eventStats.found} בסעיף 1 ו-${bookEventStats.found} בסעיף 2${eventStats.ambiguous + bookEventStats.ambiguous ? `; ${eventStats.ambiguous + bookEventStats.ambiguous} לא זוהו בוודאות (כמה הוראות באותו סכום ובאותם ימים)` : ""}.`);
  if (eventStats.error) notes.push(`קובץ סטטוס העסקאות של הבנק לא נקרא הפעם (${eventStats.error}).`);
  if (fileNameStats.found)
    notes.push(`${fileNameStats.found} תנועות בסעיף 1 קיבלו שם מקובץ הבנק שהועלה באדמין${fileNameStats.from ? ` – ${fileNameStats.from} מהן כספים שנכנסו לחשבון ("מאת: …" = מי שהעביר אלינו)` : ""}.`);
  if (fileNameStats.error) notes.push(`קובץ הבנק שהועלה באדמין לא נקרא הפעם (${fileNameStats.error}).`);
  if (accountStats.rows) {
    const a = accountStats;
    const parts = [
      a.books ? `${a.books} מהספרים` : "", a.name ? `${a.name} לפי שם זהה לשם הכרטסת` : "",
      a.employee ? `${a.employee} עובדים (כרטיס העובדים${a.employeesAccount ? ` ${a.employeesAccount}` : ""} – לפי רשימת העובדים באדמין או ספק העובדים בפריוריטי)` : "",
      a.history ? `${a.history} לפי פקודות יומן קודמות על אותו שם` : "",
      a.employeeGuess ? `${a.employeeGuess} כנראה עובדים (שם של אדם פרטי ללא כרטסת ספק – לבדיקה, מסומנים בכחול עם סימן שאלה)` : "",
      a.text ? `${a.text} לפי התאמות קודמות של אותו טקסט בנק` : "",
    ].filter(Boolean);
    notes.push(`כרטסת: ל-${a.found} מתוך ${a.rows} תנועות בסעיף 1 הוצעה כרטסת לרישום (עמודת "כרטסת"${parts.length ? `: ${parts.join("; ")}` : ""}). ${a.missing ? `${a.missing} תנועות נשארו ללא כרטסת.` : "לכל התנועות יש כרטסת."} כרטיס העובדים מסומן בכחול בכל הסעיפים; כרטסת שאינה מהספרים היא הצעה – מעבר עם העכבר מראה על מה היא מבוססת.`);
  }
  if (accountStats.error) notes.push(`הכרטסות של תנועות הבנק לא נשלפו הפעם (${accountStats.error}).`);
  if (accountStats.adminError) notes.push(`רשימת העובדים באדמין לא נקראה הפעם (${accountStats.adminError}); זיהוי העובדים נעשה לפי פריוריטי ופקודות היומן בלבד.`);
  if (cancelledCount) notes.push(`${cancelledCount} צ'קים מבוטלים (יש להם רישום הפוך) אינם מופיעים בסעיף 3.`);
  if (reversedCount) notes.push(`${reversedCount} צ'קים בוטלו בפקודת יומן (תנועת ביטול שיובאה לחשבשבת, לא במודול הצ'קים) ואינם מופיעים בסעיף 3; כדי שייעלמו גם מרשימת הצ'קים של חשבשבת יש לבטלם במודול הצ'קים.`);
  if (chequesStale.length)
    notes.push(`סעיף 3ג: ${chequesStale.length} צ'קים שמועדם עבר לפני יותר מ-${STALE_DAYS} יום ולא נפרעו, סכום ${summary.chequesStale.total.toLocaleString("he-IL", { minimumFractionDigits: 2 })} ₪${summary.chequesStale.bounced ? ` (${summary.chequesStale.bounced} מהם חזרו מהבנק – שורת "החזרת שיק" בסעיף 1)` : ""}. בוחרים שורות בכפתור "בחירה", קובעים פעולה (בוטל / חזר מהבנק) ומייצאים קובץ ייבוא לחשבשבת.`);
  if (summary.chequesCleared.groupOnly) notes.push(`${summary.chequesCleared.groupOnly} צ'קים הותאמו בחשבשבת בתוך קבוצת התאמה גדולה ולא נמצאה שורת בנק עם אותו מספר צ'ק ואותו סכום; מוצג תאריך ההתאמה או שורת הבנק היחידה בקבוצה.`);
  if (clearedUnmatched.length) notes.push(`${clearedUnmatched.length} צ'קים כבר נפרעו בבנק (לפי מספר הצ'ק והסכום) אבל עדיין לא הותאמו בחשבשבת; הם נספרים כצ'קים פתוחים עד להתאמה.`);
  if (chqStart?.d && bank.from && day(chqStart.d) > bank.from)
    notes.push(`מודול הצ'קים בחשבשבת מתחיל ב-${fmtDate(day(chqStart.d))} (דף הבנק מתחיל ב-${fmtDate(bank.from)}); צ'קים מלפני כן מופיעים בסעיפים 1 ו-2 כתנועות רגילות.`);
  notes.push(`"פתוח" הוא לפי ההתאמות שנעשו בחשבשבת עד ${fmtDate(to)} (התאמות מאוחרות יותר לא נספרות). הנתונים טרם נבדקו על ידי רואה החשבון.`);

  // every row gets its kind (cheque / transfer / card / …) and the filters of the query are applied (the summary stays
  // for the whole account; `filtered` tells how many rows of each section were kept out of how many)
  return applyFilter({
    company: { code: company.code, name: company.name }, account: { key: accountKey, name: bank.name }, from, to,
    dataUpTo: bank.dataUpTo, lastSync: sync?.t ? String(sync.t).slice(0, 19) : null, generatedAt: new Date().toISOString().slice(0, 19).replace("T", " "),
    employees: employees ? { account: employees.account, name: accountNames.get(employees.account)?.name || null } : null,
    summary, notes, bankOpen, bookOpen, bookFutureMatched, chequesCleared, chequesOpen, chequesStale,
  }, filter);
}

/** The kinds and the parties (suppliers / payees / counter accounts) of the whole report, for the pickers of the pages. */
export async function bankReconFacets(query = {}) {
  const r = await buildBankReconReport({ company: query.company, account: query.account, from: query.from, to: query.to, facets: 1 });
  return { company: r.company, account: r.account, from: r.from, to: r.to, dataUpTo: r.dataUpTo, kinds: r.facets.kinds, parties: r.facets.parties || [] };
}

// ── Excel ────────────────────────────────────────────────────────────────

const MONEY_FMT = '#,##0.00;[Red]-#,##0.00';

const PAYEE_SOURCE_LABEL = { cheques: "מודול צ'קים", journal: "פקודת יומן", priority: "פריוריטי", image: "תמונת הצ'ק", image_guess: "תמונת הצ'ק – לא ודאי", missing: "חסר", events: "סטטוס עסקאות", bank_file: "קובץ הבנק" };

function sheet(wb, title, columns, rows, totalLabel, total) {
  const ws = wb.addWorksheet(title.slice(0, 31), { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width || 14, style: c.money ? { numFmt: MONEY_FMT } : c.date ? { numFmt: "dd/mm/yyyy" } : {} }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF1F5" } };
  for (const r of rows) {
    const out = {};
    for (const c of columns) {
      let v = c.get ? c.get(r) : r[c.key];
      if (c.date && v) v = new Date(`${String(v).slice(0, 10)}T00:00:00Z`);
      if (c.link && v) v = { text: c.link, hyperlink: String(v) };
      out[c.key] = v ?? null;
    }
    const row = ws.addRow(out);
    for (const c of columns) {
      if (c.link && out[c.key]) row.getCell(c.key).font = { color: { argb: "FF1155CC" }, underline: true };
      const fill = c.fill ? c.fill(r) : null; // e.g. the employees card in blue
      if (fill) row.getCell(c.key).fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    }
  }
  if (totalLabel) {
    const row = ws.addRow({ [columns[0].key]: `${totalLabel} (${rows.length})`, [columns.find((c) => c.money)?.key]: total });
    row.font = { bold: true };
  }
  return ws;
}

export async function renderBankReconXlsx(r) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Allegro admin";
  const s = r.summary;
  const ws = wb.addWorksheet("סיכום", { views: [{ rightToLeft: true }] });
  ws.columns = [{ header: "דוח התאמת בנק מפורט", key: "a", width: 58 }, { header: "", key: "b", width: 20, style: { numFmt: MONEY_FMT } }];
  ws.getRow(1).font = { bold: true, size: 14 };
  const add = (a, b, bold = false) => { const row = ws.addRow({ a, b }); if (bold) row.font = { bold: true }; return row; };
  add("חברה", `${r.company.name || r.company.code}`);
  add("חשבון בנק", `${r.account.name} (${r.account.key})`);
  add("תקופה", `${fmtDate(r.from)} – ${fmtDate(r.to)}`);
  add("נתונים עד", fmtDate(r.dataUpTo));
  add("הופק", r.generatedAt);
  if (r.filter?.active) {
    add(`סינון: ${r.filter.label}`, null, true);
    add("הסיכום שלמטה הוא לכל החשבון; הגיליונות של הסעיפים מכילים רק את השורות שעברו את הסינון.", null);
    for (const [key, name] of [["bankOpen", "סעיף 1"], ["bookOpen", "סעיף 2"], ["bookFutureMatched", "סעיף 2ב"], ["chequesCleared", "סעיף 3א"], ["chequesOpen", "סעיף 3ב"]]) {
      const x = r.filtered?.sections?.[key];
      if (x) add(`   ${name}: ${x.omitted ? "לא נכלל" : `${x.count} מתוך ${x.of} שורות`}`, x.omitted ? null : x.total);
    }
  }
  add("", null);
  add("יתרה בבנק לפי דף הבנק", s.bankBalance, true);
  add(`פחות: תנועות בנק ללא התאמה בספרים (סעיף 1) – ${s.bankOpen.count} תנועות`, -s.bankOpen.total);
  add(`ועוד: תנועות ספרים ללא התאמה בבנק (סעיף 2) – ${s.bookOpen.count} תנועות`, s.bookOpen.total);
  add(`ועוד: צ'קים שהונפקו וטרם נפרעו (סעיף 3ב) – ${s.chequesOpen.count} צ'קים`, s.chequesOpen.total);
  if (s.chequesStale) add(`ועוד: צ'קים שלא נפרעו מעל ${s.chequesStale.staleDays} יום (סעיף 3ג) – ${s.chequesStale.count} צ'קים${s.chequesStale.bounced ? `, ${s.chequesStale.bounced} חזרו מהבנק` : ""}`, s.chequesStale.total);
  add(`   מתוכם – מועד הפירעון עבר (${s.chequesOpen.pastDueCount})`, s.chequesOpen.pastDueTotal);
  add(`   מתוכם – טרם הגיע מועד הפירעון (${s.chequesOpen.notDueCount})`, s.chequesOpen.notDueTotal);
  if (s.chequesOpen.clearedUnmatchedCount) add(`   מתוכם – נפרעו בבנק אך טרם הותאמו (${s.chequesOpen.clearedUnmatchedCount})`, s.chequesOpen.clearedUnmatchedTotal);
  if (s.bookFutureMatched.count) add(`פחות: תנועות ספרים בתאריך מאוחר שכבר הותאמו לבנק – ${s.bookFutureMatched.count} תנועות`, -s.bookFutureMatched.total);
  add("= יתרה צפויה בספרים", s.expectedBookBalance, true);
  add("יתרה בספרים בפועל", s.bookBalance, true);
  add("הפרש לא מוסבר", s.unexplained, true);
  add("", null);
  add(`צ'קים שנפרעו בתקופה (סעיף 3א) – ${s.chequesCleared.count}`, s.chequesCleared.total);
  add("סכום כל תנועות הבנק עד התאריך", s.bankLinesSum);
  if (r.noise?.count) add(`רעשים (רישום וביטולו, סעיפים 1 ו-2): ${r.noise.count} שורות — מסומנות בעמודה "רעש / לטיפול"; בלי רעשים: noise=hide`, r.noise.total);
  if (r.todo?.count) add(`לטיפול: ${r.todo.count} צ'קים שמועדם עבר לפני יותר מ-${r.todo.staleDays} יום ולא נפרעו (סעיף 3ב) – לבטל בספרים או לברר`, r.todo.total);
  if (r.older?.count) add(`תנועות מלפני ${fmtDate(r.from)} שעדיין פתוחות: ${r.older.count} שורות — מסומנות בעמודה "לפני התקופה"; רק התקופה: older=hide`, r.older.total);
  add("", null);
  add("הערות", null, true);
  for (const n of r.notes) add(n, null);
  add("", null);
  add("סימנים: כניסה לבנק = פלוס, יציאה מהבנק = מינוס, בשני הצדדים.", null);

  // with a filter the sheets hold the kept rows and the total row is theirs (the summary sheet shows "N מתוך M")
  const tot = (key) => (r.filtered?.sections?.[key] ? r.filtered.sections[key].total : s[key].total);
  const kindCol = { header: "סוג", key: "kind", width: 14, get: (x) => KIND_LABEL[x.kind] || x.kind || null };
  const noiseCol = { header: "רעש / לטיפול", key: "noise", width: 40, get: (x) => (x.noise ? `רעש: ${NOISE_LABEL[x.noise.rule] || x.noise.rule}` : x.todo ? `לטיפול: ${TODO_LABEL[x.todo.rule] || x.todo.rule}` : null) };
  const olderCol = { header: "לפני התקופה", key: "older", width: 12, get: (x) => (x.older ? "כן" : null) }; // dated before `from`, still open (older=hide leaves them out)
  // the card (כרטסת) columns: the key, its name, why — the employees card in blue, a guess in a lighter blue
  const EMP_FILL = "FFD6E9FF", GUESS_FILL = "FFEAF3FF";
  const cardFill = (x) => (x.counterEmployee ? (x.counterSource === "employee_guess" ? GUESS_FILL : EMP_FILL) : null);
  const cardCols = (withSource) => [
    { header: "כרטסת", key: "counterAccount", width: 10, fill: cardFill },
    { header: "שם הכרטסת", key: "counterName", width: 24, fill: cardFill },
    ...(withSource ? [{ header: "מקור הכרטסת", key: "counterSource", width: 44, get: (x) => (x.counterSource ? `${ACCOUNT_SOURCE_LABEL[x.counterSource] || x.counterSource}${x.counterBasis ? ` – ${x.counterBasis}` : ""}` : null) }] : []),
  ];
  sheet(wb, "1 בנק ללא ספרים", [
    { header: "תאריך", key: "date", date: true, width: 12 }, { header: "אסמכתא", key: "reference", width: 14 }, { header: "פרטים", key: "details", width: 28 }, kindCol,
    { header: "מוטב", key: "payee", width: 30, get: (x) => payeeText(x) || null }, { header: "מקור השם", key: "payeeSource", width: 12, get: (x) => PAYEE_SOURCE_LABEL[x.payeeSource] || null },
    ...cardCols(true),
    { header: "סכום", key: "amount", money: true, width: 16 }, { header: "ימים", key: "ageDays", width: 8 }, { header: "שנה", key: "year", width: 8 },
    { header: "מזהה שורה", key: "bankLineId", width: 10 }, { header: "תמונת הצ'ק", key: "image", width: 14, link: "פתח תמונה", get: (x) => x.image || null },
  olderCol, noiseCol], r.bankOpen, 'סה"כ', tot("bankOpen"));
  sheet(wb, "2 ספרים ללא בנק", [
    { header: "תאריך", key: "date", date: true, width: 12 }, { header: "אסמכתא", key: "reference", width: 14 }, kindCol,
    { header: "פרטים", key: "description", width: 30 }, { header: "חשבון נגדי", key: "counterAccount", width: 12, fill: cardFill }, { header: "שם חשבון נגדי", key: "counterName", width: 26, fill: cardFill },
    { header: "סכום", key: "amount", money: true, width: 16 }, { header: "ימים", key: "ageDays", width: 8 }, { header: "מנה", key: "batch", width: 8 },
    { header: "נקלט", key: "posted", width: 8, get: (x) => (x.posted ? "כן" : "לא") }, { header: "מס' תנועה", key: "transId", width: 10 },
  olderCol, noiseCol], r.bookOpen, 'סה"כ', tot("bookOpen"));
  if (r.bookFutureMatched.length)
    sheet(wb, "2ב ספרים בתאריך מאוחר", [
      { header: "תאריך", key: "date", date: true, width: 12 }, { header: "אסמכתא", key: "reference", width: 14 }, kindCol,
      { header: "פרטים", key: "description", width: 30 }, { header: "חשבון נגדי", key: "counterAccount", width: 12 }, { header: "שם חשבון נגדי", key: "counterName", width: 26 },
      { header: "סכום", key: "amount", money: true, width: 16 }, { header: "מנה", key: "batch", width: 8 }, { header: "מס' תנועה", key: "transId", width: 10 },
    ], r.bookFutureMatched, 'סה"כ', tot("bookFutureMatched"));
  sheet(wb, "3א צ'קים שנפרעו", [
    { header: "מס' צ'ק", key: "chequeNo", width: 10 }, { header: "מוטב", key: "payee", width: 28 }, ...cardCols(false), { header: "תאריך רישום", key: "issueDate", date: true, width: 12 },
    { header: "תאריך הצ'ק", key: "dueDate", date: true, width: 12 }, { header: "סכום הצ'ק", key: "amount", money: true, width: 16 },
    { header: "נפרע בבנק", key: "clearedDate", date: true, width: 12 }, { header: "סכום בבנק", key: "bankAmount", money: true, width: 16 },
    { header: "אסמכתא בבנק", key: "bankReference", width: 12 }, { header: "ימים מתאריך הצ'ק", key: "daysAfterDue", width: 10 },
    { header: "סטטוס", key: "status", width: 30, get: (x) => CHEQUE_STATUS_LABEL[x.status] || x.status },
  ], r.chequesCleared, 'סה"כ', tot("chequesCleared"));
  sheet(wb, "3ב צ'קים פתוחים", [
    { header: "מס' צ'ק", key: "chequeNo", width: 10 }, { header: "מוטב", key: "payee", width: 28 }, ...cardCols(false), { header: "תאריך רישום", key: "issueDate", date: true, width: 12 },
    { header: "תאריך הצ'ק", key: "dueDate", date: true, width: 12 }, { header: "סכום", key: "amount", money: true, width: 16 },
    { header: "ימים מתאריך הצ'ק", key: "daysAfterDue", width: 10, get: (x) => (x.daysAfterDue > 0 ? x.daysAfterDue : null) },
    { header: "נמצא בבנק בתאריך", key: "clearedDate", date: true, width: 14 }, { header: "סטטוס", key: "status", width: 30, get: (x) => CHEQUE_STATUS_LABEL[x.status] || x.status },
  olderCol, noiseCol], r.chequesOpen, 'סה"כ', tot("chequesOpen"));
  if (r.chequesStale?.length || r.summary.chequesStale)
    sheet(wb, "3ג צ'קים ישנים", staleColumns(cardCols, olderCol), r.chequesStale || [], 'סה"כ', tot("chequesStale"));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const ACTION_HE = { cancel: "בוטל – לא הגיע למוטב", bounced: "חזר מהבנק", keep: "להשאיר" };
const staleColumns = (cardCols, olderCol) => [
  { header: "מס' צ'ק", key: "chequeNo", width: 10 }, { header: "מוטב", key: "payee", width: 28 }, ...cardCols(false), { header: "תאריך רישום", key: "issueDate", date: true, width: 12 },
  { header: "תאריך הצ'ק", key: "dueDate", date: true, width: 12 }, { header: "סכום", key: "amount", money: true, width: 16 },
  { header: "ימים מתאריך הצ'ק", key: "daysAfterDue", width: 10 }, { header: "חזר בבנק", key: "bounced", date: true, width: 12, get: (x) => x.bounced?.date || null },
  { header: "פעולה מוצעת", key: "suggestedAction", width: 20, get: (x) => ACTION_HE[x.suggestedAction] || null }, { header: "מס' תנועה", key: "transId", width: 10 },
  olderCol,
];

/**
 * The Excel of chosen rows of one section (the selection mode of the page): the section's own columns. `ids` = bankLineId /
 * lineId / chequeId of the rows to keep (strings or numbers); an empty list = the whole section.
 */
export async function renderSectionXlsx(r, section, ids = []) {
  const ID_OF = { bankOpen: (x) => x.bankLineId, bookOpen: (x) => x.lineId, bookFutureMatched: (x) => x.lineId, chequesCleared: (x) => x.chequeId, chequesOpen: (x) => x.chequeId, chequesStale: (x) => x.chequeId };
  if (!ID_OF[section]) throw badRequest(`unknown section ${section}`);
  const want = new Set((ids || []).map(String));
  const rows = (r[section] || []).filter((x) => !want.size || want.has(String(ID_OF[section](x))));
  const wb = new ExcelJS.Workbook();
  wb.creator = "Allegro admin";
  const cols = sectionColumns(section);
  sheet(wb, SECTION_SHEET[section], cols, rows, 'סה"כ', sum(rows, (x) => x.amount));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const SECTION_SHEET = { bankOpen: "1 בנק ללא ספרים", bookOpen: "2 ספרים ללא בנק", bookFutureMatched: "2ב ספרים בתאריך מאוחר", chequesCleared: "3א צ'קים שנפרעו", chequesOpen: "3ב צ'קים פתוחים", chequesStale: "3ג צ'קים ישנים" };
function sectionColumns(section) {
  const kindCol = { header: "סוג", key: "kind", width: 14, get: (x) => KIND_LABEL[x.kind] || x.kind || null };
  const noiseCol = { header: "רעש / לטיפול", key: "noise", width: 40, get: (x) => (x.noise ? `רעש: ${NOISE_LABEL[x.noise.rule] || x.noise.rule}` : x.todo ? `לטיפול: ${TODO_LABEL[x.todo.rule] || x.todo.rule}` : null) };
  const olderCol = { header: "לפני התקופה", key: "older", width: 12, get: (x) => (x.older ? "כן" : null) };
  const cardFill = (x) => (x.counterEmployee ? (x.counterSource === "employee_guess" ? "FFEAF3FF" : "FFD6E9FF") : null);
  const cardCols = (withSource) => [
    { header: "כרטסת", key: "counterAccount", width: 10, fill: cardFill }, { header: "שם הכרטסת", key: "counterName", width: 24, fill: cardFill },
    ...(withSource ? [{ header: "מקור הכרטסת", key: "counterSource", width: 44, get: (x) => (x.counterSource ? `${ACCOUNT_SOURCE_LABEL[x.counterSource] || x.counterSource}${x.counterBasis ? ` – ${x.counterBasis}` : ""}` : null) }] : []),
  ];
  const date = (header, key, width = 12) => ({ header, key, date: true, width });
  switch (section) {
    case "bankOpen": return [date("תאריך", "date"), { header: "אסמכתא", key: "reference", width: 14 }, { header: "פרטים", key: "details", width: 28 }, kindCol, { header: "מוטב", key: "payee", width: 30, get: (x) => payeeText(x) || null }, ...cardCols(true), { header: "סכום", key: "amount", money: true, width: 16 }, { header: "ימים", key: "ageDays", width: 8 }, { header: "מזהה שורה", key: "bankLineId", width: 10 }, olderCol, noiseCol];
    case "bookOpen":
    case "bookFutureMatched": return [date("תאריך", "date"), { header: "אסמכתא", key: "reference", width: 14 }, kindCol, { header: "פרטים", key: "description", width: 30 }, { header: "חשבון נגדי", key: "counterAccount", width: 12, fill: cardFill }, { header: "שם חשבון נגדי", key: "counterName", width: 26, fill: cardFill }, { header: "סכום", key: "amount", money: true, width: 16 }, { header: "מנה", key: "batch", width: 8 }, { header: "מס' תנועה", key: "transId", width: 10 }, olderCol, noiseCol];
    case "chequesCleared": return [{ header: "מס' צ'ק", key: "chequeNo", width: 10 }, { header: "מוטב", key: "payee", width: 28 }, ...cardCols(false), date("תאריך רישום", "issueDate"), date("תאריך הצ'ק", "dueDate"), { header: "סכום הצ'ק", key: "amount", money: true, width: 16 }, date("נפרע בבנק", "clearedDate"), { header: "סכום בבנק", key: "bankAmount", money: true, width: 16 }, { header: "אסמכתא בבנק", key: "bankReference", width: 12 }, { header: "סטטוס", key: "status", width: 30, get: (x) => CHEQUE_STATUS_LABEL[x.status] || x.status }];
    case "chequesOpen": return [{ header: "מס' צ'ק", key: "chequeNo", width: 10 }, { header: "מוטב", key: "payee", width: 28 }, ...cardCols(false), date("תאריך רישום", "issueDate"), date("תאריך הצ'ק", "dueDate"), { header: "סכום", key: "amount", money: true, width: 16 }, { header: "ימים מתאריך הצ'ק", key: "daysAfterDue", width: 10, get: (x) => (x.daysAfterDue > 0 ? x.daysAfterDue : null) }, date("נמצא בבנק בתאריך", "clearedDate", 14), { header: "סטטוס", key: "status", width: 30, get: (x) => CHEQUE_STATUS_LABEL[x.status] || x.status }, olderCol, noiseCol];
    case "chequesStale": return staleColumns(cardCols, olderCol);
    default: throw badRequest(`unknown section ${section}`);
  }
}

/**
 * The Hashavshevet import file of the chosen stale cheques (hashavshevetMoves.js): `actions` = { chequeId: { action, date } },
 * format "xlsx" (the Excel with the defined name) or "movein" (movein.dat, short method). The cheques must be in the report's
 * section 3ג (the ids are checked against it — nothing else can be reversed from here).
 * @returns {Promise<{ buffer: Buffer, fileName: string, contentType: string, moves: number, skipped: Array }>}
 */
export async function renderChequeReversals(query, { ids = [], actions = {}, format = "xlsx", date = null } = {}) {
  if (!["xlsx", "movein"].includes(format)) throw badRequest("format must be xlsx or movein");
  const report = await buildBankReconReport({ ...query, sections: undefined, kind: undefined, party: undefined, q: undefined, amount: undefined, noise: undefined, older: undefined });
  const stale = new Map((report.chequesStale || []).map((x) => [String(x.chequeId), x]));
  const chosen = [...new Set((ids || []).map(String))].filter((id) => stale.has(id));
  if (!chosen.length) throw badRequest("no cheques of section 3ג were chosen");
  const { company } = await resolveParams(query);
  const entries = await loadChequeEntries(company.companyId, chosen.map(Number));
  const todayIso = today();
  const acts = {};
  for (const id of chosen) {
    const a = actions?.[id] || {};
    const x = stale.get(id);
    const action = a.action || x.suggestedAction || ACTIONS.cancel;
    const d = isIsoDate(a.date) ? a.date : action === ACTIONS.bounced && x.bounced?.date ? x.bounced.date : isIsoDate(date) ? date : todayIso;
    acts[id] = { action, date: d };
  }
  const { moves, skipped } = reversalMoves([...entries.values()], acts, { today: todayIso });
  for (const id of chosen) if (!entries.has(Number(id))) skipped.push({ chequeId: Number(id), reason: "no journal entry found for this cheque" });
  if (!moves.length) throw badRequest(`nothing to export: ${skipped.map((s) => `${s.chequeId}: ${s.reason}`).join("; ")}`);
  const stem = `hashavshevet_cheque_reversals_${report.account.key}_${todayIso}`;
  if (format === "movein") return { buffer: movesMovein(moves), fileName: "movein.dat", contentType: "application/octet-stream", moves: moves.length, skipped };
  return { buffer: await movesWorkbook(moves, { company: report.company.name || report.company.code, account: report.account.key, today: todayIso }), fileName: `${stem}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", moves: moves.length, skipped };
}

// ── export of chosen rows ────────────────────────────────────────────────

/** The export request: a JSON body, or a form field `payload` holding the JSON (the page's hidden form). */
export function parseExportBody(req) {
  let body = req.body;
  if (body && typeof body.payload === "string") {
    try { body = JSON.parse(body.payload); } catch { throw badRequest("payload is not valid JSON"); }
  }
  if (!body || typeof body !== "object") throw badRequest("a JSON body is required");
  return body;
}

/**
 * { company, account, from, to, kind: "rows" | "hashavshevet", section, ids, format, actions, date } →
 * { buffer, fileName, contentType[, skipped] }. "rows" = the chosen rows of `section` with that section's Excel columns;
 * "hashavshevet" = the reversal moves of the chosen 3ג cheques (xlsx or movein).
 */
export async function bankReconExport(body) {
  const kind = String(body.kind || "rows");
  const query = { company: body.company, account: body.account, from: body.from, to: body.to };
  const ids = Array.isArray(body.ids) ? body.ids : [];
  if (kind === "hashavshevet") return renderChequeReversals(query, { ids, actions: body.actions || {}, format: body.format || "xlsx", date: body.date || null });
  if (kind !== "rows") throw badRequest("kind must be rows or hashavshevet");
  const section = String(body.section || "");
  const report = await buildBankReconReport(query);
  const buffer = await renderSectionXlsx(report, section, ids);
  return { buffer, fileName: `${fileStem(report)}_${section}${ids.length ? "_selected" : ""}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
}

// ── router ───────────────────────────────────────────────────────────────

const fileStem = (r) => `bank_recon_${r.account.key}_${r.from}_${r.to}`;

export function Router() {
  const router = express.Router();
  const fail = (res, err) => {
    const known = financeErrorResponse(err);
    if (known) return res.status(known.status).json(known.body);
    console.error("bank-recon:", err);
    return res.status(500).json({ error: { code: "internal", message: err.message } });
  };

  router.get("/accounts", async (req, res) => {
    try {
      const list = await listBankReportAccounts();
      const to = today();
      res.json({ companies: list, defaults: { from: `${to.slice(0, 4)}-01-01`, to } });
    } catch (err) { fail(res, err); }
  });

  router.get("/facets", async (req, res) => {
    try { res.json(await bankReconFacets(req.query)); } catch (err) { fail(res, err); }
  });

  // the scanned cheque of a section-1 line (📷): the Drive file is read with the invoice agent's login and sent as the
  // picture, so the admin needs no Drive sharing; only ids that are in the archive's index are served
  router.get("/cheque-image/:id", async (req, res) => {
    try {
      const img = await readChequeImage(req.params.id);
      if (!img) return res.status(404).json({ error: { code: "not_found", message: "no such cheque image in the archive" } });
      res.setHeader("Content-Type", img.mimeType);
      res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(img.name)}`);
      res.setHeader("Cache-Control", "private, max-age=86400");
      return res.send(img.buffer);
    } catch (err) { fail(res, err); }
  });

  // the selection mode of the page (owner 2026-11-18): the chosen rows of a section as Excel, or — section 3ג — the Hashavshevet
  // import file of the cheques' reversals. The page posts a form with one field `payload` (JSON) to the relative "export", so
  // the same HTML works under /admin/bank-recon and under Joya's /api/joya/finance/bank-recon
  router.post("/export", async (req, res) => {
    try {
      const body = parseExportBody(req);
      const out = await bankReconExport(body);
      res.setHeader("Content-Type", out.contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(out.fileName)}"; filename*=UTF-8''${encodeURIComponent(out.fileName)}`);
      if (out.skipped?.length) res.setHeader("X-Skipped", encodeURIComponent(JSON.stringify(out.skipped)));
      return res.send(out.buffer);
    } catch (err) { fail(res, err); }
  });

  router.get("/report", async (req, res) => {
    try {
      const format = String(req.query.format || "json").toLowerCase();
      if (!["json", "html", "xlsx"].includes(format)) throw badRequest("format must be json, html or xlsx");
      const report = await buildBankReconReport(req.query);
      if (format === "json") return res.json(report);
      if (format === "html") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.send(renderBankReconHtml(report));
      }
      const buf = await renderBankReconXlsx(report);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${fileStem(report)}.xlsx"; filename*=UTF-8''${fileStem(report)}.xlsx`);
      return res.send(buf);
    } catch (err) { fail(res, err); }
  });
  return router;
}

export { SECTION_TITLES };
