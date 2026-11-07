// Detailed bank reconciliation report (דוח התאמת בנק מפורט) over allegro_finance (the Hashavshevet copy).
// Read only. Three sections for one bank account and a date range, as of the range's end date:
//   1. bank lines with no book match          (bank_lines open as of `to`)
//   2. book lines with no bank match, cheques excluded (journal lines on the bank account, no bank_matches row)
//   3. cheques: cleared in the period (paired to their bank line) and issued but not yet cleared
// Summary: bank balance − (1) + (2) + (3b) = expected book balance; the rest is "unexplained".
// Signs: money into the bank is plus on both sides (bank_lines.signed_amount; journal_lines.signed_amount is
// debit-plus, and a debit on the bank account is money in).
//
// Mounted by auth/roles/admin.js at /admin/bank-recon (admin role only):
//   GET /admin/bank-recon/accounts                      → companies and their bank accounts, default dates
//   GET /admin/bank-recon/report?company=&account=&from=&to=&format=json|html|xlsx
// HTML comes from shared/bankReconHtml.js (also used by the admin page); Excel from exceljs.

import express from "express";
import { createRequire } from "module";
import { financeSql } from "../sources/financePool.js";
import { ApiError, badRequest, isIsoDate } from "./localApi.js";
import { today, daysBetween, financeErrorResponse } from "./financeApi.js";
import { renderBankReconHtml, fmtDate, CHEQUE_STATUS_LABEL, SECTION_TITLES, payeeText } from "../../../shared/bankReconHtml.js";
import { addChequePayees } from "./chequePayees.js";

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
  return { company, bank, accountKey, from, to };
}

// ── the report ───────────────────────────────────────────────────────────

export async function buildBankReconReport(query = {}) {
  const { company, bank, accountKey, from, to } = await resolveParams(query);
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
    `SELECT c.cheque_id, c.reference AS cheque_no, c.payee_name, c.amount_to_pay, DATE_FORMAT(c.due_date, '%Y-%m-%d') AS due
       FROM cheques c WHERE c.company_id = :companyId AND c.bank_key = :acc AND c.deleted_at IS NULL ORDER BY c.due_date, c.cheque_id`,
    p,
  );
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

  const cheques = { cleared: [], open: [] };
  let cancelledCount = 0;
  const chequeLineIds = new Set();
  for (const c of chequeRows) {
    if (num(c.cancelled)) { cancelledCount++; continue; }
    if (c.line_id == null) continue;
    chequeLineIds.add(c.line_id);
    const amount = round2(c.signed_amount); // minus: money out
    const base = {
      chequeId: c.cheque_id, chequeNo: c.cheque_no, payee: c.payee_name, issueDate: c.issued, dueDate: c.due, amount,
      posted: num(c.status) === 1, lineId: c.line_id, transId: c.trans_id,
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
      posted: num(r.status) === 1, chequeId: r.cheque_id || null,
    }));
  const bankOpen = bankOpenRows.map((r) => ({
    bankLineId: r.bank_line_id, year: r.fiscal_year, date: r.d, reference: r.reference, details: r.details, amount: round2(r.signed_amount), ageDays: daysBetween(r.d, to),
  }));
  // the beneficiary of every cheque line, from Hashavshevet (payee / payeeSource: cheques, journal, missing)
  const payeeStats = await addChequePayees(bankOpen, { company: company.companyId, bankAccounts: [accountKey] });

  const bookFutureMatched = futureMatchedRows.map((r) => ({
    lineId: r.line_id, year: r.fiscal_year, transId: r.trans_id, date: r.d, reference: r.reference, type: r.trans_type, description: r.description || r.details,
    counterAccount: r.counter_account, counterName: r.counter_name, amount: round2(r.signed_amount), ageDays: daysBetween(r.d, to), batch: r.batch_no,
    posted: num(r.status) === 1, chequeId: r.cheque_id || null,
  }));
  const older = (rows) => rows.filter((x) => x.date < from);
  const chequesOpen = cheques.open;
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
      cheques: { count: payeeStats.lines, found: payeeStats.found, missing: payeeStats.missing, missingTotal: sum(bankOpen.filter((x) => x.payeeSource === "missing"), (x) => x.amount) },
    },
    bookOpen: { count: bookOpen.length, total: sum(bookOpen, (x) => x.amount), beforeCount: older(bookOpen).length, beforeTotal: sum(older(bookOpen), (x) => x.amount) },
    chequesOpen: {
      count: chequesOpen.length, total: sum(chequesOpen, (x) => x.amount),
      pastDueCount: pastDue.length, pastDueTotal: sum(pastDue, (x) => x.amount),
      notDueCount: notDue.length, notDueTotal: sum(notDue, (x) => x.amount),
      clearedUnmatchedCount: clearedUnmatched.length, clearedUnmatchedTotal: sum(clearedUnmatched, (x) => x.amount),
    },
    bookFutureMatched: { count: bookFutureMatched.length, total: sum(bookFutureMatched, (x) => x.amount) },
    chequesCleared: { count: chequesCleared.length, total: sum(chequesCleared, (x) => x.amount), groupOnly: chequesCleared.filter((x) => x.status === "cleared_group").length },
    cancelledCheques: cancelledCount,
  };
  summary.expectedBookBalance = round2(bankBalance - summary.bankOpen.total + summary.bookOpen.total + summary.chequesOpen.total - summary.bookFutureMatched.total);
  summary.unexplained = round2(bookBalance - summary.expectedBookBalance);

  const notes = [];
  if (Math.abs(summary.unexplained) > 0.005)
    notes.push(`נשאר הפרש לא מוסבר של ${summary.unexplained.toLocaleString("he-IL", { minimumFractionDigits: 2 })} ₪: התאמות שבהן סכום צד הבנק שונה מסכום צד הספרים.`);
  if (Math.abs(summary.bankLinesSum - bankBalance) > 0.005)
    notes.push(`סכום כל תנועות הבנק (${summary.bankLinesSum.toLocaleString("he-IL", { minimumFractionDigits: 2 })}) שונה מהיתרה לפי דף הבנק (${bankBalance.toLocaleString("he-IL", { minimumFractionDigits: 2 })}). היתרה בדוח היא היתרה הרצה של חשבשבת אחרי התנועה האחרונה עד ${fmtDate(to)}.`);
  if (summary.unpostedCount) notes.push(`${summary.unpostedCount} תנועות ספרים עד התאריך עדיין לא נקלטו (מנה פתוחה); הן נכללות ביתרת הספרים ומסומנות "לא נקלט".`);
  if (bookFutureMatched.length)
    notes.push(`${bookFutureMatched.length} תנועות ספרים בתאריך מאוחר מ-${fmtDate(to)} כבר הותאמו לתנועות בנק עד תאריך זה (למשל צ'ק שנרשם בתאריך ערך מאוחר); הן מוצגות בסוף סעיף 2 ומנוכות בסיכום.`);
  if (payeeStats.missing)
    notes.push(`${payeeStats.missing} צ'קים שנפרעו בבנק לא נמצאו בחשבשבת (לא במודול הצ'קים ולא בפקודת יומן עם מספר הצ'ק); הם מסומנים "${payeeText({ payeeSource: "missing" })}" בסעיף 1 – אלה הצ'קים שיש לרשום.`);
  if (payeeStats.error) notes.push(`שמות המוטבים של הצ'קים לא נשלפו הפעם (${payeeStats.error}).`);
  if (cancelledCount) notes.push(`${cancelledCount} צ'קים מבוטלים (יש להם רישום הפוך) אינם מופיעים בסעיף 3.`);
  if (summary.chequesCleared.groupOnly) notes.push(`${summary.chequesCleared.groupOnly} צ'קים הותאמו בחשבשבת בתוך קבוצת התאמה גדולה ולא נמצאה שורת בנק עם אותו מספר צ'ק ואותו סכום; מוצג תאריך ההתאמה או שורת הבנק היחידה בקבוצה.`);
  if (clearedUnmatched.length) notes.push(`${clearedUnmatched.length} צ'קים כבר נפרעו בבנק (לפי מספר הצ'ק והסכום) אבל עדיין לא הותאמו בחשבשבת; הם נספרים כצ'קים פתוחים עד להתאמה.`);
  if (chqStart?.d && bank.from && day(chqStart.d) > bank.from)
    notes.push(`מודול הצ'קים בחשבשבת מתחיל ב-${fmtDate(day(chqStart.d))} (דף הבנק מתחיל ב-${fmtDate(bank.from)}); צ'קים מלפני כן מופיעים בסעיפים 1 ו-2 כתנועות רגילות.`);
  notes.push(`"פתוח" הוא לפי ההתאמות שנעשו בחשבשבת עד ${fmtDate(to)} (התאמות מאוחרות יותר לא נספרות). הנתונים טרם נבדקו על ידי רואה החשבון.`);

  return {
    company: { code: company.code, name: company.name }, account: { key: accountKey, name: bank.name }, from, to,
    dataUpTo: bank.dataUpTo, lastSync: sync?.t ? String(sync.t).slice(0, 19) : null, generatedAt: new Date().toISOString().slice(0, 19).replace("T", " "),
    summary, notes, bankOpen, bookOpen, bookFutureMatched, chequesCleared, chequesOpen,
  };
}

// ── Excel ────────────────────────────────────────────────────────────────

const MONEY_FMT = '#,##0.00;[Red]-#,##0.00';

const PAYEE_SOURCE_LABEL = { cheques: "מודול צ'קים", journal: "פקודת יומן", missing: "חסר" };

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
      out[c.key] = v ?? null;
    }
    ws.addRow(out);
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
  add("", null);
  add("יתרה בבנק לפי דף הבנק", s.bankBalance, true);
  add(`פחות: תנועות בנק ללא התאמה בספרים (סעיף 1) – ${s.bankOpen.count} תנועות`, -s.bankOpen.total);
  add(`ועוד: תנועות ספרים ללא התאמה בבנק (סעיף 2) – ${s.bookOpen.count} תנועות`, s.bookOpen.total);
  add(`ועוד: צ'קים שהונפקו וטרם נפרעו (סעיף 3ב) – ${s.chequesOpen.count} צ'קים`, s.chequesOpen.total);
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
  add("", null);
  add("הערות", null, true);
  for (const n of r.notes) add(n, null);
  add("", null);
  add("סימנים: כניסה לבנק = פלוס, יציאה מהבנק = מינוס, בשני הצדדים.", null);

  sheet(wb, "1 בנק ללא ספרים", [
    { header: "תאריך", key: "date", date: true, width: 12 }, { header: "אסמכתא", key: "reference", width: 14 }, { header: "פרטים", key: "details", width: 28 },
    { header: "מוטב", key: "payee", width: 30, get: (x) => payeeText(x) || null }, { header: "מקור השם", key: "payeeSource", width: 12, get: (x) => PAYEE_SOURCE_LABEL[x.payeeSource] || null },
    { header: "סכום", key: "amount", money: true, width: 16 }, { header: "ימים", key: "ageDays", width: 8 }, { header: "שנה", key: "year", width: 8 },
    { header: "מזהה שורה", key: "bankLineId", width: 10 },
  ], r.bankOpen, 'סה"כ', s.bankOpen.total);
  sheet(wb, "2 ספרים ללא בנק", [
    { header: "תאריך", key: "date", date: true, width: 12 }, { header: "אסמכתא", key: "reference", width: 14 }, { header: "סוג", key: "type", width: 8 },
    { header: "פרטים", key: "description", width: 30 }, { header: "חשבון נגדי", key: "counterAccount", width: 12 }, { header: "שם חשבון נגדי", key: "counterName", width: 26 },
    { header: "סכום", key: "amount", money: true, width: 16 }, { header: "ימים", key: "ageDays", width: 8 }, { header: "מנה", key: "batch", width: 8 },
    { header: "נקלט", key: "posted", width: 8, get: (x) => (x.posted ? "כן" : "לא") }, { header: "מס' תנועה", key: "transId", width: 10 },
  ], r.bookOpen, 'סה"כ', s.bookOpen.total);
  if (r.bookFutureMatched.length)
    sheet(wb, "2ב ספרים בתאריך מאוחר", [
      { header: "תאריך", key: "date", date: true, width: 12 }, { header: "אסמכתא", key: "reference", width: 14 }, { header: "סוג", key: "type", width: 8 },
      { header: "פרטים", key: "description", width: 30 }, { header: "חשבון נגדי", key: "counterAccount", width: 12 }, { header: "שם חשבון נגדי", key: "counterName", width: 26 },
      { header: "סכום", key: "amount", money: true, width: 16 }, { header: "מנה", key: "batch", width: 8 }, { header: "מס' תנועה", key: "transId", width: 10 },
    ], r.bookFutureMatched, 'סה"כ', s.bookFutureMatched.total);
  sheet(wb, "3א צ'קים שנפרעו", [
    { header: "מס' צ'ק", key: "chequeNo", width: 10 }, { header: "מוטב", key: "payee", width: 28 }, { header: "תאריך רישום", key: "issueDate", date: true, width: 12 },
    { header: "תאריך הצ'ק", key: "dueDate", date: true, width: 12 }, { header: "סכום הצ'ק", key: "amount", money: true, width: 16 },
    { header: "נפרע בבנק", key: "clearedDate", date: true, width: 12 }, { header: "סכום בבנק", key: "bankAmount", money: true, width: 16 },
    { header: "אסמכתא בבנק", key: "bankReference", width: 12 }, { header: "ימים מתאריך הצ'ק", key: "daysAfterDue", width: 10 },
    { header: "סטטוס", key: "status", width: 30, get: (x) => CHEQUE_STATUS_LABEL[x.status] || x.status },
  ], r.chequesCleared, 'סה"כ', s.chequesCleared.total);
  sheet(wb, "3ב צ'קים פתוחים", [
    { header: "מס' צ'ק", key: "chequeNo", width: 10 }, { header: "מוטב", key: "payee", width: 28 }, { header: "תאריך רישום", key: "issueDate", date: true, width: 12 },
    { header: "תאריך הצ'ק", key: "dueDate", date: true, width: 12 }, { header: "סכום", key: "amount", money: true, width: 16 },
    { header: "ימים מתאריך הצ'ק", key: "daysAfterDue", width: 10, get: (x) => (x.daysAfterDue > 0 ? x.daysAfterDue : null) },
    { header: "נמצא בבנק בתאריך", key: "clearedDate", date: true, width: 14 }, { header: "סטטוס", key: "status", width: 30, get: (x) => CHEQUE_STATUS_LABEL[x.status] || x.status },
  ], r.chequesOpen, 'סה"כ', s.chequesOpen.total);
  return Buffer.from(await wb.xlsx.writeBuffer());
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
