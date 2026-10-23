// Attendance as it should be counted: the raw clock rows from Allegro (/shifts/raw, the Tabit
// detailed report) with the managers' documented corrections on top. The raw row is never changed.
import { q, ymdhms, inList } from '../db.js';
import { rawShifts } from './source.js';

const hoursOf = (clockIn, clockOut) =>
  clockIn && clockOut ? Math.round(((Date.parse(clockOut.replace(' ', 'T') + 'Z') - Date.parse(clockIn.replace(' ', 'T') + 'Z')) / 3600000) * 100) / 100 : null;

/** The newest correction of each raw row, by raw shift id. */
export async function latestCorrections(ids) {
  if (!ids.length) return new Map();
  const l = inList('a', ids);
  const rows = await q(
    `SELECT c.* FROM joya_attendance_corrections c
      WHERE c.attendance_id IN (${l.sql}) AND c.id = (SELECT MAX(c2.id) FROM joya_attendance_corrections c2 WHERE c2.attendance_id = c.attendance_id)`,
    l.params,
  );
  return new Map(rows.map((r) => [Number(r.attendance_id), r]));
}

/**
 * @returns rows { id, employeeId, externalId, employeeName, source, locationId, date, clockIn, clockOut, roleCode, roleName,
 *                 hours, corrected: bool, excluded: bool }   hours = null when a clock time is missing
 */
export async function effectiveAttendance(locationIds, from, to) {
  const raw = [];
  for (const loc of locationIds) raw.push(...(await rawShifts(loc, from, to)));
  const corr = await latestCorrections(raw.map((r) => r.id));
  return raw.map((r) => {
    const c = corr.get(r.id);
    const excluded = c?.action === 'EXCLUDE';
    const clockIn = c?.action === 'SET_TIMES' ? ymdhms(c.clock_in) ?? r.clockIn : r.clockIn;
    const clockOut = c?.action === 'SET_TIMES' ? ymdhms(c.clock_out) ?? r.clockOut : r.clockOut;
    return {
      id: r.id,
      employeeId: r.employeeId,
      externalId: r.externalId,
      employeeName: r.employeeName,
      source: 'TABIT',
      locationId: r.locationId,
      date: r.date,
      clockIn,
      clockOut,
      rawClockIn: r.clockIn,
      rawClockOut: r.clockOut,
      roleCode: r.roleCode,
      roleName: r.roleName,
      hours: hoursOf(clockIn, clockOut),
      corrected: !!c,
      excluded,
      isDemo: false,
    };
  });
}
