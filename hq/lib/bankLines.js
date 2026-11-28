// The bank lines page (owner 2026-11-28: "a bank page with the ability to filter by name (details), type of action and an
// extended date filter; add a total to the in and out columns when filtered"). Pure: the action facets and the totals of a
// list of stored bank rows. Shared by the server (src/services/bank.js bankLines) and the tests; no DOM, no DB.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const norm = (s) => String(s ?? '').trim();

/** The sums of a list: { count, moneyIn, moneyOut, net } (net = in − out). */
export function totalsOf(rows) {
  let moneyIn = 0;
  let moneyOut = 0;
  for (const r of rows || []) {
    moneyIn += Number(r.moneyIn) || 0;
    moneyOut += Number(r.moneyOut) || 0;
  }
  return { count: (rows || []).length, moneyIn: r2(moneyIn), moneyOut: r2(moneyOut), net: r2(moneyIn - moneyOut) };
}

/** The action types of the rows, most frequent first: [{ action, count, moneyIn, moneyOut }] (the empty action = "—"). */
export function actionFacets(rows) {
  const by = new Map();
  for (const r of rows || []) {
    const k = norm(r.action) || '—';
    if (!by.has(k)) by.set(k, { action: k, count: 0, moneyIn: 0, moneyOut: 0 });
    const f = by.get(k);
    f.count++;
    f.moneyIn += Number(r.moneyIn) || 0;
    f.moneyOut += Number(r.moneyOut) || 0;
  }
  return [...by.values()].map((f) => ({ ...f, moneyIn: r2(f.moneyIn), moneyOut: r2(f.moneyOut) })).sort((a, b) => b.count - a.count || (a.action === '—') - (b.action === '—') || a.action.localeCompare(b.action, 'he')); // the empty action last among equals
}

/** The rows that match the filters (q = words in the action, details, payee or reference — every word; action = exactly; side = in | out). */
export function filterLines(rows, { q = null, action = null, side = null } = {}) {
  const words = norm(q).toLowerCase().split(/\s+/).filter(Boolean);
  const act = norm(action);
  return (rows || []).filter((r) => {
    if (act && (norm(r.action) || '—') !== act) return false;
    if (side === 'in' && !(Number(r.moneyIn) > 0)) return false;
    if (side === 'out' && !(Number(r.moneyOut) > 0)) return false;
    if (words.length) {
      const hay = [r.action, r.details, r.payee, r.payeePurpose, r.reference, r.event?.payee].filter(Boolean).join(' ').toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}
