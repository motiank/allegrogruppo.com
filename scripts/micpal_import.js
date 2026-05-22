#!/usr/bin/env node
// scripts/micpal_import.js
//
// Import employees from Micpal-style xlsx exports in /home/moti/alegro/micpal
// into the employees table.
//
// Each input filename is the restaurant's name (e.g. "פסטה לינה.xlsx",
// "גויה אור ים .xlsx"). The script tries to match the filename against the
// restaurant catalog. If exactly one match is found, it is used. Otherwise
// (zero or multiple matches) the user is prompted with a numbered list.
//
// Mapping per row:
//   rest      = chosen restaurant value (Mongo ObjectId-style string)
//   name      = column "שם פרטי" + " " + column "שם משפחה"
//   ID_nmbr   = column "מספר זהות"  (also accepts "תעודת זהות" / 'ת"ז' / "תז")
//   t101      = TRUE

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import ExcelJS from "exceljs";
import mysql from "mysql2/promise";
import { RESTAURANT_GROUPS } from "../admin/client/constants/restaurants.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(repoRoot, ".env") });

const INPUT_DIR = process.argv[2] || "/home/moti/alegro/micpal";

const NAME_COL_LABELS = {
  first: ["שם פרטי"],
  last: ["שם משפחה"],
  id: ["מספר זהות", "תעודת זהות", "ת.ז.", 'ת"ז', "תז"],
};

// Strip apostrophes/quotes that vary between חברה lists
const normHeb = (s) =>
  String(s || "")
    .replace(/[׳ʼ'']/g, "")
    .replace(/\s+/g, " ")
    .trim();

function findCandidates(filename) {
  const stripped = normHeb(filename.replace(/\.xlsx$/i, ""));
  const candidates = [];
  const seen = new Set();
  for (const group of RESTAURANT_GROUPS) {
    const groupNorm = normHeb(group.label);
    const groupHit =
      stripped.includes(groupNorm) || groupNorm.includes(stripped);
    for (const r of group.items) {
      const labelNorm = normHeb(r.label);
      const labelHit =
        stripped.includes(labelNorm) || labelNorm.includes(stripped);
      if (labelHit || groupHit) {
        if (seen.has(r.value)) continue;
        seen.add(r.value);
        candidates.push({ group: group.label, label: r.label, value: r.value });
      }
    }
  }
  return candidates;
}

function allRestaurants() {
  return RESTAURANT_GROUPS.flatMap((g) =>
    g.items.map((r) => ({ group: g.label, label: r.label, value: r.value })),
  );
}

async function pickRestaurant(filename, rl) {
  const candidates = findCandidates(filename);
  if (candidates.length === 1) {
    console.log(
      `  matched: ${candidates[0].group} — ${candidates[0].label} (${candidates[0].value})`,
    );
    return candidates[0];
  }
  // Zero or many matches — show all options.
  const all = allRestaurants();
  console.log(
    `\n  ambiguous (${candidates.length} candidate${candidates.length === 1 ? "" : "s"} from filename "${filename}"). Choose:\n`,
  );
  all.forEach((c, i) => {
    const star = candidates.find((x) => x.value === c.value) ? " *" : "";
    console.log(
      `    ${String(i + 1).padStart(2, " ")}. ${c.group} — ${c.label}  (${c.value})${star}`,
    );
  });
  console.log("    s. skip this file");
  while (true) {
    const ans = (await rl.question("\n  number: ")).trim();
    if (ans === "s" || ans === "S") return null;
    const idx = parseInt(ans, 10) - 1;
    if (Number.isFinite(idx) && idx >= 0 && idx < all.length) return all[idx];
    console.log("  invalid; try again");
  }
}

function findHeaderColumns(sheet) {
  const header = sheet.getRow(1);
  const cols = { mic: null, first: null, last: null, id: null };
  header.eachCell({ includeEmpty: false }, (cell, col) => {
    const t = normHeb(cell.value);
    if (!t) return;
    for (const [key, syns] of Object.entries(NAME_COL_LABELS)) {
      if (cols[key]) continue;
      if (syns.some((s) => normHeb(s) === t || t.includes(normHeb(s)))) {
        cols[key] = col;
      }
    }
  });
  return cols;
}

function getCellString(cell) {
  const v = cell?.value;
  if (v == null) return "";
  if (typeof v === "object") {
    if (v.text != null) return String(v.text);
    if (Array.isArray(v.richText))
      return v.richText.map((t) => t.text).join("");
    if (v.result != null) return String(v.result);
    return "";
  }
  return String(v);
}

async function importFile(pool, filepath, restValue) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filepath);
  const sheet = wb.worksheets[0];
  if (!sheet) throw new Error("workbook has no sheets");
  const cols = findHeaderColumns(sheet);
  if (!cols.first || !cols.last) {
    throw new Error(
      `header missing required columns; found ${JSON.stringify(cols)}`,
    );
  }
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const first = getCellString(row.getCell(cols.first)).trim();
    const last = getCellString(row.getCell(cols.last)).trim();
    const name = `${first} ${last}`.trim();
    if (!name) {
      skipped++;
      continue;
    }
    const idn = cols.id
      ? getCellString(row.getCell(cols.id)).trim() || null
      : null;
    try {
      const [result] = await pool.execute(
        `INSERT INTO employees (rest, name, ID_nmbr, t101, roles)
         VALUES (?, ?, ?, 1, JSON_ARRAY())`,
        [restValue, name, idn],
      );
      if (result.affectedRows === 1) inserted++;
      else skipped++;
    } catch (e) {
      console.log(`    row ${r} (${name}): ${e.message}`);
      skipped++;
    }
  }
  return { inserted, updated, skipped };
}

async function main() {
  if (!process.env.DB_HOST) {
    console.error("missing DB env (DB_HOST/DB_USER/DB_PASSWORD/DB_NAME)");
    process.exit(1);
  }
  const stat = await fs.promises.stat(INPUT_DIR).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    console.error(`input folder not found: ${INPUT_DIR}`);
    process.exit(1);
  }
  const entries = await fs.promises.readdir(INPUT_DIR);
  const files = entries
    .filter((f) => /\.xlsx$/i.test(f))
    .filter((f) => !f.startsWith("~$") && !f.startsWith(".~lock"))
    .sort();
  console.log(`Folder: ${INPUT_DIR}`);
  console.log(`Found ${files.length} file(s)`);

  const ssl = process.env.DB_SSL_CA
    ? {
        ca: fs.readFileSync(
          path.resolve(
            process.env.DB_SSL_CA.replace("~", process.env.HOME || ""),
          ),
        ),
      }
    : null;
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    ssl,
    waitForConnections: true,
    connectionLimit: 5,
    timezone: "Z",
  });

  const rl = readline.createInterface({ input, output });
  let totalInserted = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  try {
    for (const f of files) {
      console.log(`\n• ${f}`);
      const rest = await pickRestaurant(f, rl);
      if (!rest) {
        console.log("  skipped");
        continue;
      }
      try {
        const { inserted, updated, skipped } = await importFile(
          pool,
          path.join(INPUT_DIR, f),
          rest.value,
        );
        totalInserted += inserted;
        totalUpdated += updated;
        totalSkipped += skipped;
        console.log(
          `  → inserted=${inserted}, updated=${updated}, skipped=${skipped}`,
        );
      } catch (e) {
        console.error(`  failed: ${e.message}`);
      }
    }
  } finally {
    rl.close();
    await pool.end();
  }
  console.log(
    `\nDone. inserted=${totalInserted}, updated=${totalUpdated}, skipped=${totalSkipped}`,
  );
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
