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
// Roles exercising the base-component split + default-wage merge:
//   • מלצר  @40   → default (40) ┐
//   • ראנר  @40   → default (40) ┴ MERGED into one base code-1 line
//   • מתלמד @35.4 → trainee                → base code 33, per role
//   • בר    @50   → different rate         → base code 31, per role
// Overtime: default roles' OT merged at 40; non-default OT per role at its rate.
const hourlyEmp = {
  name: "Hourly Hannah",
  ID_nmbr: "111",
  workdays: 20, // PAID work days (componentCode 4)
  work_dates: HOURLY_WORK_DATES, // → actualWorkDays (componentCode 7)
  daily_hours: HOURLY_DAILY_HOURS, // → actualWorkHours (componentCode 5)
  travel: TRAVEL_PER_DAY,
  in_advance: 250, // מפרעה → componentCode 35
  payroll_data: {
    מלצר: { hours: [40, 5, 2] }, // default-rate role
    ראנר: { hours: [10, 1, 0] }, // also default rate → merges with מלצר
    מתלמד: { hours: [20, 0, 0] }, // trainee
    בר: { hours: [20, 3, 1] }, // other rate
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
// hourly_min employee: Shiklulit advance is computed and overrides any manual
// in_advance. minGross = (100 + 10*1.25 + 5*1.5) * 50 = 120*50 = 6000;
// advance = 6000*0.95 − completion(200) = 5700 − 200 = 5500.
const minEmp = {
  name: "Min Mia",
  ID_nmbr: "555",
  workdays: 15,
  work_dates: [],
  daily_hours: {},
  in_advance: 9999, // manual value — must be OVERRIDDEN for hourly_min
  payroll_data: {
    מלצר: { hours: [100, 10, 5], completion: 200 },
  },
};

// Min wage set at the EMPLOYEE level, with untyped roles (inherit the
// employee wage). minGross = (50 + 30*1.25)*40 ... computed below.
const minEmpLevel = {
  name: "Min Moe",
  ID_nmbr: "666",
  workdays: 12,
  work_dates: [],
  daily_hours: {},
  payroll_data: {
    מלצר: { hours: [50, 0, 0] },
    בר: { hours: [30, 0, 0], completion: 100 },
  },
};

// DB-side records (the shape buildExportRow expects from empByName).
const empByName = new Map([
  [
    "Hourly Hannah",
    {
      ID_nmbr: "111",
      new_wage_type: "hourly_gross",
      wage: HOURLY_RATE, // employee default = 40
      travel: TRAVEL_PER_DAY,
      maxTravel: null,
      // Per-role wages drive the base component split.
      rolesByName: {
        מלצר: { role: "מלצר", new_wage_type: "hourly_gross", wage: "40" },
        ראנר: { role: "ראנר", new_wage_type: "hourly_gross", wage: "40" },
        מתלמד: { role: "מתלמד", new_wage_type: "hourly_gross", wage: "35.4" },
        בר: { role: "בר", new_wage_type: "hourly_gross", wage: "50" },
      },
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
  [
    "Min Mia",
    {
      ID_nmbr: "555",
      new_wage_type: "hourly_min_gross",
      wage: 50,
      travel: null,
      maxTravel: null,
      rolesByName: {
        מלצר: { role: "מלצר", new_wage_type: "hourly_min_gross", wage: "50" },
      },
    },
  ],
  [
    "Min Moe",
    {
      ID_nmbr: "666",
      new_wage_type: "hourly_min_gross", // employee-level min wage
      wage: 50,
      hourly_wage: -1,
      travel: 30, // 30/day × 12 workdays = 360 travel, folded into the advance
      maxTravel: null,
      // Roles carry no per-role type → inherit the employee wage.
      rolesByName: {
        מלצר: { role: "מלצר", new_wage_type: null, wage: null },
        בר: { role: "בר", new_wage_type: null, wage: null },
      },
    },
  ],
]);
const micpalByIdNmbr = new Map([
  ["111", 14],
  ["222", 27],
  ["333", 33],
  ["444", 44],
  ["555", 55],
  ["666", 66],
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
const minRow = buildExportRow(minEmp, ctx);
minRow.employeeNumber = Number(minRow.keyName);
const minLevelRow = buildExportRow(minEmpLevel, ctx);
minLevelRow.employeeNumber = Number(minLevelRow.keyName);

const workMonth = 5;
const hourlyShik = buildShikRowsForEmployee(workMonth, hourlyRow);
const globalShik = buildShikRowsForEmployee(workMonth, globalRow);
const netShik = buildShikRowsForEmployee(workMonth, netRow);
const netLowShik = buildShikRowsForEmployee(workMonth, netLowRow);
const minShik = buildShikRowsForEmployee(workMonth, minRow);

console.log("hourly emp →", hourlyShik);
console.log("global emp →", globalShik);

// ─── Assertions ────────────────────────────────────────────────────────────
const findOne = (rows, componentCode, recordType = 1) =>
  rows.filter(
    (r) => r.componentCode === componentCode && r.recordType === recordType,
  );

// Hourly employee now produces:
//   • code 1  (default 40)  ← מלצר + ראנר MERGED, qty 40+10 = 50
//   • code 33 (trainee 35.4) ← מתלמד, qty 20
//   • code 31 (other 50)     ← בר, qty 20
// plus merged default OT (38/39 @40) and per-role OT for בר (@50).
const base = findOne(hourlyShik, 1);
assert.equal(base.length, 1, "merged default base row");
assert.equal(base[0].rate, HOURLY_RATE); // 40
assert.equal(base[0].quantity, 50); // מלצר 40 + ראנר 10

const trainee = findOne(hourlyShik, 33);
assert.equal(trainee.length, 1, "trainee base row (cc=33)");
assert.equal(trainee[0].rate, 35.4);
assert.equal(trainee[0].quantity, 20); // מתלמד h100

const extra = findOne(hourlyShik, 31);
assert.equal(extra.length, 1, "extra-rate base row (cc=31)");
assert.equal(extra[0].rate, 50);
assert.equal(extra[0].quantity, 20); // בר h100

// OT125 is paid at 1.25× the wage: merged default line @40→50 (5+1=6) and one
// בר line @50→62.5 (3).
const ot125 = findOne(hourlyShik, 38);
assert.equal(ot125.length, 2, "overtime125 rows");
assert.ok(
  ot125.some((r) => r.rate === 50 && r.quantity === 6),
  "default OT125 @50 (40×1.25) merged (5+1)",
);
assert.ok(
  ot125.some((r) => r.rate === 62.5 && r.quantity === 3),
  "בר OT125 @62.5 (50×1.25)",
);

// OT150 is paid at 1.5× the wage: merged default line @40→60 (2+0=2) and one
// בר line @50→75 (1).
const ot150 = findOne(hourlyShik, 39);
assert.equal(ot150.length, 2, "overtime150 rows");
assert.ok(
  ot150.some((r) => r.rate === 60 && r.quantity === 2),
  "default OT150 @60 (40×1.5) merged",
);
assert.ok(
  ot150.some((r) => r.rate === 75 && r.quantity === 1),
  "בר OT150 @75 (50×1.5)",
);

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
assert.equal(findOne(hourlyShik, 38).length, 2, "125% rows present");
assert.equal(findOne(hourlyShik, 39).length, 2, "150% rows present");

// Bonus only appears for hourly_min_* (this fixture is hourly_gross).
assert.equal(
  findOne(hourlyShik, 32).length,
  0,
  "no bonus row for hourly_gross",
);

// מפרעה (advance) → recordType 1, componentCode 35, rate = amount, qty = 1.
const advance = findOne(hourlyShik, 35);
assert.equal(advance.length, 1, "in_advance row (cc=35)");
assert.equal(advance[0].rate, 250);
assert.equal(advance[0].quantity, 1);
// Global employee has no advance → no cc=35 row.
assert.equal(findOne(globalShik, 35).length, 0, "no advance for global emp");

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

// hourly_net: paid at the wage rate (NO reduced rate, NO net bonus); the only
// difference from gross is the net flag.
assert.equal(netRow.hourlyWage, 50, "hourly_net at wage rate");
assert.equal(netRow.net, "נ", "hourly_net flagged net");
const netBase = findOne(netShik, 1);
assert.equal(netBase.length, 1, "net baseHourly row");
assert.equal(netBase[0].rate, 50, "baseHourly at wage rate");
assert.equal(netBase[0].quantity, 100);
assert.equal(findOne(netShik, 38)[0].rate, 62.5, "OT125 at 1.25× wage (50)");
assert.equal(findOne(netShik, 39)[0].rate, 75, "OT150 at 1.5× wage (50)");
assert.equal(findOne(netShik, 32).length, 0, "no net bonus row");

// Low-wage hourly_net: still paid at the wage rate, no bonus.
assert.equal(netLowRow.hourlyWage, 40, "hourly_net at wage rate");
assert.equal(findOne(netLowShik, 1)[0].rate, 40, "baseHourly at wage rate");
assert.equal(findOne(netLowShik, 32).length, 0, "no net bonus row");

// hourly_min: advance is COMPUTED and overrides the manual in_advance (9999),
// in BOTH exports. minGross = (100 + 10*1.25 + 5*1.5)*50 = 6000;
// advance = 6000*0.95 − 200 = 5500. (minRow.inAdvance feeds Micpal too.)
assert.equal(minRow.inAdvance, 5500, "computed hourly_min advance (Micpal too)");
const minAdv = findOne(minShik, 35);
assert.equal(minAdv.length, 1, "hourly_min advance row (cc=35)");
assert.equal(minAdv[0].rate, 5500, "advance overrides manual 9999");
assert.equal(minAdv[0].quantity, 1);

// hourly_min set at the EMPLOYEE level with untyped roles → advance still
// computed (roles inherit the employee wage). minGross = (50 + 30)*50 = 4000;
// travel = 30*12 = 360; advance = (4000 + 360)*0.95 − 100 = 4142 − 100 = 4042.
assert.equal(minLevelRow.inAdvance, 4042, "employee-level min-wage advance + travel");

// Every workMonth / employeeNumber must be a finite integer.
for (const r of [
  ...hourlyShik,
  ...globalShik,
  ...netShik,
  ...netLowShik,
  ...minShik,
]) {
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
