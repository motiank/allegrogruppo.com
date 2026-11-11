// Fixed files in the owner's Drive folder — one Google Sheet per key, the SAME file every time, rewritten ON DEMAND
// (owner 2026-11-11: "merge into one table the Priority and Hashavshevet cheques, create an Excel on the Drive and
// give the link; a fixed file that is updated all the time" — then: "no schedule and no service for that: upon
// demand. If I ask to see future cheques, Joya updates the file and provides the link"). The link and the last
// refresh are kept in joya_settings ("fixedSheets").
//
// Keys today: cheques = every cheque of the company (Finance API /cheques/all: Hashavshevet's cheques module +
// the Priority file, one row per cheque, with the day the bank paid it), one tab per finance company.
import { finance, financeCompanies } from './source.js';
import { sheetsUnavailable, workbookFromTabs, upsertFixedSheet } from './sheets.js';
import { getConfig, updateConfig, err } from '../db.js';

const SETTING = 'fixedSheets';
const SOURCE_HE = { hashavshevet: 'חשבשבת', priority: 'פריוריטי', both: 'חשבשבת + פריוריטי' };
const STATE_HE = { future: 'עתידי', cleared: 'נפרע', not_cleared: 'לא נפרע' };

/** The columns of the cheques tab, in order (Hebrew headers: the owner reads the sheet). */
export const CHEQUE_COLUMNS = ["מס' שיק", 'מוטב', 'סכום', 'תאריך פרעון', 'תאריך הוצאה', 'מצב', 'נפרע בבנק', 'מקור', 'חשבון בחשבשבת', 'שם החשבון', 'חשבון ספק (פריוריטי)', "מס' תשלום (פריוריטי)", 'לפני ניכוי', 'ניכוי מס', 'חשבוניות', 'פרטים'];

/** One row of /cheques/all → the Hebrew row of the sheet. */
export function chequeRowHe(x) {
  return {
    "מס' שיק": x.cheque ?? null, 'מוטב': x.payee ?? null, 'סכום': x.amount ?? null, 'תאריך פרעון': x.dueDate ?? null, 'תאריך הוצאה': x.issueDate ?? null,
    'מצב': STATE_HE[x.state] || x.state || null, 'נפרע בבנק': x.bankDate ?? null, 'מקור': SOURCE_HE[x.source] || x.source || null,
    'חשבון בחשבשבת': x.account ?? null, 'שם החשבון': x.accountName ?? null, 'חשבון ספק (פריוריטי)': x.supplierAccount ?? null, "מס' תשלום (פריוריטי)": x.priorityPayment ?? null,
    'לפני ניכוי': x.grossAmount ?? null, 'ניכוי מס': x.withholding || null, 'חשבוניות': x.invoices ?? null, 'פרטים': x.details ?? null,
  };
}

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const dmy = (d) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '');
const my = (m) => `${m.slice(5, 7)}.${m.slice(0, 4)}`;
export const SUMMARY_COLUMNS = ['חודש', 'שיקים', 'סכום', 'מזה עתידיים', 'מזה נפרעו', 'מזה לא נפרעו'];

/**
 * The tabs of the cheques file (owner 2026-11-11: "a sheet per month, grouped by day, and a month total"): first a
 * summary tab (one line per month), then one tab per month — the cheques of each due date, a bold sum row after each
 * day, a shaded total row for the month. Months after the end of next year are one tab per YEAR (the books carry a
 * monthly series to 2036; one tab each would be 140 tabs). `prefix` names the company when the file has several.
 */
export function chequeTabs(rows, { today, prefix = '' } = {}) {
  const yearTabsFrom = `${Number(String(today).slice(0, 4)) + 2}`; // 2026 → months of 2026 and 2027 one by one, 2028+ per year
  const groups = new Map(); // tab key → rows
  for (const x of rows) {
    const d = x.dueDate || '';
    const k = !d ? 'ללא תאריך' : d.slice(0, 4) >= yearTabsFrom ? d.slice(0, 4) : d.slice(0, 7);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(x);
  }
  const keys = [...groups.keys()].sort();
  const summary = [];
  const tabs = [];
  const grand = { n: 0, amount: 0, future: 0, cleared: 0, not_cleared: 0 };
  for (const k of keys) {
    const list = groups.get(k).slice().sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')) || (a.cheque ?? 0) - (b.cheque ?? 0));
    const out = [];
    let day = null, dayN = 0, daySum = 0, n = 0, sum = 0;
    const byState = { future: 0, cleared: 0, not_cleared: 0 };
    const flushDay = () => { if (day != null && dayN) out.push({ 'מוטב': `סה״כ ${dmy(day)} – ${dayN} שיקים`, 'סכום': r2(daySum), _style: 'total' }); };
    for (const x of list) {
      if (x.dueDate !== day) { flushDay(); day = x.dueDate; dayN = 0; daySum = 0; }
      out.push(chequeRowHe(x));
      dayN += 1; daySum += x.amount || 0; n += 1; sum += x.amount || 0;
      byState[x.state] = (byState[x.state] || 0) + (x.amount || 0);
    }
    flushDay();
    const label = /^\d{4}-\d{2}$/.test(k) ? my(k) : k;
    out.push({ 'מוטב': `סה״כ ${label} – ${n} שיקים`, 'סכום': r2(sum), _style: 'grand' });
    tabs.push({ name: `${prefix}${k}`.slice(0, 31), columns: CHEQUE_COLUMNS, rows: out });
    summary.push({ 'חודש': label, 'שיקים': n, 'סכום': r2(sum), 'מזה עתידיים': r2(byState.future), 'מזה נפרעו': r2(byState.cleared), 'מזה לא נפרעו': r2(byState.not_cleared) });
    grand.n += n; grand.amount += sum; grand.future += byState.future; grand.cleared += byState.cleared; grand.not_cleared += byState.not_cleared;
  }
  summary.push({ 'חודש': 'סה״כ', 'שיקים': grand.n, 'סכום': r2(grand.amount), 'מזה עתידיים': r2(grand.future), 'מזה נפרעו': r2(grand.cleared), 'מזה לא נפרעו': r2(grand.not_cleared), _style: 'grand' });
  return [{ name: `${prefix}סיכום`.slice(0, 31), columns: SUMMARY_COLUMNS, rows: summary }, ...tabs];
}

async function buildCheques() {
  const fc = await financeCompanies();
  if (!fc.available) throw Object.assign(new Error(fc.reason || 'the Finance API is not available'), { code: 'NO_ROWS' });
  const today = new Date().toISOString().slice(0, 10);
  const loaded = [];
  for (const co of fc.companies) {
    const r = await finance('/cheques/all', { company: co.code, limit: 5000 });
    if (r.available && r.data?.length) loaded.push({ co, r });
  }
  if (!loaded.length) throw Object.assign(new Error('no cheques to put in the file (no finance company loaded)'), { code: 'NO_ROWS' });
  const tabs = [];
  const counts = {};
  const about = [];
  let dataUpTo = null;
  for (const { co, r } of loaded) {
    const label = co.allegroLabel || co.name || co.code;
    tabs.push(...chequeTabs(r.data, { today, prefix: loaded.length > 1 ? `${label.slice(0, 10)} ` : '' }));
    counts[co.code] = { ...r.meta.counts, totals: r.meta.totals };
    dataUpTo = r.meta.sync?.dataUpTo ?? dataUpTo;
    about.push([label, `${r.meta.counts.total} שיקים: חשבשבת ${r.meta.counts.hashavshevet}, פריוריטי ${r.meta.counts.priority}, בשניהם ${r.meta.counts.both}; נפרעו בבנק ${r.meta.counts.bankPaid}`]);
  }
  about.push(['מבנה', 'גיליון "סיכום" (שורה לחודש), ואז גיליון לכל חודש: השיקים לפי יום, שורת סה״כ אחרי כל יום, וסה״כ לחודש בסוף; מ-2028 גיליון לשנה']);
  return { tabs, counts, dataUpTo, about };
}

/** The fixed files: name = the file's name in Drive, build() = { tabs, counts, dataUpTo, about }. */
export const FIXED_SHEETS = {
  cheques: {
    name: 'שיקים – חשבשבת + פריוריטי · Joya',
    about: 'every cheque of the company in one table: Hashavshevet (the cheques module) and the Priority history, one row per cheque, with the day the bank paid it',
    build: buildCheques,
  },
};

/** The record kept for a key: { kind, fixed, key, id, url, name, rows, tabs, counts, dataUpTo, updatedAt, error }, or a stub when it was never made. */
export async function fixedSheetInfo(key) {
  const def = FIXED_SHEETS[key];
  if (!def) throw err('NOT_FOUND', `no fixed file "${key}"`);
  const all = await getConfig(SETTING, {});
  const rec = all[key] || null;
  return { key, name: def.name, about: def.about, unavailable: sheetsUnavailable(), ...(rec || { made: false, note: 'the file was not made yet' }) };
}

/**
 * The record for an answer: the file rebuilt now; when the rebuild fails, the last good record with the error, so the
 * chat still has a link. → { ...record, fixedFile } where fixedFile is what compute() puts under the answer.
 */
export async function refreshForAnswer(key, { by } = {}) {
  let rec;
  try {
    rec = await refreshFixedSheet(key, { by });
  } catch (e) {
    rec = { ...(await fixedSheetInfo(key)), error: { code: e.code || 'ERROR', message: e.message } };
  }
  const { url, id, ...rest } = rec;
  const fixedFile = rec.made ? { kind: 'sheet', fixed: true, id, url, name: rec.name, rows: rec.rows, tabs: rec.tabs, updatedAt: rec.updatedAt, createdAt: rec.updatedAt } : null;
  return { ...rest, fixedFile };
}

/** Rebuilds the file and replaces it in Drive (same link). The record is saved even when it fails (last good link + error). */
export async function refreshFixedSheet(key, { by = 'joya' } = {}) {
  const def = FIXED_SHEETS[key];
  if (!def) throw err('NOT_FOUND', `no fixed file "${key}"`);
  const t0 = Date.now();
  try {
    const why = sheetsUnavailable();
    if (why) throw Object.assign(new Error(why), { code: 'FILE_UNAVAILABLE' });
    const built = await def.build();
    const { buffer, rows } = await workbookFromTabs(built.tabs, { he: true, about: [['קובץ', def.name], ['עודכן', new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC'], ['נתוני חשבשבת עד', built.dataUpTo || ''], ...built.about, ['מקור', 'Joya HQ — הקובץ מתעדכן אוטומטית; אל תערכו אותו, השינויים יידרסו']] });
    const up = await upsertFixedSheet({ key, name: def.name, buffer });
    const rec = {
      kind: 'sheet', fixed: true, made: true, key, id: up.id, url: up.url, name: up.name, rows, tabs: built.tabs.map((t) => ({ name: t.name, rows: t.rows.length })),
      counts: built.counts, dataUpTo: built.dataUpTo, updatedAt: new Date().toISOString(), updatedBy: by, ms: Date.now() - t0, error: null,
    };
    await updateConfig(SETTING, {}, by, (cur) => ({ ...cur, [key]: rec }));
    return { key, name: def.name, about: def.about, unavailable: null, ...rec };
  } catch (e) {
    const error = { at: new Date().toISOString(), code: e.code || 'ERROR', message: e.message };
    await updateConfig(SETTING, {}, by, (cur) => ({ ...cur, [key]: { ...(cur[key] || { made: false }), error } })).catch(() => {});
    throw e;
  }
}
