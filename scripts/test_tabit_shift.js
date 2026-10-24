// Test for the Tabit Shift API report → tabit_shifts rows (admin/server/uploads/tabitShift.js).
//
//   $ node scripts/test_tabit_shift.js
//
// Feeds reportToParsed a report shaped like the real /api/report/ JSON (blocks _0.._3, ISO times with
// +03:00, a shift past midnight, one without a clock-out) and merges two apps (Raanana kitchen + floor).
// No network, no DB.

import assert from "node:assert/strict";
import { reportToParsed, mergeParsed, nextMonth } from "../admin/server/uploads/tabitShift.js";
import { defaultTabitShiftMonths } from "../admin/server/modules/files.js";

const emp = (id, name, data) => ({ header: { headline: "דוח מפורט", employee: { id, name } }, headers: [], data, summary: [] });

const kitchen = {
  data: [
    emp(1, "Musa Diomande", [
      { day: "ג'", date: "2026-09-01", role_0: "טבח", start_0: "2026-09-01T08:59:00+03:00", end_0: "2026-09-01T17:51:00+03:00", notes_0: "", day_100: 8.5 },
      // past midnight, and a second block the same day without a clock-out
      { day: "ד'", date: "2026-09-02", role_0: "טבח", start_0: "2026-09-02T18:00:00+03:00", end_0: "2026-09-03T01:30:00+03:00", notes_0: " late ", role_1: "שוטף", start_1: "2026-09-02T07:00:00+03:00", end_1: "" },
      { day: "ה'", date: "2026-09-03", role_0: "", start_0: "", end_0: "", absence_0: "" },
      { class: "total", date: "סיכום" },
    ]),
    emp(2, "Shared Worker", [{ date: "2026-09-05", role_0: "טבח", start_0: "2026-09-05T10:00:00+03:00", end_0: "2026-09-05T15:00:00+03:00" }]),
    // a 2-month report has a second entry per employee: October's days are not September's
    emp(1, "Musa Diomande", [{ date: "2026-10-01", role_0: "טבח", start_0: "2026-10-01T09:00:00+03:00", end_0: "2026-10-01T17:00:00+03:00" }]),
  ],
};
const floor = {
  data: [
    // the same person in both apps: the floor shift is added, the same pair is kept once
    emp(9, "Shared Worker", [
      { date: "2026-09-05", role_0: "מלצר", start_0: "2026-09-05T18:00:00+03:00", end_0: "2026-09-05T23:00:00+03:00" },
      { date: "2026-09-05", role_0: "טבח", start_0: "2026-09-05T10:00:00+03:00", end_0: "2026-09-05T15:00:00+03:00" },
    ]),
    emp(3, "דנה כהן", [{ date: "2026-09-04", role_3: "מארחת", start_3: "2026-09-04T12:00:00Z", end_3: "2026-09-04T20:00:00Z" }]),
    // Tabit's own repeats: same day and clock-in, a role row + a בלת"מ row
    emp(5, "Repeat One", [
      { date: "2026-09-08", role_0: "מלצר", start_0: "2026-09-08T17:55:00+03:00", end_0: "2026-09-08T22:15:00+03:00", role_1: 'בלת"מ', start_1: "2026-09-08T17:55:00+03:00", end_1: "" },
      { date: "2026-09-10", role_0: 'בלת"מ', start_0: "2026-09-10T17:06:00+03:00", end_0: "2026-09-10T22:42:00+03:00", role_1: "מארחת", start_1: "2026-09-10T17:06:00+03:00", end_1: "2026-09-10T22:41:00+03:00" },
      { date: "2026-09-18", role_0: "מארחת", start_0: "2026-09-18T11:30:00+03:00", end_0: "", role_1: 'בלת"מ', start_1: "2026-09-18T11:30:00+03:00", end_1: "2026-09-18T16:32:00+03:00" },
    ]),
    emp(4, "", []),
  ],
};

const k = reportToParsed(kitchen, "2026-09");
assert.equal(k.month, "2026-09");
assert.equal(k.employees.length, 2, "one employee's entries become one");
const musa = k.employees.find((e) => e.name === "Musa Diomande");
assert.deepEqual(musa.shifts, [
  { work_date: "2026-09-01", block_no: 1, role: "טבח", clock_in: "2026-09-01 08:59:00", clock_out: "2026-09-01 17:51:00", note: null },
  { work_date: "2026-09-02", block_no: 1, role: "טבח", clock_in: "2026-09-02 18:00:00", clock_out: "2026-09-03 01:30:00", note: "late" },
  { work_date: "2026-09-02", block_no: 2, role: "שוטף", clock_in: "2026-09-02 07:00:00", clock_out: null, note: null },
]);
assert.equal(musa.clockId, null);

const f = reportToParsed(floor, "2026-09");
assert.equal(f.skipped.length, 1, "an entry without a name is skipped");
// a UTC time is turned into restaurant time; block _3 → block_no 4
assert.deepEqual(f.employees.find((e) => e.name === "דנה כהן").shifts[0], {
  work_date: "2026-09-04", block_no: 4, role: "מארחת", clock_in: "2026-09-04 15:00:00", clock_out: "2026-09-04 23:00:00", note: null,
});

const m = mergeParsed([k, f]);
assert.equal(m.month, "2026-09");
assert.deepEqual(m.employees.map((e) => e.name).sort(), ["Musa Diomande", "Repeat One", "Shared Worker", "דנה כהן"]);
// one row per day: the one with a clock-out, then the real role over בלת"מ
assert.deepEqual(m.employees.find((e) => e.name === "Repeat One").shifts.map((s) => [s.work_date, s.block_no, s.role, s.clock_out]), [
  ["2026-09-08", 1, "מלצר", "2026-09-08 22:15:00"],
  ["2026-09-10", 1, "מארחת", "2026-09-10 22:41:00"],
  ["2026-09-18", 1, 'בלת"מ', "2026-09-18 16:32:00"],
]);
const shared = m.employees.find((e) => e.name === "Shared Worker").shifts;
assert.deepEqual(shared.map((s) => [s.block_no, s.role, s.clock_in]), [
  [1, "טבח", "2026-09-05 10:00:00"],
  [2, "מלצר", "2026-09-05 18:00:00"],
]);
// renumbered by clock-in: the 07:00 block comes first on 2 Sep
assert.deepEqual(m.employees.find((e) => e.name === "Musa Diomande").shifts.filter((s) => s.work_date === "2026-09-02").map((s) => [s.block_no, s.role]), [
  [1, "שוטף"],
  [2, "טבח"],
]);
assert.equal(m.employees.find((e) => e.name === "דנה כהן").shifts[0].block_no, 1);
assert.equal(m.skipped.length, 1);

assert.equal(nextMonth("2026-09"), "2026-10");
assert.equal(nextMonth("2026-12"), "2027-01");
assert.deepEqual(defaultTabitShiftMonths(new Date("2026-10-24T09:00:00Z")), ["2026-10"]);
assert.deepEqual(defaultTabitShiftMonths(new Date("2026-11-03T09:00:00Z")), ["2026-10", "2026-11"]);
assert.deepEqual(defaultTabitShiftMonths(new Date("2027-01-02T09:00:00Z")), ["2026-12", "2027-01"]);

console.log("test_tabit_shift: OK");
