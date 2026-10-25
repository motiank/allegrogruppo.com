// Test for the payroll from Tabit Shift API reports (extractEmployeesFromTabitReports in
// payroll-summary/payroll_summary.js) — the same result the Excel files give.
//
//   $ node scripts/test_payroll_tabit.js
//
// Real check done 2026-10-24: Raanana Aug + Sep 2026, Excel files vs the API — the same payroll for every
// employee except the ones whose shifts were changed in Tabit after the Excel was downloaded.
// No network, no DB.

import assert from "node:assert/strict";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { extractEmployeesFromTabitReports } = require("../payroll-summary/payroll_summary.js");

const emp = (id, name, details, data, summary) => ({ header: { employee: { id, name }, details }, headers: [], data, summary });

const kitchen = {
  data: [
    emp(1, "Musa Diomande", [{ title: "חוזה עבודה", value: "ללא הפסקות" }], [
      // 8.87 paid hours > 7 → a 0.5 h break, from the role's 100%
      { date: "2026-09-01", role_0: "מחבתות", start_0: "2026-09-01T08:59:00+03:00", end_0: "2026-09-01T17:51:00+03:00", notes_0: "", day_100: 8.5, day_125: 0.3666666666666667, total_days: 1 },
      // Saturday: rest_100 is added to 150%; no clock-out on block 1 → a shift issue
      { date: "2026-09-05", role_0: "פיצה", start_0: "2026-09-05T10:00:00+03:00", end_0: "2026-09-05T14:30:00+03:00", notes_0: "late fix", rest_100: 4.5, role_1: 'בלת"מ', start_1: "2026-09-05T18:00:00+03:00", end_1: null },
      // a day of another month is not counted
      { date: "2026-10-01", role_0: "מחבתות", start_0: "2026-10-01T09:00:00+03:00", end_0: "2026-10-01T17:00:00+03:00", day_100: 8 },
    ], [
      { class: "active", title: "מחבתות summary", day_100: 8.5, day_125: 0.3666666666666667, total_days: 1 },
      { class: "active", title: "פיצה summary", rest_100: 4.5, total_days: 1 },
      { class: "active", title: "צ'קר summary", total_days: 0 },
      { class: "info", title: "General summary", day_100: 8.5, day_125: 0.3666666666666667, rest_100: 4.5, total_days: 2 },
    ]),
  ],
};
const floor = {
  data: [
    // tip = tip (סה״כ טיפ); completion = supplement + credit_tip, as the Excel reader does
    emp(9, "דנה כהן", [{ title: "Clock id", value: "779" }], [
      { date: "2026-09-13", role_0: "מלצר", start_0: "2026-09-13T18:04:00+03:00", end_0: "2026-09-13T23:16:00+03:00", day_100: 5.2, tip: 127.8, cash_tip: 8, credit_tip: 119.8, supplement: 80.2 },
      { date: "2026-09-14", role_0: "מלצר", start_0: "2026-09-14T18:00:00+03:00", end_0: "2026-09-14T22:00:00+03:00", holiday_100: 4, cash_tip: 50 },
    ], [
      { class: "active", title: "סיכום מלצר", day_100: 5.2, holiday_100: 4, tip: 177.8, cash_tip: 58, credit_tip: 119.8, supplement: 80.2, total_days: 2 },
      { class: "info", title: "General summary", day_100: 5.2, holiday_100: 4, tip: 177.8, total_days: 2 },
    ]),
    emp(4, "", [], [], []),
  ],
};

const r = extractEmployeesFromTabitReports([{ app: 4212, report: kitchen }, { app: 1198, report: floor }], "2026-09");
assert.equal(r.month, "2026-09");
assert.deepEqual(r.exceptions.map((e) => e.issue), ["missing employee name"]);

const musa = r.employees.find((e) => e.name === "Musa Diomande");
assert.deepEqual(musa.roles, ["מחבתות", "פיצה"], "a role with no hours is not a role");
assert.deepEqual(musa.payroll_data, {
  מחבתות: { hours: [8, 0.3666666666666667, 0], tip: 0, completion: 0 },
  פיצה: { hours: [0, 0, 4.5], tip: 0, completion: 0 },
});
assert.equal(musa.breaks, 0.5);
assert.equal(musa.workdays, 2, "work days = total_days of the general row");
assert.deepEqual(musa.work_dates, ["2026-09-01", "2026-09-05"]);
assert.equal(Math.round(musa.daily_hours["2026-09-01"] * 100) / 100, 8.87);
assert.deepEqual(musa.notes, [{ date: "2026-09-05", note: "late fix" }]);
assert.equal(musa.global, true, "like an Excel sheet without a rate column");
assert.deepEqual(r.shiftIssues.map((i) => [i.employee, i.date, i.slot, i.role, i.entry, i.exit, i.missing]), [
  ["Musa Diomande", "2026-09-05", 2, 'בלת"מ', "18:00", "", "exit"],
]);

const dana = r.employees.find((e) => e.name === "דנה כהן");
assert.equal(dana.clockId, "779");
assert.deepEqual(dana.payroll_data, { מלצר: { hours: [5.2, 0, 4], tip: 177.8, completion: 200 } });
assert.equal(dana.breaks, 0);
assert.deepEqual(dana.daily_breakdown["2026-09-14"], [{ role: "מלצר", h100: 0, h125: 0, h150: 4, tip: 50, completion: 0 }]);

console.log("test_payroll_tabit: OK");
