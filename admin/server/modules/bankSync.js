// Bank update from the Bank Hapoalim business site (owner 2026-11-22: "update the bank data in the system the same way
// we have with the legal: click the button, it opens the login to the Poalim bank, downloads the missing bank data of the
// Allegro account and the Pasta Lina account and pushes it to the database — the transactions, the transfers, and the new
// cheque images").
//
// The Joya browser extension (joya-extension/, the same one that updates the legal archive) opens the bank site in a
// normal tab, the user logs in BY HIMSELF, and the extension reads the site's own JSON (the calls the site's pages make)
// and sends it to Joya HQ, which forwards it here (Local Data API, /bank/sync/*, loopback, admin only). This module:
//   plan()                what to fetch: per configured account (shared/restaurants.json bank_accounts) the last stored
//                         day, so the extension asks the site only for the days after it (with a few days of overlap);
//   importSiteRows()      the site's transaction rows → bank_transactions, in the SAME row shape as the Excel file the
//                         Upload page takes (parsers.js parseBankHapoalim), so the two sources never store a move twice:
//                         the row_key formula is the same, and on top of it a row that an older Excel upload already
//                         stored (same account, day, action code, reference, debit, credit — the texts may differ a little
//                         between the file and the JSON) is not stored again;
//   chequesWithoutImage() the paid cheques of the stored rows that the Drive cheque archive has no picture of yet
//                         (a placeholder row = the bank has no picture — not asked again; owner 2026-11-28);
//   markChequeNoImage()   writes that placeholder when the site's picture link answered nothing;
//   fileChequeImage()     one cheque picture → the Drive archive (chequeArchive.js addChequeImage), named by the books.
// The transaction status file (סטטוס עסקאות, bank_events) is not fetched from the site yet: its page was not mapped
// (plan().events.supported = false); the Upload page still takes that file.
import crypto from "crypto";
import { createRequire } from "module";
import { executeSql, getDbPool } from "../sources/dbpool.js";
import { norm } from "../uploads/workbook.js";
import { addChequePayees, pickImage, PAYEE_SOURCE } from "./chequePayees.js";
import { companyArchive, addChequeImage, addChequeNoImage, archiveFolderOf } from "./chequeArchive.js";

const require = createRequire(import.meta.url);
const RESTAURANTS = require("../../../shared/restaurants.json");
const FINANCE_MAP = require("../../../shared/finance_map.json");

export const OVERLAP_DAYS = 7; // the site is asked again for the last stored days: a late row, a corrected one
export const FIRST_DAY = "2025-01-01"; // an account with nothing stored starts here
const CHEQUE_LOOKBACK_DAYS = 400; // cheque lines this old are checked for a missing picture (2026-11-22: the archive held May–Nov 2025 and ~85 of 2026)
const MAX_CHEQUES = 600; // per run, newest first; the next run continues with the older ones
const CHUNK = 500;

const inTransaction = async (fn) => {
  const pool = await getDbPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

const pad = (n) => String(n).padStart(2, "0");
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayLocal = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
const addDays = (day, n) => {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + n);
  return isoDay(d);
};
const dayOf = (v) => {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v) ? null : isoDay(v);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/); // the site's YYYYMMDD
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return null;
};
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const text = (v) => norm(v == null ? "" : String(v)) || null;

/** The bank accounts the update works on (shared/restaurants.json → bank_accounts): [{ company, companyLabel, bank, account }]. */
export const configuredAccounts = () =>
  (RESTAURANTS.restaurants || []).flatMap((g) => (g.bank_accounts || []).map((a) => ({ company: g.key, companyLabel: g.label, bank: a.bank || "hapoalim", account: a.account })));
export const companyOfAccount = (account) => configuredAccounts().find((a) => a.account === account) || null;
/** The finance company code ("pastalina") of an Allegro company key ("pastaLina"), from finance_map.json. */
export const financeCodeOf = (allegroKey) => Object.keys(FINANCE_MAP.companies || {}).find((c) => FINANCE_MAP.companies[c].allegroKey === allegroKey) || null;

// ── the site's JSON → the Excel row shape ──────────────────────────────────

/**
 * One transaction row of the bank site (the JSON of /ServerServices/current-account/transactions) → the row the Upload
 * page would have stored from the Excel export of the same move (pure). Field names as the site sends them (the same
 * backend serves login.bankhapoalim.co.il, mapped by the open-source israeli-bank-scrapers): eventDate / valueDate
 * (YYYYMMDD), activityTypeCode (the 3-digit action code), activityDescription (the action), beneficiaryDetailsData
 * { partyHeadline, partyName, messageHeadline, messageDetail } (the "פרטים" text: "לטובת: <name>" / "המבצע: <name>"
 * [+ " עבור: <purpose>"]), referenceNumber, eventAmount with eventActivityTypeCode (2 = debit, else credit),
 * currentBalance, serialNumber (0 = still pending — not a bank row yet). The Excel writes " (תאריך ערך: DD/MM)" after
 * the action when the value date differs. Returns null for a row that is not a stored move.
 */
export function siteRowToStored(t, account) {
  if (!t || typeof t !== "object") return null;
  const tx_date = dayOf(t.eventDate);
  if (!tx_date) return null;
  if (Number(t.serialNumber) === 0 && t.serialNumber != null) return null; // pending, not yet a row of the statement
  const valueDate = dayOf(t.valueDate);
  let action = text(t.activityDescription);
  if (action && valueDate && valueDate !== tx_date) action = `${action} (תאריך ערך: ${valueDate.slice(8, 10)}/${valueDate.slice(5, 7)})`;
  // the "פרטים" text: the site's headlines already end with ":" ("לטובת:", "עבור:" — seen on production 2026-11-22);
  // the row's own `details` field is a link to a service (the cheque picture), never the Excel's text
  const b = t.beneficiaryDetailsData && typeof t.beneficiaryDetailsData === "object" ? t.beneficiaryDetailsData : null;
  let details = null;
  if (b) {
    const label = (v) => text(v)?.replace(/\s*:+\s*$/, "") || null;
    const party = text(b.partyName);
    const head = label(b.partyHeadline);
    const purpose = text(b.messageDetail);
    const purposeHead = label(b.messageHeadline) || "עבור";
    const parts = [];
    if (party) parts.push(head ? `${head}: ${party}` : party);
    if (purpose) parts.push(`${purposeHead}: ${purpose}`);
    details = parts.join(" ") || null;
  }
  const amount = Math.abs(Number(t.eventAmount) || 0);
  const debit = Number(t.eventActivityTypeCode) === 2 ? r2(amount) : null;
  const credit = Number(t.eventActivityTypeCode) === 2 ? null : r2(amount);
  const bundleRaw = t.bundleNumber ?? t.transactionBundleNumber ?? t.bundle ?? null;
  const balance = t.currentBalance == null || t.currentBalance === "" ? null : r2(t.currentBalance);
  return {
    account,
    tx_date,
    action_code: t.activityTypeCode == null ? null : String(t.activityTypeCode),
    action,
    details: details ? details.slice(0, 500) : null,
    reference: t.referenceNumber == null ? null : String(t.referenceNumber),
    bundle: bundleRaw == null ? null : String(bundleRaw),
    debit,
    credit,
    balance,
    note: text(t.textCode) && /\D/.test(String(t.textCode)) ? text(t.textCode) : null,
  };
}

/** The row_key of parsers.js parseBankHapoalim: the fields without the balance + the row's number among equal rows (pure). */
export function keyRows(rows) {
  const seen = new Map();
  for (const out of rows) {
    const fields = JSON.stringify([out.account, out.tx_date, out.action_code, out.action, out.details, out.reference, out.bundle, out.debit, out.credit]);
    const n = (seen.get(fields) || 0) + 1;
    seen.set(fields, n);
    out.row_key = crypto.createHash("sha256").update(`${fields}#${n}`).digest("hex");
  }
  return rows;
}

/** The text-free key under which an Excel row and the same move from the site agree (pure). */
export const moveKey = (r) => [r.account, r.tx_date, r.action_code ?? "", r.reference ?? "", r.debit == null ? "" : r2(r.debit), r.credit == null ? "" : r2(r.credit)].join("|");

/**
 * Drops the site rows that are already stored (pure): `existing` = Map(moveKey → how many rows stored). Equal moves on
 * one day (two cheques of the same amount and number cannot happen, but two fees can) are counted: the site's third
 * equal row is new when two are stored. Returns { fresh, alreadyStored }.
 */
export function dropStored(rows, existing) {
  const used = new Map();
  const fresh = [];
  let alreadyStored = 0;
  for (const r of rows) {
    const k = moveKey(r);
    const have = existing.get(k) || 0;
    const n = (used.get(k) || 0) + 1;
    used.set(k, n);
    if (n <= have) alreadyStored++;
    else fresh.push(r);
  }
  return { fresh, alreadyStored };
}

// ── DB ────────────────────────────────────────────────────────────────────

/** The last stored bank day per account: Map(account → 'YYYY-MM-DD'). */
async function lastDays() {
  const [rows] = await executeSql(`SELECT account, DATE_FORMAT(MAX(tx_date), '%Y-%m-%d') AS d, COUNT(*) AS n FROM bank_transactions GROUP BY account`, {});
  return new Map(rows.map((r) => [r.account, { lastDay: r.d, rows: Number(r.n) }]));
}

/**
 * What an update run should fetch: { today, accounts: [{ company, companyLabel, account, lastDay, rows, from, to }],
 * events: { supported: false, lastSubmitted }, cheques: { lookbackDays }, archive: { configured, error, cheques } }.
 * from = the last stored day minus OVERLAP_DAYS (FIRST_DAY when nothing is stored), to = today.
 */
export async function plan() {
  const today = todayLocal();
  const last = await lastDays();
  const accounts = configuredAccounts().map((a) => {
    const l = last.get(a.account);
    const code = financeCodeOf(a.company);
    return { ...a, financeCode: code, archiveFolder: code ? archiveFolderOf(code) : null, lastDay: l?.lastDay || null, rows: l?.rows || 0, from: l?.lastDay ? addDays(l.lastDay, -OVERLAP_DAYS) : FIRST_DAY, to: today };
  });
  let lastSubmitted = null;
  try {
    const [[e]] = await executeSql(`SELECT DATE_FORMAT(MAX(submitted_at), '%Y-%m-%d %H:%i') AS d FROM bank_events`, {});
    lastSubmitted = e?.d || null;
  } catch {}
  const archives = {};
  for (const a of accounts) {
    if (!a.financeCode || archives[a.financeCode]) continue;
    const ar = await companyArchive(a.financeCode);
    archives[a.financeCode] = { configured: ar.configured, folder: ar.folder, error: ar.error, cheques: ar.cheques.length };
  }
  return { today, overlapDays: OVERLAP_DAYS, accounts, events: { supported: false, lastSubmitted, note: "the transaction status file (סטטוס עסקאות) is still uploaded on the Upload page" }, cheques: { lookbackDays: CHEQUE_LOOKBACK_DAYS, max: MAX_CHEQUES }, archive: archives };
}

/**
 * Stores the site's transaction rows of one account: maps them to the Excel row shape, drops what is stored (by row_key
 * and by the text-free move key), inserts the rest, and writes one file_uploads row (kind BANK_HAPOALIM, the name says
 * it came from the site) so the Upload history and the System page show it. Returns { account, from, to, rows, mapped,
 * newRows, alreadyStored, pending, uploadId }.
 */
export async function importSiteRows(account, siteRows, { user = null, from = null, to = null } = {}) {
  const acc = companyOfAccount(account);
  if (!acc) throw Object.assign(new Error(`account ${account} is not configured (shared/restaurants.json bank_accounts)`), { status: 404, code: "not_found" });
  const list = Array.isArray(siteRows) ? siteRows : [];
  const mapped = [];
  let pending = 0;
  for (const t of list) {
    const r = siteRowToStored(t, account);
    if (r) mapped.push(r);
    else if (t && Number(t.serialNumber) === 0) pending++;
  }
  keyRows(mapped);
  const days = mapped.map((r) => r.tx_date).sort();
  const out = { account, company: acc.company, from: from || days[0] || null, to: to || days[days.length - 1] || null, rows: list.length, mapped: mapped.length, newRows: 0, alreadyStored: 0, pending, uploadId: null };
  if (!mapped.length) return out;
  // one raw row per action code, kept with the upload: the site's field names are confirmed from these (the "צרור" field
  // of the Excel is still unknown in the JSON)
  const rawSamples = {};
  for (const t of list) {
    const code = String(t?.activityTypeCode ?? "?");
    if (rawSamples[code] || Object.keys(rawSamples).length >= 20) continue;
    rawSamples[code] = t;
  }
  const [stored] = await executeSql(
    `SELECT account, DATE_FORMAT(tx_date, '%Y-%m-%d') AS tx_date, action_code, reference, debit, credit, COUNT(*) AS n
       FROM bank_transactions WHERE account = :account AND tx_date BETWEEN :d0 AND :d1
      GROUP BY account, tx_date, action_code, reference, debit, credit`,
    { account, d0: days[0], d1: days[days.length - 1] },
  );
  const existing = new Map(stored.map((r) => [moveKey(r), Number(r.n)]));
  const { fresh, alreadyStored } = dropStored(mapped, existing);
  out.alreadyStored = alreadyStored;
  if (fresh.length) {
    const values = fresh.map((r) => ["hapoalim", r.account, r.tx_date, r.action_code, r.action, r.details, r.reference, r.bundle, r.debit, r.credit, r.balance, r.note, r.row_key, null]);
    const hash = crypto.createHash("sha256").update(fresh.map((r) => r.row_key).join("\n")).digest("hex");
    await inTransaction(async (conn) => {
      const [u] = await conn.query(
        `INSERT INTO file_uploads (file_name, file_hash, file_size, kind, rest, company, period_from, period_to, status, result_json, user_email)
         VALUES (?, ?, ?, 'BANK_HAPOALIM', NULL, ?, ?, ?, 'OK', CAST(? AS JSON), ?)`,
        [`bank-site ${account} ${out.from}..${out.to}`.slice(0, 255), hash, 0, acc.company, out.from, out.to, JSON.stringify({ source: "bank_site", started: true }), user],
      );
      out.uploadId = u.insertId;
      for (const v of values) v[13] = out.uploadId;
      let inserted = 0;
      for (let i = 0; i < values.length; i += CHUNK) {
        const [res] = await conn.query(
          `INSERT IGNORE INTO bank_transactions (bank, account, tx_date, action_code, action, details, reference, bundle, debit, credit, balance, note, row_key, upload_id) VALUES ?`,
          [values.slice(i, i + CHUNK)],
        );
        inserted += res.affectedRows || 0;
      }
      out.newRows = inserted;
      out.alreadyStored += fresh.length - inserted;
      await conn.query(`UPDATE file_uploads SET result_json = CAST(? AS JSON) WHERE id = ?`, [JSON.stringify({ ...out, source: "bank_site", rawSamples }), out.uploadId]);
    });
  }
  return out;
}

/**
 * The paid cheques of one account (stored rows, action code 493 / "שיק", money out) of the last `lookbackDays` days that
 * the Drive archive has NO scanned picture of yet: [{ date, reference, amount }], newest first, at most MAX_CHEQUES. So
 * the extension downloads only the cheques missing from the archive, never one it already holds (owner 2026-11-23).
 * "Already in the archive" is decided first by the cheque number + the line's bank day: the archive stores `date` as the
 * bank day (the same `tx_date` the line has) and a cheque number clears on exactly one day, so number + date is a stable
 * index — if a scan with that number and that day exists, the cheque is not fetched again. The line's amount is kept
 * only as a safety net (the SAME test the bank reconciliation report uses to show the 📷, chequePayees.pickImage) for a
 * scan whose stored day differs a little. `archive` says whether the archive could be read at all (no archive → nothing
 * is asked) and how many lines it already covered (`archived`).
 */
export async function chequesWithoutImage(account, { lookbackDays = CHEQUE_LOOKBACK_DAYS, since = null } = {}) {
  const acc = companyOfAccount(account);
  if (!acc) throw Object.assign(new Error(`account ${account} is not configured`), { status: 404, code: "not_found" });
  const code = financeCodeOf(acc.company);
  const ar = code ? await companyArchive(code) : { cheques: [], configured: false, error: null };
  if (!ar.configured) return { account, cheques: [], archive: { configured: false, error: null }, reason: "no cheque archive for this company" };
  if (ar.error && !ar.cheques.length) return { account, cheques: [], archive: { configured: true, error: ar.error }, reason: ar.error };
  const from = since || addDays(todayLocal(), -lookbackDays);
  const [rows] = await executeSql(
    `SELECT DATE_FORMAT(tx_date, '%Y-%m-%d') AS d, reference, debit FROM bank_transactions
      WHERE account = :account AND tx_date >= :from AND debit IS NOT NULL AND (action_code = '493' OR action = 'שיק') AND reference REGEXP '^[0-9]+$'
      ORDER BY tx_date DESC, id DESC`,
    { account, from },
  );
  // the scanned cheques of the archive, grouped by cheque number: rows that really have a picture, and the placeholder
  // rows of cheques the bank itself has no picture of (owner 2026-11-28: "use a placeholder and don't retry")
  const scansByNumber = new Map();
  for (const c of ar.cheques) {
    if (!c.imageId && !c.noImage) continue;
    if (!scansByNumber.has(c.reference)) scansByNumber.set(c.reference, []);
    scansByNumber.get(c.reference).push(c);
  }
  const seen = new Set();
  const cheques = [];
  let archived = 0;
  let noImage = 0;
  for (const r of rows) {
    const ref = String(Number(r.reference));
    const amount = r2(Number(r.debit));
    const scans = scansByNumber.get(ref);
    // the cheque number + the line's day is the index; the amount is the safety net (same as the report's 📷)
    const hit = scans && (scans.find((c) => c.date === r.d) || pickImage(scans.filter((c) => c.imageId), amount) || scans.find((c) => c.noImage && Math.abs(c.amount - amount) < 0.011));
    if (hit) {
      if (hit.noImage) noImage++; // the bank has no picture of this cheque — do not ask the site again
      else archived++; // the archive already has this cheque's picture — do not fetch it again
      continue;
    }
    const k = `${ref}|${Math.round(amount * 100)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    cheques.push({ date: r.d, reference: ref, amount });
    if (cheques.length >= MAX_CHEQUES) break;
  }
  return { account, from, cheques, archive: { configured: true, error: ar.error || null, cheques: ar.cheques.length, archived, noImage }, checked: rows.length };
}

/**
 * The bank site has NO picture of this paid cheque (its picture link answered nothing; the bank's own page shows nothing
 * either — owner 2026-11-28): a placeholder row goes into the archive index so the next update does not ask again.
 * The payee is looked up like for a picture (the folder name of a future scan). Returns { ok, skipped?, noImage, name, folder, payee, payeeSource }.
 */
export async function markChequeNoImage({ account, date, reference, amount, reason }) {
  const acc = companyOfAccount(account);
  if (!acc) throw Object.assign(new Error(`account ${account} is not configured`), { status: 404, code: "not_found" });
  const code = financeCodeOf(acc.company);
  if (!code || !archiveFolderOf(code)) throw Object.assign(new Error(`no cheque archive is configured for ${acc.company}`), { status: 404, code: "not_found" });
  const day = dayOf(date);
  const ref = /^\d+$/.test(String(reference || "").trim()) ? String(Number(reference)) : null;
  const amt = r2(Math.abs(Number(amount)));
  if (!day || !ref || !(amt > 0)) throw Object.assign(new Error("date, reference and amount are required"), { status: 400, code: "bad_request" });
  const row = { details: "שיק", reference: ref, amount: -amt };
  await addChequePayees([row], { company: code, bankAccounts: [account] });
  const source = row.payeeSource === PAYEE_SOURCE.image || row.payeeSource === PAYEE_SOURCE.imageGuess ? PAYEE_SOURCE.missing : row.payeeSource || PAYEE_SOURCE.missing;
  const payee = source === PAYEE_SOURCE.missing ? "" : row.payee || "";
  const out = await addChequeNoImage(code, { date: day, reference: ref, amount: -amt, payee, payeeSource: ARCHIVE_WORD[source] || "חסר" }, reason);
  return { ok: true, ...out, payee: payee || null, payeeSource: source };
}

// the archive's own words for a name source (what the owner's machine wrote; chequeArchive.js reads both)
const ARCHIVE_WORD = { [PAYEE_SOURCE.cheques]: "מודול צ'קים", [PAYEE_SOURCE.journal]: "פקודת יומן", [PAYEE_SOURCE.priority]: "פריוריטי", [PAYEE_SOURCE.image]: "image", [PAYEE_SOURCE.imageGuess]: "חסר", [PAYEE_SOURCE.missing]: "חסר" };

/**
 * Files the front picture of one paid cheque in the Drive archive: the payee is looked up in the books / Priority (the
 * cheque lookup, read only) to choose the folder; a cheque nobody names goes to `_unknown` (its name is read from the
 * picture later, as before). A cheque that already has a picture is not uploaded again. Returns
 * { ok, skipped?, imageId, path, payee, payeeSource, folder }.
 */
export async function fileChequeImage({ account, date, reference, amount }, buffer) {
  const acc = companyOfAccount(account);
  if (!acc) throw Object.assign(new Error(`account ${account} is not configured`), { status: 404, code: "not_found" });
  const code = financeCodeOf(acc.company);
  if (!code || !archiveFolderOf(code)) throw Object.assign(new Error(`no cheque archive is configured for ${acc.company}`), { status: 404, code: "not_found" });
  const day = dayOf(date);
  const ref = /^\d+$/.test(String(reference || "").trim()) ? String(Number(reference)) : null;
  const amt = r2(Math.abs(Number(amount)));
  if (!day || !ref || !(amt > 0)) throw Object.assign(new Error("date, reference and amount are required"), { status: 400, code: "bad_request" });
  if (!Buffer.isBuffer(buffer) || buffer.length < 100) throw Object.assign(new Error("empty picture"), { status: 400, code: "bad_request" });
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50;
  if (!isJpeg && !isPng) throw Object.assign(new Error("the picture is not a JPEG or PNG"), { status: 400, code: "bad_request" });
  const row = { details: "שיק", reference: ref, amount: -amt };
  await addChequePayees([row], { company: code, bankAccounts: [account] });
  const source = row.payeeSource === PAYEE_SOURCE.image || row.payeeSource === PAYEE_SOURCE.imageGuess ? PAYEE_SOURCE.missing : row.payeeSource || PAYEE_SOURCE.missing;
  const payee = source === PAYEE_SOURCE.missing ? "" : row.payee || "";
  const filed = await addChequeImage(code, { date: day, reference: ref, amount: -amt, payee, payeeSource: ARCHIVE_WORD[source] || "חסר" }, buffer, isPng ? "image/png" : "image/jpeg");
  return { ok: true, ...filed, payee: payee || null, payeeSource: source };
}
