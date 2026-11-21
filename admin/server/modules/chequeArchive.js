// The cheque archive in Google Drive — the scanned front of every cheque the bank paid, filed per payee, with an
// index (owner 2026-11-15/16: the images come from the Bank Hapoalim site; the payee of a cheque the books and the
// Priority file do not know is READ FROM THE IMAGE — 336 of 360 unknown cheques got a name that way). Structure:
//   <root folder>/<company folder>/index.json          { company, cheques: [ one row per bank cheque line ] }
//   <root folder>/<company folder>/cheques/<payee>/<number>.jpg
// A row: rowId, date (the bank day), reference (the cheque number), amount (minus = money out), details ("שיק"),
// payee, payeeSource ("פריוריטי" | "פקודת יומן" | "מודול צ'קים" | "image" | "image_handwriting" | "חסר"), payeeGuess
// (an unsure reading of the image), party_folder, name, files.front { id, path }, reviewed.
//
// Owner 2026-11-16: "load the index.json from the cheques folder in the drive and use it to extract names wherever
// needed to reduce the 'לא נמצא בחשבשבת' cases". This module reads the index with the invoice agent's Google login
// (invoiceDrive.js: the agent made these files, so scope drive.file sees them; the root folder itself is the owner's
// and cannot be `get`, but listing its children works) and keeps it 5 minutes in memory. Nothing is stored in the DB
// and nothing is written to Drive. Used by chequePayees.js (the fourth name source: payeeSource "image", a guess
// "image_guess", and the image link on every cheque line), chequesAll.js (the one table of all cheques), the Finance
// API /cheques/archive and /cheques/image/:id (the picture itself, streamed through the admin so no Drive sharing is
// needed) and the bank reconciliation report.
//
// Settings: CHEQUE_ARCHIVE_FOLDER = the root folder id in Drive (default: the owner's "cheques" folder); the Google
// files are the agent's (INVOICE_DRIVE_CREDENTIALS, INVOICE_DRIVE_TOKEN). The company is found by its folder name:
// shared/finance_map.json → companies.<code>.chequeArchive.folder (else drive.folder).
import { createRequire } from "module";
import { driveFiles, driveQuote, driveUnavailable, readDriveJson } from "./invoiceDrive.js";

const require = createRequire(import.meta.url);
const FINANCE_MAP = require("../../../shared/finance_map.json");

const FOLDER = "application/vnd.google-apps.folder";
const CACHE_MS = 5 * 60 * 1000; // a new batch of images is filed by hand; 5 minutes is soon enough
const DEFAULT_ROOT = "1ctKpTx6_79oknPaN3Dn_Kk6XMQ_k3JiP";
export const rootFolderId = (env = process.env) => env.CHEQUE_ARCHIVE_FOLDER || DEFAULT_ROOT;

// the index's own words for where a name came from → one code
const SOURCE_OF = { "פריוריטי": "priority", priority: "priority", "פקודת יומן": "journal", journal: "journal", "מודול צ'קים": "cheques", cheques: "cheques", image: "image", image_handwriting: "image_handwriting", "חסר": "none", missing: "none", "": "none" };
const chequeNo = (v) => {
  const s = String(v ?? "").trim();
  return /^\d+$/.test(s) ? String(Number(s)) : null;
};
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const clean = (s) => {
  const t = String(s ?? "").trim();
  return t || null;
};

/** The Drive link of an image (opens for whoever may see the folder); the admin streams it itself at /cheques/image/:id. */
export const driveImageUrl = (id) => (id ? `https://drive.google.com/file/d/${id}/view` : null);

/**
 * One index row → one archive record (pure): { rowId, date, reference, amount (absolute), signedAmount, payee (the
 * confirmed name or null), source (priority | journal | cheques | image | image_handwriting | none), fromImage (the
 * name was read from the picture), guess (an unsure reading, or null), partyFolder, imageId, imagePath, reviewed }.
 */
export function normalizeEntry(e) {
  const source = SOURCE_OF[String(e?.payeeSource ?? "").trim()] ?? "other";
  const payee = clean(e?.payee);
  return {
    rowId: e?.rowId ?? null,
    date: e?.date ? String(e.date).slice(0, 10) : null,
    reference: chequeNo(e?.reference),
    amount: r2(Math.abs(Number(e?.amount) || 0)),
    signedAmount: r2(Number(e?.amount) || 0),
    payee,
    source: payee ? source : "none",
    fromImage: Boolean(payee) && (source === "image" || source === "image_handwriting"),
    guess: payee ? null : clean(e?.payeeGuess),
    partyFolder: clean(e?.party_folder),
    imageId: e?.files?.front?.id || null,
    imagePath: e?.files?.front?.path || null,
    reviewed: e?.reviewed || null,
  };
}

/** The archive records of one index file (pure): rows without a cheque number are dropped. */
export function normalizeIndex(index) {
  const rows = Array.isArray(index?.cheques) ? index.cheques : [];
  return rows.map(normalizeEntry).filter((r) => r.reference);
}

// ── Drive ────────────────────────────────────────────────────────────────

let cache = { at: 0, value: null, error: null };
/**
 * Every company folder of the archive with its records: [{ folderId, name, indexId, modifiedTime, company, cheques }].
 * Drive down or not configured → [] and `error` says why (kept 5 minutes too, so a report does not retry on every call).
 * @returns {Promise<{ companies: Array, error: string|null, at: number }>}
 */
export async function loadChequeArchive({ fresh = false } = {}) {
  if (!fresh && cache.at && Date.now() - cache.at < CACHE_MS) return { companies: cache.value || [], error: cache.error, at: cache.at };
  const why = driveUnavailable();
  if (why) {
    cache = { at: Date.now(), value: [], error: why };
    return { companies: [], error: why, at: cache.at };
  }
  try {
    const files = driveFiles();
    const r = await files.list({ q: `${driveQuote(rootFolderId())} in parents and mimeType='${FOLDER}' and trashed=false`, fields: "files(id,name)", pageSize: 100 });
    const out = [];
    for (const folder of r.data.files || []) {
      const idx = await files.list({ q: `name='index.json' and ${driveQuote(folder.id)} in parents and trashed=false`, fields: "files(id,name,modifiedTime)", pageSize: 1 });
      const file = idx.data.files?.[0];
      if (!file) continue;
      const index = await readDriveJson(file.id);
      if (!index || !Array.isArray(index.cheques)) continue;
      out.push({ folderId: folder.id, name: folder.name, indexId: file.id, modifiedTime: file.modifiedTime, company: index.company || folder.name, cheques: normalizeIndex(index) });
    }
    cache = { at: Date.now(), value: out, error: null };
  } catch (err) {
    cache = { at: Date.now(), value: [], error: `the cheque archive in Drive could not be read: ${err.message}` };
  }
  return { companies: cache.value, error: cache.error, at: cache.at };
}
export const forgetChequeArchive = () => (cache = { at: 0, value: null, error: null });

/** The archive folder name of a finance company code ("pastalina"), from finance_map.json; null = no archive. */
export function archiveFolderOf(companyCode) {
  const rules = FINANCE_MAP.companies?.[companyCode];
  return rules?.chequeArchive?.folder || rules?.drive?.folder || null;
}

/**
 * The archive of one company: { cheques, error, folder, indexId, modifiedTime } — cheques [] when the company has no
 * folder or Drive is down (then `error` says why).
 */
export async function companyArchive(companyCode) {
  const folder = archiveFolderOf(companyCode);
  if (!folder) return { cheques: [], error: null, folder: null, indexId: null, modifiedTime: null, configured: false };
  const { companies, error } = await loadChequeArchive();
  const co = companies.find((c) => c.name === folder || c.company === folder);
  return { cheques: co?.cheques || [], error, folder, folderId: co?.folderId || null, indexId: co?.indexId || null, modifiedTime: co?.modifiedTime || null, configured: true };
}

// ── writing: a new cheque picture from the bank update (bankSync.js) ─────────
// The same files the owner's machine wrote (~/bank-cheques/tools/upload2.mjs): <company>/cheques/<payee or _unknown>/
// <reference>.jpg (+ "_<date>" when the payee already has that number) and a row in index.json keyed by
// date | reference | amount. One writer (this process), one cheque at a time; the index is read again before every
// write so a row filed by the owner's machine in the meantime is kept.

const safeName = (s) => String(s || "").replace(/[\/\\:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
const entryKey = (date, reference, amount) => `${String(date).slice(0, 10)}|${String(reference)}|${Math.round(Math.abs(Number(amount)) * 100)}`;
let writing = Promise.resolve(); // serialises the index writes

async function findOrCreateFolder(name, parentId) {
  const files = driveFiles();
  const r = await files.list({ q: `name=${driveQuote(name)} and ${driveQuote(parentId)} in parents and mimeType='${FOLDER}' and trashed=false`, fields: "files(id,name)", pageSize: 1 });
  if (r.data.files?.[0]) return r.data.files[0].id;
  const c = await files.create({ requestBody: { name, mimeType: FOLDER, parents: [parentId] }, fields: "id" });
  return c.data.id;
}

/**
 * Files one cheque picture (the front) in the company's archive: entry = { date 'YYYY-MM-DD', reference (the cheque
 * number), amount (minus = money out), payee ('' = unknown), payeeSource (the archive's word: "פריוריטי" | "פקודת יומן" |
 * "מודול צ'קים" | "חסר") }. A cheque that already has a front picture is skipped. Returns { skipped?, imageId, path, folder, name }.
 */
export async function addChequeImage(companyCode, entry, buffer, mimeType = "image/jpeg") {
  const why = driveUnavailable();
  if (why) throw new Error(why);
  const folder = archiveFolderOf(companyCode);
  if (!folder) throw new Error(`no cheque archive folder is configured for ${companyCode}`);
  const run = async () => {
    const { Readable } = await import("stream");
    const files = driveFiles();
    const companyId = await findOrCreateFolder(folder, rootFolderId());
    const idx = await files.list({ q: `name='index.json' and ${driveQuote(companyId)} in parents and trashed=false`, fields: "files(id)", pageSize: 1 });
    const indexId = idx.data.files?.[0]?.id || null;
    const index = indexId ? await readDriveJson(indexId) : null;
    const cheques = Array.isArray(index?.cheques) ? index.cheques : [];
    const key = entryKey(entry.date, entry.reference, entry.amount);
    let row = cheques.find((c) => entryKey(c.date, c.reference, c.amount) === key);
    if (row?.files?.front?.id) return { skipped: true, imageId: row.files.front.id, path: row.files.front.path, folder: row.party_folder, name: row.name };
    const party = safeName(entry.payee) || "_unknown";
    const chequesId = await findOrCreateFolder("cheques", companyId);
    const partyId = await findOrCreateFolder(party, chequesId);
    if (!row) {
      const clash = cheques.some((c) => c.party_folder === party && c.name === String(entry.reference));
      row = { date: entry.date, reference: String(entry.reference), amount: Number(entry.amount), details: "שיק", payee: entry.payee || "", payeeSource: entry.payeeSource || "חסר", party_folder: party, name: clash ? `${entry.reference}_${entry.date}` : String(entry.reference), files: {} };
      cheques.push(row);
    }
    const ext = mimeType === "image/png" ? "png" : "jpg";
    const fileName = `${row.name}.${ext}`;
    const up = await files.create({ requestBody: { name: fileName, parents: [partyId] }, media: { mimeType, body: Readable.from([buffer]) }, fields: "id" });
    row.files = { ...(row.files || {}), front: { id: up.data.id, path: `cheques/${party}/${fileName}` } };
    row.filedBy = "admin";
    row.filedAt = new Date().toISOString();
    const body = Buffer.from(JSON.stringify({ ...(index || {}), company: index?.company || folder, cheques }, null, 2));
    if (indexId) await files.update({ fileId: indexId, media: { mimeType: "application/json", body: Readable.from([body]) } });
    else await files.create({ requestBody: { name: "index.json", parents: [companyId] }, media: { mimeType: "application/json", body: Readable.from([body]) }, fields: "id" });
    forgetChequeArchive();
    return { imageId: up.data.id, path: row.files.front.path, folder: party, name: row.name };
  };
  const p = writing.then(run, run);
  writing = p.catch(() => {});
  return p;
}

/**
 * The archive records of cheque numbers (strings or ints) of one company, keyed by the number as a plain string
 * (numbers not in the archive are absent). The caller picks by amount: 23 numbers were used twice.
 * @returns {Promise<{ byNumber: Map<string, object[]>, error: string|null }>}
 */
export async function archiveChequesByNumber(companyCode, numbers) {
  const { cheques, error } = await companyArchive(companyCode);
  const byNumber = new Map();
  if (!cheques.length) return { byNumber, error };
  const wanted = new Set((numbers || []).map(chequeNo).filter(Boolean));
  if (!wanted.size) return { byNumber, error };
  for (const c of cheques) {
    if (!wanted.has(c.reference)) continue;
    if (!byNumber.has(c.reference)) byNumber.set(c.reference, []);
    byNumber.get(c.reference).push(c);
  }
  return { byNumber, error };
}

const norm = (s) => String(s ?? "").replace(/["'`״׳]/g, "").toLowerCase();
const sameAmount = (a, b) => Math.abs(a - b) < 0.01;

/**
 * Search the records (pure; AND of every filter given): number = cheque number(s), q = part of the payee (or the
 * guess / folder), amount = one or several amounts (±0.01), from / to on the bank day, named = true (a confirmed
 * name) | false (no confirmed name: guess or nothing), hasImage.
 * @returns {{ rows: object[], total: number, totals: { count: number, amount: number } }}  rows = the page, totals over every match
 */
export function searchArchive(cheques, { number = null, q = null, amount = null, from = null, to = null, named = null, limit = 100, offset = 0 } = {}) {
  const numbers = number == null || number === "" ? null : new Set((Array.isArray(number) ? number : String(number).split(",")).map(chequeNo).filter(Boolean));
  const amounts = amount == null || amount === "" ? null : (Array.isArray(amount) ? amount : String(amount).split(",")).map((a) => Math.abs(Number(a))).filter((a) => Number.isFinite(a));
  const words = q ? norm(q).split(/\s+/).filter(Boolean) : [];
  const matches = (cheques || []).filter((c) => {
    if (numbers && !numbers.has(c.reference)) return false;
    if (amounts && !amounts.some((a) => sameAmount(a, c.amount))) return false;
    if (from && (!c.date || c.date < from)) return false;
    if (to && (!c.date || c.date > to)) return false;
    if (named === true && !c.payee) return false;
    if (named === false && c.payee) return false;
    if (words.length) {
      const hay = norm([c.payee, c.guess, c.partyFolder].filter(Boolean).join(" "));
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  const totals = { count: matches.length, amount: r2(matches.reduce((s, c) => s + c.amount, 0)) };
  return { rows: matches.slice(offset, offset + limit), total: matches.length, totals };
}

/** Counts of one archive (pure): how many names come from where. */
export function archiveCounts(cheques) {
  const out = { total: 0, named: 0, fromImage: 0, guess: 0, unnamed: 0, withImage: 0, bySource: {} };
  for (const c of cheques || []) {
    out.total++;
    if (c.payee) out.named++;
    if (c.fromImage) out.fromImage++;
    if (!c.payee && c.guess) out.guess++;
    if (!c.payee && !c.guess) out.unnamed++;
    if (c.imageId) out.withImage++;
    out.bySource[c.source] = (out.bySource[c.source] || 0) + 1;
  }
  return out;
}

/**
 * The picture of a cheque, by its Drive file id — only an id that is in the archive index (the id is checked against
 * the loaded index, so this endpoint cannot fetch any other Drive file). Returns { buffer, mimeType, name } or null.
 */
export async function readChequeImage(fileId) {
  const id = String(fileId || "").trim();
  if (!/^[\w-]{10,}$/.test(id)) return null;
  const { companies } = await loadChequeArchive();
  let hit = null;
  for (const co of companies) {
    hit = co.cheques.find((c) => c.imageId === id);
    if (hit) break;
  }
  if (!hit) return null;
  const r = await driveFiles().get({ fileId: id, alt: "media" }, { responseType: "arraybuffer" });
  const ext = String(hit.imagePath || "").toLowerCase();
  const mimeType = r.headers?.["content-type"] || (ext.endsWith(".png") ? "image/png" : "image/jpeg");
  return { buffer: Buffer.from(r.data), mimeType, name: hit.imagePath ? hit.imagePath.split("/").pop() : `${hit.reference}.jpg` };
}
