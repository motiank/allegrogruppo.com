// Fixed files in the owner's Drive folder — one Google Sheet per key, the SAME file every time, rewritten on a
// schedule and on request (owner 2026-11-11: "merge into one table the Priority and Hashavshevet cheques, create an
// Excel on the Drive and give the link; a fixed file that is updated all the time"). The link and the last refresh
// are kept in joya_settings ("fixedSheets"), so the chat answers without a Drive call.
//
// Keys today: cheques = every cheque of the company (Finance API /cheques/all: Hashavshevet's cheques module +
// the Priority file, one row per cheque, with the day the bank paid it), one tab per finance company.
import { finance, financeCompanies } from './source.js';
import { sheetsUnavailable, workbookFromTabs, upsertFixedSheet } from './sheets.js';
import { getConfig, updateConfig, err } from '../db.js';
import log from '../../lib/log.js';

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

async function buildCheques() {
  const fc = await financeCompanies();
  if (!fc.available) throw Object.assign(new Error(fc.reason || 'the Finance API is not available'), { code: 'NO_ROWS' });
  const tabs = [];
  const counts = {};
  const about = [];
  let dataUpTo = null;
  for (const co of fc.companies) {
    const r = await finance('/cheques/all', { company: co.code, limit: 5000 });
    if (!r.available || !r.data?.length) continue;
    tabs.push({ name: (co.allegroLabel || co.name || co.code).slice(0, 31), columns: CHEQUE_COLUMNS, rows: r.data.map(chequeRowHe) });
    counts[co.code] = { ...r.meta.counts, totals: r.meta.totals };
    dataUpTo = r.meta.sync?.dataUpTo ?? dataUpTo;
    about.push([co.allegroLabel || co.name, `${r.meta.counts.total} שיקים: חשבשבת ${r.meta.counts.hashavshevet}, פריוריטי ${r.meta.counts.priority}, בשניהם ${r.meta.counts.both}; נפרעו בבנק ${r.meta.counts.bankPaid}`]);
  }
  if (!tabs.length) throw Object.assign(new Error('no cheques to put in the file (no finance company loaded)'), { code: 'NO_ROWS' });
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

export const refreshEveryMin = () => Number(process.env.JOYA_FIXED_SHEETS_EVERY_MIN ?? 60) || 0;

/** The record kept for a key: { kind, fixed, key, id, url, name, rows, tabs, counts, dataUpTo, updatedAt, error }, or a stub when it was never made. */
export async function fixedSheetInfo(key) {
  const def = FIXED_SHEETS[key];
  if (!def) throw err('NOT_FOUND', `no fixed file "${key}"`);
  const all = await getConfig(SETTING, {});
  const rec = all[key] || null;
  return { key, name: def.name, about: def.about, refreshEveryMin: refreshEveryMin(), unavailable: sheetsUnavailable(), ...(rec || { made: false, note: 'the file was not made yet: ask with refresh true, or wait for the next scheduled refresh' }) };
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
    return { key, name: def.name, about: def.about, refreshEveryMin: refreshEveryMin(), unavailable: null, ...rec };
  } catch (e) {
    const error = { at: new Date().toISOString(), code: e.code || 'ERROR', message: e.message };
    await updateConfig(SETTING, {}, by, (cur) => ({ ...cur, [key]: { ...(cur[key] || { made: false }), error } })).catch(() => {});
    throw e;
  }
}

let timer = null;
/** The schedule: every JOYA_FIXED_SHEETS_EVERY_MIN minutes (default 60; 0 = off), first run 2 minutes after start. */
export function startFixedSheets() {
  const every = refreshEveryMin();
  const why = sheetsUnavailable();
  if (!every || why) {
    log.info(`fixed sheets: not scheduled (${why || 'JOYA_FIXED_SHEETS_EVERY_MIN=0'})`);
    return null;
  }
  const run = async () => {
    for (const key of Object.keys(FIXED_SHEETS)) {
      try {
        const r = await refreshFixedSheet(key, { by: 'scheduler' });
        log.info(`fixed sheet ${key}: ${r.rows} rows, ${r.ms} ms → ${r.url}`);
      } catch (e) {
        log.warn(`fixed sheet ${key} failed: ${e.message}`);
      }
    }
  };
  setTimeout(run, 2 * 60 * 1000).unref();
  timer = setInterval(run, every * 60 * 1000);
  timer.unref();
  log.info(`fixed sheets: every ${every} min (${Object.keys(FIXED_SHEETS).join(', ')})`);
  return timer;
}
