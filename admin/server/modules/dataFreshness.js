// How fresh every data source is — one answer for the "System" page of Joya HQ (owner 2026-11-18: "a system option in
// the main menu which displays this data": the last update date of the bank, Hashavshevet and the rest). Read only.
//
// One item per source: { key, group, label, labelEn, lastDate (the last business date the data reaches), lastUpdate (when
// it was loaded), count, detail, expectedDays (how often it should move; null = a fixed file), ageDays (today − lastDate,
// or − lastUpdate when there is no business date), state: ok (within expectedDays) | late (up to twice that) | stale |
// missing (no rows) | fixed (a constant file) | error (the source could not be read; `error` says why) }.
// Groups: hashavshevet (allegro_finance, the nightly copy), bank (the files uploaded in the admin), tabit, beecomm,
// drive (the cheque archive and the invoice agent's indexes) and files (the Priority cheque file). `notes` compares the
// sources in plain Hebrew (the bank page in Hashavshevet behind the uploaded bank file, the archive behind the bank, …).
// Served by the Local Data API GET /local-api/v1/system/freshness (loopback) → Joya /api/joya/system/freshness.
import { createRequire } from "module";
import { executeSql } from "../sources/dbpool.js";
import { financeSql } from "../sources/financePool.js";
import { companyArchive } from "./chequeArchive.js";
import { driveFiles, driveUnavailable } from "./invoiceDrive.js";

const require = createRequire(import.meta.url);
const FINANCE_MAP = require("../../../shared/finance_map.json");
const PRIORITY = require("../../../shared/priority_cheques.json");

export const GROUPS = [
  { key: "hashavshevet", label: "חשבשבת (העתק הספרים)", labelEn: "Hashavshevet (the books' copy)" },
  { key: "bank", label: "הבנק (קבצים שהועלו באדמין)", labelEn: "Bank (files uploaded in the admin)" },
  { key: "tabit", label: "טאביט (משמרות ועובדים)", labelEn: "Tabit (shifts and employees)" },
  { key: "beecomm", label: "ביקום (מכירות)", labelEn: "Beecomm (sales)" },
  { key: "drive", label: "דרייב (ארכיון הצ'קים, חשבוניות)", labelEn: "Drive (cheque archive, invoices)" },
  { key: "files", label: "קבצים קבועים", labelEn: "Fixed files" },
];

const day = (v) => {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
const stamp = (v) => {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 19).replace("T", " ");
  return String(v).replace("T", " ").slice(0, 19);
};
const num = (v) => (v == null ? 0 : Number(v) || 0);
export const todayOf = (env = process.env) => env.FINANCE_TODAY || new Date().toISOString().slice(0, 10);
/** Whole days from `from` to `to` (ISO dates); null when either is missing. */
export const daysBetween = (from, to) => (from && to ? Math.round((Date.parse(`${String(to).slice(0, 10)}T00:00:00Z`) - Date.parse(`${String(from).slice(0, 10)}T00:00:00Z`)) / 864e5) : null);

/**
 * The state of one item (pure): fixed when expectedDays is null, missing without a date, ok within expectedDays, late up
 * to twice that, stale after.
 */
export function freshnessState(item, today) {
  if (item.error) return "error";
  if (item.expectedDays == null) return "fixed";
  const ref = item.lastDate || day(item.lastUpdate);
  if (!ref) return "missing";
  const age = daysBetween(ref, today);
  if (age <= item.expectedDays) return "ok";
  if (age <= item.expectedDays * 2) return "late";
  return "stale";
}

/** Fills ageDays and state on every item (pure). */
export function decorateItems(items, today) {
  for (const it of items) {
    const ref = it.lastDate || day(it.lastUpdate);
    it.ageDays = ref ? daysBetween(ref, today) : null;
    it.state = freshnessState(it, today);
  }
  return items;
}

const fmtHe = (iso) => {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

/** Plain Hebrew notes that compare the sources (pure). */
export function freshnessNotes(items, today) {
  const by = (key) => items.find((x) => x.key === key);
  const notes = [];
  const hashBank = items.find((x) => x.key.startsWith("hash.bank."));
  const bankFile = items.find((x) => x.key.startsWith("bank.file."));
  if (hashBank?.lastDate && bankFile?.lastDate && bankFile.lastDate > hashBank.lastDate)
    notes.push(`דף הבנק בחשבשבת נגמר ב-${fmtHe(hashBank.lastDate)}, וקובץ הבנק שהועלה באדמין מגיע עד ${fmtHe(bankFile.lastDate)} (${daysBetween(hashBank.lastDate, bankFile.lastDate)} ימים): דוח התאמת הבנק לא יציג תנועות חדשות מ-${fmtHe(hashBank.lastDate)} עד שדף הבנק ייטען בחשבשבת.`);
  const archive = by("drive.chequeArchive");
  if (archive?.lastDate && bankFile?.lastDate && daysBetween(archive.lastDate, bankFile.lastDate) > 7)
    notes.push(`ארכיון הצ'קים בדרייב מכסה ימי בנק עד ${fmtHe(archive.lastDate)}; לצ'קים שנפרעו אחרי כן אין עדיין תמונה – כדאי להוריד מנה חדשה מאתר הבנק.`);
  const events = by("bank.events");
  if (events?.lastDate && bankFile?.lastDate && daysBetween(events.lastDate, bankFile.lastDate) > 3)
    notes.push(`קובץ סטטוס העסקאות מעודכן עד ${fmtHe(events.lastDate)} וקובץ הבנק עד ${fmtHe(bankFile.lastDate)}: להעברות שאחרי ${fmtHe(events.lastDate)} אין שם מוטב עד שיועלה קובץ סטטוס חדש.`);
  const sync = by("hash.sync");
  if (sync && (sync.state === "late" || sync.state === "stale")) notes.push(`הסנכרון הלילי של חשבשבת לא רץ מאז ${fmtHe(day(sync.lastUpdate))}.`);
  if (sync?.detail && /failed|error/i.test(sync.detail)) notes.push(`הסנכרון האחרון של חשבשבת נכשל (${sync.detail}).`);
  const bee = by("beecomm.orders");
  if (bee?.lastDate && daysBetween(bee.lastDate, today) > 1) notes.push(`נתוני ביקום נעצרים ב-${fmtHe(bee.lastDate)} (לפני ${daysBetween(bee.lastDate, today)} ימים).`);
  const errors = items.filter((x) => x.state === "error");
  if (errors.length) notes.push(`${errors.length} מקורות לא נקראו הפעם: ${errors.map((x) => x.label).join(", ")}.`);
  return notes;
}

// ── the sources ──────────────────────────────────────────────────────────

const item = (o) => ({ lastDate: null, lastUpdate: null, count: null, detail: null, expectedDays: null, ...o });
const safe = async (base, fn) => {
  try {
    return await fn();
  } catch (err) {
    return [item({ ...base, error: `${err.code || ""} ${err.message}`.trim() })];
  }
};
const adminRows = async (sql, params = {}) => (await executeSql(sql, params))[0];

async function hashavshevetItems() {
  const out = [];
  const g = "hashavshevet";
  out.push(...(await safe({ key: "hash.sync", group: g, label: "סנכרון לילי (hash-sync)", labelEn: "Nightly sync (hash-sync)", expectedDays: 1 }, async () => {
    const [r] = await financeSql(`SELECT sync_run_id, company_id, started_at, finished_at, status, error_text, source_label, source_years FROM sync_runs ORDER BY sync_run_id DESC LIMIT 1`);
    const n = (await financeSql(`SELECT COUNT(*) AS n FROM sync_runs`))[0]?.n;
    if (!r) return [item({ key: "hash.sync", group: g, label: "סנכרון לילי (hash-sync)", labelEn: "Nightly sync (hash-sync)", expectedDays: 1, count: 0 })];
    const years = Array.isArray(r.source_years) ? r.source_years : (() => { try { return JSON.parse(r.source_years); } catch { return []; } })();
    const mins = r.started_at && r.finished_at ? Math.round((new Date(r.finished_at) - new Date(r.started_at)) / 60000) : null;
    return [item({ key: "hash.sync", group: g, label: "סנכרון לילי (hash-sync)", labelEn: "Nightly sync (hash-sync)", expectedDays: 1, lastUpdate: stamp(r.finished_at || r.started_at), count: num(n),
      detail: `${r.status}${r.error_text ? `: ${r.error_text}` : ""}; ${r.source_label || ""}; שנים ${years.join(", ")}${mins != null ? `; ${mins} דקות` : ""}` })];
  })));
  out.push(...(await safe({ key: "hash.bank", group: g, label: "דף הבנק בחשבשבת", labelEn: "Bank page in Hashavshevet", expectedDays: 7 }, async () => {
    const rows = await financeSql(
      `SELECT b.company_id, c.code, b.account_key, COUNT(*) AS n, MAX(b.line_date) AS d1,
              (SELECT a.name FROM accounts a WHERE a.company_id = b.company_id AND a.account_key = b.account_key AND a.deleted_at IS NULL ORDER BY a.fiscal_year DESC LIMIT 1) AS name
         FROM bank_lines b JOIN companies c ON c.company_id = b.company_id WHERE b.deleted_at IS NULL GROUP BY b.company_id, c.code, b.account_key ORDER BY b.company_id, b.account_key`,
    );
    return rows.map((r) => item({ key: `hash.bank.${r.code}.${r.account_key}`, group: g, label: `דף הבנק בחשבשבת – ${r.name || r.account_key} (${r.code})`, labelEn: `Bank page in Hashavshevet – ${r.name || r.account_key} (${r.code})`, expectedDays: 7, lastDate: day(r.d1), count: num(r.n), detail: "תאריך התנועה האחרונה בדף הבנק שנקלט בחשבשבת" }));
  })));
  out.push(...(await safe({ key: "hash.matches", group: g, label: "התאמות בנק בחשבשבת", labelEn: "Bank matches in Hashavshevet", expectedDays: 7 }, async () => {
    const [r] = await financeSql(`SELECT COUNT(*) AS n, MAX(matched_on) AS d1 FROM bank_matches WHERE deleted_at IS NULL`);
    return [item({ key: "hash.matches", group: g, label: "התאמות בנק בחשבשבת", labelEn: "Bank matches in Hashavshevet", expectedDays: 7, lastDate: day(r?.d1), count: num(r?.n), detail: "היום האחרון שבו מנהלת החשבונות התאימה תנועות" })];
  })));
  out.push(...(await safe({ key: "hash.journal", group: g, label: "פקודות יומן", labelEn: "Journal entries", expectedDays: 3 }, async () => {
    const rows = await financeSql(`SELECT fiscal_year, COUNT(*) AS n, MAX(issue_date) AS issued, MAX(value_date) AS valued FROM journal_entries WHERE deleted_at IS NULL GROUP BY fiscal_year ORDER BY fiscal_year`);
    const issued = rows.map((r) => day(r.issued)).filter(Boolean).sort().pop() || null;
    return [item({ key: "hash.journal", group: g, label: "פקודות יומן", labelEn: "Journal entries", expectedDays: 3, lastDate: issued, count: rows.reduce((s, r) => s + num(r.n), 0),
      detail: `תאריך הרישום האחרון; לפי שנה: ${rows.map((r) => `${r.fiscal_year}: ${num(r.n).toLocaleString("en-US")} (ערך עד ${fmtHe(day(r.valued))})`).join(", ")}` })];
  })));
  out.push(...(await safe({ key: "hash.cheques", group: g, label: "מודול הצ'קים", labelEn: "Cheques module", expectedDays: 14 }, async () => {
    // original_date = the day the cheque was written (a post-dated cheque is written before its due date): the last one up to today
    const [r] = await financeSql(`SELECT COUNT(*) AS n, MAX(issue_date) AS issued, MAX(CASE WHEN original_date <= CURDATE() THEN original_date END) AS written, MAX(due_date) AS due FROM cheques WHERE deleted_at IS NULL`);
    const last = [day(r?.issued), day(r?.written)].filter(Boolean).sort().pop() || null;
    return [item({ key: "hash.cheques", group: g, label: "מודול הצ'קים", labelEn: "Cheques module", expectedDays: 14, lastDate: last, count: num(r?.n), detail: `הצ'ק האחרון שנכתב; מועד הפירעון הרחוק ביותר ${fmtHe(day(r?.due))}` })];
  })));
  out.push(...(await safe({ key: "hash.batches", group: g, label: "מנות (batches)", labelEn: "Batches", expectedDays: 3 }, async () => {
    const [r] = await financeSql(`SELECT COUNT(*) AS n, MAX(batch_date) AS d1 FROM batches WHERE deleted_at IS NULL`);
    return [item({ key: "hash.batches", group: g, label: "מנות (batches)", labelEn: "Batches", expectedDays: 3, lastDate: day(r?.d1), count: num(r?.n) })];
  })));
  return out;
}

async function bankItems() {
  const out = [];
  const g = "bank";
  out.push(...(await safe({ key: "bank.file", group: g, label: "קובץ הבנק (תנועות בחשבון)", labelEn: "Bank file (account transactions)", expectedDays: 7 }, async () => {
    const rows = await adminRows(`SELECT account, COUNT(*) AS n, MAX(tx_date) AS d1, MAX(created_at) AS loaded FROM bank_transactions GROUP BY account ORDER BY account`);
    if (!rows.length) return [item({ key: "bank.file.none", group: g, label: "קובץ הבנק (תנועות בחשבון)", labelEn: "Bank file (account transactions)", expectedDays: 7, count: 0 })];
    return rows.map((r) => item({ key: `bank.file.${r.account}`, group: g, label: `קובץ הבנק – חשבון ${r.account}`, labelEn: `Bank file – account ${r.account}`, expectedDays: 7, lastDate: day(r.d1), lastUpdate: stamp(r.loaded), count: num(r.n), detail: "התנועה האחרונה בקובץ שהועלה בדף ההעלאות" }));
  })));
  out.push(...(await safe({ key: "bank.events", group: g, label: "קובץ סטטוס העסקאות", labelEn: "Transaction status file", expectedDays: 7 }, async () => {
    const [r] = await adminRows(`SELECT COUNT(*) AS n, MAX(executed_at) AS d1, MAX(created_at) AS loaded FROM bank_events`);
    return [item({ key: "bank.events", group: g, label: "קובץ סטטוס העסקאות", labelEn: "Transaction status file", expectedDays: 7, lastDate: day(r?.d1), lastUpdate: stamp(r?.loaded), count: num(r?.n), detail: "ההוראה האחרונה שבוצעה; הקובץ מחזיק 1,000 אירועים לכל היותר" })];
  })));
  out.push(...(await safe({ key: "bank.uploads", group: g, label: "העלאות קבצים", labelEn: "File uploads", expectedDays: 7 }, async () => {
    const rows = await adminRows(`SELECT kind, COUNT(*) AS n, MAX(created_at) AS loaded FROM file_uploads GROUP BY kind ORDER BY kind`);
    const last = rows.map((r) => r.loaded).filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || null;
    return [item({ key: "bank.uploads", group: g, label: "העלאות קבצים (כל הסוגים)", labelEn: "File uploads (all kinds)", expectedDays: 7, lastUpdate: stamp(last), count: rows.reduce((s, r) => s + num(r.n), 0), detail: rows.map((r) => `${r.kind}: ${num(r.n)} (אחרון ${fmtHe(day(r.loaded))})`).join("; ") })];
  })));
  return out;
}

async function tabitItems() {
  const g = "tabit";
  const out = [];
  out.push(...(await safe({ key: "tabit.shifts", group: g, label: "משמרות טאביט (שעון)", labelEn: "Tabit shifts (clock)", expectedDays: 1 }, async () => {
    const [r] = await adminRows(`SELECT COUNT(*) AS n, MAX(work_date) AS d1, MAX(created_at) AS loaded FROM tabit_shifts`);
    return [item({ key: "tabit.shifts", group: g, label: "משמרות טאביט (שעון)", labelEn: "Tabit shifts (clock)", expectedDays: 1, lastDate: day(r?.d1), lastUpdate: stamp(r?.loaded), count: num(r?.n), detail: "נמשך כל בוקר ב-06:30" })];
  })));
  out.push(...(await safe({ key: "tabit.rota", group: g, label: "סידור עבודה (טאביט)", labelEn: "Work plan (Tabit rota)", expectedDays: 1 }, async () => {
    const [r] = await adminRows(`SELECT COUNT(*) AS n, MAX(work_date) AS d1, MAX(fetched_at) AS loaded FROM tabit_rota`);
    return [item({ key: "tabit.rota", group: g, label: "סידור עבודה (טאביט)", labelEn: "Work plan (Tabit rota)", expectedDays: 1, lastDate: day(r?.d1), lastUpdate: stamp(r?.loaded), count: num(r?.n), detail: "היום האחרון בסידור שנשמר (השבוע הנוכחי והבא)" })];
  })));
  out.push(...(await safe({ key: "tabit.employees", group: g, label: "עובדים (טאביט → אדמין)", labelEn: "Employees (Tabit → admin)", expectedDays: 7 }, async () => {
    const [e] = await adminRows(`SELECT COUNT(*) AS n, SUM(active = 1) AS act, MAX(updated_at) AS u FROM employees`);
    const [s] = await adminRows(`SELECT COUNT(*) AS n, MAX(GREATEST(COALESCE(updated_at, created_at), created_at)) AS u FROM shift_employees`);
    return [
      item({ key: "tabit.employees", group: g, label: "עובדים באדמין", labelEn: "Employees in the admin", expectedDays: 7, lastUpdate: stamp(e?.u), count: num(e?.n), detail: `${num(e?.act)} פעילים` }),
      item({ key: "tabit.shiftEmployees", group: g, label: "רשימת העובדים של טאביט", labelEn: "Tabit employee list", expectedDays: 7, lastUpdate: stamp(s?.u), count: num(s?.n) }),
    ];
  })));
  out.push(...(await safe({ key: "tabit.payroll", group: g, label: "שכר שנשמר", labelEn: "Saved payroll", expectedDays: 35 }, async () => {
    const [r] = await adminRows(`SELECT COUNT(*) AS n, MAX(updated_at) AS u FROM payroll`);
    return [item({ key: "tabit.payroll", group: g, label: "שכר שנשמר (דף המשמרות)", labelEn: "Saved payroll (Shifts page)", expectedDays: 35, lastUpdate: stamp(r?.u), count: num(r?.n) })];
  })));
  return out;
}

async function beecommItems() {
  const g = "beecomm";
  const defs = [
    ["beecomm.orders", "הזמנות ביקום", "Beecomm orders", "bcom_orders", "business_date", "updated_at"],
    ["beecomm.z", "דוחות Z", "Z reports", "bcom_z_reports", "business_date", "updated_at"],
    ["beecomm.payments", "תשלומים יומיים", "Daily payments", "bcom_payments_daily", "business_date", "updated_at"],
    ["beecomm.items", "פריטים יומיים", "Daily items", "bcom_items_daily", "business_date", "updated_at"],
    ["beecomm.cash", "קופה יומית", "Daily cash", "bcom_cash", "ts", null],
  ];
  const out = [];
  for (const [key, label, labelEn, table, dateCol, loadCol] of defs) {
    out.push(...(await safe({ key, group: g, label, labelEn, expectedDays: 2 }, async () => {
      const [r] = await adminRows(`SELECT COUNT(*) AS n, MAX(\`${dateCol}\`) AS d1${loadCol ? `, MAX(\`${loadCol}\`) AS loaded` : ""} FROM \`${table}\``);
      return [item({ key, group: g, label, labelEn, expectedDays: 2, lastDate: day(r?.d1), lastUpdate: stamp(r?.loaded), count: num(r?.n), detail: "יום העסקים האחרון; נמשך כל לילה ב-04:00" })];
    })));
  }
  return out;
}

async function driveItems() {
  const g = "drive";
  const out = [];
  const why = driveUnavailable();
  const codes = Object.keys(FINANCE_MAP.companies || {}).filter((c) => FINANCE_MAP.companies[c].chequeArchive?.folder || FINANCE_MAP.companies[c].drive?.folder);
  for (const code of codes) {
    out.push(...(await safe({ key: `drive.chequeArchive`, group: g, label: `ארכיון הצ'קים (${code})`, labelEn: `Cheque archive (${code})`, expectedDays: 14 }, async () => {
      if (why) throw new Error(why);
      const a = await companyArchive(code);
      if (a.error) throw new Error(a.error);
      const lastBankDay = a.cheques.map((c) => c.date).filter(Boolean).sort().pop() || null;
      return [item({ key: codes.length > 1 ? `drive.chequeArchive.${code}` : "drive.chequeArchive", group: g, label: `ארכיון הצ'קים בדרייב (${a.folder})`, labelEn: `Cheque archive in Drive (${a.folder})`, expectedDays: 14, lastDate: lastBankDay, lastUpdate: stamp(a.modifiedTime), count: a.cheques.length, detail: "יום הבנק האחרון שיש לו צ'ק סרוק; העדכון = index.json" })];
    })));
  }
  out.push(...(await safe({ key: "drive.invoices", group: g, label: "חשבוניות (סוכן החשבוניות)", labelEn: "Invoices (the invoice agent)", expectedDays: 2 }, async () => {
    if (why) throw new Error(why);
    const r = await driveFiles().list({ q: "name='index.json' and trashed=false", fields: "files(id,name,modifiedTime,parents)", pageSize: 50, orderBy: "modifiedTime desc" });
    const files = r.data.files || [];
    const names = new Map();
    for (const f of files) {
      const pid = f.parents?.[0];
      if (!pid || names.has(pid)) continue;
      try { names.set(pid, (await driveFiles().get({ fileId: pid, fields: "name" })).data.name); } catch { names.set(pid, "?"); }
    }
    const last = files.map((f) => f.modifiedTime).sort().pop() || null;
    return [item({ key: "drive.invoices", group: g, label: "אינדקסים בדרייב (סוכן החשבוניות וארכיון הצ'קים)", labelEn: "Drive indexes (invoice agent and cheque archive)", expectedDays: 2, lastUpdate: stamp(last), count: files.length,
      detail: files.map((f) => `${names.get(f.parents?.[0]) || "?"}: ${fmtHe(day(f.modifiedTime))}`).join("; ") })];
  })));
  return out;
}

function fileItems() {
  return [item({ key: "files.priority", group: "files", label: "קובץ הצ'קים של פריוריטי", labelEn: "Priority cheque file", expectedDays: null, lastDate: PRIORITY.chequeDates?.to || null, lastUpdate: PRIORITY.builtAt || null, count: PRIORITY.count ?? PRIORITY.cheques?.length ?? null,
    detail: `היסטוריה קבועה (${PRIORITY.chequeDates?.from ? fmtHe(PRIORITY.chequeDates.from) : ""} – ${PRIORITY.chequeDates?.to ? fmtHe(PRIORITY.chequeDates.to) : ""}); נבנה ${fmtHe(PRIORITY.builtAt)}` })];
}

/**
 * Everything at once: { today, generatedAt, groups: [{ key, label, labelEn, items }], items, notes }. A source that
 * cannot be read is an item with state "error"; nothing throws.
 */
export async function dataFreshness({ today = todayOf() } = {}) {
  const [h, b, t, bee, d] = await Promise.all([hashavshevetItems(), bankItems(), tabitItems(), beecommItems(), driveItems()]);
  const items = decorateItems([...h, ...b, ...t, ...bee, ...d, ...fileItems()], today);
  const groups = GROUPS.map((g) => ({ ...g, items: items.filter((x) => x.group === g.key) })).filter((g) => g.items.length);
  return { today, generatedAt: new Date().toISOString().slice(0, 19).replace("T", " "), groups, items, notes: freshnessNotes(items, today) };
}
