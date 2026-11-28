// The bank lines page (owner 2026-11-28: "a bank page with the ability to filter by name (details), type of action and an
// extended date filter; add a total to the in and out columns when filtered"). Pure: the action facets and the totals of a
// list of stored bank rows. Shared by the server (src/services/bank.js bankLines) and the tests; no DOM, no DB.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const norm = (s) => String(s ?? '').trim();
/** The action TYPE of a row: the bank's action without its value-date suffix ("תיקון (תאריך ערך: 11/11)" → "תיקון"); empty = "—". */
export const actionKey = (action) => norm(action).replace(/\s*\(תאריך ערך:[^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim() || '—';

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
    const k = actionKey(r.action);
    if (!by.has(k)) by.set(k, { action: k, count: 0, moneyIn: 0, moneyOut: 0 });
    const f = by.get(k);
    f.count++;
    f.moneyIn += Number(r.moneyIn) || 0;
    f.moneyOut += Number(r.moneyOut) || 0;
  }
  return [...by.values()].map((f) => ({ ...f, moneyIn: r2(f.moneyIn), moneyOut: r2(f.moneyOut) })).sort((a, b) => b.count - a.count || (a.action === '—') - (b.action === '—') || a.action.localeCompare(b.action, 'he')); // the empty action last among equals
}

/** The NAME of a row (the details column's filter, owner 2026-11-28): the payee when known, else the bank's details text, else "—". */
export const nameKey = (r) => norm(r?.payee) || norm(r?.event?.payee) || norm(r?.details).replace(/^(לטובת|המבצע|עבור):\s*/, '') || '—';

/** The names of the rows, most frequent first: [{ name, count, moneyIn, moneyOut }]. */
export function nameFacets(rows) {
  const by = new Map();
  for (const r of rows || []) {
    const k = nameKey(r);
    if (!by.has(k)) by.set(k, { name: k, count: 0, moneyIn: 0, moneyOut: 0 });
    const f = by.get(k);
    f.count++;
    f.moneyIn += Number(r.moneyIn) || 0;
    f.moneyOut += Number(r.moneyOut) || 0;
  }
  return [...by.values()].map((f) => ({ ...f, moneyIn: r2(f.moneyIn), moneyOut: r2(f.moneyOut) })).sort((a, b) => b.count - a.count || (a.name === '—') - (b.name === '—') || a.name.localeCompare(b.name, 'he'));
}

const asSet = (v) => (v == null ? null : v instanceof Set ? (v.size ? v : null) : Array.isArray(v) ? (v.length ? new Set(v) : null) : null);

/**
 * The rows that match the filters: q = words in the action, details, payee or reference (every word); action = one type
 * exactly; actions / names = sets of allowed types / names (the header filters; empty = no filter); side = in | out.
 */
export function filterLines(rows, { q = null, action = null, actions = null, names = null, side = null } = {}) {
  const words = norm(q).toLowerCase().split(/\s+/).filter(Boolean);
  const act = norm(action);
  const actSet = asSet(actions);
  const nameSet = asSet(names);
  return (rows || []).filter((r) => {
    if (act && actionKey(r.action) !== act) return false;
    if (actSet && !actSet.has(actionKey(r.action))) return false;
    if (nameSet && !nameSet.has(nameKey(r))) return false;
    if (side === 'in' && !(Number(r.moneyIn) > 0)) return false;
    if (side === 'out' && !(Number(r.moneyOut) > 0)) return false;
    if (words.length) {
      const hay = [r.action, r.details, r.payee, r.payeePurpose, r.reference, r.event?.payee].filter(Boolean).join(' ').toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}
