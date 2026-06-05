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

// hourlyEmp attendance: 18 distinct worked dates (→ actualWorkDays = 18, which
// deliberately differs from the 20 PAID days). daily_hours carries the clocked
// hours per date — a couple fractional so the rounding helper has something to
// do — and its sum (→ actualWorkHours) differs from the paid bands (80+8+3).
const HOURLY_WORK_DATES = Array.from(
  { length: 18 },
  (_, i) => `2026-05-${String(i + 1).padStart(2, "0")}`,
);
const HOURLY_DAILY_HOURS = {};
HOURLY_WORK_DATES.forEach((d, i) => {
  HOURLY_DAILY_HOURS[d] = i < 2 ? 8.33 : 8.5; // 8.33*2 + 8.5*16 = 152.66
});
const HOURLY_ACTUAL_HOURS =
  Math.round(
    Object.values(HOURLY_DAILY_HOURS).reduce((s, v) => s + v, 0) * 100,
  ) / 100;

// Two employees: one hourly with all hour buckets + travel, one global salary.
const hourlyEmp = {
  name: "Hourly Hannah",
  ID_nmbr: "111",
  workdays: 20, // PAID work days (componentCode 4)
  work_dates: HOURLY_WORK_DATES, // → actualWorkDays (componentCode 7)
  daily_hours: HOURLY_DAILY_HOURS, // → actualWorkHours (componentCode 5)
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
  work_dates: [],
  daily_hours: {},
  payroll_data: {},
};
// hourly_net: paid at reduced rate = max(36, floor(50*0.8)) = 40 + net bonus.
// hours h100=100, h125=10, h150=5.
const netEmp = {
  name: "Net Nora",
  ID_nmbr: "333",
  workdays: 21,
  work_dates: [],
  daily_hours: {},
  payroll_data: {
    week1: { hours: [100, 10, 5] },
  },
};
// hourly_net with a low wage: 40*0.8 = 32 < 36, so reduced clamps to 36.
const netLowEmp = {
  name: "Net Ned",
  ID_nmbr: "444",
  workdays: 18,
  work_dates: [],
  daily_hours: {},
  payroll_data: {
    week1: { hours: [100, 0, 0] },
  },
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
  [
    "Net Nora",
    {
      ID_nmbr: "333",
      new_wage_type: "hourly_net",
      wage: 50,
      travel: null,
      maxTravel: null,
    },
  ],
  [
    "Net Ned",
    {
      ID_nmbr: "444",
      new_wage_type: "hourly_net",
      wage: 40,
      travel: null,
      maxTravel: null,
    },
  ],
]);
const micpalByIdNmbr = new Map([
  ["111", 14],
  ["222", 27],
  ["333", 33],
  ["444", 44],
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

const netRow = buildExportRow(netEmp, ctx);
netRow.employeeNumber = Number(netRow.keyName);
const netLowRow = buildExportRow(netLowEmp, ctx);
netLowRow.employeeNumber = Number(netLowRow.keyName);

const workMonth = 5;
const hourlyShik = buildShikRowsForEmployee(workMonth, hourlyRow);
const globalShik = buildShikRowsForEmployee(workMonth, globalRow);
const netShik = buildShikRowsForEmployee(workMonth, netRow);
const netLowShik = buildShikRowsForEmployee(workMonth, netLowRow);

console.log("hourly emp →", hourlyShik);
console.log("global emp →", globalShik);

// ─── Assertions ────────────────────────────────────────────────────────────
const findOne = (rows, componentCode, recordType = 1) =>
  rows.filter(
    (r) => r.componentCode === componentCode && r.recordType === recordType,
  );

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

// recordType=4 employment-data rows. Paid work days (cc=4), actual work days
// (cc=7), actual work hours (cc=5). All carry rate=0; quantities come from the
// PAID workdays count, the distinct work_dates, and the summed daily_hours
// respectively — three independent sources, deliberately different values.
const paidWorkDays = findOne(hourlyShik, 4, 4);
assert.equal(paidWorkDays.length, 1, "paidWorkDays row");
assert.equal(paidWorkDays[0].rate, 0);
assert.equal(paidWorkDays[0].quantity, 20);
assert.equal(paidWorkDays[0].recordType, 4);

const actualWorkDays = findOne(hourlyShik, 7, 4);
assert.equal(actualWorkDays.length, 1, "actualWorkDays row");
assert.equal(actualWorkDays[0].rate, 0);
assert.equal(actualWorkDays[0].quantity, 18); // distinct work_dates, not paid days
assert.equal(actualWorkDays[0].recordType, 4);

const actualWorkHours = findOne(hourlyShik, 5, 4);
assert.equal(actualWorkHours.length, 1, "actualWorkHours row");
assert.equal(actualWorkHours[0].rate, 0);
assert.equal(actualWorkHours[0].quantity, HOURLY_ACTUAL_HOURS); // 152.66, clocked ≠ paid bands
assert.equal(actualWorkHours[0].recordType, 4);

// Exact row tuples from the acceptance criteria:
//   [workMonth, employeeNumber, 4, 4, 0, paidWorkDays]
//   [workMonth, employeeNumber, 4, 7, 0, actualWorkDays]
//   [workMonth, employeeNumber, 4, 5, 0, actualWorkHours]
const tuple = (r) => [
  r.workMonth,
  r.employeeNumber,
  r.recordType,
  r.componentCode,
  r.rate,
  r.quantity,
];
assert.deepEqual(tuple(paidWorkDays[0]), [
  workMonth,
  hourlyRow.employeeNumber,
  4,
  4,
  0,
  20,
]);
assert.deepEqual(tuple(actualWorkDays[0]), [
  workMonth,
  hourlyRow.employeeNumber,
  4,
  7,
  0,
  18,
]);
assert.deepEqual(tuple(actualWorkHours[0]), [
  workMonth,
  hourlyRow.employeeNumber,
  4,
  5,
  0,
  HOURLY_ACTUAL_HOURS,
]);

// regularHours (cc=1), 125% (cc=38), 150% (cc=39) still present for the same
// employee — actual attendance rows must not displace the paid-band rows.
assert.equal(findOne(hourlyShik, 1).length, 1, "regularHours row present");
assert.equal(findOne(hourlyShik, 38).length, 1, "125% row present");
assert.equal(findOne(hourlyShik, 39).length, 1, "150% row present");

// Bonus only appears for hourly_min_* (this fixture is hourly_gross).
assert.equal(
  findOne(hourlyShik, 32).length,
  0,
  "no bonus row for hourly_gross",
);

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

// hourly_net: reduced rate = max(36, floor(50*0.8)) = 40; rows exported at 40.
// Net bonus = (100+10+5)*50 − (100*40 + 10*40*1.25 + 5*40*1.5)
//           = 115*50 − 4800 = 5750 − 4800 = 950.
assert.equal(netRow.hourlyWage, 40, "hourly_net reduced rate");
assert.equal(netRow.net, "נ", "hourly_net flagged net");
const netBase = findOne(netShik, 1);
assert.equal(netBase.length, 1, "net baseHourly row");
assert.equal(netBase[0].rate, 40, "baseHourly at reduced rate");
assert.equal(netBase[0].quantity, 100);
assert.equal(findOne(netShik, 38)[0].rate, 40, "OT125 at reduced rate");
assert.equal(findOne(netShik, 39)[0].rate, 40, "OT150 at reduced rate");
const netBonus = findOne(netShik, 32);
assert.equal(netBonus.length, 1, "net bonus row present");
assert.equal(netBonus[0].rate, 950, "net bonus amount");
assert.equal(netBonus[0].quantity, 1);

// Low-wage hourly_net: 40*0.8 = 32 < 36 → reduced clamps to 36.
// Net bonus = 100*40 − 100*36 = 4000 − 3600 = 400.
assert.equal(netLowRow.hourlyWage, 36, "reduced rate clamped to 36");
assert.equal(findOne(netLowShik, 1)[0].rate, 36, "baseHourly clamped to 36");
assert.equal(findOne(netLowShik, 32)[0].rate, 400, "net bonus at clamped rate");

// Every workMonth / employeeNumber must be a finite integer.
for (const r of [...hourlyShik, ...globalShik, ...netShik, ...netLowShik]) {
  assert.equal(Number.isInteger(r.workMonth), true);
  assert.equal(r.workMonth, workMonth);
  assert.equal(Number.isFinite(r.employeeNumber), true);
}

// Validation: a row whose actual-attendance source couldn't be calculated
// (null, e.g. work_dates / daily_hours absent upstream) must raise a clear,
// specific error rather than silently exporting a 0.
assert.throws(
  () =>
    buildShikRowsForEmployee(workMonth, {
      ...hourlyRow,
      actualWorkDays: null,
    }),
  /cannot calculate actualWorkDays/,
  "missing actualWorkDays source rejected",
);
assert.throws(
  () =>
    buildShikRowsForEmployee(workMonth, {
      ...hourlyRow,
      actualWorkHours: null,
    }),
  /cannot calculate actualWorkHours/,
  "missing actualWorkHours source rejected",
);

console.log("✓ all assertions passed");

// Header check + write a sample xlsx so it can be inspected.
assert.deepEqual(SHIK_HEADERS, [
  "חודש עבודה",
  "מספר עובד",
  "סוג רשומה",
  "קוד רכיב",
  "תעריף",
  "כמות",
]);

const xl = new ShikImportXL({ year: "2026", month: String(workMonth) });
const buf = await xl.generate([hourlyRow, globalRow]);
const out = "/tmp/siklulit_sample.xlsx";
writeFileSync(out, Buffer.from(buf));
console.log(`wrote ${out} (${buf.byteLength} bytes)`);
