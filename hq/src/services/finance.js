// Finance calculations for the AI: the Hashavshevet books (allegro_finance), read live from the Allegro admin's
// Finance API (../finance_api_readme.md) through source.finance — never stored here, never computed here: every
// number is the admin's. Per company (a finance company is linked to an Allegro company key by /finance/companies).
// Chain admin only (owner 2026-11-07, decision 1; see ai.js). Every answer carries the admin's data warnings: the
// books have real gaps (no 2026 salaries, no income after August 2026, a bank gap…), and the writer must show a
// `high` warning next to the number it affects.
import { finance, financeCompanies } from './source.js';

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
const LIMITS = { aging: 30, trialBalance: 120, ledger: 150, journal: 60, invoices: 100, cheques: 80, exceptions: 60, open: 60, suggestions: 30, changes: 60, allocation: 60, spending: 20 };

const bad = (m) => Object.assign(new Error(m), { code: 'BAD_REQUEST' });
const num = (v) => (v == null || v === '' ? null : Number(v));
const clamp = (v, d, max) => Math.min(Math.max(Number(v) || d, 1), max);

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
async function perCompany(companies, path, params, shape = (data, meta) => ({ data, totals: meta.totals ?? null })) {
  const out = [];
  const notLoaded = [];
  for (const co of await linkCompanies(companies)) {
    if (!co.finance) {
      // a company the user named gets its own answer; the others (the picker's "all companies") are only listed
      if (companies.asked || !co.reason?.startsWith('no finance data')) out.push({ company: co.label, companyKey: co.key, available: false, note: co.reason });
      else notLoaded.push(co.label);
      continue;
    }
    const r = await finance(path, { company: co.finance.code, ...params });
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
      ...shape(r.data, m),
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
  const limit = clamp(p.limit, LIMITS.aging, 300);
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
  const limit = clamp(p.limit, LIMITS.trialBalance, 600);
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
  const limit = clamp(p.limit, LIMITS.ledger, 500);
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
  const limit = clamp(p.limit, LIMITS.journal, 500);
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

/** The open bank lines (side bank) or the open book lines of the bank account (side book), oldest first. */
export async function bankOpenItems(companies, p = {}) {
  const side = oneOf(p, 'side', ['bank', 'book']).side;
  if (!side) throw bad('side must be bank or book');
  const limit = clamp(p.limit, LIMITS.open, 500);
  const params = { side, ...dates(p, { required: false }), ...textOf(p, 'account'), ...(p.minAge != null ? { minAge: Number(p.minAge) || 0 } : {}), ...flagOf(p, 'includeUnposted'), limit };
  return result('bank_open_items', params, await perCompany(companies, '/bank/open', params, (d, m) => ({ shown: d.length, count: m.total, amount: m.amount, rows: d })), {
    note: 'bank side: direction in / out, money in is plus; book side: side debit / credit on the bank account; ageDays = days since the line',
  });
}

/** Suggested matches for open bank lines: one bank line to one book line with the same amount and direction. Suggestions only. */
export async function bankMatchSuggestions(companies, p = {}) {
  const limit = clamp(p.limit, LIMITS.suggestions, 300);
  const params = { ...textOf(p, 'account'), ...(p.days != null ? { days: Number(p.days) || 0 } : {}), ...(p.minAmount != null ? { minAmount: Number(p.minAmount) || 0 } : {}), limit };
  return result('bank_match_suggestions', params, await perCompany(companies, '/bank/suggestions', params, (d, m) => ({ shown: d.length, count: m.total, openBankLines: m.openBankLines, openBookLines: m.openBookLines, single: m.single, many: m.many, rows: d })), {
    note: 'nothing is matched by this: the accountant matches in Hashavshevet; confidence single = one candidate, many = several; one-to-one only (a bank line that sums several book lines gets no suggestion)',
  });
}

/** Customer invoices and credit notes (with VAT), with the kind register (the monthly register entries) or customer. */
export async function customerInvoices(companies, p = {}) {
  const limit = clamp(p.limit, LIMITS.invoices, 500);
  const params = { ...dates(p), ...textOf(p, 'account'), ...textOf(p, 'q'), ...oneOf(p, 'type', ['invoice', 'credit']), ...flagOf(p, 'includeUnposted'), limit };
  return result('customer_invoices', params, await perCompany(companies, '/invoices', params, (d, m) => ({ shown: d.length, count: m.total, amount: m.amount, rows: d })), {
    note: 'amount WITH VAT, a credit note is minus; kind register = the monthly entry of the cash register (not a real customer), customer = a real customer; docNumber = the invoice number',
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

/** Issued cheques: future, cleared (matched to the bank), not cleared; returned is not available yet. */
export async function cheques(companies, p = {}) {
  const limit = clamp(p.limit, LIMITS.cheques, 500);
  const q = textOf(p, 'q').q;
  const params = { ...oneOf(p, 'state', ['future', 'due', 'cleared', 'not_cleared', 'returned']), ...dates(p, { required: false }), ...textOf(p, 'account'), limit: q ? 5000 : limit };
  return result('cheques', { ...params, limit, ...(q ? { q } : {}) }, await perCompany(companies, '/cheques', params, (d, m) => {
    const rows = byName(d, q, (r) => `${r.payee || ''} ${r.accountName || ''}`);
    return { ...shown(rows, limit, q ? rows.length : m.total), totals: m.totals, notAvailable: m.notAvailable, note: m.note };
  }), {
    note: 'from / to filter the due date; state future = due after today, cleared = its bank line is matched, not_cleared = due and not matched; returned cheques cannot be found yet',
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
  const limit = clamp(p.limit, LIMITS.allocation, 500);
  const params = { ...dates(p), ...flagOf(p, 'missingOnly'), ...(p.minAmount != null ? { minAmount: Number(p.minAmount) || 0 } : {}), ...textOf(p, 'account'), limit };
  return result('allocation_numbers', params, await perCompany(companies, '/allocation-numbers', params, (d, m) => ({ shown: d.length, count: m.total, counts: m.counts, thresholds: m.thresholds, thresholdsConfirmed: m.thresholdsConfirmed, rows: d })), {
    note: 'required = the invoice total (with VAT) is at or over the legal limit of its date (the limits are not confirmed yet); status ok = a real number, missing = none, suspect = a short or odd value',
  });
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
  const limit = clamp(p.limit, LIMITS.exceptions, 500);
  const params = { ...oneOf(p, 'type', ['unposted', 'future_dated', 'possible_duplicate', 'missing_branch', 'wrong_account']), ...dates(p, { required: false }), limit };
  return result('exceptions', params, await perCompany(companies, '/exceptions', params, (d, m) => ({ shown: d.length, count: m.total, counts: m.counts, notAvailable: m.notAvailable, from: m.from, to: m.to, rows: d, note: m.note })), {
    note: 'counts = how many of each type; possible_duplicate is a wide rule (same accounts, amount and reference) and can be a real repeat; wrong_account has no rule yet',
  });
}

/** Change history in Hashavshevet: account changes (who, when, field, old and new value), logins, 874 runs, and what each night\'s sync changed. */
export async function changeHistory(companies, p = {}) {
  const limit = clamp(p.limit, LIMITS.changes, 500);
  const params = { ...dates(p), ...oneOf(p, 'kind', ['account', 'login', 'sync', 'vat_run']), ...textOf(p, 'account'), limit };
  return result('change_history', params, await perCompany(companies, '/changes', params, (d, m) => ({ shown: d.length, count: m.total, counts: m.counts, rows: d, note: m.note })), {
    note: 'Hashavshevet logs account changes and logins, not journal edits; kind sync shows what the nightly copy found changed, from 6 November 2026 on',
  });
}
