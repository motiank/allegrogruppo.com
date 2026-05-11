#!/usr/bin/env node
// scripts/update_employees_salary.js
//
// Update employees.global / hourly_wage / wage_type from a JSON file.
//
//   node update_employees_salary.js ./employees_salary_only_corrected.json
//
// Behaviour:
//   • Match employees by EXACT, TRIMMED name (no partial matching).
//   • If exactly one match → UPDATE.
//   • If zero matches      → record into missing_employees.json (no insert).
//   • If multiple matches  → record into duplicate_employees.json (no update).
//   • If both `global` and `hourly_wage` are populated for a record →
//     validation_errors.json (no update).
//   • Setting `global` clears `hourly_wage` to NULL.
//   • Setting `hourly_wage` clears `global` to NULL.
//   • `wage_type`: 'gross' or 'net' → use; missing/null → default to 'gross'.
//   • `hourly_wage = -1` is preserved as-is (minimum-wage marker).
//
// All updates run inside a single MySQL transaction (rolled back on uncaught
// error). Categorised records (missing / duplicate / validation_errors) are
// written to JSON files in the current working directory.

import fs from "fs/promises";
import path from "path";
import process from "process";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config();

// ---------------- CLI ----------------

function usage(extra) {
  console.error("Usage: node update_employees_salary.js <path/to/input.json>");
  if (extra) console.error(extra);
  process.exit(1);
}

const inputPath = process.argv[2];
if (!inputPath) usage();

// ---------------- Validation ----------------

function validate(rec) {
  if (rec == null || typeof rec !== "object") return "record is not an object";
  if (typeof rec.name !== "string" || !rec.name.trim())
    return "name is required";
  if (
    rec.global !== undefined &&
    rec.global !== null &&
    typeof rec.global !== "number"
  )
    return "global must be a number or null";
  if (
    rec.hourly_wage !== undefined &&
    rec.hourly_wage !== null &&
    typeof rec.hourly_wage !== "number"
  )
    return "hourly_wage must be a number or null";
  if (
    rec.wage_type !== undefined &&
    rec.wage_type !== null &&
    rec.wage_type !== "gross" &&
    rec.wage_type !== "net"
  )
    return "wage_type must be 'gross', 'net', or null";

  const hasGlobal = rec.global !== undefined && rec.global !== null;
  const hasHourly = rec.hourly_wage !== undefined && rec.hourly_wage !== null;
  if (hasGlobal && hasHourly)
    return "both 'global' and 'hourly_wage' populated — exactly one expected";
  return null;
}

// ---------------- IO helpers ----------------

async function writeJson(filename, data) {
  const out = JSON.stringify(data, null, 2);
  await fs.writeFile(filename, out, "utf8");
}

function num(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Build name-match candidates so we can find rows where the DB stored the
// name in the opposite word order (e.g. "Last First" instead of
// "First Last", or vice versa). Returns a deduplicated list with the
// original name first.
function nameCandidates(name) {
  const trimmed = String(name).trim().replace(/\s+/g, " ");
  const words = trimmed.split(" ").filter(Boolean);
  const set = new Set();
  set.add(trimmed);
  if (words.length >= 2) {
    // Full reverse — for 2 words this is the standard first/last swap.
    set.add(words.slice().reverse().join(" "));
    // First-with-rest swap: helps when the input has "First Middle Last"
    // and the DB stores "Last First Middle" (or vice versa).
    if (words.length >= 3) {
      set.add([...words.slice(1), words[0]].join(" "));
      set.add([words[words.length - 1], ...words.slice(0, -1)].join(" "));
    }
  }
  return [...set];
}

// ---------------- DB ----------------

async function buildPool() {
  const cfg = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: "utf8mb4_unicode_ci",
    waitForConnections: true,
    connectionLimit: 5,
    namedPlaceholders: false,
    timezone: "Z",
  };
  for (const k of ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"]) {
    if (!process.env[k]) {
      throw new Error(`missing required env var: ${k}`);
    }
  }
  if (process.env.DB_SSL_CA) {
    const caPath = path.resolve(
      process.env.DB_SSL_CA.replace("~", process.env.HOME || ""),
    );
    cfg.ssl = { ca: await fs.readFile(caPath) };
  }
  return mysql.createPool(cfg);
}

// ---------------- Main ----------------

async function main() {
  const absInput = path.resolve(inputPath);
  let raw;
  try {
    raw = await fs.readFile(absInput, "utf8");
  } catch (e) {
    usage(`Cannot read input: ${e.message}`);
  }

  let records;
  try {
    records = JSON.parse(raw);
  } catch (e) {
    usage(`Invalid JSON: ${e.message}`);
  }
  if (!Array.isArray(records)) {
    usage("Input must be a JSON array of employee records");
  }

  const missing = [];
  const duplicates = [];
  const validationErrors = [];
  const updateReport = [];

  const pool = await buildPool();
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    for (const rec of records) {
      // --- 1. validate ---
      const verr = validate(rec);
      if (verr) {
        validationErrors.push({ record: rec, error: verr });
        continue;
      }

      const name = rec.name.trim();

      // --- 2. find by exact trimmed name; also try reversed word order
      //         (e.g. "First Last" ↔ "Last First"). The original spelling
      //         is tried first; alternates are only consulted if the
      //         original returns zero rows. This keeps "exact-match-wins"
      //         semantics and avoids false-positive duplicates between two
      //         genuinely different employees on each side of the swap.
      const candidates = nameCandidates(name);
      let rows = [];
      let matchedAs = null;
      for (const cand of candidates) {
        const [r] = await conn.execute(
          "SELECT employee_id, `global`, hourly_wage, wage_type, name " +
            "FROM employees WHERE TRIM(name) = ? FOR UPDATE",
          [cand],
        );
        if (r.length > 0) {
          rows = r;
          matchedAs = cand;
          break;
        }
      }

      if (rows.length === 0) {
        missing.push(rec);
        continue;
      }
      if (rows.length > 1) {
        duplicates.push({
          record: rec,
          matched_as: matchedAs,
          matched_count: rows.length,
          matched_employee_ids: rows.map((r) => r.employee_id),
          matched_db_names: rows.map((r) => r.name),
        });
        continue;
      }

      const existing = rows[0];

      // --- 3. compute new values per rules ---
      const hasGlobal = rec.global !== undefined && rec.global !== null;
      const hasHourly =
        rec.hourly_wage !== undefined && rec.hourly_wage !== null;

      let newGlobal = num(existing.global);
      let newHourly = num(existing.hourly_wage);

      if (hasGlobal) {
        newGlobal = Number(rec.global);
        newHourly = null;
      } else if (hasHourly) {
        // hourly_wage = -1 preserved as-is (minimum-wage marker).
        newHourly = Number(rec.hourly_wage);
        newGlobal = null;
      }
      // If neither populated, leave global/hourly untouched.

      // wage_type: gross/net keep, otherwise default to 'gross'.
      const newWageType =
        rec.wage_type === "gross" || rec.wage_type === "net"
          ? rec.wage_type
          : "gross";

      // --- 4. update ---
      try {
        await conn.execute(
          "UPDATE employees SET `global` = ?, hourly_wage = ?, wage_type = ? " +
            "WHERE employee_id = ?",
          [newGlobal, newHourly, newWageType, existing.employee_id],
        );

        updateReport.push({
          employee_id: existing.employee_id,
          name,
          db_name: existing.name,
          matched_as: matchedAs,
          name_swapped: matchedAs !== name,
          old_global: num(existing.global),
          new_global: newGlobal,
          old_hourly_wage: num(existing.hourly_wage),
          new_hourly_wage: newHourly,
          old_wage_type: existing.wage_type || null,
          new_wage_type: newWageType,
        });
      } catch (e) {
        validationErrors.push({
          record: rec,
          employee_id: existing.employee_id,
          error: `update failed: ${e.message}`,
        });
      }
    }

    await conn.commit();
  } catch (e) {
    try {
      await conn.rollback();
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    conn.release();
    await pool.end();
  }

  // ---------------- Output files ----------------
  await writeJson("missing_employees.json", missing);
  await writeJson("duplicate_employees.json", duplicates);
  await writeJson("validation_errors.json", validationErrors);
  await writeJson("update_report.json", updateReport);

  // ---------------- Summary ----------------
  console.log("============================================");
  console.log("Update employees salary — summary");
  console.log("============================================");
  console.log(`  input file               : ${absInput}`);
  console.log(`  records read             : ${records.length}`);
  console.log(`  updated employees count  : ${updateReport.length}`);
  console.log(`  missing employees count  : ${missing.length}`);
  console.log(`  duplicate employees count: ${duplicates.length}`);
  console.log(`  validation errors count  : ${validationErrors.length}`);
  console.log("");
  console.log("Output files (current dir):");
  console.log("  • update_report.json");
  console.log("  • missing_employees.json");
  console.log("  • duplicate_employees.json");
  console.log("  • validation_errors.json");
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
