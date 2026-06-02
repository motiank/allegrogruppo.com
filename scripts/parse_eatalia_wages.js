#!/usr/bin/env node
// scripts/parse_eatalia_wages.js
//
// Parse the "פירוט שכר עובדים.xlsx" Primium Eatalia wage sheet into the new
// wage model (new_wage_type + wage) and categorise rows that need human review.
//
//   node parse_eatalia_wages.js "/path/to/פירוט שכר עובדים.xlsx" out.json
//
// Column layout (sheet "פיאמונטה"):
//   0 שם              name
//   1 תפקיד           role
//   2 מסעדה           restaurant
//   3 שכר גלובלי נטו  -> global_net
//   4 שכר גלובאלי ברוטו -> global_gross
//   5 שכר שעתי ברוטו  -> hourly_gross
//   6 שכר שעתי נטו    -> hourly_net
//   7 חברת כ"א        manpower company (no wage)
//
// Special: any wage cell containing "השלמה ל 40" -> hourly_min_gross, wage 40.

import ExcelJS from "exceljs";
import fs from "fs/promises";
import path from "path";

const inputPath = process.argv[2];
const outPath = process.argv[3] || "eatalia_wages.json";
if (!inputPath) {
  console.error('Usage: node parse_eatalia_wages.js "<xlsx>" [out.json]');
  process.exit(1);
}

const COL = { name: 0, role: 1, rest: 2, gnet: 3, ggross: 4, hgross: 5, hnet: 6, manpower: 7 };
const COL_TYPE = {
  [COL.gnet]: "global_net",
  [COL.ggross]: "global_gross",
  [COL.hgross]: "hourly_gross",
  [COL.hnet]: "hourly_net",
};
const HASHLAMA = "השלמה ל 40";
// Below this, a value in a *global* column is almost certainly a misplaced
// hourly rate (monthly globals are thousands).
const GLOBAL_MIN_PLAUSIBLE = 1000;

function clean(s) {
  return String(s == null ? "" : s).trim().replace(/\s+/g, " ");
}
function isHashlama(s) {
  return clean(s).replace(/\s+/g, "") === HASHLAMA.replace(/\s+/g, "");
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(inputPath);
const ws = wb.worksheets[0];

const proposed = [];          // ready-to-apply records
const review = [];            // needs human decision
const skippedNoName = [];
const skippedNoWage = [];     // manpower / blank wage

ws.eachRow((row, rn) => {
  if (rn === 1) return; // header
  const v = [];
  row.eachCell({ includeEmpty: true }, (c, cn) => { v[cn - 1] = c.text; });

  const name = clean(v[COL.name]);
  const role = clean(v[COL.role]);
  const rest = clean(v[COL.rest]);
  const manpower = clean(v[COL.manpower]);

  // Collect every populated wage cell among the 4 wage columns.
  const wageCells = [];
  for (const ci of [COL.gnet, COL.ggross, COL.hgross, COL.hnet]) {
    const cell = clean(v[ci]);
    if (cell !== "") wageCells.push({ ci, raw: cell });
  }

  if (!name) {
    skippedNoName.push({ row: rn, role, rest, raw: v });
    return;
  }

  // Manpower / contractor with no wage cell.
  if (wageCells.length === 0) {
    skippedNoWage.push({ row: rn, name, role, rest, manpower });
    return;
  }

  // Resolve "השלמה ל 40" anywhere -> hourly_min_gross / 40.
  const hashlamaCell = wageCells.find((w) => isHashlama(w.raw));
  if (hashlamaCell) {
    const rec = { row: rn, name, role, rest, new_wage_type: "hourly_min_gross", wage: 40 };
    if (wageCells.length > 1) {
      review.push({ ...rec, reason: "השלמה plus other wage cell(s)", wageCells });
    } else {
      proposed.push(rec);
    }
    return;
  }

  if (wageCells.length > 1) {
    review.push({ row: rn, name, role, rest, reason: "multiple wage columns populated", wageCells });
    return;
  }

  const { ci, raw } = wageCells[0];
  const num = Number(raw);
  if (!Number.isFinite(num)) {
    review.push({ row: rn, name, role, rest, reason: `non-numeric wage "${raw}"`, ci, type: COL_TYPE[ci] });
    return;
  }
  const type = COL_TYPE[ci];
  const rec = { row: rn, name, role, rest, new_wage_type: type, wage: num };

  // Suspicious: tiny value in a global column -> likely hourly miskeyed.
  if (type.startsWith("global_") && num < GLOBAL_MIN_PLAUSIBLE) {
    review.push({ ...rec, reason: `value ${num} too small for ${type} — likely hourly rate in wrong column` });
    return;
  }
  proposed.push(rec);
});

const out = { proposed, review, skippedNoName, skippedNoWage };
await fs.writeFile(path.resolve(outPath), JSON.stringify(out, null, 2), "utf8");

console.log("=== PROPOSED (ready) ===", proposed.length);
for (const r of proposed) console.log(`  r${r.row} ${r.name} | ${r.role} | ${r.rest} -> ${r.new_wage_type} ${r.wage}`);
console.log("\n=== NEEDS REVIEW ===", review.length);
for (const r of review) console.log(`  r${r.row} ${r.name||"(no name)"} | ${r.role} | ${r.rest} :: ${r.reason}` + (r.wageCells?` | cells=${JSON.stringify(r.wageCells)}`:"") + (r.new_wage_type?` | proposed=${r.new_wage_type} ${r.wage}`:""));
console.log("\n=== SKIPPED: no name ===", skippedNoName.length);
for (const r of skippedNoName) console.log(`  r${r.row} | ${r.role} | ${r.rest} | raw=${JSON.stringify(r.raw)}`);
console.log("\n=== SKIPPED: no wage (manpower/blank) ===", skippedNoWage.length);
for (const r of skippedNoWage) console.log(`  r${r.row} ${r.name} | ${r.role} | manpower=${r.manpower}`);
console.log(`\nWrote ${outPath}`);
