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
import { spawn } from "child_process";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { executeSql } from "../sources/dbpool.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const LOADER = "scripts/server/analoader/index.js";
const KEEP = 6;
const TAIL = 40; // output lines kept per run
const MAX_MS = 30 * 60 * 1000; // a run longer than this is killed (a normal one takes 10–60 s per day loaded)

const err = (status, code, message) => Object.assign(new Error(message), { status, code });
const runs = []; // newest first
let current = null;

/** Whether the admin has the back office login the loader needs (names only, never the values). */
export const configured = (env = process.env) => Boolean(env.BCOM_BO_API_KEY && env.BCOM_BO_REFRESH_TOKEN);

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

const publicRun = (r) => r && { id: r.id, by: r.by, startedAt: r.startedAt, finishedAt: r.finishedAt, seconds: r.finishedAt ? Math.round((new Date(r.finishedAt) - new Date(r.startedAt)) / 1000) : Math.round((Date.now() - new Date(r.startedAt)) / 1000), state: r.state, ok: r.ok, dates: r.dates, nothingToDo: r.nothingToDo, error: r.error, lastLine: r.lines.length ? r.lines[r.lines.length - 1] : null, lines: r.lines };

/** For the System page: the run going on (if any), the last runs, the loaded days, whether the login is configured. */
export async function state() {
  return { configured: configured(), running: Boolean(current), current: publicRun(current), runs: runs.map(publicRun), loaded: await loaded() };
}

/**
 * Starts the loader (unless one runs already → 409 running; no login → 503 not_configured). Returns the run at once;
 * `onDone(run)` is called when the child exits (the cron job logs there). The run's `promise` resolves to the finished run.
 */
export function start({ by = null, onDone = null } = {}) {
  if (current) throw err(409, "running", `a Beecomm update started at ${current.startedAt} by ${current.by || "?"} is still running`);
  if (!configured()) throw err(503, "not_configured", "BCOM_BO_API_KEY and BCOM_BO_REFRESH_TOKEN are missing in the admin's .env — the Beecomm back office login");
  const run = { id: `${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`, by, startedAt: new Date().toISOString(), finishedAt: null, state: "running", ok: null, dates: null, nothingToDo: false, error: null, lines: [], output: "" };
  current = run;
  runs.unshift(run);
  runs.splice(KEEP);
  const child = spawn(process.execPath, [LOADER], { cwd: repoRoot, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
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
