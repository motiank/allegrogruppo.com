// Finance calculations for the AI: the Hashavshevet books (allegro_finance), read live from the Allegro admin's
// Finance API (../finance_api_readme.md) through source.finance — never stored here, never computed here: every
// number is the admin's. Per company (a finance company is linked to an Allegro company key by /finance/companies).
// Chain admin only (owner 2026-11-07, decision 1; see ai.js). Every answer carries the admin's data warnings: the
// books have real gaps (no 2026 salaries, no income after August 2026, a bank gap…), and the writer must show a
// `high` warning next to the number it affects.
import { finance, financeCompanies } from './source.js';
import { plannedByDay } from './payments.js';
import { compareStatements } from '../../../shared/statementCompare.js';

const SOURCE = 'the Hashavshevet books (allegro_finance), through the Allegro admin Finance API; posted entries only unless said otherwise; data as of the last nightly sync (dataUpTo)';
// a real calendar day (2026-02-30 and 2026-13-01 are refused)
const isDate = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
};
const DATE = { test: isDate };
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
// rows given to the model per list (the API has more; count / total say how many)
const LIMITS = { recon: 15, aging: 30, trialBalance: 120, ledger: 150, journal: 60, invoices: 100, cheques: 80, exceptions: 60, open: 60, suggestions: 30, changes: 60, allocation: 60, spending: 20 };

const bad = (m) => Object.assign(new Error(m), { code: 'BAD_REQUEST' });
const num = (v) => (v == null || v === '' ? null : Number(v));
const clamp = (v, d, max) => Math.min(Math.max(Number(v) || d, 1), max);
// A file answer (ai.js compute with a plan `file`: the rows go into a Google Sheet, owner 2026-11-09) takes every row the
// admin can give (its MAX_LIMIT), the chat only the first rows: p.export = true raises the cap of every list below.
export const EXPORT_MAX = 5000;
const limitOf = (p, d, max) => (p?.export ? EXPORT_MAX : clamp(p.limit, d, max));

/** The dated params of a report: from and to as YYYY-MM-DD (to defaults to today on the admin side). */
export function dates(p, { required = true } = {}) {
  const out = {};
  if (p.from != null && p.from !== '') {
    if (!DATE.test(String(p.from))) throw bad('from must be YYYY-MM-DD');
    out.from = String(p.from);
  } else if (required) throw bad('from must be YYYY-MM-DD');
  if (p.to != null && p.to !== '') {
    if (!DATE.test(String(p.to))) throw bad('to must be YYYY-MM-DD');
    out.to = String(p.to);
  }
  if (out.from && out.to && out.from > out.to) throw bad('from is after to');
  return out;
}
const asOf = (p) => {
  if (p.asOf == null || p.asOf === '') return {};
  if (!DATE.test(String(p.asOf))) throw bad('asOf must be YYYY-MM-DD');
  return { asOf: String(p.asOf) };
};
const oneOf = (p, k, allowed) => {
  if (p[k] == null || p[k] === '') return {};
  if (!allowed.includes(String(p[k]))) throw bad(`${k} must be one of ${allowed.join(', ')}`);
  return { [k]: String(p[k]) };
};
const flagOf = (p, k) => (p[k] === true || p[k] === 1 || p[k] === '1' || p[k] === 'true' ? { [k]: 1 } : {});
const textOf = (p, k) => (p[k] == null || String(p[k]).trim() === '' ? {} : { [k]: String(p[k]).trim() });
// locationIds (Allegro branch ids) → the API's branch filter; 'none' = the rows without a branch
const branchOf = (p) => {
  const ids = p.locationIds ?? (p.locationId != null ? [p.locationId] : null);
  if (!ids) return {};
  return { branch: (Array.isArray(ids) ? ids : [ids]).map(String).join(',') };
};

/** The admin's warnings, high first, as the writer should show them. */
export function warningsOf(list) {
  return (Array.isArray(list) ? list : [])
    .map((w) => ({ code: w.code, severity: w.severity, message: w.message, ...(w.affects?.length ? { affects: w.affects } : {}) }))
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1));
}

/** Joya companies [{ key, label }] → with their finance company (allegro_finance code), or why there is none. */
export async function linkCompanies(companies) {
  const fc = await financeCompanies();
  return companies.map((co) => {
    const f = fc.companies.find((c) => c.allegroKey === co.key) || null;
    return { ...co, finance: f, reason: f ? null : fc.available ? `no finance data for ${co.label} yet: only ${fc.companies.map((c) => c.name).join(', ') || 'no company'} is loaded` : fc.reason };
  });
}

/**
 * One report of the Finance API per company: { report, source, params, companies: [{ company, companyKey, available,
 * dataUpTo, lastSync, warnings, ...shape(data, meta) }] }. shape() picks what the model needs from the admin's answer.
 */
async function perCompany(companies, path, params, shape = (data, meta) => ({ data, totals: meta.totals ?? null }), { load = null } = {}) {
  const out = [];
  const notLoaded = [];
  for (const co of await linkCompanies(companies)) {
    if (!co.finance) {
      // a company the user named gets its own answer; the others (the picker's "all companies") are only listed
      if (companies.asked || !co.reason?.startsWith('no finance data')) out.push({ company: co.label, companyKey: co.key, available: false, note: co.reason });
      else notLoaded.push(co.label);
      continue;
    }
    // load(co) = a report built from several admin calls (the future cheques); else one call of the Finance API
    const r = load ? await load(co) : await finance(path, { company: co.finance.code, ...params });
    if (!r.available) {
      out.push({ company: co.label, companyKey: co.key, available: false, note: r.reason });
      continue;
    }
    const m = r.meta || {};
    out.push({
      company: co.label,
      companyKey: co.key,
      available: true,
      dataUpTo: m.sync?.dataUpTo ?? null,
      lastSync: m.sync?.lastRunAt ?? null,
      syncStatus: m.sync?.status ?? null,
      warnings: warningsOf(m.warnings),
      ...(m.ambiguous ? { ambiguous: true, accounts: m.accounts, note: 'several accounts match the name: ask the user which one (accountKey), or list them' } : {}),
      ...(await shape(r.data, m, co)),
    });
  }
  if (notLoaded.length) out.notLoaded = notLoaded;
  return out;
}

const result = (report, params, companies, extra = {}) => ({
  report, source: SOURCE, params, ...extra,
  ...(companies.notLoaded ? { notLoaded: companies.notLoaded, noteNotLoaded: `${companies.notLoaded.join(', ')}: no finance data loaded yet (only the companies below are in the books)` } : {}),
  companies: [...companies],
});
const shown = (rows, limit, total) => ({ shown: Math.min(rows.length, limit), count: total ?? rows.length, rows: rows.slice(0, limit) });
const byName = (rows, q, pick = (r) => r.name) => (q ? rows.filter((r) => String(pick(r) || '').includes(q)) : rows);

// ---------------------------------------------------------------- the reports

/** How complete and fresh the books are: the last sync, the months with their income / salaries / unposted, the banks. */
export async function financeStatus(companies, p = {}) {
  const months = clamp(p.months, 14, 36);
  return result('finance_status', { months }, await perCompany(companies, '/status', {}, (d) => ({
    lastRun: d.lastRun,
    dataUpTo: d.dataUpTo,
    dataStart: d.dataStart,
    years: d.years,
    banks: d.banks,
    suppliers: d.suppliers,
    months: (d.months || []).slice(-months),
    note: 'complete false = the month has a high warning (for example no salary expense, income not posted); income and expenses in ₪ without VAT',
  })));
}

/** Profit and loss: income, purchases, salaries, general expenses, profit — by month, year, branch or account; compare with the period before or last year. */
export async function pnl(companies, p = {}) {
  const params = { ...dates(p), ...oneOf(p, 'by', ['month', 'year', 'branch', 'account']), ...oneOf(p, 'compare', ['prev_period', 'prev_year']), ...branchOf(p), ...flagOf(p, 'includeUnposted') };
  return result('pnl', params, await perCompany(companies, '/pnl', params, (d, m) => ({ rows: d, totals: m.totals, compare: m.compare ?? null, by: m.by })), {
    note: 'natural signs: income and expenses are plus, profit = income − purchases − salaries − general; amounts without VAT; by branch: "No branch" (branch null) is the part the books do not split, never spread it over the branches',
  });
}

/** Cash today and in 30 / 60 / 90 days: the bank lines, the cheques out by due date, cheques due and not cleared, open customer invoices. */
export async function cashPosition(companies, p = {}) {
  const params = asOf(p);
  return result('cash_position', params, await perCompany(companies, '/cash', params, (d, m) => ({ ...d, note: m.note })), {
    note: 'bankBalance = the bank statement lines added up (not the books); lastRunningBalance = the bank balance Hashavshevet shows; projected = bank + expected in − cheques out, by 30 / 60 / 90 days; expectedIn.overdue is money owed and late, not in projected',
  });
}

/** Food cost % and labor cost % per branch per month (books, Beecomm and the admin's labor data together). */
export async function branchCosts(companies, p = {}) {
  const params = { ...dates(p), ...branchOf(p) };
  return result('branch_costs', params, await perCompany(companies, '/branch-costs', params, (d, m) => ({ rows: d, noBranch: m.noBranch, vatRate: m.vatRate, foodCostAccounts: m.foodCostAccounts })), {
    note: 'revenue = the branch income in the books (revenueSource books), or Beecomm without VAT when the books have no branch for that month (beecomm); foodCost = group 800 purchases of the branch; laborCost = the admin labor cost (laborSource saved payroll / tabit / none); payrollGross = the payslip gross',
  });
}

/** Beecomm sales (without VAT) against the income in the books, per month and branch, with a company total row. */
export async function salesVsBooks(companies, p = {}) {
  const params = { ...dates(p), ...branchOf(p) };
  return result('sales_vs_books', params, await perCompany(companies, '/sales-vs-books', params, (d, m) => ({ rows: d, vatRate: m.vatRate, note: m.note })), {
    note: 'salesSystem = Beecomm daily totals without VAT (the sales system is Beecomm, not Tabit); books = income entries; difference = books − sales; the company total row (branch null) also counts income without a branch',
  });
}

/** Top suppliers (with VAT) or spending by account / group (without VAT), with the change vs the period before or last year. */
export async function spending(companies, p = {}) {
  const top = p.top == null ? LIMITS.spending : Math.min(Math.max(Number(p.top) || 0, 0), 200);
  const params = { ...dates(p), ...oneOf(p, 'by', ['supplier', 'account', 'group']), ...oneOf(p, 'compare', ['prev_period', 'prev_year']), ...branchOf(p), top };
  return result('spending', params, await perCompany(companies, '/spending', params, (d, m) => ({ rows: d, total: m.total, rowsInTotal: m.rows, withVat: m.withVat, compare: m.compare ?? null })), {
    note: 'by supplier = the supplier invoices (credit on the supplier account) WITH VAT; by account or group = the expense lines WITHOUT VAT; top = the biggest rows, total = all rows',
  });
}

/** Debts with age: what the company owes suppliers, or what customers owe it, per account, in age buckets. */
export async function aging(companies, p = {}) {
  const side = oneOf(p, 'side', ['customers', 'suppliers']).side;
  if (!side) throw bad('side must be customers or suppliers');
  const limit = limitOf(p, LIMITS.aging, 300);
  const q = textOf(p, 'q').q;
  const params = { side, ...asOf(p), ...flagOf(p, 'excludeGroupCompanies'), ...textOf(p, 'account') };
  return result('aging', { ...params, limit, ...(q ? { q } : {}) }, await perCompany(companies, '/aging', params, (d, m) => {
    const rows = byName(d, q);
    return { ...shown(rows, limit, rows.length), totals: m.totals, methods: m.methods, untied: m.untied, sign: m.sign };
  }), {
    note: 'balance and buckets in the natural sign (plus = owed); method matched = Hashavshevet matching, oldest_first = payments applied to the oldest invoices; buckets by due date (current = not yet due); rows are the biggest balances first',
  });
}

/** Group companies, loans and shareholders: balances and movement. One side only (the other company is not loaded). */
export async function intercompany(companies, p = {}) {
  const params = { ...asOf(p), ...dates(p, { required: false }) };
  delete params.to;
  return result('intercompany', params, await perCompany(companies, '/intercompany', params, (d, m) => ({ rows: d, totals: m.totals, sign: m.sign })), {
    note: 'plus = debit (they owe the company), minus = credit (the company owes them); confirmed false = the owner has not confirmed this account is a group company',
  });
}

/** Trial balance (מאזן בוחן) at a date: debit, credit and balance per account; with from, the movement of that period and the opening balance. */
export async function trialBalance(companies, p = {}) {
  const limit = limitOf(p, LIMITS.trialBalance, 600);
  const q = textOf(p, 'q').q;
  const params = { ...asOf(p), ...(p.from ? dates({ from: p.from }) : {}), ...textOf(p, 'group') };
  return result('trial_balance', { ...params, limit, ...(q ? { q } : {}) }, await perCompany(companies, '/trial-balance', params, (d, m) => {
    const rows = byName(d, q);
    return { ...shown(rows, limit, rows.length), totals: m.totals, balanced: m.balanced, asOf: m.asOf, from: m.from };
  }), {
    note: 'balance: debit is plus (an income or supplier account is normally minus); totals.debit = totals.credit when the books balance',
  });
}

/** The account card (כרטסת) of one account: its lines with a running balance, opening and closing balance. */
export async function accountCard(companies, p = {}) {
  const limit = limitOf(p, LIMITS.ledger, 500);
  const params = { ...dates(p), ...textOf(p, 'account'), ...textOf(p, 'q'), ...flagOf(p, 'includeUnposted'), limit, ...(p.offset ? { offset: Number(p.offset) || 0 } : {}) };
  if (!params.account && !params.q) throw bad('account (the account key) or q (part of the account name) is needed');
  return result('account_card', params, await perCompany(companies, '/ledger', params, (d, m) => ({
    account: m.account, openingBalance: m.openingBalance, closingBalance: m.closingBalance, debit: m.debit, credit: m.credit, total: m.total, shown: d ? d.length : 0, lines: d,
  })), { note: 'runningBalance: debit is plus; counterAccount = the other side of the entry; matched = the line is matched in Hashavshevet' });
}

/** Journal entries by batch, reference, date, account, type or text; or one entry (year + transId) with its lines, document and cheque. */
export async function journalSearch(companies, p = {}) {
  if (p.transId != null) {
    const year = Number(p.year), transId = Number(p.transId);
    if (!Number.isInteger(year) || !Number.isInteger(transId)) throw bad('year and transId must be numbers');
    return result('journal_search', { year, transId }, await perCompany(companies, `/journal/${year}/${transId}`, {}, (d, m) => ({ entry: d, debit: m.debit, credit: m.credit })));
  }
  const limit = limitOf(p, LIMITS.journal, 500);
  const params = { ...dates(p, { required: false }), ...textOf(p, 'batch'), ...textOf(p, 'reference'), ...textOf(p, 'account'), ...textOf(p, 'type'), ...textOf(p, 'q'), ...oneOf(p, 'posted', ['0', '1']), limit };
  if (!params.from && !params.to && !params.batch && !params.reference && !params.account && !params.q && !params.type) throw bad('give a period, batch, reference, account, type or text to search');
  return result('journal_search', params, await perCompany(companies, '/journal', params, (d, m) => ({ shown: d.length, count: m.total, amount: m.amount, entries: d })), {
    note: 'an entry is identified by year + transId (ids repeat between years); lineCount = its lines; posted false = not posted yet',
  });
}

/** Bank reconciliation: the bank statement vs the books per bank account, the open items on both sides and their age. */
export async function bankReconciliation(companies, p = {}) {
  const params = textOf(p, 'account');
  return result('bank_reconciliation', params, await perCompany(companies, '/bank/reconciliation', params, (d, m) => ({ accounts: d, sign: m.sign })), {
    note: 'bankBalance = the statement lines added up; bookBalance = the books (debit is plus, a minus is a credit balance); bankOpen / bookOpen = not matched yet; bankMatched should equal bookMatched; openAge = the open items by age (count and amount)',
  });
}

/**
 * The detailed bank reconciliation report (דוח התאמת בנק מפורט — the admin's bankRecon.js): for one bank account and a
 * period, as of `to`: the summary (bank balance − open bank lines + open book lines + uncleared cheques = book
 * balance), the first rows of each section and the links to the full page / Excel. The chat shows the buttons.
 */
export async function bankReconReport(companies, p = {}) {
  const params = { ...textOf(p, 'account'), ...dates(p, { required: false }) };
  const n = LIMITS.recon;
  const bankRow = (x) => ({ date: x.date, reference: x.reference, details: x.details, amount: x.amount, ageDays: x.ageDays, ...(x.payeeSource ? { payee: x.payee, payeeSource: x.payeeSource } : {}) });
  const bookRow = (x) => ({ date: x.date, reference: x.reference, description: x.description, counter: x.counterName || x.counterAccount, amount: x.amount, ageDays: x.ageDays, ...(x.posted ? {} : { posted: false }) });
  const chequeRow = (x) => ({ chequeNo: x.chequeNo, payee: x.payee, dueDate: x.dueDate, amount: x.amount, clearedDate: x.clearedDate, daysAfterDue: x.daysAfterDue, status: x.status });
  const top = (rows, by) => [...rows].sort((a, b) => Math.abs(b[by]) - Math.abs(a[by]));
  return result('bank_recon_report', params, await perCompany(companies, '/bank/report', params, (d) => {
    const q = { company: d.company?.code, account: d.account?.key, from: d.from, to: d.to };
    const qs = Object.entries(q).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    return {
      account: d.account,
      from: d.from,
      to: d.to,
      dataUpTo: d.dataUpTo,
      summary: d.summary,
      notes: d.notes,
      sections: {
        bankOpen: shown(top(d.bankOpen || [], 'amount').map(bankRow), n),
        bookOpen: shown(top(d.bookOpen || [], 'amount').map(bookRow), n),
        bookFutureMatched: shown((d.bookFutureMatched || []).map(bookRow), n),
        chequesCleared: shown(top(d.chequesCleared || [], 'amount').map(chequeRow), n),
        chequesOpen: shown(top(d.chequesOpen || [], 'amount').map(chequeRow), n),
      },
      downloads: { page: `/accounting/bank-recon?${qs}`, xlsx: `/api/joya/finance/bank-recon?${qs}&format=xlsx`, html: `/api/joya/finance/bank-recon?${qs}&format=html` },
    };
  }), {
    note: 'signs: money into the bank is plus on both sides. summary: bankBalance (the statement, running balance at `to`), bankOpen = bank lines with no book match (section 1; a cheque line carries payee / payeeSource, see summary.bankOpen.cheques: count, found, missing = cheques in the bank that are not in Hashavshevet yet), bookOpen = book lines with no bank match without cheques (section 2), chequesOpen = cheques issued and not cleared (section 3b: pastDue / notDue / clearedUnmatched), bookFutureMatched = book lines dated after `to` already matched, expectedBookBalance = bankBalance − bankOpen + bookOpen + chequesOpen − bookFutureMatched, unexplained = bookBalance − expected; chequesCleared = cleared in the period (section 3a). Each section gives its biggest rows by amount (shown of count; the full lists are in the page / Excel); cheque status: cleared, cleared_group (matched in a group), cleared_unmatched (in the bank, not matched yet), past_due, not_due; the chat shows the buttons for the full page and the Excel — do not write the links',
  });
}

/** The open bank lines (side bank) or the open book lines of the bank account (side book), oldest first. */
export async function bankOpenItems(companies, p = {}) {
  const side = oneOf(p, 'side', ['bank', 'book']).side;
  if (!side) throw bad('side must be bank or book');
  const limit = limitOf(p, LIMITS.open, 500);
  const params = { side, ...dates(p, { required: false }), ...textOf(p, 'account'), ...(p.minAge != null ? { minAge: Number(p.minAge) || 0 } : {}), ...flagOf(p, 'includeUnposted'), limit };
  return result('bank_open_items', params, await perCompany(companies, '/bank/open', params, (d, m) => ({ shown: d.length, count: m.total, amount: m.amount, rows: d })), {
    note: 'bank side: direction in / out, money in is plus, a cheque line (שיק + the cheque number as reference) carries payee = its beneficiary from Hashavshevet and payeeSource (cheques = the cheques module, journal = the journal entry with that number, missing = the cheque is not in Hashavshevet yet); book side: side debit / credit on the bank account; ageDays = days since the line',
  });
}

/** Suggested matches for open bank lines: one bank line to one book line with the same amount and direction. Suggestions only. */
export async function bankMatchSuggestions(companies, p = {}) {
  const limit = limitOf(p, LIMITS.suggestions, 300);
  const params = { ...textOf(p, 'account'), ...(p.days != null ? { days: Number(p.days) || 0 } : {}), ...(p.minAmount != null ? { minAmount: Number(p.minAmount) || 0 } : {}), limit };
  return result('bank_match_suggestions', params, await perCompany(companies, '/bank/suggestions', params, (d, m) => ({ shown: d.length, count: m.total, openBankLines: m.openBankLines, openBookLines: m.openBookLines, single: m.single, many: m.many, rows: d })), {
    note: 'nothing is matched by this: the accountant matches in Hashavshevet; confidence single = one candidate, many = several; one-to-one only (a bank line that sums several book lines gets no suggestion)',
  });
}

/** Customer invoices and credit notes (with VAT), with the kind register (the monthly register entries) or customer. */
export async function customerInvoices(companies, p = {}) {
  const limit = limitOf(p, LIMITS.invoices, 500);
  const params = { ...dates(p), ...textOf(p, 'account'), ...textOf(p, 'q'), ...oneOf(p, 'type', ['invoice', 'credit']), ...flagOf(p, 'includeUnposted'), limit };
  return result('customer_invoices', params, await perCompany(companies, '/invoices', params, (d, m) => ({ shown: d.length, count: m.total, amount: m.amount, rows: d })), {
    note: 'amount WITH VAT, a credit note is minus; kind register = the monthly entry of the cash register (not a real customer), customer = a real customer; docNumber = the invoice number; entryDate = the day it was entered in Hashavshevet',
  });
}

/**
 * Supplier invoices as the books hold them (owner 2026-11-09: "the invoices that are in the books — only in the books"),
 * with VAT: the invoice date, the day it was entered in Hashavshevet (entryDate), the supplier, the expense account, the
 * number, the batch and the description. The whole year goes into a file (export); the chat shows the first rows.
 */
export async function supplierInvoices(companies, p = {}) {
  const limit = limitOf(p, LIMITS.invoices, 500);
  const params = { side: 'supplier', ...dates(p), ...textOf(p, 'account'), ...textOf(p, 'q'), ...oneOf(p, 'type', ['invoice', 'credit']), ...flagOf(p, 'includeUnposted'), limit, ...(p.offset ? { offset: Number(p.offset) || 0 } : {}) };
  return result('supplier_invoices', params, await perCompany(companies, '/invoices', params, (d, m) => ({ shown: d.length, count: m.total, amount: m.amount, dates: m.dates, rows: d })), {
    note: 'amount WITH VAT, a supplier credit note is minus (type credit); date = the invoice date, entryDate = the day the bookkeeper entered it in Hashavshevet (תאריך הזנה), docNumber = the invoice number as Hashavshevet keeps it (often the last digits only); expenseAccount / expenseName = where the expense was booked; these are the BOOKS only — not Drive, not the mailbox (for invoices missing in the books use missing_invoices)',
  });
}

/**
 * A supplier's or customer's statement of us (the rows the planner extracted from the attached file) against our account
 * card in the books — only the differences (owner 2026-11-10, shared/statementCompare.js). p: { account | q (the party),
 * from, to (the statement's period), theirs: { perspective: 'supplier' | 'customer', party?, openingBalance?, closingBalance?,
 * rows: [{ date, reference, description, debit, credit }] }, days?, tolerance? }.
 */
export async function statementCompare(companies, p = {}) {
  const theirs = p.theirs && typeof p.theirs === 'object' ? p.theirs : null;
  if (!theirs || !Array.isArray(theirs.rows) || !theirs.rows.length) throw bad('theirs.rows (the rows of the attached statement) are needed');
  const params = { ...dates(p), ...textOf(p, 'account'), ...textOf(p, 'q'), ...flagOf(p, 'includeUnposted'), limit: EXPORT_MAX };
  if (!params.account && !params.q) throw bad('account (the account key) or q (part of the party name) is needed');
  const days = clamp(p.days, 45, 365), tolerance = p.tolerance == null ? 0.05 : Math.max(0, Number(p.tolerance) || 0);
  const perspective = theirs.perspective === 'customer' ? 'customer' : 'supplier';
  return result('statement_compare', { ...params, perspective, days, tolerance, theirsRows: theirs.rows.length }, await perCompany(companies, '/ledger', params, (d, m) => {
    if (m.ambiguous) return { ambiguous: true, accounts: m.accounts };
    const cmp = compareStatements({ ...theirs, perspective }, { lines: d || [], openingBalance: m.openingBalance, closingBalance: m.closingBalance }, { days, tolerance });
    return { account: m.account, period: { from: m.from, to: m.to }, ours: { lines: m.total, openingBalance: m.openingBalance, closingBalance: m.closingBalance }, theirs: { party: theirs.party ?? null, rows: theirs.rows.length, openingBalance: theirs.openingBalance ?? null, closingBalance: theirs.closingBalance ?? null }, ...cmp };
  }), {
    note: 'only the differences are listed: onlyTheirs = in their statement and not in our books, onlyOurs = in our books and not in their statement, amountDiffers = the same document with another amount; kind charge = an invoice (raises the debt), payment = money or a credit note; balance = the debt in one direction (debt says which), theirs as they give it, ours from our books, difference = theirs − ours, explainedByDifferences = what the listed differences add up to, unexplained = the rest (opening balance, lines outside the period)',
  });
}

/** One customer's or supplier's card: invoices, credit notes, payments, other lines, open items with age, and the balance. */
export async function accountStatement(companies, p = {}) {
  const params = { ...dates(p, { required: false }), ...textOf(p, 'account'), ...textOf(p, 'q') };
  if (!params.account && !params.q) throw bad('account (the account key) or q (part of the name) is needed');
  const n = clamp(p.limit, 40, 200);
  const cut = (rows) => ({ shown: Math.min(rows.length, n), count: rows.length, rows: rows.slice(-n) });
  return result('account_statement', { ...params, limit: n }, await perCompany(companies, '/statement', params, (d, m) => ({
    account: d.account, balance: d.balance, openingBalance: d.openingBalance, totals: d.totals, buckets: d.buckets, method: m.method,
    invoices: cut(d.invoices || []), credits: cut(d.credits || []), payments: cut(d.payments || []), others: cut(d.others || []), openItems: cut(d.openItems || []), sign: m.sign,
  })), {
    note: 'plus = owed (a supplier: the company owes it; a customer: it owes the company); invoice = an entry of the invoice types, credit = a credit note, other = a line on the invoice side without an invoice type (the register income entries), payment = every other line; the newest rows are shown when there are many',
  });
}

const numbersOf = (p, k) => {
  if (p[k] == null || String(p[k]).trim() === '') return {};
  const list = (Array.isArray(p[k]) ? p[k] : String(p[k]).split(',')).map((n) => String(n).trim()).filter(Boolean);
  if (!list.length || list.some((n) => !/^\d+$/.test(n))) throw bad(`${k} must be a cheque number or a list of numbers`);
  return { [k]: list.join(',') };
};

export const monthStart = (d) => `${String(d).slice(0, 7)}-01`;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const todayISO = () => new Date().toISOString().slice(0, 10);

/**
 * The window of "the future cheques" when the user gives no dates (owner 2026-11-11: "from now 3 months, till the end
 * of the third month"; 2026-11-12: "always from the start of the current month, not from today"): the first day of
 * this month → the last day of the month three months ahead (2026-11-12 → 2026-11-01 – 2027-02-28).
 */
export function futureChequesRange(today) {
  const [y, m] = String(today).split('-').map(Number);
  const end = new Date(Date.UTC(y, m - 1 + 3 + 1, 0)); // day 0 of the month after (month + 3) = its last day
  return { from: monthStart(today), to: end.toISOString().slice(0, 10) };
}

/**
 * The bank balance at the end of each bank day, from–to (Finance API /bank/balances: the uploaded bank file, else
 * Hashavshevet's bank lines) → { available, series: [{ date, balance, source, provisional? }], last, sources, agree }.
 */
export async function bankBalances(financeCode, from, to) {
  if (!from || !to || from > to) return { available: false, reason: 'no days to read', series: [], last: null };
  const r = await finance('/bank/balances', { company: financeCode, from, to });
  if (!r.available) return { available: false, reason: r.reason, series: [], last: null };
  return { available: true, series: r.data || [], last: r.meta?.last ?? null, sources: r.meta?.sources ?? null, agree: r.meta?.agree ?? null, warnings: warningsOf(r.meta?.warnings) };
}

const SOURCE_HE = { bank_file: 'קובץ הבנק', hashavshevet: 'חשבשבת' };

/** The words after the table: the last real balance, the expected end and the lowest expected day (owner 2026-11-12). */
export function balanceSummary(byDay, balances, { to = null } = {}) {
  const last = balances?.last || null;
  if (!last) return { lastActual: null, expectedEnd: null, lowest: null, note: balances?.reason || 'no bank balance is loaded: the bank file was not uploaded and Hashavshevet has no bank lines' };
  const expected = byDay.filter((d) => d.balance?.kind === 'expected');
  const lowest = expected.reduce((m, d) => (m == null || d.balance.amount < m.balance.amount ? d : m), null);
  const end = expected[expected.length - 1] || null;
  const before = byDay.filter((d) => d.dueDate <= last.date).reduce((s, d) => s + d.cheques.filter((c) => !c.paid).length, 0);
  const beforeAmount = r2(byDay.filter((d) => d.dueDate <= last.date).reduce((s, d) => s + d.cheques.filter((c) => !c.paid).reduce((a, c) => a + (Number(c.amount) || 0), 0), 0));
  return {
    lastActual: { date: last.date, amount: last.balance, source: last.source, sourceHe: SOURCE_HE[last.source] || last.source, ...(last.provisional ? { provisional: true } : {}) },
    agree: balances.agree ?? null,
    expectedEnd: end ? { date: end.dueDate, amount: end.balance.amount, windowTo: to } : null,
    lowest: lowest ? { date: lowest.dueDate, amount: lowest.balance.amount } : null,
    notPaidBefore: { count: before, amount: beforeAmount },
    note: `actual = the bank's closing balance of that day (${SOURCE_HE[last.source] || last.source}; minus = overdraft) up to ${last.date}${last.provisional ? ' (a file uploaded that same day — the day may still change)' : ''}; expected = the last actual balance minus the cheques and planned payments of every later day (other movements — income, transfers, fees — are not in it); notPaidBefore = cheques dated up to the last bank day that the bank has not paid (not deducted)`,
  };
}

/** The window's cheques by state: { window, paid, due (dated up to today, not paid), future (after today) }. */
export function chequeTotals(rows, today) {
  const t = { window: { count: 0, amount: 0 }, paid: { count: 0, amount: 0 }, due: { count: 0, amount: 0 }, future: { count: 0, amount: 0 } };
  const add = (k, c) => { t[k].count += 1; t[k].amount = r2(t[k].amount + (Number(c.amount) || 0)); };
  for (const c of rows) {
    add('window', c);
    add(c.bankDate ? 'paid' : c.dueDate && c.dueDate > today ? 'future' : 'due', c);
  }
  return t;
}

const mapChequeRow = (x) => ({ reference: x.cheque, payee: x.payee, amount: x.amount, dueDate: x.dueDate, issueDate: x.issueDate, state: x.state, bankDate: x.bankDate ?? null, source: x.source, account: x.account, accountName: x.accountName });

/**
 * The future-cheques report of one company (the chat calc and the fixed Drive file share it): the cheques of the window
 * from Hashavshevet + Priority (/cheques/all, every state — the window starts in the past), the bank balance per day
 * up to the last bank day and the expected balance after it (owner 2026-11-12). Cheques and planned payments between
 * the last bank day and the window's start are read too, so the expected balance already counts them.
 * → { available, meta, rows (the window), byDay, balances, payments, totals, balance }
 */
export async function futureChequesData({ financeCode, companyKey = null }, { from, to = null, today = todayISO() }) {
  const balances = await bankBalances(financeCode, from < monthStart(today) ? from : monthStart(today), today);
  const fetchFrom = balances.last && balances.last.date < from ? balances.last.date : from;
  const r = await finance('/cheques/all', { company: financeCode, from: fetchFrom, ...(to ? { to } : {}), limit: EXPORT_MAX });
  if (!r.available) return { available: false, reason: r.reason };
  const all = (r.data || []).map(mapChequeRow);
  const payments = await plannedByDay(companyKey, fetchFrom, to || '2099-12-31');
  const inWindow = (d) => d >= from && (!to || d <= to);
  const byDay = chequesByDay(all, { balances, payments, today }).filter((d) => inWindow(d.dueDate));
  const rows = all.filter((x) => inWindow(x.dueDate));
  return { available: true, meta: r.meta || {}, rows, byDay, balances, payments: payments.filter((p) => inWindow(p.date)), totals: chequeTotals(rows, today), balance: balanceSummary(byDay, balances, { to }) };
}

/**
 * Issued cheques: future, cleared (matched to the bank), not cleared; returned is not available yet. The FUTURE
 * cheques come from the merged table (/cheques/all: Hashavshevet + the Priority history, so the post-dated Priority
 * cheques count too) and, without dates, from today to the end of the third month ahead.
 */
export async function cheques(companies, p = {}) {
  const limit = limitOf(p, LIMITS.cheques, 500);
  const q = textOf(p, 'q').q;
  const state = oneOf(p, 'state', ['future', 'due', 'cleared', 'not_cleared', 'returned']).state;
  const numbers = numbersOf(p, 'number').number?.split(',') || null;
  if (state === 'future') {
    const given = dates(p, { required: false });
    const today = p.today || todayISO();
    const range = given.from || given.to ? given : { ...futureChequesRange(today), defaultRange: true };
    const params = { state: 'future', from: range.from, ...(range.to ? { to: range.to } : {}), limit: EXPORT_MAX };
    const account = textOf(p, 'account').account;
    const filtered = q || numbers || account; // a payee / number / account question: the plain list, no balance line
    const load = async (co) => {
      const d = await futureChequesData({ financeCode: co.finance.code, companyKey: co.key }, { from: range.from, to: range.to || null, today });
      return d.available ? { available: true, data: d, meta: d.meta } : d;
    };
    return result('cheques', { ...params, limit, ...(range.defaultRange ? { defaultRange: true } : {}), ...(q ? { q } : {}), ...(numbers ? { number: numbers.join(',') } : {}), ...(account ? { account } : {}) }, await perCompany(companies, '/cheques/all', params, (d, m) => {
      let rows = byName(d.rows, q, (r) => `${r.payee || ''} ${r.accountName || ''}`);
      if (numbers) rows = rows.filter((r) => numbers.includes(String(r.reference)));
      if (account) rows = rows.filter((r) => r.account === account);
      const byDay = filtered ? chequesByDay(rows) : d.byDay;
      return {
        ...shown(rows, limit, rows.length), byDay, totals: filtered ? chequeTotals(rows, today) : d.totals,
        ...(filtered ? {} : { balance: d.balance, payments: { count: d.payments.length, amount: r2(d.payments.reduce((s, x) => s + x.amount, 0)) } }),
        allFuture: m.totals ? { amount: m.totals.future } : null, note: 'Hashavshevet + Priority (source per row); dueDate = the date on the cheque; paid = the bank paid it already (bankDate)',
      };
    }, { load }), {
      note: `the future cheques (שיקים לפרעון, שקלפ): every cheque dated in the window from–to — the ones the bank paid already (paid), the ones due and not paid, and the future ones — from Hashavshevet's cheques module AND the Priority history (source per row: hashavshevet / priority)${range.defaultRange ? '; no dates were given, so the window is the default — the start of this month to the end of the third month ahead (say it)' : ''}. byDay = every day of the window with cheques, planned payments or a bank day, soonest first: the cheques (paid, source), the planned payments (Joya's Payments), the day's count and sum, and balance = the bank's closing balance of that day (kind actual, up to the last bank day) or the expected balance (kind expected: the last actual balance minus that day's unpaid cheques and payments, running); balance (the summary) = lastActual, expectedEnd, lowest, notPaidBefore; totals = window / paid / due / future; allFuture.amount = every future cheque, any date`,
    });
  }
  // every row is fetched (≤ 5000): the day groups and their sums must cover the whole selection, not the shown rows
  const params = { ...(state ? { state } : {}), ...dates(p, { required: false }), ...textOf(p, 'account'), ...numbersOf(p, 'number'), limit: EXPORT_MAX };
  return result('cheques', { ...params, limit, ...(q ? { q } : {}) }, await perCompany(companies, '/cheques', params, (d, m) => {
    const rows = byName(d, q, (r) => `${r.payee || ''} ${r.accountName || ''}`);
    return { ...shown(rows, limit, q ? rows.length : m.total), byDay: chequesByDay(rows), totals: m.totals, notAvailable: m.notAvailable, note: m.note };
  }), {
    note: 'from / to filter the due date; number = the cheque number(s); state cleared = its bank line is matched, not_cleared = due and not matched; returned cheques cannot be found yet. byDay = the same cheques grouped by due date, with the count and the sum of each day (over every cheque of the selection, not only the shown rows)',
  });
}

/**
 * The cheques grouped by due date, soonest first: { dueDate, count, amount, cheques: [{ reference, payee, amount, paid?,
 * source? }] }. With `balances` (bankBalances) and `payments` (plannedByDay) every day also has: payments[], paymentsAmount,
 * and balance = { amount, kind: 'actual' | 'expected', source? } — actual = the bank's closing balance of that day (or of
 * the last bank day before it) up to the last bank day; after it expected = the running balance minus the day's unpaid
 * cheques and planned payments (owner 2026-11-12: green = actual, red = expected). Bank days without cheques are days
 * too (count 0), so the balance is seen at the end of each day.
 */
export function chequesByDay(rows, { balances = null, payments = [], today = null } = {}) {
  const days = new Map();
  const day = (k) => {
    if (!days.has(k)) days.set(k, { dueDate: k, count: 0, amount: 0, cheques: [], ...(balances || payments.length ? { payments: [], paymentsAmount: 0 } : {}) });
    return days.get(k);
  };
  for (const c of rows) {
    const d = day(c.dueDate || 'no date');
    d.count += 1;
    d.amount = r2(d.amount + (Number(c.amount) || 0));
    d.cheques.push({ reference: c.reference ?? null, payee: c.payee || c.accountName || null, amount: c.amount, ...(c.bankDate ? { paid: true } : {}), ...(c.source && c.source !== 'hashavshevet' ? { source: c.source } : {}) });
  }
  for (const p of payments) {
    const d = day(p.date);
    d.payments.push({ id: p.id, payee: p.payee, amount: p.amount, ...(p.dueKind === 'WEEK' ? { window: `${p.date}–${p.dueTo}` } : {}) });
    d.paymentsAmount = r2(d.paymentsAmount + (Number(p.amount) || 0));
  }
  const last = balances?.last || null;
  if (last) for (const b of balances.series || []) if (b.date <= last.date) day(b.date);
  const out = [...days.values()].sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
  if (!last) return out;
  const series = (balances.series || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  let i = 0;
  let actual = null;
  let running = last.balance;
  for (const d of out) {
    if (d.dueDate === 'no date') continue;
    if (d.dueDate <= last.date) {
      while (i < series.length && series[i].date <= d.dueDate) actual = series[i++];
      d.balance = actual ? { amount: actual.balance, kind: 'actual', source: actual.source, ...(actual.date !== d.dueDate ? { asOf: actual.date } : {}), ...(actual.provisional ? { provisional: true } : {}) } : null;
    } else {
      const outflow = d.cheques.filter((c) => !c.paid).reduce((s, c) => s + (Number(c.amount) || 0), 0) + (d.paymentsAmount || 0);
      running = r2(running - outflow);
      d.balance = { amount: running, kind: 'expected' };
    }
  }
  return out;
}

/** The cheques written in Priority before Hashavshevet (history, a constant file): by number, supplier, amount, dates. */
export async function priorityCheques(companies, p = {}) {
  const limit = limitOf(p, LIMITS.cheques, 500);
  const amount = p.amount == null || p.amount === '' ? {} : Number.isFinite(Number(p.amount)) ? { amount: Number(p.amount) } : (() => { throw bad('amount must be a number'); })();
  const params = { ...numbersOf(p, 'cheque'), ...textOf(p, 'q'), ...textOf(p, 'supplierAccount'), ...amount, ...oneOf(p, 'dateField', ['chequeDate', 'payDate']), ...dates(p, { required: false }), limit };
  return result('priority_cheques', params, await perCompany(companies, '/cheques/priority', params, (d, m) => ({
    ...shown(d, limit, m.total), totals: m.totals, source: m.source, note: m.note,
  })), {
    note: 'the Priority cheque file — Pasta Lina\'s cheques before Hashavshevet (written April 2025 – March 2026, cheque dates to 2029; nothing updates it): cheque = the number on the cheque, chequeDate = the date on it, payDate = when it was made, amount = before withholding tax, withholding, net = the amount on the cheque, lines = the invoices it paid (invoice, invoiceDate, amount); cheques written in Hashavshevet are in cheques',
  });
}

/** VAT per month from the books (sales VAT, input VAT, VAT on assets, to pay) and, when asked, the 874 report runs. */
export async function vatSummary(companies, p = {}) {
  const params = { ...dates(p), ...flagOf(p, 'includeUnposted') };
  const out = await perCompany(companies, '/vat', params, (d, m) => ({ months: d, totals: m.totals, accounts: m.accounts, balancesAtTo: m.balancesAtTo }));
  if (p.issues) {
    const runs = await perCompany(companies, '/vat/issues', dates(p), (d, m) => ({ runs: d, recordTypes: m.recordTypes, note: m.note }));
    for (const co of out) Object.assign(co, { issues874: runs.find((x) => x.companyKey === co.companyKey) ?? null });
  }
  return result('vat_summary', { ...params, issues: !!p.issues }, out, {
    note: 'from the books: salesVat = credit on the sales VAT account, inputVat = debit on the input VAT account, toPay = salesVat − inputVat − assetVat; this is NOT the Beecomm VAT report (vat_report) — it is what the accountant posted; the 874 runs are not checked yet',
  });
}

/** Tax deducted at source: the payments to suppliers with what was deducted, and the suppliers' certificates (valid / expiring / expired). */
export async function withholding(companies, p = {}) {
  const q = textOf(p, 'q').q;
  const params = { ...dates(p, { required: false }), ...textOf(p, 'account'), ...(p.expiring != null ? { expiring: Number(p.expiring) || 60 } : {}) };
  return result('withholding', { ...params, ...(q ? { q } : {}) }, await perCompany(companies, '/withholding', params, (d, m) => ({
    deductions: shown(byName(d.deductions || [], q), 60),
    // the certificates that need attention first (expired, expiring), then the valid ones, up to the limit
    certificates: shown(byName(d.certificates || [], q).sort((a, b) => ['expired', 'expiring', 'valid'].indexOf(a.certificate) - ['expired', 'expiring', 'valid'].indexOf(b.certificate)), clamp(p.limit, 40, 300)),
    noCertificate: d.noCertificate, totals: m.totals, otherPayments: m.otherPayments, certificateCounts: m.certificates,
  })), {
    note: 'deducted = the tax taken from the payment (deductedPct of paid); certificate: valid, expiring (ends within `expiring` days, default 60), expired; certificateCounts has every supplier, the rows show the expired and expiring ones first; noCertificate = suppliers with no certificate date in Hashavshevet',
  });
}

/** Allocation numbers (מספר הקצאה) on supplier invoices: which invoices need one and which have a real one. */
export async function allocationNumbers(companies, p = {}) {
  const limit = limitOf(p, LIMITS.allocation, 500);
  const params = { ...dates(p), ...flagOf(p, 'missingOnly'), ...(p.minAmount != null ? { minAmount: Number(p.minAmount) || 0 } : {}), ...textOf(p, 'account'), limit };
  return result('allocation_numbers', params, await perCompany(companies, '/allocation-numbers', params, (d, m) => ({ shown: d.length, count: m.total, counts: m.counts, thresholds: m.thresholds, thresholdsConfirmed: m.thresholdsConfirmed, rows: d })), {
    note: 'required = the invoice total (with VAT) is at or over the legal limit of its date (the limits are not confirmed yet); status ok = a real number, missing = none, suspect = a short or odd value',
  });
}

// Missing invoices (owner 2026-11-08): "which invoices are not booked yet" is ONE question with several channels to
// look in. The first channel is the invoice agent's Drive index (every invoice that reached the accountant's mailbox);
// more channels come later (e.g. bank debits with no invoice in the books). The answer is built per channel, so the
// user asks about missing invoices and gets the Drive list as one part of it — never has to ask "about Drive".
const INVOICE_CHANNELS = {
  drive: {
    title: "the invoices that reached the accountant's mailbox (filed in Drive by the invoice agent)",
    titleHe: 'החשבוניות שהגיעו למייל של הנהלת החשבונות (תויקו בדרייב)',
    async run(companies, p, limit) {
      const status = p.status == null || p.status === '' || p.status === 'all' ? {} : { status: Array.isArray(p.status) ? p.status.join(',') : String(p.status) };
      const direction = p.direction && p.direction !== 'all' ? { direction: String(p.direction) } : {};
      const params = { ...dates(p, { required: false }), ...direction, ...status, ...textOf(p, 'q'), ...(p.recheck ? { recheck: 1 } : {}), limit };
      const cos = await perCompany(companies, '/invoices/drive-check', params, (d, m) => ({
        shown: d.length, count: m.total, driveInvoices: m.driveInvoices, from: m.from, to: m.to, booksUpTo: m.booksUpTo, driveUpdatedAt: m.driveUpdatedAt,
        counts: m.counts, totals: m.totals, flagged: m.flagged, rules: m.rules, booksWithoutDocument: m.booksWithoutDocument, unmatchedFolder: m.unmatchedFolder, statuses: m.statuses, rows: d,
      }));
      return {
        params,
        companies: [...cos],
        ...(cos.notLoaded ? { notLoaded: cos.notLoaded } : {}),
        note: 'status booked = in the books (an entry of the party with the same total, with VAT); pending = too new for the books (probably not entered yet); not_booked = missing in the books; amount_differs = the number is booked with another total; no_account = the party has no account with that tax id in Hashavshevet. counts / totals cover every invoice of this channel in the period; rows are the ones asked for (status). The match is written back into Drive (books.matched). booksWithoutDocument = book entries of the period that no invoice of this channel matched (count and amount)',
      };
    },
  },
};
const PLANNED_CHANNELS = 'not connected yet: bank debits and card charges with no invoice in the books, supplier statements';

/** Invoices not booked yet in Hashavshevet, from every channel the system can check — today the Drive channel. */
export async function missingInvoices(companies, p = {}) {
  const limit = limitOf(p, LIMITS.invoices, 500);
  const wanted = Array.isArray(p.channels) && p.channels.length ? p.channels.map(String) : Object.keys(INVOICE_CHANNELS);
  const unknown = wanted.filter((k) => !INVOICE_CHANNELS[k]);
  if (unknown.length) throw bad(`unknown channel ${unknown.join(', ')} (channels: ${Object.keys(INVOICE_CHANNELS).join(', ')})`);
  const channels = [];
  for (const key of wanted) {
    const ch = INVOICE_CHANNELS[key];
    channels.push({ channel: key, title: ch.title, titleHe: ch.titleHe, ...(await ch.run(companies, p, limit)) });
  }
  return {
    report: 'missing_invoices',
    source: 'the Hashavshevet books (allegro_finance) through the Allegro admin Finance API, checked against each channel; the first channel is the invoice agent\'s Google Drive index',
    params: { ...dates(p, { required: false }), direction: p.direction || 'all', status: p.status || 'all', channels: wanted },
    channels,
    otherChannels: PLANNED_CHANNELS,
    note: 'the answer is per channel: each channel is one part of it, named by its title; the same invoice may appear in more than one channel later',
  };
}

/** Salary entries in the books (group 720) against the payslip gross of the admin's payroll, per branch, for one month. */
export async function payrollCheck(companies, p = {}) {
  if (!MONTH.test(String(p.month || ''))) throw bad('month must be YYYY-MM');
  const params = { month: String(p.month), ...branchOf(p) };
  return result('payroll_check', params, await perCompany(companies, '/payroll-check', params, (d, m) => ({ rows: d, totals: m.totals, booksByAccount: m.booksByAccount })), {
    note: 'books = the salary expense posted in the books; payroll = the payslip gross of the admin (payrollSource saved / tabit / none); difference = books − payroll; employer costs are not in the payroll gross',
  });
}

/** Exceptions in the books: unposted entries, future-dated entries, possible duplicates, expense lines without a branch. */
export async function exceptions(companies, p = {}) {
  const limit = limitOf(p, LIMITS.exceptions, 500);
  const params = { ...oneOf(p, 'type', ['unposted', 'future_dated', 'possible_duplicate', 'missing_branch', 'wrong_account']), ...dates(p, { required: false }), limit };
  return result('exceptions', params, await perCompany(companies, '/exceptions', params, (d, m) => ({ shown: d.length, count: m.total, counts: m.counts, notAvailable: m.notAvailable, from: m.from, to: m.to, rows: d, note: m.note })), {
    note: 'counts = how many of each type; possible_duplicate is a wide rule (same accounts, amount and reference) and can be a real repeat; wrong_account has no rule yet',
  });
}

/** Change history in Hashavshevet: account changes (who, when, field, old and new value), logins, 874 runs, and what each night\'s sync changed. */
export async function changeHistory(companies, p = {}) {
  const limit = limitOf(p, LIMITS.changes, 500);
  const params = { ...dates(p), ...oneOf(p, 'kind', ['account', 'login', 'sync', 'vat_run']), ...textOf(p, 'account'), limit };
  return result('change_history', params, await perCompany(companies, '/changes', params, (d, m) => ({ shown: d.length, count: m.total, counts: m.counts, rows: d, note: m.note })), {
    note: 'Hashavshevet logs account changes and logins, not journal edits; kind sync shows what the nightly copy found changed, from 6 November 2026 on',
  });
}
