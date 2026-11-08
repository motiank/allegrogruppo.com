// Drive invoices (the invoice agent's index.json rows) against the books (Hashavshevet journal entries): pure rules,
// shared by the admin Finance API (/finance/invoices/drive-check) and its tests. Nothing here touches Drive or a database.
//
// How a Drive invoice is matched (owner 2026-11-08):
//   1. The party's account in the books = the account whose tax file number (ח.פ.) is the invoice's party tax id.
//      No such account → status `no_account` (the supplier / customer is not opened in Hashavshevet with that number).
//   2. Among the invoice-type entries of that account, an entry with the same total (with VAT, ±tolerance, sign
//      ignored: a credit note is minus in the books) within `days` of the invoice date → `booked`. Among several, the
//      one whose reference ends with the invoice number's digits wins, then the nearest date.
//      The date is not a reason by itself to say "missing" (owner 2026-11-08: "I don't care when it was booked"): an
//      entry with that total booked LATER, with any delay, also counts — when the reference confirms the number, or
//      when the amount is a one-off (one such invoice of the party in Drive and one such entry on the account). An
//      entry dated before the invoice (beyond the window) is never it — the invoice did not exist yet — unless the
//      reference carries its number (a misread date). A recurring amount
//      (rent, a monthly fee) stays inside the window: on real data the unlimited match took January's rent entry for
//      September's missing invoice and hid the gap.
//   3. Else an entry of that account whose reference ends with the invoice number (4+ digits) but another amount →
//      `amount_differs` (the books hold the document with a different total: check which is right).
//   4. Else, an invoice dated after `booksUpTo - recentDays` → `pending` (the bookkeeper has probably not entered it
//      yet); older → `not_booked` (missing in the books).
// One entry is used by one invoice at most. Entries already fixed to an invoice (`books.transId` of an earlier
// check) are reserved first, so a repeated check gives the same answer.

export const STATUSES = ['booked', 'amount_differs', 'pending', 'not_booked', 'no_account'];

export const digits = (s) => String(s ?? '').replace(/\D/g, '');
/** A tax id or an invoice number as digits without leading zeros ("0512842162" → "512842162", "01-067138" → "1067138"). */
export const normDigits = (s) => digits(s).replace(/^0+/, '');

const dayMs = 86400000;
const daysBetween = (a, b) => Math.abs((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / dayMs);
export const addDaysIso = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * dayMs).toISOString().slice(0, 10);

/** Does a book reference (an int: 9045) end the invoice number (94879045)? Hashavshevet keeps the last digits only. */
export function referenceFits(invoiceNumber, ...references) {
  const n = normDigits(invoiceNumber);
  if (n.length < 4) return false;
  return references.some((r) => {
    const d = normDigits(r);
    return d.length >= 4 && (n === d || n.endsWith(d) || d.endsWith(n));
  });
}

/**
 * @param {object[]} invoices  Drive index rows: { number, date (YYYY-MM-DD), total, direction, party_tax_id, drive_file_id, books? }
 * @param {object[]} entries   book entries of the invoice types: { year, transId, type, date, amount, accountKey, reference, reference2, reference3, allocationNumber }
 * @param {Map<string, {accountKey, name}>} accountsByTax  account by normalised tax id
 * @param {object} o  { booksUpTo (YYYY-MM-DD), tolerance = 0.05, days = 45, recentDays = 21, recheck = false }
 * @returns {{ results: object[], used: Set<string> }}  one result per invoice, in the same order; used = the entry keys taken
 */
export function matchInvoices(invoices, entries, accountsByTax, { booksUpTo = null, tolerance = 0.05, days = 45, recentDays = 21, recheck = false } = {}) {
  const key = (e) => `${e.year}:${e.transId}`;
  const byAccount = new Map();
  const byKey = new Map();
  for (const e of entries) {
    byKey.set(key(e), e);
    if (!byAccount.has(e.accountKey)) byAccount.set(e.accountKey, []);
    byAccount.get(e.accountKey).push(e);
  }
  const used = new Set();
  const results = new Array(invoices.length);
  // pass 0: invoices flagged booked before keep their entry (when it still exists and the flag is trusted)
  if (!recheck) {
    invoices.forEach((inv, i) => {
      const b = inv.books;
      if (!b || b.status !== 'booked' || b.transId == null) return;
      const e = byKey.get(`${b.year}:${b.transId}`);
      if (!e || used.has(key(e))) return;
      used.add(key(e));
      results[i] = { status: 'booked', entry: e, account: { accountKey: e.accountKey, name: e.accountName ?? null }, how: 'kept' };
    });
  }
  const fits = (inv, e) => Math.abs(Math.abs(Number(e.amount)) - Math.abs(Number(inv.total))) <= tolerance + 1e-9;
  const pass = (i, inv, candidates) => {
    if (results[i]) return;
    const account = accountsByTax.get(normDigits(inv.party_tax_id)) || null;
    if (!account) {
      results[i] = { status: 'no_account', entry: null, account: null, how: 'no account with this tax id' };
      return;
    }
    const mine = (byAccount.get(account.accountKey) || []).filter((e) => !used.has(key(e)));
    const pick = candidates(inv, mine);
    if (pick) {
      used.add(key(pick.entry));
      results[i] = { ...pick, account };
    }
  };
  const gap = (e, x) => (e.date && x.date ? daysBetween(e.date, x.date) : Infinity);
  const byAmount = (maxGap, how, howWithNumber) => (x, mine) => {
    const fit = mine.filter((e) => fits(x, e) && gap(e, x) <= maxGap);
    if (!fit.length) return null;
    fit.sort((a, b) => Number(referenceFits(x.number, b.reference, b.reference2, b.reference3)) - Number(referenceFits(x.number, a.reference, a.reference2, a.reference3)) || gap(a, x) - gap(b, x));
    const e = fit[0];
    return { status: 'booked', entry: e, how: referenceFits(x.number, e.reference, e.reference2, e.reference3) ? howWithNumber : how };
  };
  // pass 1: the same total near the invoice date (the reference decides between several)
  invoices.forEach((inv, i) => pass(i, inv, byAmount(days, 'amount and date', 'amount, date and number')));
  // pass 2: the same total booked LATER (any delay) — only when the number confirms it or the amount is a one-off on
  // both sides. An entry dated before the invoice (beyond the window) is not that invoice unless its reference says so.
  const invoiceKey = (x) => `${normDigits(x.party_tax_id)}|${Math.abs(Number(x.total)).toFixed(2)}`;
  const sameInvoices = new Map();
  for (const x of invoices) sameInvoices.set(invoiceKey(x), (sameInvoices.get(invoiceKey(x)) || 0) + 1);
  invoices.forEach((inv, i) =>
    pass(i, inv, (x, mine) => {
      const notBefore = x.date ? addDaysIso(x.date, -days) : null;
      const same = mine.filter((e) => fits(x, e) && (!notBefore || (e.date && e.date >= notBefore) || referenceFits(x.number, e.reference, e.reference2, e.reference3)));
      if (!same.length) return null;
      const oneOff = sameInvoices.get(invoiceKey(x)) === 1 && mine.filter((e) => fits(x, e)).length === 1;
      const fit = same.filter((e) => oneOff || referenceFits(x.number, e.reference, e.reference2, e.reference3));
      if (!fit.length) return null;
      fit.sort((a, b) => Number(referenceFits(x.number, b.reference, b.reference2, b.reference3)) - Number(referenceFits(x.number, a.reference, a.reference2, a.reference3)) || gap(a, x) - gap(b, x));
      const e = fit[0];
      return { status: 'booked', entry: e, how: referenceFits(x.number, e.reference, e.reference2, e.reference3) ? 'amount and number (another date)' : 'amount, a one-off (another date)' };
    }),
  );
  // pass 3: the number is there with another amount — a weak sign (the books keep only the last digits), so only near the date
  invoices.forEach((inv, i) =>
    pass(i, inv, (x, mine) => {
      const fit = mine.filter((e) => referenceFits(x.number, e.reference, e.reference2, e.reference3) && gap(e, x) <= days * 2);
      if (!fit.length) return null;
      fit.sort((a, b) => gap(a, x) - gap(b, x));
      return { status: 'amount_differs', entry: fit[0], how: 'number found, the amount is different' };
    }),
  );
  // pass 4: nothing
  const recentFrom = booksUpTo ? addDaysIso(booksUpTo, -recentDays) : null;
  invoices.forEach((inv, i) => {
    if (results[i]) return;
    const account = accountsByTax.get(normDigits(inv.party_tax_id)) || null;
    if (!account) {
      results[i] = { status: 'no_account', entry: null, account: null, how: 'no account with this tax id' };
      return;
    }
    const pending = recentFrom && inv.date && inv.date >= recentFrom;
    results[i] = { status: pending ? 'pending' : 'not_booked', entry: null, account, how: pending ? `dated after ${recentFrom}: probably not entered yet` : 'no entry of this account with this amount or number' };
  });
  return { results, used };
}

/** The flag written into the Drive index row (index.json → invoices[].books). */
export function booksFlag(r, { checkedAt, booksUpTo }) {
  const e = r.entry;
  return {
    matched: r.status === 'booked',
    status: r.status,
    checkedAt,
    booksUpTo: booksUpTo ?? null,
    accountKey: r.account?.accountKey ?? null,
    ...(e ? { year: e.year, transId: e.transId, type: e.type, date: e.date, amount: e.amount, reference: e.reference2 || e.reference || e.reference3 || null, allocationNumber: e.allocationNumber ?? null } : {}),
  };
}

/** Did the flag change in a way worth writing? (the date of the check alone is not) */
export function flagChanged(before, after) {
  if (!before) return true;
  for (const k of ['matched', 'status', 'accountKey', 'year', 'transId', 'amount']) if ((before[k] ?? null) !== (after[k] ?? null)) return true;
  return false;
}
