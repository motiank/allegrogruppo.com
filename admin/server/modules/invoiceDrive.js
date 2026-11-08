// The accountant's Google Drive, as the invoice agent left it (invoice-agent/README.md → Drive structure):
//   <root "Invoices">/<company folder>/index.json   one row per filed invoice
// The admin reads these index files to compare the invoices with the books (financeApi.js → /invoices/drive-check)
// and writes the match flag back into each row (`books`, shared/invoiceMatch.js booksFlag). Owner 2026-11-08: the
// admin reaches Drive itself, with the agent's Google login (OAuth client + saved token, scope drive.file: only what
// the agent created is visible). Nothing else in Drive is read or changed.
//
// Settings (admin .env): INVOICE_DRIVE_CREDENTIALS = the OAuth client file (default invoice-agent/credentials.json),
// INVOICE_DRIVE_TOKEN = the saved login (default invoice-agent/data/token.json), INVOICE_DRIVE_ROOT = the main folder
// (default "Invoices"). Without the two files the feature answers "not configured" and nothing breaks.
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { fileURLToPath } from "url";
import { google } from "googleapis";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FOLDER = "application/vnd.google-apps.folder";
const CACHE_MS = 5 * 60 * 1000; // the agent files new invoices every 15 minutes; a check sees them within 5
const quote = (s) => `'${String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

export function driveSettings(env = process.env) {
  const p = (v, d) => path.resolve(repoRoot, v || d);
  return {
    credentials: p(env.INVOICE_DRIVE_CREDENTIALS, "invoice-agent/credentials.json"),
    token: p(env.INVOICE_DRIVE_TOKEN, "invoice-agent/data/token.json"),
    root: env.INVOICE_DRIVE_ROOT || "Invoices",
  };
}

/** Why Drive cannot be used, or null when the two files are there. */
export function driveUnavailable(env = process.env) {
  const s = driveSettings(env);
  if (!fs.existsSync(s.credentials)) return `the Google OAuth client file is missing (${s.credentials}); set INVOICE_DRIVE_CREDENTIALS`;
  if (!fs.existsSync(s.token)) return `the Google login of the invoice agent is missing (${s.token}); run "npm run auth" in invoice-agent and set INVOICE_DRIVE_TOKEN`;
  return null;
}

let client = null;
function auth() {
  if (client) return client;
  const s = driveSettings();
  const raw = JSON.parse(fs.readFileSync(s.credentials, "utf8"));
  const c = raw.installed ?? raw.web;
  if (!c) throw new Error("INVOICE_DRIVE_CREDENTIALS is not an OAuth client file");
  const saved = JSON.parse(fs.readFileSync(s.token, "utf8"));
  client = new google.auth.OAuth2(c.client_id, c.client_secret);
  client.setCredentials(saved);
  // Google renews the access token by itself; keep the renewed one so a restart does not renew again at once
  client.on("tokens", (t) => {
    try {
      fs.writeFileSync(s.token, JSON.stringify({ ...saved, ...t }, null, 2), { mode: 0o600 });
    } catch {}
  });
  return client;
}
const files = () => google.drive({ version: "v3", auth: auth() }).files;

async function findOne(q) {
  const r = await files().list({ q: `${q} and trashed=false`, fields: "files(id,name,modifiedTime)", pageSize: 1 });
  return r.data.files?.[0] ?? null;
}

let rootId = null;
async function root() {
  if (rootId) return rootId;
  const f = await findOne(`name=${quote(driveSettings().root)} and mimeType='${FOLDER}'`);
  if (!f) throw new Error(`the Drive folder "${driveSettings().root}" of the invoice agent was not found (nothing filed yet?)`);
  rootId = f.id;
  return rootId;
}

async function readJson(fileId) {
  return (await files().get({ fileId, alt: "media" }, { responseType: "json" })).data;
}

let cache = { at: 0, value: null };
/**
 * Every company folder with its index: [{ folderId, name, indexId, modifiedTime, index: { company, invoices: [...], updated_at } }].
 * The `_unmatched` folder (invoices of no company of ours) is listed too, with unmatched: true.
 */
export async function listCompanyIndexes({ fresh = false } = {}) {
  if (!fresh && cache.value && Date.now() - cache.at < CACHE_MS) return cache.value;
  const parent = await root();
  const r = await files().list({ q: `${quote(parent)} in parents and mimeType='${FOLDER}' and trashed=false`, fields: "files(id,name)", pageSize: 200 });
  const out = [];
  for (const folder of r.data.files || []) {
    const idx = await findOne(`name='index.json' and ${quote(folder.id)} in parents`);
    if (!idx) continue;
    const index = await readJson(idx.id);
    if (!index || !Array.isArray(index.invoices)) continue;
    out.push({ folderId: folder.id, name: folder.name, indexId: idx.id, modifiedTime: idx.modifiedTime, index, unmatched: folder.name === "_unmatched" });
  }
  cache = { at: Date.now(), value: out };
  return out;
}
export const forgetIndexes = () => (cache = { at: 0, value: null });

/**
 * Writes the match flags into a company's index.json: `flags` = Map(drive_file_id → books). The index is read again
 * right before writing, so rows the agent filed in the meantime are kept (the agent, on its side, keeps `books` of
 * rows it did not touch). Returns how many rows were changed.
 */
export async function writeFlags(indexId, flags) {
  if (!flags.size) return 0;
  const index = await readJson(indexId);
  if (!index || !Array.isArray(index.invoices)) throw new Error("index.json changed shape while writing the flags");
  let changed = 0;
  for (const inv of index.invoices) {
    const f = flags.get(inv.drive_file_id);
    if (!f) continue;
    inv.books = f;
    changed++;
  }
  if (!changed) return 0;
  index.books_checked_at = new Date().toISOString();
  const bytes = Buffer.from(JSON.stringify(index, null, 2));
  await files().update({ fileId: indexId, media: { mimeType: "application/json", body: Readable.from([bytes]) } });
  forgetIndexes();
  return changed;
}
