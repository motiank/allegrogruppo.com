// Bank calculations for the AI (bank_summary, bank_transactions). The bank data is per company — an account
// belongs to a company in Allegro (restaurants.json bank_accounts) — and read live from the Allegro API
// (source.bank), never stored here. Chain admin only (see ai.js).
import { bank as sourceBank } from './source.js';
import { addDays } from '../lib/recommend.js';
import { periodOf, GROUPS, paymentsSummary } from './analytics.js';

const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const sum = (rows, k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
// how far back to look for the balance before the period (the account may have quiet days)
const OPENING_LOOKBACK_DAYS = 45;
const BY_DAY_MAX = 62;
const SOURCE = 'bank files uploaded in Allegro (/bank/transactions/stored); as fresh as the last upload';

// weekly (Sunday–Saturday) or monthly money in / out and the balance at the end, from the day rows
function byPeriod(days, by, from, to) {
  const m = new Map();
  for (const r of days) {
    const pp = periodOf(r.date, by);
    const g = m.get(pp.key) || { from: pp.from, to: pp.to, ...(pp.from < from || pp.to > to ? { partial: true } : {}), daysWithData: 0, moneyIn: 0, moneyOut: 0, closingBalance: null };
    g.daysWithData++;
    g.moneyIn += r.credit || 0;
    g.moneyOut += r.debit || 0;
    if (r.closingBalance != null) g.closingBalance = r.closingBalance;
    m.set(pp.key, g);
  }
  return [...m.values()].map((g) => ({ ...g, moneyIn: r2(g.moneyIn), moneyOut: r2(g.moneyOut), net: r2(g.moneyIn - g.moneyOut) }));
}

/**
 * Money in and out of each company's bank account(s) in a period, vs the same-length period before: totals, the
 * balance at the start and the end, the lowest balance, the biggest sources and uses (action + details), and day by
 * day for periods up to 62 days.
 */
export async function bankSummary(companies, from, to, group = null) {
  const by = GROUPS.includes(group) ? group : null;
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
        ...(by ? { byPeriod: byPeriod(cur, by, from, to) } : {}),
        ...(len <= BY_DAY_MAX && !by ? { byDay: cur.map((r) => ({ date: r.date, moneyIn: r.credit, moneyOut: r.debit, closingBalance: r.closingBalance })) } : {}),
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

// Card company payouts in the bank text (action). The members club (חבר משרתי קבע) is not a card company.
const CARD_COMPANIES = [
  { name: 'Max', re: /מקס/ },
  { name: 'Isracard', re: /ישראכרט/ },
  { name: 'American Express', re: /אמריקן אקספרס|אמריקן/ },
  { name: 'Cal', re: /כאל|כרטיסי אשראי לישראל/ },
  { name: 'Diners', re: /דיינרס/ },
  { name: 'Leumi Card', re: /לאומי קארד/ },
];
const cardCompanyOf = (r) => CARD_COMPANIES.find((c) => c.re.test(`${r.action || ''}`))?.name ?? null;

/**
 * Week by week (Sunday–Saturday): the credit cards in Beecomm (VISA + MASTERCARD + AMEX + DINERS, the company's
 * locations) next to what the card companies paid into the company's bank account in the FOLLOWING week (they pay
 * a sales week in the next week — Max on Wednesday, Amex on Thursday or Friday). The difference is fees, timing and
 * missing days; it is not a sum the model should make itself.
 */
export async function cardsVsBank(companies, locationsOf, from, to) {
  const start = periodOf(from, 'week').from;
  const end = periodOf(to, 'week').to;
  const out = [];
  let reason = null;
  for (const co of companies) {
    const locs = locationsOf(co.key);
    const pay = locs.length ? await paymentsSummary(locs, start, end, null, 'week') : null;
    const bank = await sourceBank(co.key, addDays(start, 7), addDays(end, 7), { group: 'none', side: 'credit' });
    if (!bank.available) reason = bank.reason;
    const weeks = new Map();
    for (const w of pay?.byPeriodTotal || []) weeks.set(w.from, { salesWeek: { from: w.from, to: w.to }, beecommCreditCards: w.creditCards, beecommMembersClub: w.membersClub, beecommDaysWithData: w.daysWithData, bank: {} });
    let lastBankDate = null;
    for (const r of bank.available ? bank.rows : []) {
      // how far the bank file goes (any credit), to tell a week not paid yet from a week the file does not cover
      lastBankDate = !lastBankDate || r.date > lastBankDate ? r.date : lastBankDate;
      const c = cardCompanyOf(r);
      if (!c || r.credit == null) continue;
      const salesWeek = addDays(periodOf(r.date, 'week').from, -7);
      const w = weeks.get(salesWeek);
      if (!w) continue;
      const b = w.bank[c] || { amount: 0, payments: 0, dates: new Set() };
      b.amount += r.credit;
      b.payments++;
      b.dates.add(r.date);
      w.bank[c] = b;
    }
    const rows = [...weeks.values()]
      .sort((a, b) => (a.salesWeek.from < b.salesWeek.from ? -1 : 1))
      .map((w) => {
        const companiesPaid = Object.entries(w.bank).map(([company, b]) => ({ company, amount: r2(b.amount), payments: b.payments, dates: [...b.dates].sort() }));
        const bankTotal = companiesPaid.reduce((a, b) => a + b.amount, 0);
        const payWeek = { from: addDays(w.salesWeek.from, 7), to: addDays(w.salesWeek.to, 7) };
        const notYet = !lastBankDate || lastBankDate < payWeek.to;
        return {
          ...w,
          bank: undefined,
          bankWeek: payWeek,
          bankCardCompanies: r2(bankTotal),
          bankByCompany: companiesPaid,
          ...(notYet ? { bankNotComplete: true } : {}),
          differencePct: w.beecommCreditCards && !notYet ? r2(((bankTotal - w.beecommCreditCards) / w.beecommCreditCards) * 100) : null,
        };
      });
    out.push({ company: co.label, companyKey: co.key, locations: locs, available: bank.available, lastBankDate, weeks: rows });
  }
  return {
    period: { from: start, to: end },
    source: 'Beecomm payments (/beecomm/payments/stored, credit cards = VISA + MASTERCARD + AMEX + DINERS) and the bank file (/bank/transactions/stored, credits of the card companies)',
    note: 'each Sunday–Saturday sales week is matched with the card company payments that arrived in the bank in the next week; Beecomm is gross with tips, the bank is net after the card company fees; bankNotComplete = the bank file does not cover that pay week yet; the members club is not in either column',
    ...(reason ? { missing: reason } : {}),
    companies: out,
  };
}
