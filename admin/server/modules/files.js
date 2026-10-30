// "Upload files" — one place for every data file (Tabit, Micpal/Shiklulit, bank). Beecomm comes from its API.
//   POST /recognize   multipart files[]        → what each file is + what an import would do (no writes)
//   POST /import      multipart files[] + plan → imports the approved files that this module handles
//   POST /log         JSON                     → records a file imported through an existing loader
//   GET  /history                              → the last approved uploads
// Mounted for admin at /admin/files and for restMngr (own branches, no bank files).
import express from "express";
import multer from "multer";
import { createRequire } from "module";
import { executeSql } from "../sources/dbpool.js";
import users from "../sources/users.js";
import { nameKey } from "../uploads/workbook.js";
import { recognizeFile, applyPermissions, KINDS } from "../uploads/recognize.js";
import crypto from "crypto";
import { importTabitDetailed, importBankHapoalim, saveTabitDetailed, saveTabitShiftReports, saveTabitRota } from "../uploads/importers.js";
import { TabitShiftClient, tabitShiftConfig, reportToParsed, mergeParsed, nextMonth, rotaToRows, weekSunday } from "../uploads/tabitShift.js";
import { Router as r404 } from "./r404.js";

const require = createRequire(import.meta.url);
const RESTAURANTS = require("../../../shared/restaurants.json");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 50 },
});
const parseFilesRaw = upload.array("files");
// multer reads file names as latin1; browsers send UTF-8 (Hebrew names came out garbled).
const fixName = (n) => {
  const s = String(n || "");
  const utf = Buffer.from(s, "latin1").toString("utf8");
  return /[\u0080-\u00ff]/.test(s) && !utf.includes("\ufffd") ? utf : s;
};
export const parseFiles = (req, res, next) =>
  parseFilesRaw(req, res, (err) => {
    for (const f of req.files || []) f.originalname = fixName(f.originalname);
    next(err);
  });

const GROUPS = (RESTAURANTS.restaurants || []).map((g) => ({
  key: g.key,
  label: g.label,
  companyId: g.companyId,
  payrollSoft: g.payroll_soft || null,
  micCompany: g.mic_company || null,
  branches: (g.branches || []).map((b) => b.id),
}));
const BRANCH_IDS = new Set(GROUPS.flatMap((g) => g.branches));

// Employee names → branch ids (for the branch guess), from the employee tables. Cached for a few minutes.
let ctxCache = null;
let ctxAt = 0;
const loadContext = async () => {
  if (ctxCache && Date.now() - ctxAt < 5 * 60 * 1000) return ctxCache;
  const nameIndex = new Map();
  const addName = (name, rest) => {
    const k = nameKey(name);
    if (!k || !rest) return;
    if (!nameIndex.has(k)) nameIndex.set(k, new Set());
    nameIndex.get(k).add(rest);
  };
  const safe = async (sql) => {
    try {
      const [rows] = await executeSql(sql, {});
      return rows || [];
    } catch (e) {
      console.log(`files: context query failed: ${e.message}`);
      return [];
    }
  };
  for (const r of await safe("SELECT rest, name FROM employees WHERE active = 1")) addName(r.name, r.rest);
  for (const r of await safe("SELECT rest, first_name, family_name FROM shift_employees")) {
    addName(`${r.first_name || ""} ${r.family_name || ""}`, r.rest);
  }
  ctxCache = { groups: GROUPS, nameIndex };
  ctxAt = Date.now();
  return ctxCache;
};

// The cookie may lack the branch list; then read it from the users file (as restMngr.js does).
const branchesOfUser = (req) =>
  new Promise((resolve) => {
    if (Array.isArray(req.user?.restaurants)) return resolve(req.user.restaurants);
    const uid = req.user && (req.user.user_id || req.user.id);
    if (!uid) return resolve([]);
    users.get({ user_id: uid }, (db_res) => {
      const row = db_res.getRes().rows[0];
      resolve(Array.isArray(row?.restaurants) ? row.restaurants : []);
    });
  });

const permissionsOf = async (req, restricted) => {
  const isAdmin = req.user?.role === "admin";
  if (!restricted || isAdmin) return { isAdmin, allowed: null };
  const list = await branchesOfUser(req);
  if (list.includes("*")) return { isAdmin, allowed: null };
  return { isAdmin, allowed: new Set(list) };
};

const previousUploads = async (hashes) => {
  if (!hashes.length) return new Map();
  try {
    const [rows] = await executeSql(
      `SELECT file_hash, MAX(created_at) AS at, COUNT(*) AS times FROM file_uploads
        WHERE status <> 'FAILED' AND file_hash IN (${hashes.map((_, i) => `:h${i}`).join(",")}) GROUP BY file_hash`,
      Object.fromEntries(hashes.map((h, i) => [`h${i}`, h])),
    );
    return new Map((rows || []).map((r) => [r.file_hash, r]));
  } catch (e) {
    console.log(`files: previous-upload lookup failed: ${e.message}`);
    return new Map();
  }
};

const logUpload = async (req, r, status, resultJson, extra = {}) => {
  const [res] = await executeSql(
    `INSERT INTO file_uploads (file_name, file_hash, file_size, kind, rest, company, period_from, period_to, status, result_json, user_email)
     VALUES (:file_name, :file_hash, :file_size, :kind, :rest, :company, :period_from, :period_to, :status, CAST(:result AS JSON), :user_email)`,
    {
      file_name: String(r.name || "").slice(0, 255),
      file_hash: r.hash,
      file_size: r.size || 0,
      kind: r.kind,
      rest: extra.rest ?? r.rest ?? null,
      company: r.company ?? null,
      period_from: r.period?.from ?? null,
      period_to: r.period?.to ?? null,
      status,
      result: JSON.stringify(resultJson ?? null),
      user_email: req.user?.email || null,
    },
  );
  return res.insertId;
};

const setUploadResult = (id, status, resultJson) =>
  executeSql("UPDATE file_uploads SET status = :status, result_json = CAST(:result AS JSON) WHERE id = :id", {
    id,
    status,
    result: JSON.stringify(resultJson ?? null),
  });

// Branches whose attendance comes from the Tabit Shift API: "tabit_shift" = their Tabit app ids
// (Raanana has two, kitchen and floor; they are merged into one import of the branch).
const TABIT_SHIFT_BRANCHES = (RESTAURANTS.restaurants || []).flatMap((g) =>
  (g.branches || []).filter((b) => (b.tabit_shift || []).length).map((b) => ({ rest: b.id, name: b.name, apps: b.tabit_shift })),
);

const localMonth = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit" }).format(d).slice(0, 7);
// The current month; in the first 5 days also the previous one (late clock fixes).
export const defaultTabitShiftMonths = (now = new Date()) => {
  const cur = localMonth(now);
  const day = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", day: "2-digit" }).format(now));
  if (day > 5) return [cur];
  const prev = localMonth(new Date(now.getTime() - 6 * 24 * 3600 * 1000));
  return [prev, cur];
};

/**
 * Tabit Shift API → tabit_shifts (+ the full reports → tabit_shift_reports), for each month × branch, like an
 * approved upload of the detailed report (logged in file_uploads as TABIT_SHIFT_API). dryRun: reads and counts,
 * writes nothing. rests: only these branch ids (default: every branch with Tabit Shift apps).
 */
export const fetchTabitShift = async ({ months = defaultTabitShiftMonths(), dryRun = false, by = null, rests = null } = {}) => {
  const branches = rests ? TABIT_SHIFT_BRANCHES.filter((b) => rests.includes(b.rest)) : TABIT_SHIFT_BRANCHES;
  if (!branches.length) throw new Error("no Tabit Shift app for this branch (shared/restaurants.json tabit_shift)");
  const client = new TabitShiftClient(tabitShiftConfig());
  await client.login(tabitShiftConfig());
  const results = [];
  try {
    const visible = new Set((await client.siblings()).map((s) => Number(s.id)));
    for (const month of months) {
      for (const b of branches) {
        const base = { month, rest: b.rest, branch: b.name, apps: b.apps };
        try {
          const missing = b.apps.filter((id) => !visible.has(Number(id)));
          if (missing.length) throw new Error(`this Tabit Shift login cannot see app ${missing.join(", ")}`);
          const reports = [];
          for (const app of b.apps) {
            await client.switchApp(app);
            reports.push({ app, report: await client.detailedReport(month) });
          }
          const parsed = mergeParsed(reports.map((r) => reportToParsed(r.report, month)));
          const shifts = parsed.employees.reduce((n, e) => n + e.shifts.length, 0);
          if (dryRun) {
            const noClockOut = parsed.employees.reduce((n, e) => n + e.shifts.filter((s) => s.clock_in && !s.clock_out).length, 0);
            results.push({ ...base, status: "DRY_RUN", result: { employees: parsed.employees.length, shifts, shiftsWithoutClockOut: noClockOut } });
            continue;
          }
          const body = JSON.stringify(parsed);
          const r = {
            name: `Tabit Shift API ${month} — ${b.name} (app ${b.apps.join(" + ")})`,
            hash: crypto.createHash("sha256").update(body).digest("hex"),
            size: Buffer.byteLength(body),
            kind: "TABIT_SHIFT_API",
            period: { from: `${month}-01`, to: `${nextMonth(month)}-01` },
          };
          const uploadId = await logUpload({ user: { email: by } }, r, "FAILED", { started: true }, { rest: b.rest });
          try {
            const out = await saveTabitDetailed(parsed, { rest: b.rest, uploadId, wholeMonth: true });
            // The full reports, for the payroll. A failure here (e.g. the table is not created yet) does not
            // undo the shifts import; it is reported and makes the status PARTIAL.
            try {
              out.reportsSaved = await saveTabitShiftReports(reports, { rest: b.rest, month, uploadId });
            } catch (e) {
              console.error(`tabit_shift_reports ${month} ${b.name}:`, e.message);
              out.reportsError = e.message;
            }
            const status = out.skippedSheets.length || out.reportsError ? "PARTIAL" : "OK";
            await setUploadResult(uploadId, status, out);
            results.push({ ...base, status, result: out });
          } catch (e) {
            await setUploadResult(uploadId, "FAILED", { error: e.message }).catch(() => {});
            throw e;
          }
        } catch (e) {
          results.push({ ...base, status: "FAILED", error: e.message });
        }
      }
    }
  } finally {
    await client.logout();
  }
  if (!dryRun) ctxCache = null;
  return results;
};

/**
 * Tabit Shift work plan (Rota page) → tabit_rota, for the week that starts on weekStart (a Sunday; default: this
 * week) × branch; a fetch replaces that week of the branch from today on — days that passed keep the plan stored
 * before them (keepPast, default; false = replace the whole week). dryRun: reads and counts, writes nothing.
 */
export const fetchTabitRota = async ({ weekStart = weekSunday(), dryRun = false, rests = null, keepPast = true } = {}) => {
  const keepBefore = keepPast ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date()) : null;
  if (new Date(`${weekStart}T12:00:00Z`).getUTCDay() !== 0) throw new Error(`${weekStart} is not a Sunday`);
  const branches = rests ? TABIT_SHIFT_BRANCHES.filter((b) => rests.includes(b.rest)) : TABIT_SHIFT_BRANCHES;
  const client = new TabitShiftClient(tabitShiftConfig());
  await client.login(tabitShiftConfig());
  const results = [];
  try {
    for (const b of branches) {
      const base = { weekStart, rest: b.rest, branch: b.name, apps: b.apps };
      try {
        const rows = [];
        const published = [];
        for (const app of b.apps) {
          await client.switchApp(app);
          const plan = await client.rota(weekStart);
          published.push(...plan.rotas.map((r) => ({ app, published: !!r.is_published })));
          rows.push(...rotaToRows(plan, { rest: b.rest, app, weekStart, employees: await client.employees() }));
        }
        const counts = { slots: rows.length, withEmployee: rows.filter((r) => r.employee_name).length, published };
        if (dryRun) results.push({ ...base, status: "DRY_RUN", result: counts });
        else results.push({ ...base, status: "OK", result: { ...counts, ...(await saveTabitRota(rows, { rest: b.rest, weekStart, keepBefore })) } });
      } catch (e) {
        results.push({ ...base, status: "FAILED", error: e.message });
      }
    }
  } finally {
    await client.logout();
  }
  return results;
};

/**
 * What each uploaded file is and what an import would do (no writes). perms = { isAdmin, allowed: Set|null,
 * bankAccounts?: Set } (see recognize.js applyPermissions). Used by the Upload page and the Local Data API (Joya chat).
 */
export const recognizeUploads = async (files, perms) => {
  const ctx = await loadContext();
  const out = [];
  for (const f of files) {
    let r;
    try {
      r = applyPermissions(await recognizeFile(f, ctx, perms), perms);
    } catch (e) {
      console.error(`files/recognize ${f.originalname}:`, e);
      r = { name: f.originalname, size: f.buffer.length, recognized: false, importable: false, reason: `Error while reading the file: ${e.message}` };
    }
    out.push(r);
  }
  const prev = await previousUploads(out.map((r) => r.hash).filter(Boolean));
  for (const r of out) {
    const p = prev.get(r.hash);
    if (p) r.previous = { at: p.at, times: Number(p.times) };
  }
  return out;
};

/** Imports the approved files this module handles. plan: one { hash, rest? } per file, in the same order. */
export const importUploads = async (files, plan, perms, userEmail) => {
  const ctx = await loadContext();
  const req = { user: { email: userEmail } };
  const results = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const step = plan[i] || {};
    const r = applyPermissions(await recognizeFile(f, ctx, perms), perms);
    const fail = (error) => results.push({ name: f.originalname, kind: r.kind, status: "FAILED", error });
    if (step.hash && step.hash !== r.hash) {
      fail("the file changed after it was checked — check it again");
      continue;
    }
    if (!r.importable || r.handler !== "server") {
      fail(r.reason || "this file is not imported here");
      continue;
    }
    let rest = r.rest;
    if (r.kind === "TABIT_DETAILED") {
      rest = String(step.rest || "").trim();
      if (!BRANCH_IDS.has(rest)) {
        fail("choose the branch of this report");
        continue;
      }
      if (perms.allowed && !perms.allowed.has(rest)) {
        fail("you are not allowed to use this branch");
        continue;
      }
    }
    let uploadId = null;
    try {
      uploadId = await logUpload(req, r, "FAILED", { started: true }, { rest });
      let out;
      if (r.kind === "TABIT_DETAILED") out = await importTabitDetailed(f.buffer, { rest, uploadId });
      else if (r.kind === "BANK_HAPOALIM") out = await importBankHapoalim(f.buffer, { uploadId });
      else throw new Error(`no importer for ${r.kind}`);
      const status = (out.skippedBranches || []).length || (out.skippedSheets || []).length ? "PARTIAL" : "OK";
      await setUploadResult(uploadId, status, out);
      results.push({ name: f.originalname, kind: r.kind, rest, status, result: out });
    } catch (e) {
      console.error(`files/import ${f.originalname}:`, e);
      if (uploadId) await setUploadResult(uploadId, "FAILED", { error: e.message }).catch(() => {});
      fail(e.message || "import failed");
    }
  }
  ctxCache = null;
  return results;
};

export const Router = function ({ restricted = false } = {}) {
  const router = express.Router();

  router.post("/recognize", (req, res) => {
    parseFiles(req, res, async (uploadErr) => {
      if (uploadErr) return res.status(400).json({ error: uploadErr.message || "upload failed" });
      try {
        const files = (req.files || []).filter((f) => f && f.buffer);
        if (!files.length) return res.status(400).json({ error: "no files" });
        res.json({ files: await recognizeUploads(files, await permissionsOf(req, restricted)) });
      } catch (err) {
        console.error("files/recognize error:", err);
        res.status(500).json({ error: err.message || "recognize failed" });
      }
    });
  });

  // plan: JSON array, one entry per uploaded file in the same order: { hash, rest? }.
  router.post("/import", (req, res) => {
    parseFiles(req, res, async (uploadErr) => {
      if (uploadErr) return res.status(400).json({ error: uploadErr.message || "upload failed" });
      try {
        let plan;
        try {
          plan = JSON.parse(String(req.body?.plan || "[]"));
        } catch {
          return res.status(400).json({ error: "bad plan" });
        }
        const files = (req.files || []).filter((f) => f && f.buffer);
        if (!files.length || plan.length !== files.length) return res.status(400).json({ error: "files and plan do not match" });
        res.json({ results: await importUploads(files, plan, await permissionsOf(req, restricted), req.user?.email || null) });
      } catch (err) {
        console.error("files/import error:", err);
        res.status(500).json({ error: err.message || "import failed" });
      }
    });
  });

  // A file imported through an existing loader (employee list, Micpal / Shiklulit index).
  router.post("/log", async (req, res) => {
    try {
      const b = req.body || {};
      if (!KINDS[b.kind] || !/^[0-9a-f]{64}$/.test(String(b.hash || ""))) return res.status(400).json({ error: "bad log entry" });
      const perms = await permissionsOf(req, restricted);
      if (perms.allowed && (KINDS[b.kind].adminOnly || !perms.allowed.has(String(b.rest || "")))) {
        return res.status(403).json({ error: "restaurant not permitted for this user" });
      }
      const status = ["OK", "PARTIAL", "FAILED"].includes(b.status) ? b.status : "OK";
      const id = await logUpload(req, { name: b.name, hash: b.hash, size: Number(b.size) || 0, kind: b.kind, rest: b.rest || null, company: b.company || null }, status, b.result);
      ctxCache = null;
      res.json({ id });
    } catch (err) {
      console.error("files/log error:", err);
      res.status(500).json({ error: err.message || "log failed" });
    }
  });

  // Admin only: read the Tabit Shift detailed reports now. Body { months?: ['YYYY-MM'], dryRun?: true }.
  router.post("/tabit-shift", async (req, res) => {
    if (restricted) return res.status(403).json({ error: "admin only" });
    const months = req.body?.months;
    if (months != null && !(Array.isArray(months) && months.length && months.length <= 3 && months.every((m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m)))) {
      return res.status(400).json({ error: "months: up to 3 of 'YYYY-MM'" });
    }
    try {
      const results = await fetchTabitShift({ months: months || undefined, dryRun: req.body?.dryRun === true, by: req.user?.email || null });
      res.json({ results });
    } catch (err) {
      console.error("files/tabit-shift error:", err.message);
      res.status(502).json({ error: err.message || "Tabit Shift fetch failed" });
    }
  });

  router.get("/history", async (req, res) => {
    try {
      const perms = await permissionsOf(req, restricted);
      const [rows] = await executeSql(
        `SELECT id, file_name, kind, rest, company, period_from, period_to, status, result_json, user_email, created_at
           FROM file_uploads ORDER BY id DESC LIMIT 200`,
        {},
      );
      const visible = (rows || []).filter((r) => {
        if (!perms.allowed) return true;
        if (KINDS[r.kind]?.adminOnly) return false;
        return r.rest && perms.allowed.has(r.rest);
      });
      res.json({ rows: visible.slice(0, 50).map((r) => ({ ...r, label: KINDS[r.kind]?.label || r.kind })) });
    } catch (err) {
      console.error("files/history error:", err);
      res.status(500).json({ error: err.message || "history failed" });
    }
  });

  router.use("/*", r404());
  return router;
};
