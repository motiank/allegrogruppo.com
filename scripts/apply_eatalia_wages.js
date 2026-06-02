#!/usr/bin/env node
// scripts/apply_eatalia_wages.js
//
// Apply the parsed Primium Eatalia wage sheet to the employees table, using the
// new wage model (new_wage_type + wage) and deriving the legacy columns
// (global / hourly_wage / wage_type) exactly like admin/server/modules/payroll.js.
//
//   node parse_eatalia_wages.js "<xlsx>" /tmp/eatalia_wages.json   # produce input
//   node apply_eatalia_wages.js /tmp/eatalia_wages.json            # DRY RUN
//   node apply_eatalia_wages.js /tmp/eatalia_wages.json --apply    # WRITE
//
// Scope (per user decision): update ONLY the Goya master roster
// (rest = 64be1926335ee46a739a1ba2, active = 1). The Goya branch holds the
// full Eatalia group roster (Goya + Piamonte + La Braccia + Mata). The older
// Piamonte duplicate rows (#300-#323) are intentionally left untouched.
//
// Each sheet name is matched to exactly one Goya-active employee by:
//   1. prefix     — DB name tokens start with the sheet name tokens (DB names
//                   often append a role suffix, e.g. "גיא קליין - מלצר גויה").
//   2. reversed   — two-token first/last swap.
//   3. fuzzy      — leading tokens within total Levenshtein distance <= 2
//                   (handles spelling variants, e.g. גרסימוב vs גריסמוב).
// Rows in OVERRIDES bypass matching and target an explicit employee_id.

import ExcelJS from "exceljs"; // not used here but kept for parity / future
import fs from "fs/promises";
import path from "path";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config();

const GOYA = "64be1926335ee46a739a1ba2";
const APPLY = process.argv.includes("--apply");
const inputPath = process.argv[2];
if (!inputPath || inputPath.startsWith("--")) {
  console.error("Usage: node apply_eatalia_wages.js <parsed.json> [--apply]");
  process.exit(1);
}

// Explicit resolutions (keyed by sheet row) decided with the user. Each entry
// forces the target employee_id and (optionally) overrides new_wage_type/wage.
const OVERRIDES = {
  6: { id: 526, new_wage_type: "hourly_gross", wage: 50 }, // אלכסנדר זובקוב: 50 was in global col
  17: { id: 581, new_wage_type: "hourly_gross", wage: 45 }, // מעיין מקייס
  37: { id: 614, new_wage_type: "hourly_gross", wage: 50 }, // אלעד ינקו
  50: { id: 547 }, // הילה אטיאס -> suffixed row #547 (not bare #546)
  54: { id: 550 }, // ולריה מוגליבסקי -> "ולריה מארחת"
  92: { id: 520 }, // איהם (אחמד אבו סרור) -> "איהם קאסם טבח גויה- כח אדם"
  93: { id: 532 }, // בונה (bonnard situatala) -> "בונה ניקיון פרטי"
  95: { id: 551 }, // חאתם עלאא (אמארה איהאב) -> "חאתם עלאא"
};
// Rows known to have no DB row — reported, never written.
const KNOWN_MISSING = new Set([2]); // קובי בכר (שף, מטה) — not in DB

const strip = (s) =>
  String(s || "").replace(/[׳״'"`\-–—]/g, "").replace(/\s+/g, " ").trim();
const toks = (s) => strip(s).split(" ").filter(Boolean);
function lev(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return d[m][n];
}

function matchOne(name, db) {
  const st = toks(name);
  if (!st.length) return [];
  const res = [];
  for (const e of db) {
    const prefix = st.length <= e.t.length && st.every((w, i) => w === e.t[i]);
    let rev = false;
    if (!prefix && st.length === 2) {
      const r = [st[1], st[0]];
      rev = e.t.length >= 2 && r[0] === e.t[0] && r[1] === e.t[1];
    }
    let fuzzy = false;
    if (!prefix && !rev && e.t.length >= st.length) {
      let d = 0;
      for (let i = 0; i < st.length; i++) d += lev(st[i], e.t[i]);
      fuzzy = d > 0 && d <= 2;
    }
    if (prefix || rev || fuzzy) res.push(e);
  }
  return res;
}

// Derive legacy columns from new_wage_type + wage (mirrors payroll.js).
function derive(nwt, wage) {
  const wage_type = nwt.endsWith("_net") ? "net" : "gross";
  let global = null, hourly_wage = null;
  if (nwt.startsWith("global_")) global = wage;
  else if (nwt.startsWith("hourly_min_")) hourly_wage = -1;
  else hourly_wage = wage;
  return { wage_type, global, hourly_wage };
}

async function buildConn() {
  const cfg = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? +process.env.DB_PORT : 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: "utf8mb4_unicode_ci",
    timezone: "Z",
  };
  if (process.env.DB_SSL_CA) {
    const p = path.resolve(process.env.DB_SSL_CA.replace("~", process.env.HOME || ""));
    cfg.ssl = { ca: await fs.readFile(p) };
  }
  return mysql.createConnection(cfg);
}

async function main() {
  const data = JSON.parse(await fs.readFile(path.resolve(inputPath), "utf8"));
  const recs = [...data.proposed, ...data.review.filter((r) => r.new_wage_type)]
    .sort((a, b) => a.row - b.row);

  const conn = await buildConn();
  const [emps] = await conn.execute(
    "SELECT employee_id, name FROM employees WHERE rest = ? AND active = 1",
    [GOYA],
  );
  const db = emps.map((e) => ({ ...e, t: toks(e.name) }));
  const byId = new Map(emps.map((e) => [e.employee_id, e]));

  const plan = [];
  const problems = [];

  for (const rec of recs) {
    if (KNOWN_MISSING.has(rec.row)) {
      problems.push({ row: rec.row, name: rec.name, issue: "known missing (no DB row)" });
      continue;
    }
    const ov = OVERRIDES[rec.row];
    const nwt = ov?.new_wage_type ?? rec.new_wage_type;
    const wage = ov?.wage ?? rec.wage;

    let emp;
    if (ov?.id) {
      emp = byId.get(ov.id);
      if (!emp) { problems.push({ row: rec.row, name: rec.name, issue: `override id ${ov.id} not in Goya-active` }); continue; }
    } else {
      const m = matchOne(rec.name, db);
      if (m.length === 0) { problems.push({ row: rec.row, name: rec.name, issue: "no match" }); continue; }
      if (m.length > 1) { problems.push({ row: rec.row, name: rec.name, issue: `ambiguous: ${m.map((x) => x.employee_id).join(",")}` }); continue; }
      emp = m[0];
    }

    const leg = derive(nwt, wage);
    plan.push({
      row: rec.row,
      employee_id: emp.employee_id,
      sheet_name: rec.name,
      db_name: emp.name,
      new_wage_type: nwt,
      wage,
      ...leg,
    });
  }

  // Guard: an employee_id targeted twice is OK only if both rows resolve to the
  // SAME (new_wage_type, wage) — e.g. someone listed under two branches in the
  // sheet. Identical targets are deduped; conflicting ones abort.
  const seen = new Map();
  const dedup = [];
  for (const p of plan) {
    const prev = seen.get(p.employee_id);
    if (prev) {
      if (prev.new_wage_type === p.new_wage_type && Number(prev.wage) === Number(p.wage)) {
        console.log(`  (dedup) r${p.row} #${p.employee_id} same as r${prev.row} — skipping duplicate`);
        continue;
      }
      problems.push({ row: p.row, name: p.sheet_name, issue: `employee_id ${p.employee_id} conflicts with row ${prev.row} (${prev.new_wage_type} ${prev.wage} vs ${p.new_wage_type} ${p.wage})` });
      continue;
    }
    seen.set(p.employee_id, p);
    dedup.push(p);
  }
  plan.length = 0;
  plan.push(...dedup);

  console.log(`=== PLAN (${plan.length} updates) — ${APPLY ? "APPLY" : "DRY RUN"} ===`);
  for (const p of plan)
    console.log(`  r${p.row} #${p.employee_id} "${p.db_name}"  <=  ${p.new_wage_type} ${p.wage}  [g=${p.global} h=${p.hourly_wage} ${p.wage_type}]`);
  console.log(`\n=== PROBLEMS (${problems.length}) ===`);
  for (const pr of problems) console.log(`  r${pr.row} "${pr.name}": ${pr.issue}`);

  if (problems.some((p) => p.issue.includes("conflicts with row"))) {
    console.error("\nAborting: conflicting employee_id targets detected.");
    await conn.end();
    process.exit(2);
  }

  if (!APPLY) {
    console.log("\nDry run — no rows written. Re-run with --apply to write.");
    await conn.end();
    return;
  }

  await conn.beginTransaction();
  try {
    let n = 0;
    for (const p of plan) {
      const [r] = await conn.execute(
        "UPDATE employees SET `global` = ?, hourly_wage = ?, wage_type = ?, new_wage_type = ?, wage = ? WHERE employee_id = ?",
        [p.global, p.hourly_wage, p.wage_type, p.new_wage_type, p.wage, p.employee_id],
      );
      if (r.affectedRows >= 1) n++;
      else problems.push({ row: p.row, name: p.sheet_name, issue: "no row updated" });
    }
    await conn.commit();
    console.log(`\nCommitted. Rows updated: ${n}/${plan.length}.`);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    await conn.end();
  }
}

main().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });
