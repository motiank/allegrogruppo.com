// The known bank payments — standing orders and direct debits (הוראות קבע) — next to the cheques on the שקלפ page
// (owner 2026-11-22: "list forward the daily cheques or expenses like known bank payments (הוראות קבע) by date").
// Nothing is stored and nobody types them in: they are learned from the bank file the admin holds (bank_transactions,
// through the Local Data API): a money-out line of action code 515 (a standing order — the payee is the action text) or
// 469 ("הוראת-קבע") that came in at least two different months of the last four is a KNOWN payment; for a future day
// it is expected on the same day of the month (the middle day of its past dates) with its last month's amount. Days the
// bank file already covers show the real debits instead (paid). An expected debit whose day passed without a line is
// kept in the list, marked `late`, and is never deducted from the balance (the bank's real balance covers those days).
// Card debits (491 ישראכרט) are irregular and are NOT predicted.
import { bank as sourceBank } from './source.js';
import { bankLineName } from './payments.js';

export const STANDING_CODES = new Set(['515', '469']);
export const LOOKBACK_MONTHS = 4;
export const MIN_MONTHS = 2;

const r2 = (n) => Math.round(n * 100) / 100;
const monthOf = (d) => String(d).slice(0, 7);
const dayOf = (d) => Number(String(d).slice(8, 10));
const pad = (n) => String(n).padStart(2, '0');
export const daysInMonth = (month) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
/** The month `n` months before a YYYY-MM month (n may be negative). */
export const shiftMonth = (month, n) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 - n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};
/** Every YYYY-MM month from a to b, both included. */
export const monthsBetween = (a, b) => {
  const out = [];
  for (let m = a; m <= b; m = shiftMonth(m, -1)) out.push(m);
  return out;
};

const isStanding = (r) => Number(r?.debit) > 0 && STANDING_CODES.has(String(r.actionCode ?? r.action_code ?? ''));
const keyOf = (r) => `${r.account ?? ''}|${String(r.actionCode ?? '')}|${bankLineName(r)}|${r.reference ?? ''}`;
const median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};

/**
 * Pure. rows = the bank's money-out lines (Local Data API shape: date, actionCode, action, details, reference, debit,
 * account) of the months before the window and of the window itself. Returns the window's bank payments:
 *   items: [{ date, payee, amount, kind: 'standing_order', reference, paid?, expected?, late?, months, lastAmount, lastDate }]
 *   known: [{ key, payee, months, day, lastAmount, lastDate }] — what is learned (for the page's explanation)
 * `lastBankDay` = the last day the bank file covers (days up to it show the real lines, later days the expected ones).
 */
export function bankPaymentsInWindow(rows, { from, to, lastBankDay = null, lookbackMonths = LOOKBACK_MONTHS, minMonths = MIN_MONTHS } = {}) {
  const lines = (rows || []).filter(isStanding).map((r) => ({ ...r, date: String(r.date).slice(0, 10) }));
  const firstMonth = monthOf(from);
  const historyFrom = shiftMonth(firstMonth, lookbackMonths);
  // what repeats: per key, per month before the window → the month's first day and total
  const byKey = new Map();
  for (const r of lines) {
    const m = monthOf(r.date);
    if (m < historyFrom || r.date >= from) continue;
    if (!byKey.has(keyOf(r))) byKey.set(keyOf(r), { key: keyOf(r), payee: bankLineName(r), reference: r.reference ?? null, account: r.account ?? null, months: new Map() });
    const k = byKey.get(keyOf(r));
    const e = k.months.get(m) || { month: m, day: dayOf(r.date), amount: 0, count: 0 };
    e.day = Math.min(e.day, dayOf(r.date));
    e.amount = r2(e.amount + Number(r.debit));
    e.count += 1;
    k.months.set(m, e);
  }
  const known = [...byKey.values()]
    .filter((k) => k.months.size >= minMonths)
    .map((k) => {
      const ms = [...k.months.values()].sort((a, b) => (a.month < b.month ? -1 : 1));
      const last = ms[ms.length - 1];
      return { key: k.key, payee: k.payee, reference: k.reference, account: k.account, months: ms.length, day: median(ms.map((x) => x.day)), lastAmount: last.amount, lastMonth: last.month, lastDate: `${last.month}-${pad(last.day)}` };
    })
    .sort((a, b) => a.day - b.day || (a.payee < b.payee ? -1 : 1));
  // the window: the real lines of the days the bank covers …
  const items = [];
  const seen = new Set(); // key|month of the real lines in the window
  for (const r of lines) {
    if (r.date < from || r.date > to) continue;
    seen.add(`${keyOf(r)}|${monthOf(r.date)}`);
    items.push({ date: r.date, payee: bankLineName(r), amount: Number(r.debit), kind: 'standing_order', reference: r.reference ?? null, paid: true });
  }
  // … and the expected ones for the rest
  for (const month of monthsBetween(firstMonth, monthOf(to))) {
    for (const k of known) {
      if (seen.has(`${k.key}|${month}`)) continue;
      const date = `${month}-${pad(Math.min(k.day, daysInMonth(month)))}`;
      if (date < from || date > to) continue;
      const late = Boolean(lastBankDay && date <= lastBankDay);
      items.push({ date, payee: k.payee, amount: k.lastAmount, kind: 'standing_order', reference: k.reference, expected: true, ...(late ? { late: true } : {}), months: k.months, lastDate: k.lastDate });
    }
  }
  items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.payee || '') < (b.payee || '') ? -1 : 1));
  return { items, known };
}

/** The window's known bank payments of a company, from the admin's stored bank rows. { available, items, known, lastBankDay, reason? } */
export async function knownBankPayments(companyKey, from, to, { today, lastBankDay = null } = {}) {
  const readFrom = `${shiftMonth(monthOf(from), LOOKBACK_MONTHS)}-01`;
  const readTo = to < today ? to : today;
  const b = await sourceBank(companyKey, readFrom, readTo, { side: 'debit' });
  if (!b.available) return { available: false, reason: b.reason, items: [], known: [], lastBankDay };
  const last = lastBankDay || b.rows.reduce((m, r) => (String(r.date).slice(0, 10) > m ? String(r.date).slice(0, 10) : m), '') || null;
  return { available: true, lastBankDay: last, ...bankPaymentsInWindow(b.rows, { from, to, lastBankDay: last }) };
}
