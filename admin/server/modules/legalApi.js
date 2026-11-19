// The Legal API — GET /local-api/v1/legal/* (owner 2026-11-18): the court cases of the owners from the legal archive
// in Google Drive (legalArchive.js), read only, loopback only like the rest of the Local Data API. For Joya HQ's
// Legal area: browse every case and paper, download any paper, and the facts its AI needs for questions such as
// "what was the story with <a claimant>", "what was the verdict", "the last decision", "when is the next hearing".
// Spec: legal_api_readme.md. Envelope: { data, meta } / { error: { code, message } }.
//
//   GET /people                                  the person folders with their counts
//   GET /cases[?person=&q=&status=open|closed&downloaded=1|0&from=&to=&limit=]   the case list (no documents)
//   GET /cases/:number[?person=]                 one case: details, story, key facts, every paper
//   GET /hearings[?person=&from=&to=&cancelled=1]  the hearings ahead, over all cases
//   GET /documents[?person=&number=&q=&type=&key=1|0&from=&to=&limit=]   papers by words
//   GET /documents/:documentID/text[?max=]       the plain text of a paper (for the AI)
//   GET /files/:driveId[?download=1]             the PDF itself
//   GET /sync/plan?person=[&fresh=1]             the update plan for the browser extension: every case with the paper ids already held
import express from "express";
import { localOnly, ApiError, badRequest, isIsoDate } from "./localApi.js";
import { loadLegalArchive, peopleOf, listCases, findCase, hearings, searchDocuments, readLegalFile, readLegalText, syncPlan, forgetLegalArchive } from "./legalArchive.js";

const unavailable = (why) => new ApiError(503, "legal_archive_unavailable", why);
const dateParam = (q, name) => {
  if (q[name] == null || q[name] === "") return null;
  if (!isIsoDate(String(q[name]))) throw badRequest(`${name} must be YYYY-MM-DD`);
  return String(q[name]);
};
const flag = (v) => (v == null || v === "" ? null : ["1", "true", "yes"].includes(String(v).toLowerCase()));
const status = (v) => {
  if (v == null || v === "" || v === "all") return null;
  if (!["open", "closed"].includes(String(v))) throw badRequest("status must be open, closed or all");
  return String(v);
};

async function archive() {
  const a = await loadLegalArchive();
  if (!a.catalogs.length) throw unavailable(a.error || "the legal archive is empty");
  return a;
}
const metaOf = (a) => ({ people: a.catalogs.map((c) => c.person), builtAt: a.catalogs.map((c) => c.builtAt).filter(Boolean).sort().pop() || null, readAt: new Date(a.at).toISOString() });
const personOf = (a, v) => {
  if (v == null || v === "" || v === "all") return null;
  if (!a.catalogs.some((c) => c.person === v)) throw badRequest(`unknown person "${v}" (known: ${a.catalogs.map((c) => c.person).join(", ")})`);
  return String(v);
};

const Router = () => {
  const router = express.Router();
  router.use(localOnly);

  const route = (path, fn) =>
    router.get(path, async (req, res) => {
      try {
        const out = await fn(req, res);
        if (out !== undefined && !res.headersSent) res.json(out);
      } catch (err) {
        if (err instanceof ApiError) return res.status(err.status).json({ error: { code: err.code, message: err.message } });
        console.error(`legal-api ${req.path} error:`, err);
        res.status(500).json({ error: { code: "internal_error", message: err.message || "internal error" } });
      }
    });

  route("/people", async () => {
    const a = await archive();
    return { data: peopleOf(a.catalogs), meta: metaOf(a) };
  });

  route("/sync/plan", async (req) => {
    if (flag(req.query.fresh)) forgetLegalArchive(); // after an update run, so the next plan knows the new papers
    const a = await archive();
    const person = personOf(a, req.query.person);
    if (!person) throw badRequest("person is required");
    return { data: syncPlan(a.catalogs, person), meta: metaOf(a) };
  });

  route("/cases", async (req) => {
    const a = await archive();
    const q = req.query;
    const out = listCases(a.catalogs, { person: personOf(a, q.person), q: q.q ? String(q.q).slice(0, 200) : null, status: status(q.status), downloaded: flag(q.downloaded), from: dateParam(q, "from"), to: dateParam(q, "to"), limit: q.limit });
    return { data: out.rows, meta: { ...metaOf(a), total: out.total, count: out.rows.length } };
  });

  route("/cases/:number", async (req) => {
    const a = await archive();
    const c = findCase(a.catalogs, req.params.number, personOf(a, req.query.person));
    if (!c) throw new ApiError(404, "not_found", `no case ${req.params.number} in the legal archive`);
    return { data: c, meta: metaOf(a) };
  });

  route("/hearings", async (req) => {
    const a = await archive();
    const rows = hearings(a.catalogs, { person: personOf(a, req.query.person), from: dateParam(req.query, "from"), to: dateParam(req.query, "to"), cancelled: flag(req.query.cancelled) });
    return {
      data: rows,
      meta: { ...metaOf(a), count: rows.length, note: 'source "court" = the court\'s list of sittings (kept only for the cases read from the new court site); source "decision" = a future date that a recent decision of an open case mentions — a hearing or a deadline, read the text' },
    };
  });

  route("/documents", async (req) => {
    const a = await archive();
    const q = req.query;
    const out = searchDocuments(a.catalogs, { person: personOf(a, q.person), number: q.number || null, q: q.q ? String(q.q).slice(0, 200) : null, type: q.type || null, key: flag(q.key), from: dateParam(q, "from"), to: dateParam(q, "to"), limit: q.limit });
    return { data: out.rows, meta: { ...metaOf(a), total: out.total, count: out.rows.length } };
  });

  route("/documents/:id/text", async (req) => {
    await archive();
    const max = Math.min(Math.max(Number(req.query.max) || 40000, 1000), 150000);
    const t = await readLegalText(req.params.id, max);
    if (!t) throw new ApiError(404, "not_found", `no paper ${req.params.id} in the legal archive`);
    const d = t.doc;
    return {
      data: { documentID: d.documentID, number: t.case.number, caseName: t.case.name, date: d.date, type: d.type, detail: d.detail || "", by: d.by || "", pages: d.pages || 0, textSource: d.textSource || "", text: t.text },
      meta: { chars: t.chars, cut: t.cut, note: t.text ? (d.textSource === "ocr" ? "the text was read from a scan (OCR) and may hold reading errors" : null) : "this paper has no text" },
    };
  });

  // the paper itself; only Drive ids listed in a catalog are served, so the caller needs no Drive access
  route("/files/:id", async (req, res) => {
    await archive();
    const f = await readLegalFile(req.params.id);
    if (!f) throw new ApiError(404, "not_found", "no such paper in the legal archive");
    res.setHeader("Content-Type", f.mimeType);
    res.setHeader("Content-Disposition", `${flag(req.query.download) ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(f.buffer);
  });

  router.use((req, res) => res.status(404).json({ error: { code: "not_found", message: `no endpoint ${req.method} /legal${req.path}` } }));
  return router;
};

export { Router };
