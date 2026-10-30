// Attendance as it should be counted: the raw clock rows from Allegro (/shifts/raw, the Tabit
// detailed report) with the managers' documented corrections on top. The raw row is never changed.
import { q, ymdhms, inList } from '../db.js';
import { rawShifts, workPlan } from './source.js';
import { addDays } from '../lib/recommend.js';

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
      loadedAt: r.loadedAt,
      hours: hoursOf(clockIn, clockOut),
      corrected: !!c,
      excluded,
      isDemo: false,
    };
  });
}

// ---------------------------------------------------------------- attendance report (דיווחי נוכחות)

const MAX_LIST = 200;
const personName = (s) => String(s ?? '').trim().replace(/^\*+\s*/, '').replace(/\s+/g, ' ');
const timeOf = (s) => (s ? s.slice(11, 16) : null);
const localDay = (iso, tz = process.env.JOYA_TZ || 'Asia/Jerusalem') =>
  iso ? new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)) : null;

/**
 * דיווחי נוכחות = the Tabit Shift clock report only (owner 2026-10-30). The problems in it:
 *   · open shifts: an entry without an exit, or an exit without an entry (no exit on a day that was not over when the
 *     report was read = still at work)
 *   · no-shows: in the work plan (סידור עבודה) of a day, but no clock row that day
 *   · not in the plan: a clock row on a day the person was not in the plan
 * The plan is compared only on days that passed (up to yesterday), that have a plan with people and clock rows.
 * A person is the same when the employee id (linked by Allegro) or the name is the same.
 */
export async function attendanceReport(locationIds, from, to, today, names = new Map()) {
  const out = [];
  for (const loc of locationIds) {
    const att = (await effectiveAttendance([loc], from, to)).filter((a) => !a.excluded);
    const plan = await workPlan(loc, from, to);
    // the report is read once a day (06:30) and may be read again during the day: a day from the day it was read on
    // was not over yet, so its open entries and its plan are not checked
    const loadedDay = localDay(att.reduce((m, a) => (a.loadedAt && a.loadedAt > m ? a.loadedAt : m), '')) || today;
    const openFrom = loadedDay < today ? loadedDay : today;
    const missingExit = [];
    const missingEntry = [];
    const stillAtWork = [];
    const row = (a) => ({ date: a.date, name: personName(a.employeeName), role: a.roleName, clockIn: timeOf(a.clockIn), clockOut: timeOf(a.clockOut), corrected: a.corrected });
    for (const a of att) {
      if (a.clockIn && !a.clockOut) (a.date >= openFrom ? stillAtWork : missingExit).push(row(a));
      else if (!a.clockIn) missingEntry.push(row(a));
    }
    const lastClockDate = att.reduce((m, a) => (a.date > m ? a.date : m), '') || null;

    // who clocked / who was planned, per date: by employee id and by name
    const clocked = new Map();
    for (const a of att) {
      const d = clocked.get(a.date) || { ids: new Set(), names: new Set(), rows: [] };
      if (a.employeeId != null) d.ids.add(a.employeeId);
      d.names.add(personName(a.employeeName));
      d.rows.push(a);
      clocked.set(a.date, d);
    }
    const planned = new Map();
    for (const r of plan.available ? plan.rows : []) {
      if (!r.employeeName) continue; // an open slot
      const d = planned.get(r.date) || { ids: new Set(), names: new Set(), rows: [], published: false };
      if (r.employeeId != null) d.ids.add(r.employeeId);
      d.names.add(personName(r.employeeName));
      d.rows.push(r);
      d.published = d.published || r.published;
      planned.set(r.date, d);
    }
    const lastDay = [to, addDays(openFrom, -1), lastClockDate || from].sort()[0];
    const compared = [];
    const noPlanDays = [];
    const noClockDays = [];
    const noShow = [];
    const notInPlan = [];
    for (let d = from; d <= lastDay; d = addDays(d, 1)) {
      const p = planned.get(d);
      const c = clocked.get(d);
      if (!p) {
        if (c) noPlanDays.push(d);
        continue;
      }
      if (!c) {
        noClockDays.push(d); // planned but no clock rows at all: closed day or the report is missing
        continue;
      }
      compared.push({ date: d, published: p.published });
      const seen = new Set();
      for (const r of p.rows) {
        const n = personName(r.employeeName);
        if ((r.employeeId != null && c.ids.has(r.employeeId)) || c.names.has(n) || seen.has(n)) continue;
        seen.add(n);
        const slots = p.rows.filter((x) => personName(x.employeeName) === n);
        noShow.push({ date: d, name: n, shift: slots.map((x) => x.shift).filter(Boolean).join(', ') || null, role: slots.map((x) => x.roleName).filter(Boolean).join(', ') || null, plannedStart: timeOf(r.plannedStart), plannedEnd: timeOf(r.plannedEnd), published: p.published });
      }
      const seenC = new Set();
      for (const a of c.rows) {
        const n = personName(a.employeeName);
        if ((a.employeeId != null && p.ids.has(a.employeeId)) || p.names.has(n) || seenC.has(n)) continue;
        seenC.add(n);
        const rows = c.rows.filter((x) => personName(x.employeeName) === n);
        notInPlan.push({ date: d, name: n, role: rows.map((x) => x.roleName).filter(Boolean).join(', ') || null, clockIn: timeOf(rows[0].clockIn), clockOut: timeOf(rows[rows.length - 1].clockOut), hours: rows.reduce((h, x) => h + (x.hours || 0), 0) || null });
      }
    }
    const cap = (list) => ({ count: list.length, rows: list.slice(0, MAX_LIST), ...(list.length > MAX_LIST ? { notShown: list.length - MAX_LIST } : {}) });
    out.push({
      locationId: String(loc),
      location: names.get(String(loc)) ?? String(loc),
      clockRows: att.length,
      lastClockDate,
      reportReadOn: loadedDay,
      openShifts: { missingExit: cap(missingExit), missingEntry: cap(missingEntry), stillAtWorkToday: cap(stillAtWork) },
      plan: plan.available
        ? {
            available: true,
            comparedDays: compared,
            daysWithoutPlan: noPlanDays,
            plannedDaysWithoutClockRows: noClockDays,
            ...(compared.length ? {} : { notCompared: planned.size ? 'no day with both a plan and clock times up to yesterday' : 'no work plan for this period' }),
          }
        : { available: false, reason: plan.reason },
      noShow: cap(noShow),
      notInPlan: cap(notInPlan),
    });
  }
  return {
    source: 'Tabit Shift clock report (Allegro /shifts/raw, with the managers\' corrections) and the Tabit Shift work plan (Allegro /shifts/plan)',
    period: { from, to },
    today,
    rules:
      'open shift = an entry without an exit or an exit without an entry (no exit on a day not over when the report was read (reportReadOn or later) = still at work, not a problem); no-show = in the work plan that day but no clock times; not in the plan = clock times on a day the person was not in the plan. The plan is compared only on days that were over when the report was read, with both a plan and clock times',
    byLocation: out,
  };
}

// ---------------------------------------------------------------- clock rows (the shifts themselves)

const MAX_ROWS = 400;
const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const msOf = (s) => Date.parse(`${s.replace(' ', 'T')}Z`);

/** The shifts of a clock row: morning before `split`, evening from it (on to the night); a shift counts with 1 h or more. */
function shiftsOf(clockIn, clockOut, date, split = '17:00') {
  if (!clockIn || !clockOut) return clockIn ? [clockIn.slice(11, 16) < split ? 'morning' : 'evening'] : clockOut ? [clockOut.slice(11, 16) <= split ? 'morning' : 'evening'] : [];
  const a = msOf(clockIn);
  const b = msOf(clockOut);
  const s = msOf(`${date} ${split}:00`);
  const out = [];
  if (Math.min(b, s) - a >= 3600000) out.push('morning');
  if (b - Math.max(a, s) >= 3600000) out.push('evening');
  return out.length ? out : [clockIn.slice(11, 16) < split ? 'morning' : 'evening'];
}

/**
 * Every clock row (entry and exit) of the Tabit Shift report, with the managers' corrections: per person or for a
 * date / shift. q = part of the name; shift = morning | evening; role = part of the role name.
 */
export async function clockRows(locationIds, from, to, { q = null, employeeId = null, role = null, shift = null } = {}, names = new Map()) {
  const text = q ? personName(q) : null;
  const all = [];
  for (const loc of locationIds) {
    for (const a of await effectiveAttendance([loc], from, to)) {
      if (a.excluded) continue;
      if (employeeId != null && String(a.employeeId) !== String(employeeId)) continue;
      if (text && !personName(a.employeeName).includes(text)) continue;
      if (role && !String(a.roleName || '').includes(role)) continue;
      const shifts = shiftsOf(a.clockIn, a.clockOut, a.date);
      if (shift && !shifts.includes(shift)) continue;
      all.push({
        location: names.get(String(loc)) ?? String(loc),
        date: a.date,
        weekday: WEEKDAYS[new Date(`${a.date}T12:00:00Z`).getUTCDay()],
        name: personName(a.employeeName),
        linked: a.employeeId != null,
        role: a.roleName,
        shift: shifts.join('+') || null,
        clockIn: a.clockIn ? a.clockIn.slice(11, 16) : null,
        clockOut: a.clockOut ? (a.clockOut.slice(0, 10) > a.date ? `${a.clockOut.slice(11, 16)} (+1)` : a.clockOut.slice(11, 16)) : null,
        hours: a.hours,
        open: !a.clockIn || !a.clockOut,
        corrected: a.corrected,
      });
    }
  }
  all.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : (x.clockIn || '').localeCompare(y.clockIn || '')));
  const people = new Map();
  for (const r of all) {
    const k = `${r.location}|${r.name}`;
    const p = people.get(k) || { location: r.location, name: r.name, rows: 0, days: new Set(), hours: 0, open: 0 };
    p.rows++;
    p.days.add(r.date);
    p.hours += r.hours || 0;
    if (r.open) p.open++;
    people.set(k, p);
  }
  return {
    source: "Tabit Shift clock report (Allegro /shifts/raw), with the managers' corrections; raw clock hours, before the payroll rules",
    period: { from, to },
    filter: { q, role, shift },
    shiftRule: 'morning = before 17:00, evening = from 17:00 (and the night); a row counts in a shift with 1 hour or more in it',
    count: all.length,
    shown: Math.min(all.length, MAX_ROWS),
    people: [...people.values()].map((p) => ({ location: p.location, name: p.name, rows: p.rows, days: p.days.size, hours: Math.round(p.hours * 100) / 100, openRows: p.open })),
    rows: all.slice(0, MAX_ROWS),
  };
}
