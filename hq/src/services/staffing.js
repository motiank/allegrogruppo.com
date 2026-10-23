// Weekly staffing proposal → manager edits → approved plan → compared with actual activity.
// The arithmetic is in ../lib/staffingRules.js (pure, tested); this file loads the rules,
// the forecast and past plans, and stores the results.
//
// Kept apart: joya_staffing_proposal_lines (the system's proposal, never changed),
// joya_staffing_plan_lines (what the manager edits), joya_staffing_edits (every change),
// joya_staffing_plans.final_json (frozen at approval).
import { q, one, tx, err, audit, parseJson, ymd, hms, getSettings, todayLocal } from '../db.js';
import { assertLocation } from '../access.js';
import { computeSlot, normalizeRule, validateRule, learnedAdjustments, normTime } from '../lib/staffingRules.js';
import { addDays } from '../lib/recommend.js';
import { forecastWeek, actualDemand } from './demand.js';
import { listRoles, listShifts } from './master.js';
import { effectiveAttendance } from './attendance.js';
import { toCsv } from '../lib/csv.js';

const weekdayOf = (d) => new Date(d + 'T00:00:00Z').getUTCDay();
export const sundayOf = (d) => addDays(d, -weekdayOf(d));
const durH = (s, e) => {
  const [sh, sm] = s.split(':').map(Number);
  const [eh, em] = e.split(':').map(Number);
  let m = eh * 60 + em - (sh * 60 + sm);
  if (m <= 0) m += 24 * 60;
  return m / 60;
};

// ---------------------------------------------------------------- rules and baseline

export async function listRules(access, locationId = null) {
  const rows = await q(`SELECT * FROM joya_staffing_rules ORDER BY role_code, location_id IS NULL DESC, location_id, shift_code, id`);
  return rows
    .filter((r) => r.location_id == null || access.isAdmin || access.locationIds.includes(r.location_id))
    .filter((r) => locationId == null || r.location_id == null || r.location_id === Number(locationId))
    .map((r) => ({ ...normalizeRule(r), updatedBy: r.updated_by, updatedAt: r.updated_at }));
}

/** Chain-wide and mandatory rules: chain admin only. A location manager may edit their location's other rules. */
function canEditRule(access, rule) {
  if (access.isAdmin) return true;
  return rule.location_id != null && access.locationIds.includes(Number(rule.location_id)) && !rule.mandatory;
}

export async function saveRule(access, input) {
  const r = {
    id: input.id || null,
    location_id: input.locationId ?? null,
    shift_code: input.shiftCode || null,
    days: Array.isArray(input.days) && input.days.length ? input.days.map(Number) : null,
    role_code: input.roleCode,
    rule_type: input.type,
    demand_unit: ['FIXED', 'MIN', 'MAX'].includes(input.type) ? null : input.unit || null,
    params: input.params || {},
    role_start: input.roleStart ? normTime(input.roleStart) : null,
    role_end: input.roleEnd ? normTime(input.roleEnd) : null,
    mandatory: input.mandatory ? 1 : 0,
    active: input.active === false ? 0 : 1,
    note: input.note || null,
  };
  const bad = validateRule(r);
  if (bad) throw err('BAD_REQUEST', bad);
  if (!(await one(`SELECT code FROM joya_staff_roles WHERE code=:c`, { c: r.role_code }))) throw err('BAD_REQUEST', `unknown role ${r.role_code}`);
  if (r.id) {
    const prev = await one(`SELECT * FROM joya_staffing_rules WHERE id=:id`, { id: r.id });
    if (!prev) throw err('NOT_FOUND', 'rule not found');
    if (!canEditRule(access, prev)) throw err('FORBIDDEN', 'only the chain admin can change this rule');
  }
  if (!canEditRule(access, r)) throw err('FORBIDDEN', 'only the chain admin can create chain-wide or mandatory rules');
  const p = { ...r, days: r.days ? JSON.stringify(r.days) : null, params: JSON.stringify(r.params), by: access.username };
  if (r.id) {
    await q(
      `UPDATE joya_staffing_rules SET location_id=:location_id, shift_code=:shift_code, days_json=:days, role_code=:role_code, rule_type=:rule_type, demand_unit=:demand_unit,
              params_json=:params, role_start=:role_start, role_end=:role_end, mandatory=:mandatory, active=:active, note=:note, updated_by=:by WHERE id=:id`,
      p,
    );
  } else {
    r.id = (
      await q(
        `INSERT INTO joya_staffing_rules (location_id, shift_code, days_json, role_code, rule_type, demand_unit, params_json, role_start, role_end, mandatory, active, note, updated_by)
         VALUES (:location_id, :shift_code, :days, :role_code, :rule_type, :demand_unit, :params, :role_start, :role_end, :mandatory, :active, :note, :by)`,
        p,
      )
    ).insertId;
  }
  await audit(access.username, 'STAFFING_RULE_SAVED', 'staffing_rule', r.id, r.location_id, { ...r, params: r.params });
  return r.id;
}

export async function deleteRule(access, id) {
  const prev = await one(`SELECT * FROM joya_staffing_rules WHERE id=:id`, { id });
  if (!prev) throw err('NOT_FOUND', 'rule not found');
  if (!canEditRule(access, prev)) throw err('FORBIDDEN', 'only the chain admin can delete this rule');
  await q(`DELETE FROM joya_staffing_rules WHERE id=:id`, { id });
  await audit(access.username, 'STAFFING_RULE_DELETED', 'staffing_rule', id, prev.location_id, normalizeRule(prev));
}

export async function listBaseline(access, locationId) {
  assertLocation(access, locationId);
  return (await q(`SELECT * FROM joya_staffing_baseline WHERE location_id=:l ORDER BY shift_code, weekday, role_code`, { l: locationId })).map((r) => ({
    id: r.id,
    locationId: r.location_id,
    shiftCode: r.shift_code,
    weekday: r.weekday,
    roleCode: r.role_code,
    headcount: r.headcount,
    note: r.note,
  }));
}

export async function saveBaseline(access, { locationId, shiftCode, weekday, roleCode, headcount, note = null }) {
  assertLocation(access, locationId);
  if (!(Number.isInteger(Number(headcount)) && Number(headcount) >= 0)) throw err('BAD_REQUEST', 'headcount must be a whole number ≥ 0');
  if (!(weekday >= 0 && weekday <= 6)) throw err('BAD_REQUEST', 'weekday 0..6');
  await q(
    `INSERT INTO joya_staffing_baseline (location_id, shift_code, weekday, role_code, headcount, note, updated_by) VALUES (:l, :s, :w, :r, :h, :n, :by)
     ON DUPLICATE KEY UPDATE headcount=VALUES(headcount), note=VALUES(note), updated_by=VALUES(updated_by)`,
    { l: locationId, s: shiftCode, w: weekday, r: roleCode, h: Number(headcount), n: note, by: access.username },
  );
  await audit(access.username, 'STAFFING_BASELINE_SAVED', 'staffing_baseline', null, locationId, { shiftCode, weekday, roleCode, headcount });
}

// ---------------------------------------------------------------- the proposal

async function pastPlanDiffs(locationId, beforeWeek, limit) {
  const plans = await q(
    `SELECT id, week_start, final_json FROM joya_staffing_plans WHERE location_id=:l AND status='APPROVED' AND week_start < :w ORDER BY week_start DESC LIMIT ${Number(limit) || 4}`,
    { l: locationId, w: beforeWeek },
  );
  const out = [];
  for (const p of plans) {
    const prop = await q(`SELECT work_date, shift_code, role_code, SUM(headcount) AS h FROM joya_staffing_proposal_lines WHERE plan_id=:id AND is_peak_extra=0 GROUP BY work_date, shift_code, role_code`, { id: p.id });
    const fin = new Map();
    for (const l of parseJson(p.final_json) || []) {
      if (l.isPeakExtra) continue;
      const k = `${l.date}|${l.shiftCode}|${l.roleCode}`;
      fin.set(k, (fin.get(k) || 0) + l.headcount);
    }
    const keys = new Set([...prop.map((r) => `${ymd(r.work_date)}|${r.shift_code}|${r.role_code}`), ...fin.keys()]);
    const propMap = new Map(prop.map((r) => [`${ymd(r.work_date)}|${r.shift_code}|${r.role_code}`, Number(r.h)]));
    out.push({
      planId: p.id,
      weekStart: ymd(p.week_start),
      diffs: [...keys].map((k) => {
        const [date, shiftCode, roleCode] = k.split('|');
        return { weekday: weekdayOf(date), shiftCode, roleCode, delta: (fin.get(k) || 0) - (propMap.get(k) || 0) };
      }),
    });
  }
  return out;
}

/**
 * Compute (without saving) the proposal for a week. `extraRules` (what-if) are added on top of the
 * stored rules as the most specific ones — used by "recalculate with …" in the chat; nothing is saved.
 */
export async function computeProposal(locationId, weekStart, { extraRules = [] } = {}) {
  const st = await getSettings('staffing');
  const forecast = await forecastWeek(locationId, weekStart);
  const rulesRows = await q(`SELECT * FROM joya_staffing_rules WHERE active=1 AND (location_id IS NULL OR location_id=:l)`, { l: locationId });
  let rules = rulesRows.map(normalizeRule);
  if (extraRules.length) {
    const extra = extraRules.map((r, i) => ({ ...normalizeRule({ ...r, id: 1e9 + i, active: 1, location_id: locationId }), whatIf: true }));
    // a what-if rule replaces stored rules of the same role and type for its scope
    rules = rules.filter((r) => !extra.some((x) => x.roleCode === r.roleCode && x.type === r.type)).concat(extra);
  }
  const roles = await listRoles();
  const roleOrder = roles.map((r) => r.code);
  const baselineRows = await q(`SELECT * FROM joya_staffing_baseline WHERE location_id=:l`, { l: locationId });
  const learned = learnedAdjustments(await pastPlanDiffs(locationId, weekStart, st.learnedAdjustWindow || 4), { minPlans: st.learnedAdjustMinPlans || 3, window: st.learnedAdjustWindow || 4 });

  const lines = [];
  const warnings = [];
  for (const slot of forecast.slots) {
    const demand = Object.fromEntries(Object.entries(slot.demand).map(([u, f]) => [u, { value: f.value, n: f.n, confidence: f.confidence }]));
    const res = computeSlot(rules, { locationId, shiftCode: slot.shiftCode, weekday: slot.weekday, start: slot.start, end: slot.end }, demand, roleOrder);
    const ruled = new Set(rules.filter((r) => r.active).map((r) => r.roleCode));
    // baseline: roles that no rule covers keep the staffing example as the proposal
    for (const b of baselineRows.filter((b) => b.shift_code === slot.shiftCode && b.weekday === slot.weekday)) {
      const line = res.lines.find((l) => l.roleCode === b.role_code && !l.isPeakExtra);
      if (line) line.explain.baseline = b.headcount;
      else if (!ruled.has(b.role_code) && b.headcount > 0) {
        res.lines.push({ roleCode: b.role_code, headcount: b.headcount, start: slot.start, end: slot.end, isPeakExtra: false, minRequired: 0, explain: { rules: [], demand: null, calc: [`BASELINE = ${b.headcount}`], notes: [{ code: 'FROM_BASELINE' }], baseline: b.headcount } });
      }
    }
    // learned adjustments: shown with their reason, never below the floor, never a rule change
    for (const line of res.lines.filter((l) => !l.isPeakExtra)) {
      const adj = learned[`${slot.weekday}|${slot.shiftCode}|${line.roleCode}`];
      if (!adj) continue;
      const before = line.headcount;
      line.headcount = Math.max(line.minRequired, before + adj.delta, 0);
      line.explain.learned = { delta: adj.delta, seen: adj.seen, window: adj.window, planIds: adj.plans.map((p) => p.planId), ruleResult: before };
      line.explain.calc.push(`learned ${adj.delta > 0 ? '+' : ''}${adj.delta} (${adj.seen}/${adj.window} plans) → ${line.headcount}`);
    }
    for (const w of res.warnings) warnings.push({ ...w, date: slot.date, shiftCode: slot.shiftCode });
    for (const l of res.lines) lines.push({ ...l, date: slot.date, shiftCode: slot.shiftCode, weekday: slot.weekday });
  }
  return { forecast, rules, lines, warnings, roles };
}

export async function propose(access, locationId, weekStart, { force = false } = {}) {
  assertLocation(access, locationId);
  const ws = sundayOf(weekStart || addDays(todayLocal(), 7));
  if (!force) {
    const open = await one(`SELECT id FROM joya_staffing_plans WHERE location_id=:l AND week_start=:w AND status='DRAFT' ORDER BY id DESC LIMIT 1`, { l: locationId, w: ws });
    if (open) return { planId: open.id, existing: true };
  }
  const shifts = (await listShifts([locationId])).filter((s) => s.active);
  if (!shifts.length) throw err('BAD_REQUEST', 'this location has no shifts defined yet (Settings → Shifts)');
  const p = await computeProposal(locationId, ws);
  const loc = await one(`SELECT is_demo FROM joya_locations WHERE id=:l`, { l: locationId });
  const planId = await tx(async (c) => {
    const id = (
      await c.q(`INSERT INTO joya_staffing_plans (location_id, week_start, status, forecast_json, rules_json, is_demo, created_by) VALUES (:l, :w, 'DRAFT', :f, :r, :d, :by)`, {
        l: locationId,
        w: ws,
        f: JSON.stringify({ ...p.forecast, warnings: p.warnings }),
        r: JSON.stringify(p.rules),
        d: loc?.is_demo ? 1 : 0,
        by: access.username,
      })
    ).insertId;
    for (const l of p.lines) {
      const pid = (
        await c.q(
          `INSERT INTO joya_staffing_proposal_lines (plan_id, work_date, shift_code, role_code, headcount, start_time, end_time, is_peak_extra, min_required, explain_json)
           VALUES (:p, :d, :s, :r, :h, :st, :en, :pk, :m, :e)`,
          { p: id, d: l.date, s: l.shiftCode, r: l.roleCode, h: l.headcount, st: l.start, en: l.end, pk: l.isPeakExtra ? 1 : 0, m: l.minRequired, e: JSON.stringify(l.explain) },
        )
      ).insertId;
      await c.q(
        `INSERT INTO joya_staffing_plan_lines (plan_id, work_date, shift_code, role_code, headcount, start_time, end_time, is_peak_extra, min_required, origin, proposal_line_id, updated_by)
         VALUES (:p, :d, :s, :r, :h, :st, :en, :pk, :m, 'PROPOSED', :pid, :by)`,
        { p: id, d: l.date, s: l.shiftCode, r: l.roleCode, h: l.headcount, st: l.start, en: l.end, pk: l.isPeakExtra ? 1 : 0, m: l.minRequired, pid, by: access.username },
      );
    }
    return id;
  });
  await audit(access.username, 'STAFFING_PROPOSED', 'staffing_plan', planId, locationId, { weekStart: ws, lines: p.lines.length, warnings: p.warnings.length });
  return { planId, existing: false };
}

const shapeLine = (r) => ({
  id: r.id,
  date: ymd(r.work_date),
  weekday: weekdayOf(ymd(r.work_date)),
  shiftCode: r.shift_code,
  roleCode: r.role_code,
  headcount: r.headcount,
  start: hms(r.start_time),
  end: hms(r.end_time),
  hours: Math.round(durH(hms(r.start_time), hms(r.end_time)) * 100) / 100,
  isPeakExtra: !!r.is_peak_extra,
  minRequired: r.min_required,
});

export async function getPlan(access, planId) {
  const p = await one(`SELECT p.*, l.name AS location_name FROM joya_staffing_plans p JOIN joya_locations l ON l.id = p.location_id WHERE p.id=:id`, { id: planId });
  if (!p) throw err('NOT_FOUND', 'plan not found');
  assertLocation(access, p.location_id);
  const lines = await q(`SELECT * FROM joya_staffing_plan_lines WHERE plan_id=:id ORDER BY work_date, shift_code, is_peak_extra, role_code, id`, { id: planId });
  const props = await q(`SELECT * FROM joya_staffing_proposal_lines WHERE plan_id=:id ORDER BY work_date, shift_code, is_peak_extra, role_code, id`, { id: planId });
  const edits = await q(`SELECT * FROM joya_staffing_edits WHERE plan_id=:id ORDER BY id`, { id: planId });
  const propById = new Map(props.map((x) => [x.id, x]));
  return {
    plan: {
      id: p.id,
      locationId: p.location_id,
      locationName: p.location_name,
      weekStart: ymd(p.week_start),
      status: p.status,
      isDemo: !!p.is_demo,
      note: p.note,
      createdBy: p.created_by,
      createdAt: p.created_at,
      approvedBy: p.approved_by,
      approvedAt: p.approved_at,
      rejectedBy: p.rejected_by,
      rejectedAt: p.rejected_at,
      forecast: parseJson(p.forecast_json),
      final: parseJson(p.final_json),
    },
    lines: lines.map((r) => {
      const prop = r.proposal_line_id ? propById.get(r.proposal_line_id) : null;
      return { ...shapeLine(r), origin: r.origin, note: r.note, updatedBy: r.updated_by, proposed: prop ? { headcount: prop.headcount, start: hms(prop.start_time), end: hms(prop.end_time) } : null, explain: prop ? parseJson(prop.explain_json) : null };
    }),
    proposal: props.map((r) => ({ ...shapeLine(r), explain: parseJson(r.explain_json) })),
    edits: edits.map((e) => ({ id: e.id, lineId: e.line_id, action: e.action, before: parseJson(e.before_json), after: parseJson(e.after_json), note: e.note, via: e.via, by: e.username, at: e.created_at })),
    violations: violations(lines.map(shapeLine)),
  };
}

/** Slots where the planned headcount is under the mandatory minimum. */
function violations(lines) {
  const slots = new Map();
  for (const l of lines) {
    if (l.isPeakExtra) continue;
    const k = `${l.date}|${l.shiftCode}|${l.roleCode}`;
    const s = slots.get(k) || { date: l.date, shiftCode: l.shiftCode, roleCode: l.roleCode, planned: 0, minRequired: 0 };
    s.planned += l.headcount;
    s.minRequired = Math.max(s.minRequired, l.minRequired);
    slots.set(k, s);
  }
  return [...slots.values()].filter((s) => s.planned < s.minRequired);
}

export async function listPlans(access, { locationIds, limit = 30 }) {
  if (!locationIds.length) return [];
  const rows = await q(
    `SELECT p.id, p.location_id, p.week_start, p.status, p.is_demo, p.created_by, p.approved_by, p.approved_at, l.name AS location_name,
            (SELECT SUM(headcount) FROM joya_staffing_plan_lines x WHERE x.plan_id = p.id) AS people
       FROM joya_staffing_plans p JOIN joya_locations l ON l.id = p.location_id
      WHERE p.location_id IN (${locationIds.map(Number).join(',')}) ORDER BY p.week_start DESC, p.id DESC LIMIT ${Math.min(Math.max(parseInt(limit, 10) || 30, 1), 200)}`,
  );
  return rows.map((r) => ({ id: r.id, locationId: r.location_id, locationName: r.location_name, weekStart: ymd(r.week_start), status: r.status, isDemo: !!r.is_demo, people: Number(r.people) || 0, createdBy: r.created_by, approvedBy: r.approved_by, approvedAt: r.approved_at }));
}

/**
 * ops: { op: 'set', lineId, headcount?, start?, end?, note? } | { op: 'add', date, shiftCode, roleCode, headcount, start?, end?, note? }
 *      | { op: 'remove', lineId, note? }
 * A change that would put a slot under its mandatory minimum is refused (MANDATORY_MIN).
 */
export async function checkOps(access, planId, ops) {
  const { plan, lines } = await getPlan(access, planId);
  if (plan.status !== 'DRAFT') throw err('CONFLICT', `the plan is ${plan.status}; reopen it to edit`);
  if (!Array.isArray(ops) || !ops.length) throw err('BAD_REQUEST', 'no changes');
  const roles = new Set((await listRoles()).map((r) => r.code));
  const shifts = (await listShifts([plan.locationId])).filter((s) => s.active);
  const sim = lines.map((l) => ({ ...l }));
  const out = [];
  for (const o of ops) {
    if (o.op === 'add') {
      if (!roles.has(o.roleCode)) throw err('BAD_REQUEST', `unknown role ${o.roleCode}`);
      const sh = shifts.find((s) => s.code === o.shiftCode);
      if (!sh) throw err('BAD_REQUEST', `unknown shift ${o.shiftCode}`);
      if (!(o.date >= plan.weekStart && o.date <= addDays(plan.weekStart, 6))) throw err('BAD_REQUEST', `${o.date} is not in this week`);
      const h = Number(o.headcount ?? 1);
      if (!(Number.isInteger(h) && h > 0)) throw err('BAD_REQUEST', 'headcount must be a whole number > 0');
      const start = o.start ? normTime(o.start) : sh.start;
      const end = o.end ? normTime(o.end) : sh.end;
      if (!start || !end) throw err('BAD_REQUEST', 'times must be HH:MM');
      const add = { op: 'add', date: o.date, shiftCode: o.shiftCode, roleCode: o.roleCode, headcount: h, start, end, note: o.note || null };
      sim.push({ ...add, id: null, isPeakExtra: false, minRequired: 0 });
      out.push(add);
    } else if (o.op === 'set' || o.op === 'remove') {
      const line = sim.find((l) => l.id === Number(o.lineId));
      if (!line) throw err('BAD_REQUEST', `line ${o.lineId} is not on this plan`);
      const next = { ...line };
      if (o.op === 'remove') next.headcount = 0;
      if (o.headcount != null) {
        const h = Number(o.headcount);
        if (!(Number.isInteger(h) && h >= 0)) throw err('BAD_REQUEST', 'headcount must be a whole number ≥ 0');
        next.headcount = h;
      }
      if (o.start) next.start = normTime(o.start);
      if (o.end) next.end = normTime(o.end);
      if (!next.start || !next.end) throw err('BAD_REQUEST', 'times must be HH:MM');
      Object.assign(line, next);
      out.push({ op: o.op, lineId: line.id, date: line.date, shiftCode: line.shiftCode, roleCode: line.roleCode, before: lines.find((l) => l.id === line.id), headcount: next.headcount, start: next.start, end: next.end, note: o.note || null });
    } else throw err('BAD_REQUEST', `unknown change "${o.op}"`);
  }
  const v = violations(sim.filter((l) => l.headcount > 0));
  // a slot with every line removed is also a violation when it has a floor
  for (const l of lines) {
    if (l.minRequired > 0 && !sim.some((s) => s.date === l.date && s.shiftCode === l.shiftCode && s.roleCode === l.roleCode && s.headcount > 0 && !s.isPeakExtra)) {
      if (!v.some((x) => x.date === l.date && x.shiftCode === l.shiftCode && x.roleCode === l.roleCode)) v.push({ date: l.date, shiftCode: l.shiftCode, roleCode: l.roleCode, planned: 0, minRequired: l.minRequired });
    }
  }
  if (v.length) throw Object.assign(err('MANDATORY_MIN', `below the mandatory minimum: ${v.map((x) => `${x.date} ${x.shiftCode} ${x.roleCode} ${x.planned} < ${x.minRequired}`).join('; ')}`), { details: { violations: v } });
  return out;
}

export async function applyOps(access, planId, ops, { via = 'UI' } = {}) {
  const checked = await checkOps(access, planId, ops);
  await tx(async (c) => {
    for (const o of checked) {
      if (o.op === 'add') {
        const id = (
          await c.q(
            `INSERT INTO joya_staffing_plan_lines (plan_id, work_date, shift_code, role_code, headcount, start_time, end_time, origin, note, updated_by) VALUES (:p, :d, :s, :r, :h, :st, :en, 'ADDED', :n, :by)`,
            { p: planId, d: o.date, s: o.shiftCode, r: o.roleCode, h: o.headcount, st: o.start, en: o.end, n: o.note, by: access.username },
          )
        ).insertId;
        await c.q(`INSERT INTO joya_staffing_edits (plan_id, line_id, action, after_json, note, via, username) VALUES (:p, :l, 'ADD', :a, :n, :via, :u)`, {
          p: planId,
          l: id,
          a: JSON.stringify(o),
          n: o.note,
          via,
          u: access.username,
        });
      } else if (o.op === 'remove' || (o.op === 'set' && o.headcount === 0)) {
        await c.q(`DELETE FROM joya_staffing_plan_lines WHERE id=:id AND plan_id=:p`, { id: o.lineId, p: planId });
        await c.q(`INSERT INTO joya_staffing_edits (plan_id, line_id, action, before_json, note, via, username) VALUES (:p, :l, 'REMOVE', :b, :n, :via, :u)`, {
          p: planId,
          l: o.lineId,
          b: JSON.stringify(o.before),
          n: o.note,
          via,
          u: access.username,
        });
      } else {
        await c.q(`UPDATE joya_staffing_plan_lines SET headcount=:h, start_time=:st, end_time=:en, note=COALESCE(:n, note), updated_by=:by WHERE id=:id AND plan_id=:p`, {
          h: o.headcount,
          st: o.start,
          en: o.end,
          n: o.note,
          by: access.username,
          id: o.lineId,
          p: planId,
        });
        await c.q(`INSERT INTO joya_staffing_edits (plan_id, line_id, action, before_json, after_json, note, via, username) VALUES (:p, :l, 'SET', :b, :a, :n, :via, :u)`, {
          p: planId,
          l: o.lineId,
          b: JSON.stringify(o.before),
          a: JSON.stringify({ headcount: o.headcount, start: o.start, end: o.end }),
          n: o.note,
          via,
          u: access.username,
        });
      }
    }
  });
  return getPlan(access, planId);
}

export async function approve(access, planId, { note } = {}) {
  const { plan, lines, violations: v } = await getPlan(access, planId);
  if (plan.status !== 'DRAFT') throw err('CONFLICT', `the plan is ${plan.status}`);
  if (v.length) throw Object.assign(err('MANDATORY_MIN', 'the plan is under a mandatory minimum'), { details: { violations: v } });
  const final = lines.map((l) => ({ lineId: l.id, date: l.date, shiftCode: l.shiftCode, roleCode: l.roleCode, headcount: l.headcount, start: l.start, end: l.end, isPeakExtra: l.isPeakExtra, origin: l.origin, proposedHeadcount: l.proposed?.headcount ?? null }));
  await q(`UPDATE joya_staffing_plans SET status='APPROVED', final_json=:f, approved_by=:u, approved_at=NOW(), note=COALESCE(:n, note) WHERE id=:id AND status='DRAFT'`, { f: JSON.stringify(final), u: access.username, n: note || null, id: planId });
  await q(`INSERT INTO joya_staffing_edits (plan_id, action, note, username) VALUES (:p, 'APPROVE', :n, :u)`, { p: planId, n: note || null, u: access.username });
  await audit(access.username, 'STAFFING_APPROVED', 'staffing_plan', planId, plan.locationId, { lines: final.length });
  return getPlan(access, planId);
}

export async function reject(access, planId, { note } = {}) {
  const { plan } = await getPlan(access, planId);
  if (plan.status !== 'DRAFT') throw err('CONFLICT', `the plan is ${plan.status}`);
  await q(`UPDATE joya_staffing_plans SET status='REJECTED', rejected_by=:u, rejected_at=NOW(), note=COALESCE(:n, note) WHERE id=:id`, { u: access.username, n: note || null, id: planId });
  await q(`INSERT INTO joya_staffing_edits (plan_id, action, note, username) VALUES (:p, 'REJECT', :n, :u)`, { p: planId, n: note || null, u: access.username });
  await audit(access.username, 'STAFFING_REJECTED', 'staffing_plan', planId, plan.locationId, { note });
  return getPlan(access, planId);
}

export async function reopen(access, planId) {
  const { plan } = await getPlan(access, planId);
  if (plan.status !== 'APPROVED') throw err('CONFLICT', 'only an approved plan can be reopened');
  await q(`UPDATE joya_staffing_plans SET status='DRAFT', final_json=NULL, approved_by=NULL, approved_at=NULL WHERE id=:id`, { id: planId });
  await q(`INSERT INTO joya_staffing_edits (plan_id, action, before_json, username) VALUES (:p, 'REOPEN', :b, :u)`, { p: planId, b: JSON.stringify(plan.final), u: access.username });
  await audit(access.username, 'STAFFING_REOPENED', 'staffing_plan', planId, plan.locationId, {});
  return getPlan(access, planId);
}

/** What-if: recompute the week with extra/changed rules, without saving. Returns the diff to the plan. */
export async function whatIf(access, planId, extraRules) {
  const { plan, lines } = await getPlan(access, planId);
  for (const r of extraRules) {
    const bad = validateRule({ ...r, params: r.params_json || r.params });
    if (bad) throw err('BAD_REQUEST', bad);
  }
  const p = await computeProposal(plan.locationId, plan.weekStart, { extraRules: extraRules.map((r) => ({ ...r, params_json: r.params_json || r.params })) });
  const key = (l) => `${l.date}|${l.shiftCode}|${l.roleCode}|${l.isPeakExtra ? 1 : 0}`;
  const cur = new Map();
  for (const l of lines) cur.set(key(l), l);
  const changes = [];
  for (const n of p.lines) {
    const c = cur.get(key(n));
    if (!c) changes.push({ op: 'add', date: n.date, shiftCode: n.shiftCode, roleCode: n.roleCode, headcount: n.headcount, start: n.start, end: n.end, explain: n.explain });
    else if (c.headcount !== n.headcount || c.start !== n.start || c.end !== n.end) changes.push({ op: 'set', lineId: c.id, date: n.date, shiftCode: n.shiftCode, roleCode: n.roleCode, before: c.headcount, headcount: n.headcount, start: n.start, end: n.end, explain: n.explain });
    cur.delete(key(n));
  }
  for (const c of cur.values()) if (c.isPeakExtra) changes.push({ op: 'remove', lineId: c.id, date: c.date, shiftCode: c.shiftCode, roleCode: c.roleCode, before: c.headcount });
  return { changes, warnings: p.warnings, note: 'what-if only — the stored rules were not changed' };
}

/** CSV for typing into Tabit SHIFT ORGANIZER by hand (no automatic sync exists). */
export async function exportCsv(access, planId, lang = 'he') {
  const { plan, lines } = await getPlan(access, planId);
  const roles = await listRoles();
  const shifts = await listShifts([plan.locationId]);
  const roleName = (c) => (roles.find((r) => r.code === c)?.[lang === 'he' ? 'nameHe' : 'nameEn'] ?? c);
  const shiftName = (c) => shifts.find((s) => s.code === c)?.name ?? c;
  const daysHe = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const daysEn = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const headers = lang === 'he' ? ['תאריך', 'יום', 'משמרת', 'תפקיד', 'מספר עובדים', 'שעת התחלה', 'שעת סיום', 'תוספת שיא', 'סטטוס'] : ['Date', 'Day', 'Shift', 'Role', 'Headcount', 'Start', 'End', 'Peak extra', 'Status'];
  const rows = lines.map((l) => [l.date, (lang === 'he' ? daysHe : daysEn)[l.weekday], shiftName(l.shiftCode), roleName(l.roleCode), l.headcount, l.start.slice(0, 5), l.end.slice(0, 5), l.isPeakExtra ? '1' : '', plan.status]);
  return { fileName: `joya-staffing-${plan.locationId}-${plan.weekStart}-${plan.status.toLowerCase()}.csv`, csv: toCsv(headers, rows) };
}

/** Planned vs actual: demand (POS) and worked hours by role (attendance), for dates that passed. */
export async function compareActual(access, planId) {
  const { plan, lines } = await getPlan(access, planId);
  const today = todayLocal();
  const to = addDays(plan.weekStart, 6) < today ? addDays(plan.weekStart, 6) : addDays(today, -1);
  if (to < plan.weekStart) return { available: false, reason: 'WEEK_NOT_STARTED' };
  const actual = await actualDemand(plan.locationId, plan.weekStart, to);
  const forecast = plan.forecast?.slots || [];
  const att = (await effectiveAttendance([plan.locationId], plan.weekStart, to)).filter((a) => !a.excluded);
  const slots = actual.map((a) => {
    const f = forecast.find((x) => x.date === a.date && x.shiftCode === a.shiftCode);
    const planned = lines.filter((l) => l.date === a.date && l.shiftCode === a.shiftCode);
    return {
      date: a.date,
      shiftCode: a.shiftCode,
      hasData: a.hasData,
      actual: a.demand?.values ?? null,
      forecast: f ? Object.fromEntries(Object.entries(f.demand).map(([u, v]) => [u, v.value])) : null,
      plannedPeople: planned.reduce((s, l) => s + l.headcount, 0),
      plannedHours: Math.round(planned.reduce((s, l) => s + l.headcount * l.hours, 0) * 100) / 100,
    };
  });
  const byRole = {};
  for (const l of lines.filter((x) => x.date <= to)) {
    byRole[l.roleCode] ||= { plannedHours: 0, actualHours: 0, actualRows: 0, missingHoursRows: 0 };
    byRole[l.roleCode].plannedHours += l.headcount * l.hours;
  }
  for (const a of att) {
    const k = a.roleCode || '_unknown';
    byRole[k] ||= { plannedHours: 0, actualHours: 0, actualRows: 0, missingHoursRows: 0 };
    byRole[k].actualRows++;
    if (a.hours == null) byRole[k].missingHoursRows++;
    else byRole[k].actualHours += a.hours;
  }
  for (const v of Object.values(byRole)) {
    v.plannedHours = Math.round(v.plannedHours * 100) / 100;
    v.actualHours = Math.round(v.actualHours * 100) / 100;
  }
  return { available: true, from: plan.weekStart, to, slots, byRole, attendanceRows: att.length, sources: { demand: 'Beecomm via Allegro (/beecomm/orders/stored)', hours: 'Tabit clock rows via Allegro (/shifts/raw) + corrections' } };
}
