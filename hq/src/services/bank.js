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

// Max pays VISA (merchant numbers 002…) and MASTERCARD (007…) every Wednesday for the Sunday–Saturday week
// before, about 1.6% under Beecomm (its fee); its 008… numbers pay once a month (28th) for something else.
// American Express pays about twice a month (2nd and 8th) for the month before. Checked on Pasta Lina, Jun–Oct 2026.
const maxNumber = (r) => (r.details || '').match(/מזהה (\d{3})/)?.[1] ?? null;

/**
 * The card sales in Beecomm next to the card companies' payouts in the bank, the way they really pay:
 *   weeks: VISA + MASTERCARD of each Sunday–Saturday week vs Max's payout in the following week (fee ≈ 1.6%);
 *   amexMonths: AMEX of each month vs American Express's payouts in the next month.
 */
export async function cardsVsBank(companies, locationsOf, from, to) {
  const start = periodOf(from, 'week').from;
  const end = periodOf(to, 'week').to;
  const mStart = `${start.slice(0, 7)}-01`;
  const mEnd = periodOf(end, 'month').to;
  const out = [];
  let reason = null;
  for (const co of companies) {
    const locs = locationsOf(co.key);
    const pay = locs.length ? await paymentsSummary(locs, start, end, null, 'week') : null;
    const payM = locs.length ? await paymentsSummary(locs, mStart, mEnd, null, 'month') : null;
    const bank = await sourceBank(co.key, addDays(start, 7), periodOf(addDays(mEnd, 1), 'month').to, { group: 'none', side: 'credit' });
    if (!bank.available) reason = bank.reason;
    const rows = bank.available ? bank.rows.filter((r) => r.credit != null) : [];
    const lastBankDate = rows.reduce((m, r) => (!m || r.date > m ? r.date : m), null);
    const brand = (p, k) => p.brands?.[k] || 0;

    const weeks = (pay?.byPeriodTotal || []).map((w) => {
      const payWeek = { from: addDays(w.from, 7), to: addDays(w.to, 7) };
      const max = rows.filter((r) => /מקס/.test(r.action) && maxNumber(r) !== '008' && r.date >= payWeek.from && r.date <= payWeek.to);
      const visa = brand(w, 'VISA');
      const mc = brand(w, 'MASTERCARD');
      const bankVisa = max.filter((r) => maxNumber(r) === '002').reduce((a, r) => a + r.credit, 0);
      const bankMc = max.filter((r) => maxNumber(r) === '007').reduce((a, r) => a + r.credit, 0);
      const notYet = !lastBankDate || lastBankDate < payWeek.to;
      const diff = (b, x) => (x && !notYet ? r2(((b - x) / x) * 100) : null);
      return {
        salesWeek: { from: w.from, to: w.to },
        beecommDaysWithData: w.daysWithData,
        beecommVisa: r2(visa),
        beecommMastercard: r2(mc),
        bankWeek: payWeek,
        maxPaidOn: [...new Set(max.map((r) => r.date))].sort(),
        bankMaxVisa: r2(bankVisa),
        bankMaxMastercard: r2(bankMc),
        differencePct: diff(bankVisa + bankMc, visa + mc),
        ...(notYet ? { bankNotComplete: true } : {}),
      };
    });

    const amexMonths = (payM?.byPeriodTotal || []).map((m) => {
      const next = periodOf(addDays(m.to, 1), 'month');
      const amex = rows.filter((r) => /אמריקן/.test(r.action) && r.date >= next.from && r.date <= next.to);
      const paid = amex.reduce((a, r) => a + r.credit, 0);
      const notYet = !lastBankDate || lastBankDate < addDays(next.from, 9);
      return {
        salesMonth: m.from.slice(0, 7),
        beecommAmex: r2(brand(m, 'AMEX')),
        bankMonth: next.key,
        amexPayouts: amex.map((r) => ({ date: r.date, amount: r2(r.credit) })),
        bankAmex: r2(paid),
        differencePct: brand(m, 'AMEX') && !notYet ? r2(((paid - brand(m, 'AMEX')) / brand(m, 'AMEX')) * 100) : null,
        ...(notYet ? { bankNotComplete: true } : {}),
      };
    });

    const full = weeks.filter((w) => !w.bankNotComplete);
    const sumB = full.reduce((a, w) => a + w.beecommVisa + w.beecommMastercard, 0);
    const sumK = full.reduce((a, w) => a + w.bankMaxVisa + w.bankMaxMastercard, 0);
    // an unusual week (more than 8 points from the usual difference): does it even out with the weeks around it?
    const usual = sumB ? ((sumK - sumB) / sumB) * 100 : null;
    full.forEach((w, i) => {
      if (usual == null || w.differencePct == null || Math.abs(w.differencePct - usual) <= 8) return;
      const near = full.slice(Math.max(i - 1, 0), i + 2);
      const b = near.reduce((a, x) => a + x.beecommVisa + x.beecommMastercard, 0);
      const k = near.reduce((a, x) => a + x.bankMaxVisa + x.bankMaxMastercard, 0);
      const together = b ? ((k - b) / b) * 100 : null;
      w.unusual = { withWeeksAroundPct: r2(together), ...(together != null && Math.abs(together - usual) > 2.5 ? { checkWithMax: true, gap: r2(k - b * (1 + usual / 100)) } : { evensOut: true }) };
    });
    out.push({
      company: co.label,
      companyKey: co.key,
      locations: locs,
      available: bank.available,
      lastBankDate,
      visaMastercardTotal: { weeks: full.length, beecomm: r2(sumB), bankMax: r2(sumK), differencePct: sumB ? r2(((sumK - sumB) / sumB) * 100) : null },
      weeks,
      amexMonths,
      ...(brand(pay?.byPeriodTotal?.reduce((a, w) => ({ brands: { DINERS: (a.brands.DINERS || 0) + brand(w, 'DINERS') } }), { brands: {} }) || {}, 'DINERS')
        ? { dinersNote: 'Diners sales are in Beecomm, but no Diners payer is known in the bank: not compared' }
        : {}),
    });
  }
  return {
    period: { from: start, to: end },
    source: 'Beecomm payments (/beecomm/payments/stored) and the bank file (/bank/transactions/stored)',
    note:
      'weeks: VISA (Max merchant numbers 002…) and MASTERCARD (007…) of each Sunday–Saturday week vs what Max paid in the next week (on Wednesday); over many weeks the bank is ≈1.6% under Beecomm = the Max fee. One week can be ±10–30% for one restaurant when a day is paid a week late or early — the next week evens it out. amexMonths: American Express pays about twice a month (2nd, 8th) for the month before, so it is compared by month. Max 008… payouts (monthly, 28th), Isracard debits (fees) and the members club (חבר משרתי קבע, monthly) are not in these columns. Missing Beecomm days (beecommDaysWithData < 7 per restaurant) make the bank look higher.',
    ...(reason ? { missing: reason } : {}),
    companies: out,
  };
}
