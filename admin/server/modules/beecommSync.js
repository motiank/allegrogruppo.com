// The Beecomm load on demand (owner 2026-11-22: "add the update button to the Beecomm as well — to initiate the update
// process on the server"). The same nightly loader (scripts/server/analoader/index.js, the admin's 06:00 cron job) is
// started here as a child process: it reads the Beecomm back office from the last loaded day up to yesterday and
// writes bcom_cash / bcom_z_reports / bcom_orders / bcom_items_daily / bcom_payments_daily. One run at a time; the
// cron job and the button share this module, so the two never run together. The last runs are kept in memory only
// (the System page shows the loaded days from the tables anyway — dataFreshness.js).
//
// The loader prints its errors and exits 0 (its main() catches everything), so the verdict is read from its output:
// "Main is don" = it went through; "Global error" / "must be set in .env" / "Error getting dates" = failed; "Nothing to
// process" = already up to date. Needs BCOM_BO_API_KEY + BCOM_BO_REFRESH_TOKEN in the admin's .env (the back office
// login); without them the loader stops at once, so start() refuses before spawning.
// BEECOMM_SYNC=off in the .env switches the whole thing off on this server (owner 2026-11-28: Beecomm's API gateway refuses
// every call from the droplet's address since ~25/11 — 403 Forbidden — while the same code works from the owner's machine,
// so the nightly job runs there, crontab 06:30 + 13:30): the 06:00 cron is not scheduled and start() answers 503 disabled.
//
// THROUGH THE JOYA EXTENSION (owner 2026-11-28: "support the update Beecomm through the Joya extension"): the user's
// browser does the Beecomm calls from Israel, the server does everything else. extPlan() runs the loader in PLAN mode
// (BCOM_CUBE_PLAN: it records the cube requests it would make — Z reports, orders, items per day, payments per branch
// per day — fetches nothing, saves nothing) and mints a 1-hour access token from the server's refresh token; the
// extension POSTs each request to Beecomm with that token and hands every answer to extAnswer(), which keeps it as
// <tmp dir>/<key>.json; extFinish() runs the loader in REPLAY mode (BCOM_CUBE_REPLAY) on those files — the same saving
// code as the nightly job, so the tables get exactly what the server would have loaded. BEECOMM_SYNC=off does not stop
// this path (that is its point). The refresh token never leaves the server; the access token lives one hour.
import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { executeSql } from "../sources/dbpool.js";
import { getBcomAccessToken, BCOM_CUBE_URL } from "../../../scripts/server/analoader/bcom_api_loader.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const LOADER = "scripts/server/analoader/index.js";
const KEEP = 6;
const TAIL = 40; // output lines kept per run
const MAX_MS = 30 * 60 * 1000; // a run longer than this is killed (a normal one takes 10–60 s per day loaded)
const PLAN_MS = 3 * 60 * 1000; // the plan run only asks the DB for the dates
const MAX_EXT_REQUESTS = 2500; // ~ 3 months (payments: one call per branch per day); a longer gap is loaded by hand
const EXT_STALE_MS = 2 * 3600 * 1000; // a plan nobody finished

const err = (status, code, message) => Object.assign(new Error(message), { status, code });
const runs = []; // newest first
let current = null;

/** Whether the admin has the back office login the loader needs (names only, never the values). */
export const configured = (env = process.env) => Boolean(env.BCOM_BO_API_KEY && env.BCOM_BO_REFRESH_TOKEN);
/** BEECOMM_SYNC=off (or 0 / false / no): the Beecomm load is switched off on this server — no cron, no button. */
export const disabled = (env = process.env) => /^(off|0|false|no)$/i.test(String(env.BEECOMM_SYNC || "").trim());
export const DISABLED_MESSAGE = "the Beecomm update is switched off on this server (BEECOMM_SYNC=off): Beecomm refuses the server's address, so the nightly load runs on the owner's machine";

/** What the loader's output says: { ok, dates: { from, to } | null, nothingToDo, error } — exported for the tests. */
export function verdict(output, exitCode) {
  const text = String(output || "");
  const m = text.match(/Using dates: (\d\d\/\d\d\/\d{4}) to (\d\d\/\d\d\/\d{4})/);
  const iso = (d) => (d ? d.split("/").reverse().join("-") : null);
  const dates = m ? { from: iso(m[1]), to: iso(m[2]) } : null;
  const nothingToDo = /Nothing to process/.test(text);
  let error = null;
  const bad = text.match(/(BCOM_BO_API_KEY and BCOM_BO_REFRESH_TOKEN must be set in \.env|Global error[^\n]*|Error getting dates[^\n]*|save failed[^\n]*)/);
  if (exitCode !== 0 && exitCode != null) error = `the loader exited with code ${exitCode}`;
  else if (bad) error = bad[1].trim().slice(0, 300);
  else if (!nothingToDo && !/Main is don/.test(text)) error = "the loader ended without finishing (no 'Main is done' line)";
  return { ok: !error, dates, nothingToDo, error };
}

/** The last loaded business day and when it was written (bcom_orders — the biggest table, written last but one). */
export async function loaded() {
  try {
    const [rows] = await executeSql("SELECT MAX(business_date) AS lastDay, MAX(updated_at) AS loadedAt FROM bcom_orders", []);
    const r = rows?.[0] || {};
    const day = (v) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
    return { lastDay: day(r.lastDay), loadedAt: r.loadedAt instanceof Date ? r.loadedAt.toISOString() : r.loadedAt || null };
  } catch (e) {
    return { lastDay: null, loadedAt: null, error: e.message };
  }
}

const publicRun = (r) => r && { id: r.id, by: r.by, via: r.via || "server", startedAt: r.startedAt, finishedAt: r.finishedAt, seconds: r.finishedAt ? Math.round((new Date(r.finishedAt) - new Date(r.startedAt)) / 1000) : Math.round((Date.now() - new Date(r.startedAt)) / 1000), state: r.state, ok: r.ok, dates: r.dates, nothingToDo: r.nothingToDo, error: r.error, lastLine: r.lines.length ? r.lines[r.lines.length - 1] : null, lines: r.lines };

/** For the System page: the run going on (if any), the last runs, the loaded days, whether the login is configured. */
export async function state() {
  return { configured: configured(), disabled: disabled(), running: Boolean(current), current: publicRun(current), runs: runs.map(publicRun), loaded: await loaded() };
}

/**
 * Starts the loader (unless one runs already → 409 running; no login → 503 not_configured). Returns the run at once;
 * `onDone(run)` is called when the child exits (the cron job logs there). The run's `promise` resolves to the finished run.
 */
export function start({ by = null, onDone = null, env = null, via = "server" } = {}) {
  // via "extension" = a replay of what the user's browser fetched: the server's own network path being off is no reason to refuse
  if (disabled() && via !== "extension") throw err(503, "disabled", DISABLED_MESSAGE);
  if (current) throw err(409, "running", `a Beecomm update started at ${current.startedAt} by ${current.by || "?"} is still running`);
  if (!configured()) throw err(503, "not_configured", "BCOM_BO_API_KEY and BCOM_BO_REFRESH_TOKEN are missing in the admin's .env — the Beecomm back office login");
  const run = { id: `${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`, by, via, startedAt: new Date().toISOString(), finishedAt: null, state: "running", ok: null, dates: null, nothingToDo: false, error: null, lines: [], output: "" };
  current = run;
  runs.unshift(run);
  runs.splice(KEEP);
  const child = spawn(process.execPath, [LOADER], { cwd: repoRoot, env: { ...process.env, ...(env || {}) }, stdio: ["ignore", "pipe", "pipe"] });
  const take = (chunk) => {
    const s = String(chunk);
    run.output = (run.output + s).slice(-20000);
    for (const line of s.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      run.lines.push(t.slice(0, 200));
      if (run.lines.length > TAIL) run.lines.shift();
      const m = t.match(/Using dates: (\d\d\/\d\d\/\d{4}) to (\d\d\/\d\d\/\d{4})/);
      if (m) run.dates = { from: m[1].split("/").reverse().join("-"), to: m[2].split("/").reverse().join("-") };
    }
  };
  child.stdout.on("data", take);
  child.stderr.on("data", take);
  const timer = setTimeout(() => {
    run.lines.push(`killed after ${MAX_MS / 60000} minutes`);
    child.kill("SIGTERM");
  }, MAX_MS);
  run.promise = new Promise((resolve) => {
    const finish = (code, spawnError) => {
      clearTimeout(timer);
      if (run.finishedAt) return;
      const v = verdict(run.output, code);
      run.finishedAt = new Date().toISOString();
      run.ok = spawnError ? false : v.ok;
      run.dates = run.dates || v.dates;
      run.nothingToDo = v.nothingToDo;
      run.error = spawnError ? `the loader could not start: ${spawnError.message}` : v.error;
      run.state = run.ok ? "done" : "failed";
      run.output = "";
      if (current === run) current = null;
      try {
        onDone?.(publicRun(run));
      } catch {}
      resolve(publicRun(run));
    };
    child.on("error", (e) => finish(null, e));
    child.on("close", (code) => finish(code));
  });
  return publicRun(run);
}

// ── through the Joya extension (the browser fetches, the server saves) ──────────────────────────────────────────────

const ext = new Map(); // plan id → { id, by, dir, dates, keys: Map(key → request), answered: Set, createdAt }
const rmrf = (dir) => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
};
const dropStale = () => {
  for (const [id, p] of ext) {
    if (Date.now() - new Date(p.createdAt).getTime() > EXT_STALE_MS) {
      rmrf(p.dir);
      ext.delete(id);
    }
  }
};

/** The plan file's lines → the requests, one per key (pure; exported for the tests). */
export function parsePlan(text) {
  const out = new Map();
  for (const line of String(text || "").split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    let q;
    try {
      q = JSON.parse(t);
    } catch {
      continue;
    }
    if (q && typeof q.key === "string" && typeof q.path === "string" && q.payload && !out.has(q.key)) out.set(q.key, { key: q.key, path: q.path, payload: q.payload });
  }
  return [...out.values()];
}

/** Runs the loader in plan mode and returns { dates, nothingToDo, requests, error }. */
function runPlan(planFile) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [LOADER], { cwd: repoRoot, env: { ...process.env, BCOM_CUBE_PLAN: planFile }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const take = (c) => (output = (output + String(c)).slice(-20000));
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    const timer = setTimeout(() => child.kill("SIGTERM"), PLAN_MS);
    const done = (code, spawnError) => {
      clearTimeout(timer);
      const v = verdict(output, code);
      let requests = [];
      try {
        requests = parsePlan(fs.readFileSync(planFile, "utf8"));
      } catch {}
      resolve({ dates: v.dates, nothingToDo: v.nothingToDo, requests, error: spawnError ? `the loader could not start: ${spawnError.message}` : v.ok ? null : v.error, lines: output.split(/\r?\n/).filter(Boolean).slice(-8) });
    };
    child.on("error", (e) => done(null, e));
    child.on("close", (code) => done(code));
  });
}

/**
 * What the extension must fetch: { id, dates, cubeUrl, token, requests: [{ key, path, payload }] } — or
 * { nothingToDo: true, dates } when the tables already reach yesterday. The token is a 1-hour Beecomm access token
 * minted here from the server's refresh token (the login the loader uses). 409 while a load runs, 503 without the
 * login, 413 when the gap is too long for one browser run.
 */
export async function extPlan({ by = null } = {}) {
  dropStale();
  if (current) throw err(409, "running", `a Beecomm update started at ${current.startedAt} by ${current.by || "?"} is still running`);
  if (!configured()) throw err(503, "not_configured", "BCOM_BO_API_KEY and BCOM_BO_REFRESH_TOKEN are missing in the admin's .env — the Beecomm back office login");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "beecomm-ext-"));
  const planFile = path.join(dir, "plan.jsonl");
  const p = await runPlan(planFile);
  if (p.error && !p.nothingToDo) {
    rmrf(dir);
    throw err(500, "plan_failed", `the loader could not say what to fetch: ${p.error}`);
  }
  if (p.nothingToDo || !p.requests.length) {
    rmrf(dir);
    return { nothingToDo: true, dates: p.dates };
  }
  if (p.requests.length > MAX_EXT_REQUESTS) {
    rmrf(dir);
    throw err(413, "too_many", `${p.requests.length} Beecomm requests (${p.dates?.from} – ${p.dates?.to}) are too many for one browser run — load the gap by hand first`);
  }
  let token;
  try {
    token = await getBcomAccessToken();
  } catch (e) {
    rmrf(dir);
    throw err(502, "token_failed", `the Beecomm login token could not be made: ${e.response?.data?.error?.message || e.message}`);
  }
  const id = `x${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
  ext.set(id, { id, by, dir, dates: p.dates, keys: new Map(p.requests.map((q) => [q.key, q])), answered: new Set(), createdAt: new Date().toISOString() });
  console.log(`[beecomm-sync] extension plan ${id} by ${by || "?"}: ${p.requests.length} requests, ${p.dates?.from} – ${p.dates?.to}`);
  return { id, dates: p.dates, cubeUrl: BCOM_CUBE_URL, token, requests: p.requests, count: p.requests.length };
}

const planOf = (id) => {
  const p = ext.get(String(id || ""));
  if (!p) throw err(404, "not_found", "no such extension plan (it may have expired — start again)");
  return p;
};

/** One answer of Beecomm, kept for the replay. Returns { answered, total }. */
export function extAnswer(id, key, data) {
  const p = planOf(id);
  if (!p.keys.has(String(key || ""))) throw err(400, "bad_request", "the key is not in this plan");
  if (data == null || typeof data !== "object") throw err(400, "bad_request", "data must be Beecomm's JSON answer");
  fs.writeFileSync(path.join(p.dir, `${key}.json`), JSON.stringify(data));
  p.answered.add(String(key));
  return { answered: p.answered.size, total: p.keys.size };
}

/** A fresh access token for a long run (the first one lives one hour). */
export async function extToken(id) {
  planOf(id);
  try {
    return { token: await getBcomAccessToken() };
  } catch (e) {
    throw err(502, "token_failed", `the Beecomm login token could not be made: ${e.response?.data?.error?.message || e.message}`);
  }
}

/** Every request answered → the loader runs in replay mode on the answers (a normal run in the list, via "extension"). */
export function extFinish(id, { by = null } = {}) {
  const p = planOf(id);
  const missing = [...p.keys.keys()].filter((k) => !p.answered.has(k));
  if (missing.length) throw err(400, "incomplete", `${missing.length} of ${p.keys.size} Beecomm answers are missing — nothing was loaded`);
  ext.delete(p.id);
  const run = start({ by: by || p.by, via: "extension", env: { BCOM_CUBE_REPLAY: p.dir }, onDone: () => rmrf(p.dir) });
  console.log(`[beecomm-sync] extension plan ${p.id}: replay run ${run.id} started`);
  return run;
}

/** The browser gave up: the answers kept so far are thrown away. */
export function extCancel(id) {
  const p = ext.get(String(id || ""));
  if (!p) return { cancelled: false };
  rmrf(p.dir);
  ext.delete(p.id);
  return { cancelled: true };
}
