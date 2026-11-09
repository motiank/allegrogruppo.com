// The rows of an answer's results as sheet tabs (owner 2026-11-09: "put it in a file, don't show it in the chat").
// Pure: used by services/sheets.js to build the Google Sheet and by test/test_joya_lib.mjs.
//
// A calculation result is a tree (companies[].rows, channels[].companies[].rows, locations[].months, total[]…). Every
// list of objects in it becomes one tab: the header = the keys in the order they first appear (an object inside a row
// is flattened to "key.sub"; a list inside a row is written as text), one row per object. Lists of warnings and
// of plain values are not tabs. The biggest tab comes first. Tab names come from the path and the names on the
// way ("pastaLina · rows"), cut to Google's 100 / Excel's 31 characters and made unique.

const SKIP_KEYS = new Set(['warnings', 'codes', 'statuses', 'rules', 'sources', 'notLoaded', 'otherChannels', 'params']);
const NAME_KEYS = ['company', 'companyKey', 'name', 'title', 'channel', 'account', 'location', 'month', 'kind'];
const MAX_TAB = 31;

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const isRowList = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => isObj(x));

/** A row's cells: nested objects → "a.b" keys (2 levels), lists → text, dates stay strings. */
export function flattenRow(row, prefix = '', depth = 0) {
  const out = {};
  for (const [k, v] of Object.entries(row || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isObj(v) && depth < 3 && Object.keys(v).length <= 40) Object.assign(out, flattenRow(v, key, depth + 1));
    else if (Array.isArray(v)) out[key] = v.length ? v.map((x) => (isObj(x) ? JSON.stringify(x) : String(x))).join('; ') : null;
    else if (isObj(v)) out[key] = JSON.stringify(v);
    else out[key] = v === undefined ? null : v;
  }
  return out;
}

const labelOf = (o) => {
  for (const k of NAME_KEYS) {
    const v = o?.[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (isObj(v) && typeof v.name === 'string') return v.name;
  }
  return null;
};

/**
 * @param {object[]} results  [{ calc, params, result }] as the hub computed them
 * @param {string[]} [only]   the columns the user asked for, in their order (a name that no tab has is ignored)
 * @returns {{ name, calc, path, columns: string[], rows: object[] }[]}  the tabs, biggest first
 */
export function tabsOf(results, only = null) {
  const tabs = [];
  const walk = (node, path, labels, calc) => {
    if (isRowList(node)) {
      const rows = node.map((r) => flattenRow(r));
      const columns = [];
      for (const r of rows) for (const k of Object.keys(r)) if (!columns.includes(k)) columns.push(k);
      // a row list whose rows hold their own row lists (channels[].companies[]) is a container, not a table
      const inner = node.some((r) => Object.values(r).some((v) => isRowList(v)));
      if (!inner) {
        tabs.push({ calc, path: path.join('.'), labels: labels.filter(Boolean), columns, rows });
        return;
      }
      node.forEach((r, i) => walk(r, [...path, String(i)], [...labels, labelOf(r)], calc));
      return;
    }
    if (!isObj(node)) return;
    for (const [k, v] of Object.entries(node)) {
      if (SKIP_KEYS.has(k)) continue;
      if (isRowList(v) || isObj(v)) walk(v, [...path, k], [...labels, isObj(v) ? labelOf(v) : null], calc);
    }
  };
  for (const r of results || []) if (r && r.result && !r.error) walk(r.result, [], [], r.calc);
  // no row list anywhere (a result of single numbers: a balance, a VAT total…) → one key / value tab per calculation,
  // so any data can go into a sheet (owner 2026-11-09)
  if (!tabs.length) {
    for (const r of results || []) {
      if (!r || !r.result || r.error || !isObj(r.result)) continue;
      const flat = flattenRow(r.result);
      const rows = Object.entries(flat).filter(([k]) => !SKIP_KEYS.has(k.split('.')[0])).map(([key, value]) => ({ key, value }));
      if (rows.length) tabs.push({ calc: r.calc, path: '', labels: [r.calc], columns: ['key', 'value'], rows });
    }
  }
  if (Array.isArray(only) && only.length) {
    for (const t of tabs) {
      const keep = only.map((k) => String(k)).filter((k) => t.columns.includes(k));
      if (keep.length) t.columns = keep;
    }
  }
  tabs.sort((a, b) => b.rows.length - a.rows.length);
  const used = new Set();
  for (const t of tabs) {
    const last = t.path.split('.').pop();
    const base = [...new Set([...t.labels, last === 'rows' ? null : last].filter(Boolean))].join(' · ') || t.calc || 'rows';
    let name = cleanName(base);
    let i = 2;
    while (used.has(name)) name = cleanName(`${base} ${i++}`);
    used.add(name);
    t.name = name;
    delete t.labels;
  }
  return tabs;
}

/** A sheet tab name Excel accepts: no []:*?/\, at most 31 characters, not empty. */
export function cleanName(s) {
  const t = String(s || '').replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim();
  return (t || 'rows').slice(0, MAX_TAB).trim();
}

/** A YYYY-MM-DD (optionally with a time) → a Date for a date cell; anything else null. */
export function cellDate(v) {
  const m = typeof v === 'string' && /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2})?)?/.exec(v);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}
