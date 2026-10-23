// Payroll preparation checks. The system finds problems in the clock rows and the saved
// payroll (both read from Allegro); a manager reviews each one and documents what was done.
// It never approves payroll — final approval stays with a person, in the payroll system.
import { q, one, err, audit, parseJson, ymd, ymdhms, inList, getSettings } from '../db.js';
import { assertLocation } from '../access.js';
import { effectiveAttendance } from './attendance.js';
import { rawShifts, employeeNames, payroll as sourcePayroll, shiftsSummary } from './source.js';
import { addDays } from '../lib/recommend.js';

const monthRange = (period) => {
  const from = `${period}-01`;
  const next = addDays(from, 32).slice(0, 7) + '-01';
  return [from, addDays(next, -1)];
};

/** Find issues for one location and month. Re-running never duplicates; issues that went away are closed. */
export async function runChecks(access, locationId, period) {
  assertLocation(access, locationId);
  if (!/^\d{4}-\d{2}$/.test(period || '')) throw err('BAD_REQUEST', 'period must be YYYY-MM');
  const dq = await getSettings('dataQuality');
  const longH = dq.longShiftHours ?? 14;
  const [from, to] = monthRange(period);
  const att = (await effectiveAttendance([locationId], from, to)).filter((a) => !a.excluded);
  const found = [];
  const add = (kind, rows, extra = {}) => {
    const ids = rows.map((r) => r.id).sort((a, b) => a - b);
    found.push({
      fingerprint: `${kind}:${locationId}:${period}:${extra.key ?? ids.join(',')}`.slice(0, 160),
      kind,
      employeeId: rows[0]?.employeeId ?? extra.employeeId ?? null,
      externalId: rows[0]?.externalId ?? extra.externalId ?? null,
      detail: { attendanceIds: ids, rows: rows.map((r) => ({ id: r.id, date: r.date, clockIn: r.clockIn, clockOut: r.clockOut, hours: r.hours, corrected: r.corrected })), ...extra.detail },
    });
  };

  for (const a of att) {
    if (!a.clockOut && a.clockIn) add('MISSING_CLOCK_OUT', [a]);
    if (!a.clockIn && a.clockOut) add('MISSING_CLOCK_IN', [a]);
    if (!a.clockIn && !a.clockOut) add('MISSING_CLOCK_IN', [a]);
    if (a.hours != null && a.hours > longH) add('LONG_SHIFT', [a], { detail: { limitHours: longH } });
  }
  // the same person: identical rows (duplicate) or overlapping times (overlap)
  const byPerson = new Map();
  for (const a of att) {
    const k = `${a.source}|${a.externalId}`;
    if (!byPerson.has(k)) byPerson.set(k, []);
    byPerson.get(k).push(a);
  }
  for (const rows of byPerson.values()) {
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const x = rows[i];
        const y = rows[j];
        if (x.date !== y.date) continue;
        if ((x.clockIn || null) === (y.clockIn || null) && (x.clockOut || null) === (y.clockOut || null)) add('DUPLICATE', [x, y]);
        else if (x.clockIn && y.clockIn && x.clockOut && y.clockOut && x.clockIn < y.clockOut && y.clockIn < x.clockOut) add('OVERLAP', [x, y]);
      }
    }
  }
  // attendance with an id no employee carries
  const unmatched = new Map();
  for (const a of att.filter((x) => !x.employeeId)) {
    const k = `${a.source}|${a.externalId}`;
    if (!unmatched.has(k)) unmatched.set(k, []);
    unmatched.get(k).push(a);
  }
  for (const [k, rows] of unmatched) add('UNMATCHED_EMPLOYEE', rows.slice(0, 1), { key: k, detail: { source: rows[0].source, externalId: rows[0].externalId, rowCount: rows.length } });

  // payroll hours (the saved month, after breaks and overtime rules) vs clocked hours, per employee.
  // The rules only take hours away (breaks), so only payroll ABOVE the clock is a problem.
  const pl = access.payroll ? (await shiftsSummary(locationId, period)).filter((p) => p.employeeId != null) : [];
  for (const p of pl) {
    const ext = String(p.employeeId);
    const rows = att.filter((a) => a.employeeId === p.employeeId);
    if (!rows.length) {
      // without any clock rows of the month (no Tabit report uploaded yet) there is nothing to compare
      if (att.length) add('NO_ATTENDANCE', [], { key: `pay:${ext}`, employeeId: p.employeeId, externalId: ext, detail: { payrollHours: p.totalHours == null ? null : Number(p.totalHours) } });
      continue;
    }
    if (p.totalHours == null || rows.some((a) => a.hours == null)) continue; // cannot compare honestly
    const attH = rows.reduce((s, a) => s + a.hours, 0);
    const payH = Number(p.totalHours);
    const diff = payH - attH;
    if (diff > Math.max(1, 0.03 * attH)) {
      add('HOURS_MISMATCH', [], {
        key: `hrs:${ext}`,
        employeeId: p.employeeId,
        externalId: ext,
        detail: { payrollHours: Math.round(payH * 100) / 100, attendanceHours: Math.round(attH * 100) / 100, differenceHours: Math.round(diff * 100) / 100, attendanceRows: rows.length },
      });
    }
  }

  let created = 0;
  for (const f of found) {
    const r = await q(
      `INSERT IGNORE INTO joya_payroll_issues (fingerprint, period, location_id, employee_id, external_employee_id, kind, detail_json)
       VALUES (:fp, :p, :l, :e, :x, :k, :d)`,
      { fp: f.fingerprint, p: period, l: locationId, e: f.employeeId, x: f.externalId, k: f.kind, d: JSON.stringify(f.detail) },
    );
    created += r.affectedRows;
  }
  // open issues that are no longer found (fixed by a correction or new data in Allegro)
  const fps = found.map((f) => f.fingerprint);
  const open = await q(`SELECT id, fingerprint FROM joya_payroll_issues WHERE location_id=:l AND period=:p AND status='OPEN'`, { l: locationId, p: period });
  let closed = 0;
  for (const o of open.filter((o) => !fps.includes(o.fingerprint))) {
    await q(`UPDATE joya_payroll_issues SET status='CORRECTED', resolution_note='no longer found when the checks ran again', resolved_by='system', resolved_at=NOW() WHERE id=:id`, { id: o.id });
    closed++;
  }
  await audit(access.username, 'PAYROLL_CHECKS_RUN', 'payroll', null, locationId, { period, found: found.length, created, closed });
  return { period, attendanceRows: att.length, found: found.length, created, closed, payrollCompared: access.payroll };
}

export async function listIssues(access, { locationIds, period, status }) {
  if (!locationIds.length) return [];
  const l = inList('l', locationIds);
  const st = status ? String(status).split(',') : null;
  const names = await employeeNames(locationIds).catch(() => new Map());
  const rows = await q(
    `SELECT i.*, loc.name AS location_name FROM joya_payroll_issues i JOIN joya_locations loc ON loc.id = i.location_id
      WHERE i.location_id IN (${l.sql}) ${period ? 'AND i.period = :p' : ''} ${st ? `AND i.status IN (${st.map((s) => `'${s.replace(/[^A-Z_]/g, '')}'`).join(',')})` : ''}
      ORDER BY FIELD(i.status,'OPEN','CORRECTED','ACCEPTED','DISMISSED'), i.period DESC, i.kind, i.id`,
    { ...l.params, p: period },
  );
  return rows.map((r) => {
    const detail = parseJson(r.detail_json) || {};
    // hours mismatch numbers come from payroll lines: payroll access only
    if (!access.payroll && r.kind === 'HOURS_MISMATCH') delete detail.payrollHours;
    return {
      id: r.id,
      period: r.period,
      locationId: r.location_id,
      locationName: r.location_name,
      employeeId: r.employee_id,
      employeeName: (r.employee_id != null ? names.get(Number(r.employee_id)) : null) ?? (String(r.external_employee_id || '').startsWith('name:') ? r.external_employee_id.slice(5) : null),
      externalId: r.external_employee_id,
      kind: r.kind,
      detail,
      status: r.status,
      resolutionNote: r.resolution_note,
      resolvedBy: r.resolved_by,
      resolvedAt: r.resolved_at,
      detectedAt: r.detected_at,
    };
  });
}

/** Accept (it is right as it is) or dismiss (not a real problem). A note is required. */
export async function resolveIssue(access, id, { status, note }) {
  const i = await one(`SELECT * FROM joya_payroll_issues WHERE id=:id`, { id });
  if (!i) throw err('NOT_FOUND', 'issue not found');
  assertLocation(access, i.location_id);
  if (!['ACCEPTED', 'DISMISSED', 'OPEN'].includes(status)) throw err('BAD_REQUEST', 'status must be ACCEPTED, DISMISSED or OPEN');
  if (status !== 'OPEN' && !String(note || '').trim()) throw err('BAD_REQUEST', 'write a short note: what was checked');
  await q(`UPDATE joya_payroll_issues SET status=:s, resolution_note=:n, resolved_by=:u, resolved_at=${status === 'OPEN' ? 'NULL' : 'NOW()'} WHERE id=:id`, {
    s: status,
    n: status === 'OPEN' ? null : String(note).trim(),
    u: status === 'OPEN' ? null : access.username,
    id,
  });
  await audit(access.username, 'PAYROLL_ISSUE_' + status, 'payroll_issue', id, i.location_id, { note });
}

/**
 * A documented correction of one raw clock row (an Allegro /shifts/raw id). The client sends the
 * row's location and date, so the row can be found in Allegro; the raw row is never changed.
 */
export async function correctAttendance(access, { attendanceId, locationId, date, action, clockIn, clockOut, note, issueId = null }) {
  if (!Number(locationId) || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw err('BAD_REQUEST', 'locationId and date of the row are required');
  assertLocation(access, Number(locationId));
  const raw = (await rawShifts(Number(locationId), date, date)).find((r) => r.id === Number(attendanceId));
  if (!raw) throw err('NOT_FOUND', 'attendance row not found');
  const a = { location_id: Number(locationId), clock_in: raw.clockIn, clock_out: raw.clockOut };
  if (!['SET_TIMES', 'EXCLUDE'].includes(action)) throw err('BAD_REQUEST', 'action must be SET_TIMES or EXCLUDE');
  if (!String(note || '').trim()) throw err('BAD_REQUEST', 'a correction needs a note (who confirmed it, why)');
  const fmt = (v) => (v ? String(v).replace('T', ' ').slice(0, 16) + ':00' : null);
  const ci = action === 'SET_TIMES' ? fmt(clockIn) : null;
  const co = action === 'SET_TIMES' ? fmt(clockOut) : null;
  if (action === 'SET_TIMES') {
    if (!ci && !co) throw err('BAD_REQUEST', 'give the corrected clock-in and/or clock-out');
    const effIn = ci || ymdhms(a.clock_in);
    const effOut = co || ymdhms(a.clock_out);
    if (effIn && effOut && effOut <= effIn) throw err('BAD_REQUEST', 'clock-out must be after clock-in');
  }
  const id = (
    await q(
      `INSERT INTO joya_attendance_corrections (attendance_id, location_id, business_date, raw_clock_in, raw_clock_out, issue_id, action, clock_in, clock_out, note, created_by)
       VALUES (:a, :l, :d, :ri, :ro, :i, :ac, :ci, :co, :n, :u)`, {
      a: raw.id,
      l: a.location_id,
      d: raw.date,
      ri: raw.clockIn,
      ro: raw.clockOut,
      i: issueId,
      ac: action,
      ci,
      co,
      n: String(note).trim(),
      u: access.username,
    })
  ).insertId;
  if (issueId) await q(`UPDATE joya_payroll_issues SET status='CORRECTED', resolution_note=:n, resolved_by=:u, resolved_at=NOW() WHERE id=:id AND location_id=:l`, { n: `correction #${id}: ${String(note).trim()}`, u: access.username, id: issueId, l: a.location_id });
  await audit(access.username, 'ATTENDANCE_CORRECTED', 'attendance', attendanceId, a.location_id, { correctionId: id, action, clockIn: ci, clockOut: co, note, before: { clockIn: ymdhms(a.clock_in), clockOut: ymdhms(a.clock_out) } });
  return { correctionId: id };
}

export async function attendanceRows(access, locationId, from, to) {
  assertLocation(access, locationId);
  const rows = await effectiveAttendance([locationId], from, to);
  const corr = rows.length
    ? await q(`SELECT * FROM joya_attendance_corrections WHERE attendance_id IN (${rows.map((r) => r.id).join(',')}) ORDER BY id`)
    : [];
  const names = await employeeNames([locationId]);
  return rows.map((r) => ({
    ...r,
    employeeName: (r.employeeId ? names.get(r.employeeId) : null) ?? r.employeeName,
    corrections: corr.filter((c) => c.attendance_id === r.id).map((c) => ({ id: c.id, action: c.action, clockIn: ymdhms(c.clock_in), clockOut: ymdhms(c.clock_out), note: c.note, by: c.created_by, at: c.created_at })),
  }));
}

/**
 * Payroll lines of a month (payroll access only): the payslip input of the saved month in Allegro
 * (`tlush.components`, amount = rate × quantity). Net lines and benefits in kind are OTHER, not gross.
 * Allegro has no employer cost.
 */
export async function payrollLines(access, locationId, period) {
  assertLocation(access, locationId);
  if (!/^\d{4}-\d{2}$/.test(period || '')) throw err('BAD_REQUEST', 'period must be YYYY-MM');
  const rows = [];
  let withoutPayslip = 0;
  for (const e of await sourcePayroll(locationId, period)) {
    if (!e.tlush?.components?.length) {
      withoutPayslip++;
      continue;
    }
    for (const c of e.tlush.components) {
      const amount = c.wage == null || c.quantity == null ? null : Math.round(Number(c.wage) * Number(c.quantity) * 100) / 100;
      const benefit = /שווי/.test(c.label || '');
      rows.push({
        id: `${e.employeeId}:${c.code}`,
        employeeId: e.employeeId,
        employeeName: e.name,
        externalId: e.tlush.employeeNumber != null ? String(e.tlush.employeeNumber) : null,
        component: c.label || String(c.code),
        costType: c.netGross === 'gross' && !benefit ? 'GROSS_WAGE' : 'OTHER',
        hours: /שעות|שעתי/.test(c.label || '') ? Math.round(Number(c.quantity) * 100) / 100 : null,
        amount,
        isDemo: false,
      });
    }
  }
  rows.sort((a, b) => String(a.employeeName).localeCompare(String(b.employeeName)) || String(a.component).localeCompare(String(b.component)));
  const sum = (t) => Math.round(rows.filter((r) => r.costType === t).reduce((s, r) => s + (r.amount ?? 0), 0) * 100) / 100;
  return {
    period,
    source: 'saved payroll via Allegro (/payroll, payslip input)',
    totals: { grossWage: sum('GROSS_WAGE'), employerCost: null, other: sum('OTHER'), linesWithoutAmount: rows.filter((r) => r.amount == null).length, employeesWithoutPayslip: withoutPayslip },
    lines: rows,
  };
}

export { ymd };
