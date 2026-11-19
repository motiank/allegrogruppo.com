// The legal archive in Google Drive — the court cases (נט המשפט) of the owners, one folder per person, with a catalog
// the owner's machine builds (~/legal/_tools: catalog.mjs, drive_upload.mjs). Owner 2026-11-18: "create api in the
// allegro admin that manage the legal part … complete browsing and download of any file", for Joya's Legal area and
// questions like "what was the story with <a claimant>", "what was the verdict", "the last decision", "when is the
// next hearing". Structure in Drive:
//   <root folder>/<person>/catalog.json                     { person, builtAt, cases: [ case … ] }
//   <root folder>/<person>/<YY-MM number name>/<paper>.pdf  the court papers
//   <root folder>/<person>/<YY-MM number name>/.text/<documentID>.txt   the paper's plain text (OCR for scans)
// A case: caseID, number ("68499-05-26"), name, court, type, subject, status ("פתוח" | "סגור"), opened, closed, folder,
// downloaded, scope ("all" | "claim_and_verdict" — a closed case holds only the opening paper and the verdict),
// complete, summary (1–2 Hebrew sentences), history (the long story), outcome, amount, parties [{ role, name }],
// judges, sittings [{ date "dd/mm/yyyy", time, type, status, judge }], missing, documents (oldest first):
// documentID, date, type, detail, by, kind (document | attachment), attachmentOf, file, pages, hasText, key (a paper
// the AI read: claim, defence, decision, verdict), description (Hebrew), descriptionSource (ai | rule), result,
// amount, driveId, textDriveId.
//
// This module reads the catalogs with the invoice agent's Google login (invoiceDrive.js; the agent's login uploaded
// these files, so scope drive.file sees them; the root folder is the owner's and cannot be `get`, but listing its
// children works), keeps them 5 minutes in memory, and streams a paper by its Drive id — only ids that are in a
// catalog. Nothing is stored in the DB and nothing is written to Drive.
//
// Settings: LEGAL_ARCHIVE_FOLDER = the root folder id in Drive (default: the owner's "legal" folder); the Google
// files are the agent's (INVOICE_DRIVE_CREDENTIALS, INVOICE_DRIVE_TOKEN).
import { driveFiles, driveQuote, driveUnavailable, readDriveJson } from "./invoiceDrive.js";

const FOLDER = "application/vnd.google-apps.folder";
const CACHE_MS = 5 * 60 * 1000; // the catalog is rebuilt by hand after a download; 5 minutes is soon enough
const DEFAULT_ROOT = "1F3sT00qtcUQpO9qG7iwnMD4RQcx276LS";
export const legalRootId = (env = process.env) => env.LEGAL_ARCHIVE_FOLDER || DEFAULT_ROOT;

// ── words ────────────────────────────────────────────────────────────────

const FINALS = { "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" };
/** Lower case, Hebrew final letters as regular ones, quote marks and punctuation as spaces. */
export const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[ךםןףץ]/g, (ch) => FINALS[ch])
    .replace(/["'`׳״.,;:()\[\]\-–/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// A name is typed in Hebrew or in Latin letters, with or without the vowel letters ("בלודמן", "בלדמן", "baldman",
// "bludman"): both sides are reduced to a consonant skeleton in Latin letters and compared.
const HEB = { "ב": "b", "ג": "g", "ד": "d", "ז": "z", "ח": "h", "ט": "t", "כ": "k", "ל": "l", "מ": "m", "נ": "n", "ס": "s", "פ": "p", "צ": "s", "ק": "k", "ר": "r", "ש": "s", "ת": "t" };
/** The consonant skeleton of one word, in Latin letters ("בלודמן" → "bldmn", "Baldman" → "bldmn"). */
export function skeleton(word) {
  const w = norm(word);
  if (/[א-ת]/.test(w)) return [...w].map((ch) => HEB[ch] ?? "").join("");
  return w
    .replace(/sch|sh|tz|ts/g, "s")
    .replace(/ch|kh/g, "h")
    .replace(/ph|f/g, "p")
    .replace(/[vw]/g, "b")
    .replace(/[cq]/g, "k")
    .replace(/x/g, "ks")
    .replace(/[aeiouy]/g, "")
    .replace(/[^a-z]/g, "")
    .replace(/(.)\1+/g, "$1");
}

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
/** "21/12/2026", "1.2.2027", "23.11.26" → "2026-12-21"; null when it is not a date. */
export function isoDate(s) {
  const m = String(s ?? "").match(/^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})$/);
  if (!m) return /^\d{4}-\d{2}-\d{2}/.test(String(s ?? "")) ? String(s).slice(0, 10) : null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const mo = Number(m[2]), d = Number(m[1]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// ── a case (pure) ────────────────────────────────────────────────────────

const VERDICT = /^(פסק דין|גזר דין|הכרעת דין)/;
const DECISION = /^(החלטה|פסק דין|גזר דין|הכרעת דין)/;
const HEARING_NOTICE = /^(זימון|הזמנה לדין|הזמנה לנאשם)/;
const isMain = (d) => d.kind !== "attachment";
const OFF = /בוטל|נדחה/; // a sitting that was cancelled or moved to another date is not a hearing ahead

/** The dates after `from` that a text mentions, each with its sentence: [{ date, text }] (a hearing set in a decision). */
export function datesAhead(text, from = today()) {
  const out = [];
  for (const sentence of String(text ?? "").split(/(?<=[.!?])\s+|\n+/)) {
    for (const m of sentence.matchAll(/(?<![\d./])(\d{1,2}[./]\d{1,2}[./](?:\d{4}|\d{2}))(?![\d])/g)) {
      const d = isoDate(m[1]);
      if (d && d > from && !out.some((x) => x.date === d)) out.push({ date: d, text: sentence.trim().slice(0, 300) });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

const paper = (d) =>
  d && {
    documentID: d.documentID, date: d.date, type: d.type, detail: d.detail || "", by: d.by || "", description: d.description,
    ...(d.result ? { result: d.result } : {}), ...(d.amount ? { amount: d.amount } : {}), file: d.driveId || null,
  };

/**
 * What a reader asks first about a case (pure): the verdict, the last decision, the hearings ahead.
 * { verdict, lastDecision, nextHearing, hearings (scheduled, from the court's list), datesMentioned (future dates in
 * the last decisions — a hearing or a deadline, by the sentence), hearingNotices (the last summons papers) }
 */
export function keyFacts(c, day = today()) {
  const docs = (c.documents || []).filter(isMain);
  const verdicts = docs.filter((d) => VERDICT.test(d.type || ""));
  const decisions = docs.filter((d) => DECISION.test(d.type || ""));
  const last = decisions[decisions.length - 1] || null;
  const hearings = (c.sittings || [])
    .map((s) => ({ date: isoDate(s.date), time: s.time || "", type: s.type || "", status: s.status || "", judge: s.judge || "" }))
    .filter((s) => s.date)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const ahead = hearings.filter((s) => s.date >= day && !OFF.test(s.status));
  const mentioned = [];
  for (const d of decisions.slice(-4).reverse()) {
    for (const x of datesAhead(`${d.result || ""} ${d.description || ""}`, day)) if (!mentioned.some((y) => y.date === x.date)) mentioned.push({ ...x, from: { documentID: d.documentID, date: d.date, type: d.type } });
  }
  mentioned.sort((a, b) => (a.date < b.date ? -1 : 1));
  return {
    verdict: paper(verdicts[verdicts.length - 1]) || null,
    lastDecision: paper(last) || null,
    nextHearing: ahead[0] || null,
    hearings,
    datesMentioned: mentioned,
    hearingNotices: docs.filter((d) => HEARING_NOTICE.test(d.type || "")).slice(-3).map((d) => ({ documentID: d.documentID, date: d.date, type: d.type, detail: d.detail || "" })),
  };
}

/** A case without its documents, with the key facts — a row of the case list. */
export function caseHead(c, day = today()) {
  const { documents, ...head } = c;
  const k = c.downloaded ? keyFacts(c, day) : null;
  return {
    ...head,
    ...(k ? { verdictDate: k.verdict?.date || null, lastDecisionDate: k.lastDecision?.date || null, nextHearing: k.nextHearing, nextDateMentioned: k.nextHearing ? null : k.datesMentioned[0] || null } : {}),
  };
}

/**
 * How well a case answers the words `q` (pure): 0 = not at all. The case number wins; then a name of the case or of a
 * party (exact letters, else the consonant skeleton — "baldman" finds "בלודמן"); then the subject, the court and the story.
 * Every word of q must be found somewhere. `q` may hold several spellings apart by "|": the best one counts.
 */
export function matchScore(c, q) {
  const alts = String(q ?? "").split("|").map((s) => s.trim()).filter(Boolean);
  if (!alts.length) return 1;
  const names = norm([c.name, ...(c.parties || []).map((p) => p.name)].join(" "));
  const nameSk = names.split(" ").map(skeleton).filter(Boolean);
  const meta = norm([c.subject, c.court, c.type, c.judges].join(" "));
  const story = norm([c.summary, c.history, c.outcome].join(" "));
  let best = 0;
  for (const alt of alts) {
    if (String(c.number) === alt || String(c.number).startsWith(alt + "-") || String(c.caseID) === alt) return 100;
    const words = norm(alt).split(" ").filter(Boolean);
    if (!words.length) continue;
    let score = 0, all = true;
    for (const w of words) {
      const sk = skeleton(w);
      if (names.includes(w)) score += 60;
      else if (sk.length >= 3 && nameSk.some((n) => n === sk || (sk.length >= 4 && n.includes(sk)))) score += 40;
      else if (meta.includes(w)) score += 25;
      else if (story.includes(w)) score += 15;
      else { all = false; break; }
    }
    if (all) best = Math.max(best, Math.round(score / words.length));
  }
  return best;
}

// ── the archive (pure, over the loaded catalogs) ─────────────────────────

/**
 * The cases of the archive, one row per case number. The same case can sit in two people's folders (a case both are
 * a party of): the copy with more papers is kept and `people` names both.
 * @param {Array<{ person, cases }>} catalogs
 */
export function allCases(catalogs, person = null) {
  const byNumber = new Map();
  for (const cat of catalogs) {
    if (person && cat.person !== person) continue;
    for (const c of cat.cases || []) {
      const row = { ...c, person: cat.person };
      const prev = byNumber.get(c.number);
      if (!prev) byNumber.set(c.number, { ...row, people: [cat.person] });
      else {
        const better = (row.documents?.length || 0) > (prev.documents?.length || 0) ? row : prev;
        byNumber.set(c.number, { ...better, people: [...new Set([...prev.people, cat.person])] });
      }
    }
  }
  return [...byNumber.values()];
}

const ym = (n) => {
  const m = String(n).match(/^\d+-(\d\d)-(\d\d)$/);
  return m ? Number(m[2]) * 100 + Number(m[1]) : 0;
};
const newestFirst = (a, b) => ym(b.number) - ym(a.number) || (b.caseID || 0) - (a.caseID || 0);

/**
 * The case list, filtered: person, q (number / a party's name / words of the story), status "open" | "closed",
 * downloaded (true = only cases with papers), from / to (the case's last paper date). Best match first when q is
 * given, else newest case first. → { rows (heads), total }
 */
export function listCases(catalogs, p = {}, day = today()) {
  let rows = allCases(catalogs, p.person || null);
  if (p.status === "open") rows = rows.filter((c) => c.status === "פתוח");
  if (p.status === "closed") rows = rows.filter((c) => c.status === "סגור");
  if (p.downloaded != null) rows = rows.filter((c) => !!c.downloaded === !!p.downloaded);
  if (p.from) rows = rows.filter((c) => (c.lastDate || "") >= p.from);
  if (p.to) rows = rows.filter((c) => (c.firstDate || c.lastDate || "9999") <= p.to);
  if (p.q) {
    rows = rows.map((c) => ({ c, s: matchScore(c, p.q) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || newestFirst(a.c, b.c)).map((x) => ({ ...x.c, match: x.s }));
  } else rows.sort(newestFirst);
  const total = rows.length;
  const limit = Math.min(Math.max(Number(p.limit) || 300, 1), 500);
  return { rows: rows.slice(0, limit).map((c) => caseHead(c, day)), total };
}

/** One case by its number (or caseID), with the documents and the key facts; null when it is not in the archive. */
export function findCase(catalogs, number, person = null, day = today()) {
  const c = allCases(catalogs, person).find((x) => String(x.number) === String(number) || String(x.caseID) === String(number));
  if (!c) return null;
  return { ...c, documents: c.documents || [], facts: c.downloaded ? keyFacts(c, day) : null };
}

/**
 * The hearings ahead (or in a period), over all cases: the court's scheduled sittings, and — for a case with no
 * sittings list — the future dates its last decisions mention (source "decision": may be a hearing or a deadline).
 */
export function hearings(catalogs, p = {}, day = today()) {
  const from = p.from || day, to = p.to || "9999-12-31";
  const out = [];
  for (const c of allCases(catalogs, p.person || null)) {
    if (!c.downloaded) continue;
    const k = keyFacts(c, from < day ? from : day);
    const base = { number: c.number, name: c.name, court: c.court, status: c.status, person: c.person };
    const sched = k.hearings.filter((s) => s.date >= from && s.date <= to && (p.cancelled || !OFF.test(s.status)));
    for (const s of sched) out.push({ ...base, ...s, source: "court" });
    if (!k.hearings.length && c.status === "פתוח") for (const m of k.datesMentioned.filter((x) => x.date >= from && x.date <= to)) out.push({ ...base, date: m.date, time: "", type: "", status: "", text: m.text, source: "decision", from: m.from });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Papers by words (type, detail, sender, description), over all cases or one: person, number, q, type, key, from, to, limit. */
export function searchDocuments(catalogs, p = {}) {
  const words = norm(p.q).split(" ").filter(Boolean);
  const type = norm(p.type);
  const rows = [];
  for (const c of allCases(catalogs, p.person || null)) {
    if (p.number && String(c.number) !== String(p.number)) continue;
    for (const d of c.documents || []) {
      if (p.key != null && !!d.key !== !!p.key) continue;
      if (type && !norm(d.type).includes(type)) continue;
      if (p.from && (d.date || "") < p.from) continue;
      if (p.to && (d.date || "9999") > p.to) continue;
      if (words.length) {
        const hay = norm([d.type, d.detail, d.by, d.description, d.result].join(" "));
        if (!words.every((w) => hay.includes(w))) continue;
      }
      rows.push({ number: c.number, caseName: c.name, person: c.person, ...paper(d), kind: d.kind, key: !!d.key, pages: d.pages || 0 });
    }
  }
  rows.sort((a, b) => ((a.date || "") < (b.date || "") ? 1 : -1));
  const limit = Math.min(Math.max(Number(p.limit) || 50, 1), 500);
  return { rows: rows.slice(0, limit), total: rows.length };
}

// ── Drive ────────────────────────────────────────────────────────────────

let cache = { at: 0, value: null, error: null };
/**
 * The catalog of every person folder: { catalogs: [{ person, folderId, catalogId, modifiedTime, builtAt, cases }], error, at }.
 * Drive down or not configured → [] and `error` says why (kept 5 minutes too).
 */
export async function loadLegalArchive({ fresh = false } = {}) {
  if (!fresh && cache.at && Date.now() - cache.at < CACHE_MS) return { catalogs: cache.value || [], error: cache.error, at: cache.at };
  const why = driveUnavailable();
  if (why) {
    cache = { at: Date.now(), value: [], error: why };
    return { catalogs: [], error: why, at: cache.at };
  }
  try {
    const files = driveFiles();
    const r = await files.list({ q: `${driveQuote(legalRootId())} in parents and mimeType='${FOLDER}' and trashed=false`, fields: "files(id,name)", pageSize: 50 });
    const out = [];
    for (const folder of r.data.files || []) {
      const idx = await files.list({ q: `name='catalog.json' and ${driveQuote(folder.id)} in parents and trashed=false`, fields: "files(id,name,modifiedTime)", pageSize: 1 });
      const file = idx.data.files?.[0];
      if (!file) continue;
      const cat = await readDriveJson(file.id);
      if (!cat || !Array.isArray(cat.cases)) continue;
      out.push({ person: cat.person || folder.name, folderId: folder.id, catalogId: file.id, modifiedTime: file.modifiedTime, builtAt: cat.builtAt || null, cases: cat.cases });
    }
    cache = { at: Date.now(), value: out, error: out.length ? null : "no catalog.json was found in the legal folder in Drive" };
  } catch (err) {
    cache = { at: Date.now(), value: [], error: `the legal archive in Drive could not be read: ${err.message}` };
  }
  return { catalogs: cache.value, error: cache.error, at: cache.at };
}
export const forgetLegalArchive = () => (cache = { at: 0, value: null, error: null });

/** The people of the archive with their counts: [{ person, cases, saved, open, documents, builtAt }]. */
// The update plan of one person, for the browser extension that reads נט המשפט (owner 2026-11-19): every known case
// with the ids of the papers the archive already holds, so the extension asks the site only for what is new.
export function syncPlan(catalogs, person) {
  const cat = catalogs.find((c) => c.person === person);
  if (!cat) return null;
  return {
    person,
    builtAt: cat.builtAt || null,
    cases: (cat.cases || []).map((c) => ({
      number: c.number,
      caseID: c.caseID || null,
      name: c.name || "",
      open: !/סגור/.test(c.status || ""),
      downloaded: !!c.downloaded,
      ids: (Array.isArray(c.documents) ? c.documents : []).map((d) => d.documentID).filter(Boolean),
    })),
  };
}

export function peopleOf(catalogs) {
  return catalogs.map((cat) => ({
    person: cat.person,
    cases: cat.cases.length,
    saved: cat.cases.filter((c) => c.downloaded).length,
    open: cat.cases.filter((c) => c.status === "פתוח").length,
    documents: cat.cases.reduce((n, c) => n + (c.documents?.length || 0), 0),
    builtAt: cat.builtAt,
  }));
}

/** The paper behind a Drive id — only an id that a catalog lists: { doc, case } or null. */
export function documentByDriveId(catalogs, id) {
  for (const cat of catalogs) for (const c of cat.cases) for (const d of c.documents || []) if (d.driveId && d.driveId === id) return { doc: d, case: c, person: cat.person };
  return null;
}
/** The paper with a court document id (in any case that holds it; one with text first): { doc, case } or null. */
export function documentById(catalogs, documentID) {
  let found = null;
  for (const cat of catalogs) for (const c of cat.cases) for (const d of c.documents || []) if (String(d.documentID) === String(documentID)) { if (d.textDriveId) return { doc: d, case: c, person: cat.person }; found = found || { doc: d, case: c, person: cat.person }; }
  return found;
}

/** The PDF of a paper by its Drive id → { buffer, mimeType, name }, or null when no catalog lists the id. */
export async function readLegalFile(id) {
  const { catalogs } = await loadLegalArchive();
  const hit = documentByDriveId(catalogs, String(id || ""));
  if (!hit) return null;
  const r = await driveFiles().get({ fileId: hit.doc.driveId, alt: "media" }, { responseType: "arraybuffer" });
  return { buffer: Buffer.from(r.data), mimeType: "application/pdf", name: hit.doc.file || `${hit.doc.documentID}.pdf` };
}

/** The plain text of a paper by its court document id → { text, chars, cut, doc, case }, or null (unknown id / no text). */
export async function readLegalText(documentID, max = 40000) {
  const { catalogs } = await loadLegalArchive();
  const hit = documentById(catalogs, documentID);
  if (!hit || !hit.doc.textDriveId) return hit ? { text: "", chars: 0, cut: false, ...hit } : null;
  const r = await driveFiles().get({ fileId: hit.doc.textDriveId, alt: "media" }, { responseType: "text" });
  // pdftotext wraps Hebrew runs in direction marks; they carry nothing for a reader and cost the AI tokens
  const text = String(r.data ?? "").replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "");
  // a long paper: its start and its end (a verdict's result is at the end)
  const cut = text.length > max;
  return { text: cut ? `${text.slice(0, Math.round(max * 0.7))}\n\n[… the middle was left out …]\n\n${text.slice(-Math.round(max * 0.3))}` : text, chars: text.length, cut, ...hit };
}
