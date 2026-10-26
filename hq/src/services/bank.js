// Bank calculations for the AI (bank_summary, bank_transactions). The bank data is per company — an account
// belongs to a company in Allegro (restaurants.json bank_accounts) — and read live from the Allegro API
// (source.bank), never stored here. Chain admin only (see ai.js).
import { bank as sourceBank } from './source.js';
import { addDays } from '../lib/recommend.js';

const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const sum = (rows, k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
// how far back to look for the balance before the period (the account may have quiet days)
const OPENING_LOOKBACK_DAYS = 45;
const BY_DAY_MAX = 62;
const SOURCE = 'bank files uploaded in Allegro (/bank/transactions/stored); as fresh as the last upload';

/**
 * Money in and out of each company's bank account(s) in a period, vs the same-length period before: totals, the
 * balance at the start and the end, the lowest balance, the biggest sources and uses (action + details), and day by
 * day for periods up to 62 days.
 */
export async function bankSummary(companies, from, to) {
  const len = daysBetween(from, to) + 1;
  const pFrom = addDays(from, -len);
  const out = [];
  let reason = null;
  for (const co of companies) {
    const days = await sourceBank(co.key, addDays(from, -Math.max(len, OPENING_LOOKBACK_DAYS)), to, { group: 'day' });
    if (!days.available) {
      reason = days.reason;
      out.push({ company: co.label, companyKey: co.key, available: false });
      continue;
    }
    if (!days.accounts.length) {
      out.push({ company: co.label, companyKey: co.key, available: true, accounts: [], note: 'this company has no bank account in Allegro' });
      continue;
    }
    const details = await sourceBank(co.key, from, to, { group: 'details' });
    const accounts = days.accounts.map((account) => {
      const all = days.rows.filter((r) => r.account === account);
      const cur = all.filter((r) => r.date >= from);
      const prev = all.filter((r) => r.date >= pFrom && r.date < from);
      const before = all.filter((r) => r.date < from).at(-1) || null;
      const last = cur.at(-1) || null;
      const low = cur.reduce((m, r) => (r.closingBalance != null && (m == null || r.closingBalance < m.closingBalance) ? r : m), null);
      const top = (side) =>
        details.rows
          .filter((r) => r.account === account && r[side] != null)
          .sort((a, b) => b[side] - a[side])
          .slice(0, 10)
          .map((r) => ({ action: r.action, details: r.details, transactions: r.transactions, amount: r2(r[side]), firstDate: r.firstDate, lastDate: r.lastDate }));
      return {
        bank: all[0]?.bank ?? null,
        account,
        daysWithData: cur.length,
        lastDataDate: all.at(-1)?.date ?? null,
        moneyIn: cur.length ? r2(sum(cur, 'credit')) : null,
        moneyOut: cur.length ? r2(sum(cur, 'debit')) : null,
        net: cur.length ? r2(sum(cur, 'credit') - sum(cur, 'debit')) : null,
        prevMoneyIn: prev.length ? r2(sum(prev, 'credit')) : null,
        prevMoneyOut: prev.length ? r2(sum(prev, 'debit')) : null,
        openingBalance: before ? { asOf: before.date, balance: before.closingBalance } : null,
        closingBalance: last ? { asOf: last.date, balance: last.closingBalance } : null,
        lowestBalance: low ? { date: low.date, balance: low.closingBalance } : null,
        topIn: top('credit'),
        topOut: top('debit'),
        ...(len <= BY_DAY_MAX ? { byDay: cur.map((r) => ({ date: r.date, moneyIn: r.credit, moneyOut: r.debit, closingBalance: r.closingBalance })) } : {}),
      };
    });
    out.push({ company: co.label, companyKey: co.key, available: true, accounts });
  }
  return {
    period: { from, to },
    comparedWith: { from: pFrom, to: addDays(from, -1) },
    source: SOURCE,
    note: 'moneyIn = credits (זכות), moneyOut = debits (חובה); a balance is the account balance at the end of that day; days with no transactions have no row',
    ...(reason ? { missing: reason } : {}),
    companies: out,
  };
}

/**
 * The bank transactions of the companies in a period: q = text in the action or details (e.g. WOLT, מקס, ביטוח
 * לאומי), side = credit (in) | debit (out). The biggest first (or the newest, order 'date'), at most limit rows,
 * with the count and sums of all that match.
 */
export async function bankTransactions(companies, from, to, { q = null, side = null, order = 'amount', limit = 30 } = {}) {
  const max = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const out = [];
  let reason = null;
  for (const co of companies) {
    const res = await sourceBank(co.key, from, to, { group: 'none', q, side });
    if (!res.available) {
      reason = res.reason;
      out.push({ company: co.label, companyKey: co.key, available: false });
      continue;
    }
    const rows = res.rows.map((r) => ({ date: r.date, account: r.account, action: r.action, details: r.details, reference: r.reference, moneyIn: r.credit, moneyOut: r.debit, balance: r.balance }));
    const amount = (r) => r.moneyIn ?? r.moneyOut ?? 0;
    const sorted = order === 'date' ? rows : [...rows].sort((a, b) => amount(b) - amount(a));
    out.push({
      company: co.label,
      companyKey: co.key,
      available: true,
      accounts: res.accounts,
      count: rows.length,
      moneyIn: r2(sum(rows, 'moneyIn')),
      moneyOut: r2(sum(rows, 'moneyOut')),
      shown: Math.min(rows.length, max),
      transactions: sorted.slice(0, max),
    });
  }
  return {
    period: { from, to },
    filter: { q: q || null, side: side || 'all', order: order === 'date' ? 'date' : 'amount' },
    source: SOURCE,
    ...(reason ? { missing: reason } : {}),
    companies: out,
  };
}
