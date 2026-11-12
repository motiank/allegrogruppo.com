// Fixed files in the owner's Drive folder — one Google Sheet per key, the SAME file every time, rewritten ON DEMAND
// (owner 2026-11-11: "merge into one table the Priority and Hashavshevet cheques, create an Excel on the Drive and
// give the link; a fixed file that is updated all the time" — then: "no schedule and no service for that: upon
// demand. If I ask to see future cheques, Joya updates the file and provides the link"). The link and the last
// refresh are kept in joya_settings ("fixedSheets").
//
// Keys today: cheques = the cheques (שיקים לפרעון) of the window the user asked for — by default the start of this
// month to the end of the third month ahead (owner: "display according to the user request, 3 months by default, only"
// — not the history; 2026-11-12: "always from the start of the current month") — from the Finance API /cheques/all
// (Hashavshevet's cheques module + the Priority file, one row per cheque), a tab per month, and since 2026-11-12 the
// bank balance at the end of each day: real up to the last bank day (green), expected after it (red).
import { financeCompanies } from './source.js';
import { futureChequesRange, futureChequesData } from './finance.js';
import { sheetsUnavailable, workbookFromTabs, upsertFixedSheet } from './sheets.js';
import { getConfig, updateConfig, err } from '../db.js';

const SETTING = 'fixedSheets';
const SOURCE_HE = { hashavshevet: 'חשבשבת', priority: 'פריוריטי', both: 'חשבשבת + פריוריטי' };
const STATE_HE = { future: 'עתידי', cleared: 'נפרע', not_cleared: 'לא נפרע' };
const BALANCE_SOURCE_HE = { bank_file: 'קובץ הבנק', hashavshevet: 'חשבשבת' };

/** The columns of the cheques tab, in order (Hebrew headers: the owner reads the sheet). יתרה = the bank balance at the end of the day, on the day's sum row. */
export const CHEQUE_COLUMNS = ["מס' שיק", 'מוטב', 'סכום', 'יתרה', 'תאריך פרעון', 'תאריך הוצאה', 'מצב', 'נפרע בבנק', 'מקור', 'חשבון בחשבשבת', 'שם החשבון', 'חשבון ספק (פריוריטי)', "מס' תשלום (פריוריטי)", 'לפני ניכוי', 'ניכוי מס', 'חשבוניות', 'פרטים'];

/** One row of /cheques/all → the Hebrew row of the sheet. */
export function chequeRowHe(x) {
  return {
    "מס' שיק": x.cheque ?? null, 'מוטב': x.payee ?? null, 'סכום': x.amount ?? null, 'יתרה': null, 'תאריך פרעון': x.dueDate ?? null, 'תאריך הוצאה': x.issueDate ?? null,
    'מצב': STATE_HE[x.state] || x.state || null, 'נפרע בבנק': x.bankDate ?? null, 'מקור': SOURCE_HE[x.source] || x.source || null,
    'חשבון בחשבשבת': x.account ?? null, 'שם החשבון': x.accountName ?? null, 'חשבון ספק (פריוריטי)': x.supplierAccount ?? null, "מס' תשלום (פריוריטי)": x.priorityPayment ?? null,
    'לפני ניכוי': x.grossAmount ?? null, 'ניכוי מס': x.withholding || null, 'חשבוניות': x.invoices ?? null, 'פרטים': x.details ?? null,
  };
}

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const dmy = (d) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '');
const my = (m) => `${m.slice(5, 7)}.${m.slice(0, 4)}`;
export const SUMMARY_COLUMNS = ['חודש', 'שיקים', 'סכום', 'מזה פריוריטי', 'תשלומים מתוכננים', 'יתרה בסוף החודש'];
const TONE = { actual: 'actual', expected: 'expected' };

/**
 * The tabs of the cheques file (owner 2026-11-11: "a sheet per month, grouped by day, and a month total"; 2026-11-12:
 * the bank balance at the end of each day, green = real, red = expected): first a summary tab (one line per month:
 * cheques, amount, of which Priority, planned payments, the balance at the month's end), then one tab per month — the
 * cheques of each due date (and Joya's planned payments, "העברה"), a bold sum row after each day with the day's
 * balance in the column יתרה (row tone actual / expected → green / red in the sheet), a shaded total row for the
 * month. A bank day without cheques is a sum row alone, so the real balance of every day is seen. Months after the end
 * of next year are one tab per YEAR (a long window would otherwise make a tab for every month of a series that runs
 * to 2036). `byDay` = chequesByDay(...) with balances (finance.js); without it the tabs have no balance. `prefix`
 * names the company when the file has several.
 */
export function chequeTabs(rows, { today, prefix = '', byDay = null } = {}) {
  const yearTabsFrom = `${Number(String(today).slice(0, 4)) + 2}`; // 2026 → months of 2026 and 2027 one by one, 2028+ per year
  const tabKey = (d) => (!d || d === 'no date' ? 'ללא תאריך' : d.slice(0, 4) >= yearTabsFrom ? d.slice(0, 4) : d.slice(0, 7));
  const dayInfo = new Map((byDay || []).map((d) => [d.dueDate, d]));
  const groups = new Map(); // tab key → rows
  for (const x of rows) {
    const k = tabKey(x.dueDate);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(x);
  }
  for (const d of byDay || []) if (!groups.has(tabKey(d.dueDate))) groups.set(tabKey(d.dueDate), []); // bank days / payments without cheques
  const keys = [...groups.keys()].sort();
  const summary = [];
  const tabs = [];
  const grand = { n: 0, amount: 0, priority: 0, payments: 0 };
  for (const k of keys) {
    const list = groups.get(k).slice().sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')) || (a.cheque ?? 0) - (b.cheque ?? 0));
    // every day of the tab: the cheques' days and the days byDay knows (bank days, payments)
    const dayKeys = [...new Set([...list.map((x) => x.dueDate || 'no date'), ...[...dayInfo.keys()].filter((d) => tabKey(d) === k)])].sort();
    const out = [];
    let n = 0, sum = 0, priority = 0, payments = 0, lastBalance = null;
    for (const day of dayKeys) {
      const info = dayInfo.get(day) || null;
      const cheques = list.filter((x) => (x.dueDate || 'no date') === day);
      for (const x of cheques) {
        out.push(chequeRowHe(x));
        n += 1; sum += x.amount || 0;
        if (x.source === 'priority') priority += x.amount || 0;
      }
      for (const p of info?.payments || []) {
        out.push({ ...chequeRowHe({}), "מס' שיק": 'העברה', 'מוטב': p.payee, 'סכום': p.amount, 'תאריך פרעון': day, 'מצב': 'תשלום מתוכנן', 'מקור': 'Joya – תשלומים', 'פרטים': p.window ? `שבוע ${p.window}` : null });
        payments += p.amount || 0;
      }
      const daySum = r2(cheques.reduce((s, x) => s + (x.amount || 0), 0) + (info?.paymentsAmount || 0));
      const parts = [cheques.length ? `${cheques.length} שיקים` : null, info?.payments?.length ? `${info.payments.length} תשלומים` : null].filter(Boolean).join(' + ');
      const label = day === 'no date' ? 'ללא תאריך' : dmy(day);
      const bal = info?.balance || null;
      if (bal) lastBalance = bal;
      out.push({ 'מוטב': parts ? `סה״כ ${label} – ${parts}` : `${label} – יום בנק ללא שיקים`, 'סכום': parts ? daySum : null, 'יתרה': bal ? bal.amount : null, _style: 'total', ...(bal ? { _tone: TONE[bal.kind] } : {}) });
    }
    const label = /^\d{4}-\d{2}$/.test(k) ? my(k) : k;
    out.push({ 'מוטב': `סה״כ ${label} – ${n} שיקים${payments ? ' + תשלומים' : ''}`, 'סכום': r2(sum + payments), 'יתרה': lastBalance ? lastBalance.amount : null, _style: 'grand', ...(lastBalance ? { _tone: TONE[lastBalance.kind] } : {}) });
    tabs.push({ name: `${prefix}${k}`.slice(0, 31), columns: CHEQUE_COLUMNS, rows: out });
    summary.push({ 'חודש': label, 'שיקים': n, 'סכום': r2(sum), 'מזה פריוריטי': r2(priority), 'תשלומים מתוכננים': r2(payments), 'יתרה בסוף החודש': lastBalance ? lastBalance.amount : null, ...(lastBalance ? { _tone: TONE[lastBalance.kind] } : {}) });
    grand.n += n; grand.amount += sum; grand.priority += priority; grand.payments += payments;
  }
  summary.push({ 'חודש': 'סה״כ', 'שיקים': grand.n, 'סכום': r2(grand.amount), 'מזה פריוריטי': r2(grand.priority), 'תשלומים מתוכננים': r2(grand.payments), 'יתרה בסוף החודש': null, _style: 'grand' });
  return [{ name: `${prefix}סיכום`.slice(0, 31), columns: SUMMARY_COLUMNS, rows: summary }, ...tabs];
}

/** The window of the file: the user's dates, else the default of the future cheques (the start of this month → the end of the third month). */
export function chequesWindow({ from, to } = {}, today = new Date().toISOString().slice(0, 10)) {
  if (from || to) return { from: from || today, to: to || null, defaultRange: false };
  return { ...futureChequesRange(today), defaultRange: true };
}

async function buildCheques(opts = {}) {
  const fc = await financeCompanies();
  if (!fc.available) throw Object.assign(new Error(fc.reason || 'the Finance API is not available'), { code: 'NO_ROWS' });
  const today = new Date().toISOString().slice(0, 10);
  const window = chequesWindow(opts, today);
  const loaded = [];
  for (const co of fc.companies) {
    const r = await futureChequesData({ financeCode: co.code, companyKey: co.allegroKey }, { from: window.from, to: window.to || null, today });
    if (r.available) loaded.push({ co, r });
  }
  if (!loaded.length) throw Object.assign(new Error('no finance company loaded'), { code: 'NO_ROWS' });
  const tabs = [];
  const counts = {};
  const about = [];
  let dataUpTo = null;
  for (const { co, r } of loaded) {
    const label = co.allegroLabel || co.name || co.code;
    const rows = r.rows.map((x) => ({ ...x, cheque: x.reference })); // chequeRowHe reads the admin's names
    tabs.push(...chequeTabs(rows, { today, prefix: loaded.length > 1 ? `${label.slice(0, 10)} ` : '', byDay: r.byDay }));
    const bySource = rows.reduce((m, x) => ((m[x.source] = (m[x.source] || 0) + 1), m), {});
    const b = r.balance;
    counts[co.code] = {
      total: rows.length, hashavshevet: bySource.hashavshevet || 0, priority: bySource.priority || 0, both: bySource.both || 0, amount: r2(rows.reduce((s, x) => s + (x.amount || 0), 0)),
      paid: r.totals.paid, due: r.totals.due, future: r.totals.future, payments: r.payments.length,
      balance: b.lastActual ? { lastActual: b.lastActual, expectedEnd: b.expectedEnd, lowest: b.lowest } : null,
    };
    dataUpTo = r.meta.sync?.dataUpTo ?? dataUpTo;
    about.push([label, `${rows.length} שיקים בתקופה, ${counts[co.code].amount} ₪: חשבשבת ${counts[co.code].hashavshevet}, פריוריטי ${counts[co.code].priority}; נפרעו ${r.totals.paid.count}, לפרעון ${r.totals.due.count + r.totals.future.count}${r.payments.length ? `; תשלומים מתוכננים (Joya) ${r.payments.length}` : ''}`]);
    about.push([`יתרת בנק – ${label}`, b.lastActual ? `${b.lastActual.amount} ₪ בסוף ${dmy(b.lastActual.date)} (${BALANCE_SOURCE_HE[b.lastActual.source] || b.lastActual.source}${b.lastActual.provisional ? ', קובץ מאותו יום – עשוי להשתנות' : ''})${b.expectedEnd ? `; צפויה בסוף התקופה ${b.expectedEnd.amount} ₪` : ''}${b.lowest ? `; הנמוכה ביותר הצפויה ${b.lowest.amount} ₪ ב-${dmy(b.lowest.date)}` : ''}` : 'אין יתרת בנק טעונה']);
  }
  about.unshift(['תקופה', `${dmy(window.from)} – ${window.to ? dmy(window.to) : 'ללא הגבלה'}${window.defaultRange ? ' (ברירת מחדל: מתחילת החודש עד סוף החודש השלישי)' : ' (לפי הבקשה)'}`]);
  about.push(['מבנה', 'גיליון "סיכום" (שורה לחודש), ואז גיליון לכל חודש: השיקים לפי יום, שורת סה״כ אחרי כל יום עם יתרת הבנק בסוף היום, וסה״כ לחודש בסוף']);
  about.push(['צבעים', 'ירוק = יתרה בפועל בסוף היום (קובץ הבנק, אחרת חשבשבת), עד יום הבנק האחרון; אדום = יתרה צפויה – היתרה האחרונה פחות השיקים והתשלומים המתוכננים של כל יום (בלי הכנסות ותנועות אחרות)']);
  return { tabs, counts, dataUpTo, about, window };
}

/** The fixed files: name = the file's name in Drive, build() = { tabs, counts, dataUpTo, about }. */
export const FIXED_SHEETS = {
  cheques: {
    name: 'שיקים לפרעון · Joya',
    about: 'the cheques (שיקים לפרעון) of the asked window — by default from the start of this month to the end of the third month ahead — Hashavshevet and the Priority history in one table, a tab per month, grouped by day with a sum per day, the bank balance at the end of each day (green = real up to the last bank day, red = expected after it) and a month total',
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
export async function refreshForAnswer(key, { by, ...opts } = {}) {
  let rec;
  try {
    rec = await refreshFixedSheet(key, { by, ...opts });
  } catch (e) {
    rec = { ...(await fixedSheetInfo(key)), error: { code: e.code || 'ERROR', message: e.message } };
  }
  const { url, id, ...rest } = rec;
  const fixedFile = rec.made ? { kind: 'sheet', fixed: true, id, url, name: rec.name, rows: rec.rows, tabs: rec.tabs, updatedAt: rec.updatedAt, createdAt: rec.updatedAt } : null;
  return { ...rest, fixedFile };
}

/** Rebuilds the file and replaces it in Drive (same link). The record is saved even when it fails (last good link + error). */
export async function refreshFixedSheet(key, { by = 'joya', ...opts } = {}) {
  const def = FIXED_SHEETS[key];
  if (!def) throw err('NOT_FOUND', `no fixed file "${key}"`);
  const t0 = Date.now();
  try {
    const why = sheetsUnavailable();
    if (why) throw Object.assign(new Error(why), { code: 'FILE_UNAVAILABLE' });
    const built = await def.build(opts);
    const { buffer, rows } = await workbookFromTabs(built.tabs, { he: true, about: [['קובץ', def.name], ['עודכן', new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC'], ['נתוני חשבשבת עד', built.dataUpTo || ''], ...built.about, ['מקור', 'Joya HQ — הקובץ מתעדכן אוטומטית; אל תערכו אותו, השינויים יידרסו']] });
    const up = await upsertFixedSheet({ key, name: def.name, buffer });
    const rec = {
      kind: 'sheet', fixed: true, made: true, key, id: up.id, url: up.url, name: up.name, rows, tabs: built.tabs.map((t) => ({ name: t.name, rows: t.rows.length })),
      counts: built.counts, window: built.window || null, dataUpTo: built.dataUpTo, updatedAt: new Date().toISOString(), updatedBy: by, ms: Date.now() - t0, error: null,
    };
    await updateConfig(SETTING, {}, by, (cur) => ({ ...cur, [key]: rec }));
    return { key, name: def.name, about: def.about, unavailable: null, ...rec };
  } catch (e) {
    const error = { at: new Date().toISOString(), code: e.code || 'ERROR', message: e.message };
    await updateConfig(SETTING, {}, by, (cur) => ({ ...cur, [key]: { ...(cur[key] || { made: false }), error } })).catch(() => {});
    throw e;
  }
}
