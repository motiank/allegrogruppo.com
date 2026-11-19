// Legal update — new court papers from נט המשפט into the legal archive (owner 2026-11-19: "update the folder on the
// drive from נט המשפט … by clicking update on the hq app … on my computer, with the chrome extension installed").
//
// Three parts work together; Joya is only the meeting point and keeps the papers a short time:
//   1. the Joya Legal browser extension (../../legal-extension) in the user's Chrome: the user logs in to נט המשפט in
//      a normal tab, the extension reads every case's paper list, fetches the papers the archive does not hold, and
//      sends them here through the open Joya page (cases, then the PDFs in small chunks);
//   2. this inbox: one folder per update run ("batch") under JOYA_LEGAL_INBOX (default ~/.joya-legal-inbox);
//   3. the legal agent on the owner's computer (~/legal/_tools/sync_agent.mjs), which holds the archive and the tools:
//      it asks for a ready batch (X-Joya-Key), files it, runs OCR / descriptions / catalog / Drive upload and reports.
//      After its report the PDFs are removed from the inbox.
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

export const INBOX = process.env.JOYA_LEGAL_INBOX || path.join(os.homedir(), '.joya-legal-inbox');
const AGENT_FILE = () => path.join(INBOX, 'agent.json');
const AGENT_ALIVE_MS = 12 * 60 * 1000; // the agent asks every few minutes
const MAX_FILE = 80 * 1024 * 1024;
const MAX_BATCH_FILES = 3000;
const OPEN_STALE_MS = 3 * 3600 * 1000; // an open batch nobody finished (the tab was closed)

const err = (code, message) => Object.assign(new Error(message), { code });
const readJson = (p, d = null) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return d;
  }
};
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(v), { mode: 0o600 });
  fs.renameSync(tmp, p);
};
const okId = (id) => /^[a-z0-9]{6,14}-[a-f0-9]{8}$/.test(String(id || ''));
const dirOf = (id) => {
  if (!okId(id)) throw err('BAD_REQUEST', 'bad batch id');
  return path.join(INBOX, id);
};
const docNo = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw err('BAD_REQUEST', 'bad document id');
  return n;
};
const load = (id) => {
  const b = readJson(path.join(dirOf(id), 'batch.json'));
  if (!b) throw err('NOT_FOUND', 'no such update run');
  return b;
};
const save = (b) => writeJson(path.join(dirOf(b.id), 'batch.json'), b);

/** What the page shows of a batch (no paper lists). */
const brief = (b) => ({
  id: b.id,
  person: b.person,
  by: b.by,
  state: b.state, // open (the extension is sending) | ready (waits for the agent) | taken (the agent works) | done | failed
  startedAt: b.startedAt,
  finishedAt: b.finishedAt || null,
  doneAt: b.doneAt || null,
  cases: Object.keys(b.cases || {}).length,
  files: Object.keys(b.files || {}).length,
  bytes: Object.values(b.files || {}).reduce((s, f) => s + (f.bytes || 0), 0),
  summary: b.summary || null,
  step: b.step || null,
  result: b.result || null,
  error: b.error || null,
});

export function agentState() {
  const a = readJson(AGENT_FILE());
  return { online: !!a && Date.now() - new Date(a.at).getTime() < AGENT_ALIVE_MS, lastSeen: a?.at || null, host: a?.host || null };
}

export function listBatches(limit = 6) {
  if (!fs.existsSync(INBOX)) return [];
  const out = [];
  for (const d of fs.readdirSync(INBOX)) {
    if (!okId(d)) continue;
    const b = readJson(path.join(INBOX, d, 'batch.json'));
    if (!b) continue;
    if (b.state === 'open' && Date.now() - new Date(b.startedAt).getTime() > OPEN_STALE_MS) {
      b.state = 'failed';
      b.error = 'the update was not finished (the page or the court tab was closed)';
      removeFiles(b);
      save(b);
    }
    out.push(b);
  }
  return out.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)).slice(0, limit).map(brief);
}

export function start({ person, by }) {
  if (!/^[a-z]{2,20}$/.test(String(person || ''))) throw err('BAD_REQUEST', 'person is required');
  const busy = listBatches(20).find((b) => b.person === person && ['open', 'ready', 'taken'].includes(b.state));
  if (busy && busy.state !== 'open') throw err('CONFLICT', 'an update of this archive is still being processed');
  if (busy) {
    // a run that was started and left: close it, its papers are asked again
    const old = load(busy.id);
    old.state = 'failed';
    old.error = 'replaced by a new update run';
    removeFiles(old);
    save(old);
  }
  const id = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  const b = { id, person, by: by || null, state: 'open', startedAt: new Date().toISOString(), cases: {}, files: {} };
  save(b);
  return brief(b);
}

const CASE_FIELDS = ['caseID', 'number', 'name', 'court', 'type', 'subject', 'status'];
const ROW_FIELDS = ['DocumentID', 'DocumentType', 'DocumentDesc', 'PresentationDate', 'CasePartyDisplayName', 'attachmentOf'];

/** One case as the extension read it from the site: its details and the full list of its papers. */
export function putCase(id, c) {
  const b = load(id);
  if (b.state !== 'open') throw err('CONFLICT', 'this update run is closed');
  if (!/^\d+-\d\d-\d\d$/.test(String(c?.number || '')) || !Number.isInteger(Number(c?.caseID))) throw err('BAD_REQUEST', 'bad case');
  const rows = (Array.isArray(c.rows) ? c.rows : []).slice(0, 5000).map((r) => {
    const o = {};
    for (const k of ROW_FIELDS) o[k] = k === 'DocumentID' || k === 'attachmentOf' ? Number(r?.[k]) || 0 : String(r?.[k] ?? '').slice(0, 400);
    return o;
  }).filter((r) => r.DocumentID > 0);
  const o = { rows };
  for (const k of CASE_FIELDS) o[k] = k === 'caseID' ? Number(c.caseID) : String(c[k] ?? '').slice(0, 300);
  b.cases[o.number] = o;
  save(b);
  return { ok: true, rows: rows.length };
}

/** A piece of one paper; the last piece closes the file after a check that it is a PDF. */
export function putChunk(id, { doc, caseNumber, index, last }, buf) {
  const b = load(id);
  if (b.state !== 'open') throw err('CONFLICT', 'this update run is closed');
  const n = docNo(doc);
  if (!b.cases[caseNumber]) throw err('BAD_REQUEST', 'the case of this paper was not sent first');
  if (!Buffer.isBuffer(buf) || !buf.length) throw err('BAD_REQUEST', 'empty piece');
  if (Object.keys(b.files).length >= MAX_BATCH_FILES && !b.files[n]) throw err('BAD_REQUEST', 'too many papers in one update run');
  const part = path.join(dirOf(id), `${n}.part`);
  const i = Number(index) || 0;
  if (i === 0) fs.writeFileSync(part, buf, { mode: 0o600 });
  else {
    if (!fs.existsSync(part)) throw err('BAD_REQUEST', 'the first piece is missing');
    if (fs.statSync(part).size + buf.length > MAX_FILE) {
      fs.rmSync(part, { force: true });
      throw err('BAD_REQUEST', 'the paper is too big');
    }
    fs.appendFileSync(part, buf);
  }
  if (!last) return { ok: true };
  const fd = fs.openSync(part, 'r');
  const head = Buffer.alloc(5);
  fs.readSync(fd, head, 0, 5, 0);
  fs.closeSync(fd);
  if (head.toString('latin1') !== '%PDF-') {
    fs.rmSync(part, { force: true });
    throw err('BAD_REQUEST', 'the file is not a PDF');
  }
  fs.renameSync(part, path.join(dirOf(id), `${n}.pdf`));
  b.files[n] = { case: caseNumber, bytes: fs.statSync(path.join(dirOf(id), `${n}.pdf`)).size };
  save(b);
  return { ok: true, saved: true, bytes: b.files[n].bytes };
}

/** The extension is done: the batch waits for the agent (or is closed at once when nothing new came). */
export function finish(id, summary) {
  const b = load(id);
  if (b.state !== 'open') return brief(b);
  b.finishedAt = new Date().toISOString();
  b.summary = summary && typeof summary === 'object' ? JSON.parse(JSON.stringify(summary).slice(0, 20000)) : null;
  for (const f of fs.readdirSync(dirOf(id))) if (f.endsWith('.part')) fs.rmSync(path.join(dirOf(id), f), { force: true });
  if (!Object.keys(b.files).length && !b.summary?.newCases) {
    b.state = 'done';
    b.doneAt = b.finishedAt;
    b.result = { nothingNew: true };
  } else b.state = 'ready';
  save(b);
  return brief(b);
}

/** An update that was left in the middle (the court tab or the page was closed, the user stopped it): close it. */
export function cancel(id, why) {
  const b = load(id);
  if (b.state !== 'open') return brief(b);
  b.state = 'failed';
  b.doneAt = new Date().toISOString();
  b.error = String(why || 'cancelled').slice(0, 300);
  removeFiles(b);
  save(b);
  return brief(b);
}

function removeFiles(b) {
  const d = dirOf(b.id);
  if (!fs.existsSync(d)) return;
  for (const f of fs.readdirSync(d)) if (/\.(pdf|part)$/.test(f)) fs.rmSync(path.join(d, f), { force: true });
}

// ---------------------------------------------------------------- the agent's side (X-Joya-Key)

/** The agent says it is alive and gets the oldest batch that waits (with the manifest that file_in.mjs reads). */
export function agentPoll({ host } = {}) {
  writeJson(AGENT_FILE(), { at: new Date().toISOString(), host: String(host || '').slice(0, 80) });
  const ids = fs.readdirSync(INBOX).filter(okId).sort();
  for (const id of ids) {
    const b = readJson(path.join(INBOX, id, 'batch.json'));
    if (!b || (b.state !== 'ready' && b.state !== 'taken')) continue;
    b.state = 'taken';
    b.takenAt = new Date().toISOString();
    save(b);
    const byCase = {};
    for (const [doc, f] of Object.entries(b.files)) (byCase[f.case] ||= {})[doc] = `${doc}.pdf`;
    return {
      batch: {
        id: b.id,
        by: b.by,
        files: Object.entries(b.files).map(([doc, f]) => ({ doc: Number(doc), bytes: f.bytes })),
        manifest: { person: b.person, cases: Object.values(b.cases).map((c) => ({ ...c, files: byCase[c.number] || {} })) },
      },
    };
  }
  return { batch: null };
}

export function agentFile(id, doc) {
  const p = path.join(dirOf(id), `${docNo(doc)}.pdf`);
  if (!fs.existsSync(p)) throw err('NOT_FOUND', 'no such paper in this update run');
  return p;
}

/** The agent's progress and end: step = a short line while it works; state done / failed closes the batch. */
export function agentReport(id, { state, step, result, error } = {}) {
  const b = load(id);
  writeJson(AGENT_FILE(), { ...(readJson(AGENT_FILE()) || {}), at: new Date().toISOString() });
  if (step) b.step = String(step).slice(0, 200);
  if (state === 'done' || state === 'failed') {
    b.state = state;
    b.doneAt = new Date().toISOString();
    b.step = null;
    b.result = result && typeof result === 'object' ? JSON.parse(JSON.stringify(result).slice(0, 20000)) : null;
    b.error = error ? String(error).slice(0, 500) : null;
    if (state === 'done') removeFiles(b); // the papers now live in the archive
  }
  save(b);
  return { ok: true };
}
