// Bank update — the bank's moves and the new cheque pictures from the Bank Hapoalim business site into the admin
// (owner 2026-11-22: "update the bank data in the system the same way we have with the legal: click the button, it
// opens the login to the Poalim bank, downloads the missing bank data of the Allegro account and the Pasta Lina account
// and pushes it to the database — the transactions, the transfers, and the new cheque images").
//
// Three parts, like the legal update (legalSync.js), but Joya keeps NOTHING here — the admin stores at once:
//   1. the Joya browser extension (../../joya-extension, bank part) in the user's Chrome: the user logs in to the bank
//      in a normal tab, the extension reads the site's own JSON (transactions per account, then the picture of every
//      paid cheque the archive lacks) and sends it here through the open Joya page;
//   2. this service: a thin pass-through to the admin's Local Data API (/bank/sync/*, admin rights in the X-Joya-*
//      headers) plus a small record of the last runs (JOYA_BANK_SYNC_DIR/runs.json) for the System page;
//   3. the admin (admin/server/modules/bankSync.js): bank_transactions (same row shape and keys as the Excel upload, so
//      nothing is stored twice) and the Drive cheque archive (chequeArchive.js addChequeImage).
// The transaction status file (סטטוס עסקאות) is not fetched from the site yet (the admin's plan says events.supported
// = false); the Upload page still takes it.
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { apiBase, clearCache as clearAllegroCache } from '../../lib/allegro.js';
import log from '../../lib/log.js';

// Where the run records live: JOYA_BANK_SYNC_DIR, else next to the legal inbox (the service user on the droplet has no
// home folder — HOME is unset, os.homedir() gives /nonexistent), else ~/.joya-bank-sync. The records are only for the
// System page: when the folder cannot be written they stay in memory and a warning is logged, the update itself goes on.
export const DIR =
  process.env.JOYA_BANK_SYNC_DIR || (process.env.JOYA_LEGAL_INBOX ? path.join(path.dirname(process.env.JOYA_LEGAL_INBOX), 'joya-bank-sync') : path.join(os.homedir(), '.joya-bank-sync'));
const RUNS = () => path.join(DIR, 'runs.json');
const KEEP = 12;
const OPEN_STALE_MS = 3 * 3600 * 1000; // a run nobody finished (the tab or the page was closed)

const err = (code, message) => Object.assign(new Error(message), { code });
let memory = null; // the runs when the folder is not writable
let warned = false;
const readRuns = () => {
  if (memory) return memory;
  try {
    const v = JSON.parse(fs.readFileSync(RUNS(), 'utf8'));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};
const writeRuns = (runs) => {
  const list = runs.slice(0, KEEP);
  if (memory) {
    memory = list;
    return;
  }
  try {
    fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
    const tmp = `${RUNS()}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(list), { mode: 0o600 });
    fs.renameSync(tmp, RUNS());
  } catch (e) {
    memory = list;
    if (!warned) {
      warned = true;
      log.warn(`[bank-sync] the run records cannot be written to ${DIR} (${e.code || e.message}) — kept in memory only; set JOYA_BANK_SYNC_DIR to a writable folder`);
    }
  }
};
const okId = (id) => /^[a-z0-9]{6,14}-[a-f0-9]{8}$/.test(String(id || ''));
const load = (id) => {
  if (!okId(id)) throw err('BAD_REQUEST', 'bad run id');
  const runs = readRuns();
  const r = runs.find((x) => x.id === id);
  if (!r) throw err('NOT_FOUND', 'no such update run');
  return { runs, r };
};
const save = (runs) => writeRuns(runs.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)));
const trim = (v, n = 20000) => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v).slice(0, n)) : null);

// ---------------------------------------------------------------- the admin's Local Data API, as an admin

const adminHeaders = (access) => ({ 'X-Joya-Admin': '1', 'X-Joya-User': String(access?.username || '') });

export async function admin(path, { method = 'GET', access, json, raw, contentType, timeout = 180_000 } = {}) {
  let res;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      method,
      headers: { ...adminHeaders(access), ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(raw ? { 'Content-Type': contentType || 'application/octet-stream' } : {}) },
      body: json !== undefined ? JSON.stringify(json) : raw || undefined,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    throw err('UPSTREAM', `Allegro API: not reachable (${e.cause?.code || e.name})`);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const code = res.status === 404 && body?.error?.code !== 'not_found' ? 'NOT_SUPPORTED' : res.status === 400 ? 'BAD_REQUEST' : res.status === 404 ? 'NOT_FOUND' : res.status === 403 ? 'FORBIDDEN' : res.status === 409 ? 'CONFLICT' : res.status === 503 || body?.error?.code === 'not_loaded' ? 'NOT_LOADED' : 'UPSTREAM';
    throw err(code, `Allegro API: ${res.status} ${body?.error?.message || res.statusText}`);
  }
  return { data: body?.data, meta: body?.meta || {} };
}

/** What to fetch (the admin's plan): accounts with the last stored day and the window, the cheque archive state. */
export async function plan(access) {
  return (await admin('/bank/sync/plan', { access })).data;
}

// ---------------------------------------------------------------- runs

/** What the page shows: the last runs, newest first. */
export function listRuns(limit = 6) {
  const runs = readRuns();
  let changed = false;
  for (const r of runs) {
    if (r.state === 'open' && Date.now() - new Date(r.startedAt).getTime() > OPEN_STALE_MS) {
      r.state = 'failed';
      r.error = 'the update was not finished (the page or the bank tab was closed)';
      r.doneAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) save(runs);
  return runs.slice(0, limit);
}

/** A new run; an older run left open is closed as failed. Returns the run. */
export function start({ by, plan: p }) {
  const runs = readRuns();
  for (const r of runs) {
    if (r.state !== 'open') continue;
    r.state = 'failed';
    r.error = 'replaced by a new update run';
    r.doneAt = new Date().toISOString();
  }
  const run = {
    id: `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`,
    by: by || null,
    state: 'open', // open (the extension works) | done | failed
    startedAt: new Date().toISOString(),
    accounts: (p?.accounts || []).map((a) => ({ account: a.account, company: a.company, companyLabel: a.companyLabel, from: a.from, to: a.to, rows: 0, newRows: 0, alreadyStored: 0, images: 0, imagesSkipped: 0, imageErrors: 0 })),
    step: null,
    summary: null,
    error: null,
  };
  runs.unshift(run);
  save(runs);
  return run;
}

const accountOf = (r, account) => {
  let a = r.accounts.find((x) => x.account === account);
  if (!a) {
    a = { account, rows: 0, newRows: 0, alreadyStored: 0, images: 0, imagesSkipped: 0, imageErrors: 0 };
    r.accounts.push(a);
  }
  return a;
};

/** The site's transaction rows of one account → the admin. Returns the admin's result. */
export async function transactions(access, id, { account, rows, from, to }) {
  const { runs, r } = load(id);
  if (r.state !== 'open') throw err('CONFLICT', 'this update run is closed');
  if (!account) throw err('BAD_REQUEST', 'account is required');
  if (!Array.isArray(rows)) throw err('BAD_REQUEST', 'rows must be an array');
  const out = (await admin('/bank/sync/transactions', { method: 'POST', access, json: { account, rows, from, to } })).data;
  const a = accountOf(r, account);
  a.rows += out.rows || 0;
  a.newRows += out.newRows || 0;
  a.alreadyStored += out.alreadyStored || 0;
  if (out.from && (!a.gotFrom || out.from < a.gotFrom)) a.gotFrom = out.from;
  if (out.to && (!a.gotTo || out.to > a.gotTo)) a.gotTo = out.to;
  r.step = `${account}: ${a.newRows} new rows`;
  save(runs);
  if (out.newRows) clearAllegroCache(); // the new rows are seen at once
  return out;
}

/** The paid cheques of one account that have no picture in the archive yet (the admin decides). */
export async function cheques(access, id, account, { since } = {}) {
  load(id);
  if (!account) throw err('BAD_REQUEST', 'account is required');
  const { data, meta } = await admin(`/bank/sync/cheques?account=${encodeURIComponent(account)}${since ? `&since=${encodeURIComponent(since)}` : ''}`, { access });
  return { cheques: data || [], ...meta };
}

/** One cheque picture → the admin → the Drive archive. */
export async function chequeImage(access, id, { account, date, reference, amount }, buffer, contentType) {
  const { runs, r } = load(id);
  if (r.state !== 'open') throw err('CONFLICT', 'this update run is closed');
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw err('BAD_REQUEST', 'empty picture');
  const q = new URLSearchParams({ account: String(account || ''), date: String(date || ''), reference: String(reference || ''), amount: String(amount || '') });
  const a = accountOf(r, account);
  try {
    const out = (await admin(`/bank/sync/cheque-image?${q}`, { method: 'POST', access, raw: buffer, contentType: contentType || 'image/jpeg' })).data;
    if (out.skipped) a.imagesSkipped++;
    else a.images++;
    r.step = `${account}: ${a.images} cheque pictures`;
    save(runs);
    return out;
  } catch (e) {
    a.imageErrors++;
    save(runs);
    throw e;
  }
}

/** The bank site has no picture of this cheque (owner 2026-11-28): the admin writes a placeholder, so it is not asked again. */
export async function chequeNoImage(access, id, { account, date, reference, amount, reason }) {
  const { runs, r } = load(id);
  if (r.state !== 'open') throw err('CONFLICT', 'this update run is closed');
  const a = accountOf(r, account);
  const out = (await admin('/bank/sync/cheque-no-image', { method: 'POST', access, json: { account, date, reference, amount, reason: reason || null } })).data;
  if (!out.skipped) a.imagesEmpty = (a.imagesEmpty || 0) + 1;
  save(runs);
  return out;
}

/** The extension is done (or stopped / failed): the run is closed with its summary; the admin writes its archive index now. */
export async function finish(access, id, { summary, error } = {}) {
  const { runs, r } = load(id);
  if (r.state !== 'open') return r;
  r.state = error ? 'failed' : 'done';
  r.doneAt = new Date().toISOString();
  r.step = null;
  r.summary = trim(summary);
  r.error = error ? String(error).slice(0, 300) : null;
  save(runs);
  if (r.accounts.some((a) => a.newRows)) clearAllegroCache();
  await admin('/bank/sync/finish', { method: 'POST', access, json: {} }).catch((e) => log.warn(`[bank-sync] the admin did not write the archive index now: ${e.message}`));
  return r;
}

export const cancel = (access, id, why) => finish(access, id, { error: why || 'cancelled' });

/** For the System page: the runs and whether one is open. */
export function state() {
  const runs = listRuns();
  return { runs, open: runs.find((r) => r.state === 'open') || null };
}
