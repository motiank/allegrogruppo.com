// A supplier's or customer's statement of our account (כרטסת that THEY sent) against OUR account card in the books
// (Hashavshevet ledger lines of their account): pure rules, shared by Joya's calc statement_compare
// (hq/src/services/finance.js) and scripts/test_statement_compare.js. Only the differences are the result
// (owner 2026-11-09: "the server analyzes the file, pulls our כרטסת from the books, compares, displays only the differences").
//
// Both sides are first turned into the same two kinds of events, so the direction of the columns does not matter:
//   charge  = a document that raises the debt (an invoice): on a SUPPLIER's statement of us it is their debit, in our
//             books a credit on the supplier account; on a CUSTOMER's statement of us it is their credit, in our books
//             a debit on the customer account.
//   payment = money or a credit note that lowers the debt: the other column on each side.
// Then one-to-one matching: (1) same kind, same amount, the document number fits (4+ digits, one ends with the
// other); (2) same kind, same amount, within `days` of each other (nearest first); (3) same kind, same amount, any
// date, when the amount is a one-off on both sides. What stays: onlyTheirs (in their statement, not in our books),
// onlyOurs (in our books, not in their statement), and amountDiffers (the number fits within 2×days but another
// amount — paired from the leftovers). The balances are compared in ONE direction, "what we owe them" (supplier) or
// "what they owe us" (customer); their closing balance is taken as they give it (plus = the debt).

export const digits = (s) => String(s ?? '').replace(/\D/g, '').replace(/^0+/, '');
export function referenceFits(a, b) {
  const x = digits(a), y = digits(b);
  if (x.length < 4 || y.length < 4) return false;
  return x === y || x.endsWith(y) || y.endsWith(x);
}
const dayMs = 86400000;
const gap = (a, b) => (a && b ? Math.abs((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / dayMs) : Infinity);
const num = (v) => {
  if (v == null || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,\s₪]/g, '').replace(/^\((.*)\)$/, '-$1'));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n) => Math.round(n * 100) / 100;

/**
 * Their rows and our lines as events. perspective: 'supplier' (their statement of us as their customer) or 'customer'.
 * theirs rows: { date, reference, description, debit, credit }; ours lines: { date, reference, description, type, debit, credit } (ledger).
 */
export function toEvents(rows, side, perspective) {
  const out = [];
  for (const [i, r] of (rows || []).entries()) {
    const debit = Math.abs(num(r.debit)), credit = Math.abs(num(r.credit));
    if (!debit && !credit) continue;
    // which column is the charge
    const chargeIsDebit = side === 'theirs' ? perspective === 'supplier' : perspective === 'customer';
    const push = (kind, amount) => amount > 0 && out.push({ i, side, kind, amount: r2(amount), date: r.date || null, reference: r.reference ?? r.docNumber ?? null, text: r.description ?? r.details ?? null, type: r.type ?? null, row: r });
    push(chargeIsDebit ? 'charge' : 'payment', debit);
    push(chargeIsDebit ? 'payment' : 'charge', credit);
  }
  return out;
}

/**
 * @param {object} theirs  { perspective: 'supplier'|'customer', rows, openingBalance?, closingBalance?, from?, to? }
 * @param {object} ours    { lines (ledger rows), openingBalance, closingBalance }  (balance: debit is plus)
 * @param {object} o       { tolerance = 0.05, days = 45 }
 */
export function compareStatements(theirs, ours, { tolerance = 0.05, days = 45 } = {}) {
  const perspective = theirs.perspective === 'customer' ? 'customer' : 'supplier';
  const T = toEvents(theirs.rows, 'theirs', perspective);
  const O = toEvents(ours.lines, 'ours', perspective);
  const usedT = new Set(), usedO = new Set();
  const matched = [];
  const same = (a, b) => a.kind === b.kind && Math.abs(a.amount - b.amount) <= tolerance + 1e-9;
  const pass = (how, ok, rank) => {
    for (const [ti, t] of T.entries()) {
      if (usedT.has(ti)) continue;
      const cands = O.map((o, oi) => [o, oi]).filter(([o, oi]) => !usedO.has(oi) && same(t, o) && ok(t, o));
      if (!cands.length) continue;
      cands.sort(([a], [b]) => rank(t, a) - rank(t, b));
      const [o, oi] = cands[0];
      usedT.add(ti);
      usedO.add(oi);
      matched.push({ theirs: t, ours: o, how });
    }
  };
  pass('amount and number', (t, o) => referenceFits(t.reference, o.reference), (t, a) => gap(t.date, a.date));
  pass(`amount and date (${days} days)`, (t, o) => gap(t.date, o.date) <= days, (t, a) => gap(t.date, a.date));
  const countT = new Map(), countO = new Map();
  for (const e of T) countT.set(`${e.kind}|${e.amount.toFixed(2)}`, (countT.get(`${e.kind}|${e.amount.toFixed(2)}`) || 0) + 1);
  for (const e of O) countO.set(`${e.kind}|${e.amount.toFixed(2)}`, (countO.get(`${e.kind}|${e.amount.toFixed(2)}`) || 0) + 1);
  pass('amount, a one-off (another date)', (t) => countT.get(`${t.kind}|${t.amount.toFixed(2)}`) === 1 && countO.get(`${t.kind}|${t.amount.toFixed(2)}`) === 1, (t, a) => gap(t.date, a.date));
  // leftovers: the number fits with another amount
  const amountDiffers = [];
  for (const [ti, t] of T.entries()) {
    if (usedT.has(ti)) continue;
    const cands = O.map((o, oi) => [o, oi]).filter(([o, oi]) => !usedO.has(oi) && o.kind === t.kind && referenceFits(t.reference, o.reference) && gap(t.date, o.date) <= days * 2);
    if (!cands.length) continue;
    cands.sort(([a], [b]) => gap(t.date, a.date) - gap(t.date, b.date));
    const [o, oi] = cands[0];
    usedT.add(ti);
    usedO.add(oi);
    amountDiffers.push({ theirs: t, ours: o, difference: r2(t.amount - o.amount) });
  }
  const strip = (e) => ({ date: e.date, reference: e.reference, description: e.text, kind: e.kind, amount: e.amount, ...(e.type ? { type: e.type } : {}) });
  const onlyTheirs = T.filter((_, i) => !usedT.has(i)).map(strip);
  const onlyOurs = O.filter((_, i) => !usedO.has(i)).map(strip);
  const sum = (xs, kind) => r2(xs.filter((x) => x.kind === kind).reduce((a, x) => a + x.amount, 0));
  // balances as "the debt": supplier → what we owe them; customer → what they owe us
  const theirsClosing = theirs.closingBalance == null ? null : r2(num(theirs.closingBalance));
  const oursDebt = ours.closingBalance == null ? null : r2(perspective === 'supplier' ? -num(ours.closingBalance) : num(ours.closingBalance));
  // the differences explain the gap: their extra charges raise their debt figure, their extra payments lower it, and the reverse for ours
  const explained = r2(sum(onlyTheirs, 'charge') - sum(onlyTheirs, 'payment') - sum(onlyOurs, 'charge') + sum(onlyOurs, 'payment') + amountDiffers.reduce((a, d) => a + (d.theirs.kind === 'charge' ? d.difference : -d.difference), 0));
  return {
    perspective,
    debt: perspective === 'supplier' ? 'what we owe them' : 'what they owe us',
    counts: { theirs: T.length, ours: O.length, matched: matched.length, onlyTheirs: onlyTheirs.length, onlyOurs: onlyOurs.length, amountDiffers: amountDiffers.length },
    balance: {
      theirs: theirsClosing,
      ours: oursDebt,
      difference: theirsClosing == null || oursDebt == null ? null : r2(theirsClosing - oursDebt),
      explainedByDifferences: explained,
      unexplained: theirsClosing == null || oursDebt == null ? null : r2(theirsClosing - oursDebt - explained),
    },
    onlyTheirs,
    onlyOurs,
    amountDiffers: amountDiffers.map((d) => ({ theirs: strip(d.theirs), ours: strip(d.ours), difference: d.difference })),
    matchedHow: matched.reduce((m, x) => ((m[x.how] = (m[x.how] || 0) + 1), m), {}),
    totals: { onlyTheirs: { charges: sum(onlyTheirs, 'charge'), payments: sum(onlyTheirs, 'payment') }, onlyOurs: { charges: sum(onlyOurs, 'charge'), payments: sum(onlyOurs, 'payment') } },
  };
}
