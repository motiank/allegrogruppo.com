// Self-contained smoke test for the Siklulit (שיקלולית) exporter.
//
//   $ node scripts/test_shik_export.js
//
// Builds a representative employee fixture, drives buildExportRow ->
// buildShikRowsForEmployee (the same path /export-micpal uses for shik), and
// asserts each component code/rate/quantity. Then writes an xlsx to /tmp so a
// human can open it.

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { buildExportRow } from "../admin/server/modules/payroll.js";
import ShikImportXL, {
  buildShikRowsForEmployee,
  SHIK_HEADERS,
} from "../admin/server/modules/ShikImportXL.js";

const HOURLY_RATE = 40;
const TRAVEL_PER_DAY = 12;
const BONUS_AMOUNT = 0; // computed only for hourly_min types; this fixture is hourly

// Two employees: one hourly with all hour buckets + travel, one global salary.
const hourlyEmp = {
  name: "Hourly Hannah",
  ID_nmbr: "111",
  workdays: 20,
  travel: TRAVEL_PER_DAY,
  payroll_data: {
    week1: { hours: [40, 5, 2] }, // h100, h125, h150
    week2: { hours: [40, 3, 1] },
  },
};
const globalEmp = {
  name: "Global Greg",
  ID_nmbr: "222",
  workdays: 22,
  payroll_data: {},
};

// DB-side records (the shape buildExportRow expects from empByName).
const empByName = new Map([
  [
    "Hourly Hannah",
    {
      ID_nmbr: "111",
      new_wage_type: "hourly_gross",
      wage: HOURLY_RATE,
      travel: TRAVEL_PER_DAY,
      maxTravel: null,
    },
  ],
  [
    "Global Greg",
    {
      ID_nmbr: "222",
      new_wage_type: "global_gross",
      wage: 9000,
      travel: null,
      maxTravel: null,
    },
  ],
]);
const micpalByIdNmbr = new Map([
  ["111", 14],
  ["222", 27],
]);

const ctx = {
  empByName,
  micpalByIdNmbr,
  stdDays: 25,
  stdHours: 182,
  minHourlyWage: 35.4,
};

const hourlyRow = buildExportRow(hourlyEmp, ctx);
const globalRow = buildExportRow(globalEmp, ctx);

// keyName is what becomes employeeNumber in Shik land.
hourlyRow.employeeNumber = Number(hourlyRow.keyName);
globalRow.employeeNumber = Number(globalRow.keyName);

const workMonth = 5;
const hourlyShik = buildShikRowsForEmployee(workMonth, hourlyRow);
const globalShik = buildShikRowsForEmployee(workMonth, globalRow);

console.log("hourly emp →", hourlyShik);
console.log("global emp →", globalShik);

// ─── Assertions ────────────────────────────────────────────────────────────
const findOne = (rows, componentCode, recordType = 1) =>
  rows.filter((r) => r.componentCode === componentCode && r.recordType === recordType);

// Hourly employee should produce: baseHourly (cc=1), overtime125 (38),
// overtime150 (39), travel (3), workDays (cc=4 recordType=4).
const base = findOne(hourlyShik, 1);
assert.equal(base.length, 1, "baseHourly row");
assert.equal(base[0].rate, HOURLY_RATE);
assert.equal(base[0].quantity, 80); // 40+40

const ot125 = findOne(hourlyShik, 38);
assert.equal(ot125.length, 1, "overtime125 row");
assert.equal(ot125[0].rate, HOURLY_RATE);
assert.equal(ot125[0].quantity, 8); // 5+3

const ot150 = findOne(hourlyShik, 39);
assert.equal(ot150.length, 1, "overtime150 row");
assert.equal(ot150[0].rate, HOURLY_RATE);
assert.equal(ot150[0].quantity, 3); // 2+1

const travel = findOne(hourlyShik, 3);
assert.equal(travel.length, 1, "travel row");
assert.equal(travel[0].rate, TRAVEL_PER_DAY * 20);
assert.equal(travel[0].quantity, 1);

const workDays = findOne(hourlyShik, 4, 4);
assert.equal(workDays.length, 1, "workDays row");
assert.equal(workDays[0].rate, 0);
assert.equal(workDays[0].quantity, 20);
assert.equal(workDays[0].recordType, 4);

// Bonus only appears for hourly_min_* (this fixture is hourly_gross).
assert.equal(findOne(hourlyShik, 32).length, 0, "no bonus row for hourly_gross");

// Global employee should produce: globalSalary (cc=1, rate=9000, qty=1) +
// workDays.
const gsalary = findOne(globalShik, 1);
assert.equal(gsalary.length, 1, "globalSalary row");
assert.equal(gsalary[0].rate, 9000);
assert.equal(gsalary[0].quantity, 1);

const gworkdays = findOne(globalShik, 4, 4);
assert.equal(gworkdays.length, 1);
assert.equal(gworkdays[0].quantity, 22);

assert.equal(findOne(globalShik, 38).length, 0, "no OT for global");
assert.equal(findOne(globalShik, 39).length, 0, "no OT for global");

// Every workMonth / employeeNumber must be a finite integer.
for (const r of [...hourlyShik, ...globalShik]) {
  assert.equal(Number.isInteger(r.workMonth), true);
  assert.equal(r.workMonth, workMonth);
  assert.equal(Number.isFinite(r.employeeNumber), true);
}

console.log("✓ all assertions passed");

// Header check + write a sample xlsx so it can be inspected.
assert.deepEqual(SHIK_HEADERS, [
  "workMonth",
  "employeeNumber",
  "recordType",
  "componentCode",
  "rate",
  "quantity",
]);

const xl = new ShikImportXL({ year: "2026", month: String(workMonth) });
const buf = await xl.generate([hourlyRow, globalRow]);
const out = "/tmp/siklulit_sample.xlsx";
writeFileSync(out, Buffer.from(buf));
console.log(`wrote ${out} (${buf.byteLength} bytes)`);
