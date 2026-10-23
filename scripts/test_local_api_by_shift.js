// Smoke test for the per-shift counts behind /local-api/v1/shifts/by-shift.
//
//   $ node scripts/test_local_api_by_shift.js
//
// Feeds shiftsByShift a few clock pairs (one crossing the 17:00 split, one past
// midnight, one without a clock-out) and checks people/hours per shift. No DB.

import assert from "node:assert/strict";
import { shiftsByShift } from "../admin/server/modules/localApi.js";

const B = "5ff419934676f0fddabaef3a";
const row = (employee_name, role, clock_in, clock_out, work_date = "2026-09-04") => ({
  rest: B, employee_name, clock_id: null, work_date, role, clock_in, clock_out,
});
const rows = [
  // 11:00–21:00 crosses the split: 6 h morning, 4 h evening
  row("*דנה - מלצר", "מלצר", "2026-09-04 11:00:00", "2026-09-04 21:00:00"),
  // 18:00–02:30 crosses midnight: all 8.5 h in the evening of 4 Sep
  row("*יוסי - מלצר", "מלצר", "2026-09-04 18:00:00", "2026-09-05 02:30:00"),
  // 16:30–23:00: 0.5 h morning (under minHours, hours still count), 6 h evening
  row("*רון - טבח", "טבח", "2026-09-04 16:30:00", "2026-09-04 23:00:00"),
  // closes after 06:00: only up to 06:00 counts
  row("*רון - טבח", "טבח", "2026-09-05 01:00:00", "2026-09-05 07:00:00"),
  // no clock-out
  row("*גל - מלצר", "מלצר", "2026-09-04 12:00:00", null),
];
// Dana is matched to employee 7; everybody else stays unmatched (counted by name).
const resolve = (rest, name) => ({ employeeId: name.includes("דנה") ? 7 : null });

const { data, missingClockOut, unmatched } = shiftsByShift(rows, resolve, { split: "17:00", minHours: 1 });
const pick = (shift, role) => data.find((d) => d.shift === shift && d.role === role);

assert.deepEqual(pick("morning", "מלצר"), {
  branch: B, date: "2026-09-04", shift: "morning", role: "מלצר", people: 1, hours: 6,
  start: "2026-09-04 00:00:00", end: "2026-09-04 17:00:00",
});
assert.deepEqual(pick("evening", "מלצר"), {
  branch: B, date: "2026-09-04", shift: "evening", role: "מלצר", people: 2, hours: 12.5,
  start: "2026-09-04 17:00:00", end: "2026-09-05 06:00:00",
});
assert.equal(pick("morning", "טבח").people, 0);
assert.equal(pick("morning", "טבח").hours, 0.5);
// Ron's two pairs are one person: 6 h + 5 h
assert.equal(pick("evening", "טבח").people, 1);
assert.equal(pick("evening", "טבח").hours, 11);
assert.equal(data.length, 4);
assert.deepEqual(data.map((d) => `${d.shift}/${d.role}`), ["morning/טבח", "morning/מלצר", "evening/טבח", "evening/מלצר"]);
assert.equal(missingClockOut, 1);
assert.equal(unmatched, 3);

// Another split moves the hours: at 15:00 Dana has 4 h morning, 6 h evening.
const at15 = shiftsByShift(rows, resolve, { split: "15:00", minHours: 1 }).data;
assert.equal(at15.find((d) => d.shift === "morning" && d.role === "מלצר").hours, 4);
assert.equal(at15.find((d) => d.shift === "evening" && d.role === "מלצר").hours, 14.5);

console.log("by-shift: all checks passed");
