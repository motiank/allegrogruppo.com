// Weekly staffing proposal → manager edits → approved plan → compared with actual activity.
// The arithmetic is in ../lib/staffingRules.js (pure, tested); this file loads the rules,
// the forecast and past plans, and stores the results.
//
// Kept apart, all on the joya_staffing_plans row: proposal_json (the system's proposal, never changed),
// lines_json (what the manager edits), edits_json (every change), final_json (frozen at approval).
// The rules are the staffingRules config document; shifts and baseline are in the location's document.
import { q, one, tx, err, audit, parseJson, ymd, inList, getSettings, todayLocal, getConfig, updateConfig, lockRow, nextId } from '../db.js';
import { assertLocation } from '../access.js';
import { computeSlot, normalizeRule, validateRule, learnedAdjustments, normTime } from '../lib/staffingRules.js';
import { addDays } from '../lib/recommend.js';
import { forecastWeek, actualDemand } from './demand.js';
import * as source from './source.js';
import { listRoles, listShifts, locationConfig, updateLocationConfig } from './master.js';
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

const allRules = async () => getConfig('staffingRules', []);

export async function listRules(access, locationId = null) {
  return (await allRules())
    .filter((r) => r.locationId == null || access.isAdmin || access.locationIds.includes(r.locationId))
    .filter((r) => locationId == null || r.locationId == null || r.locationId === String(locationId))
    .sort((a, b) => a.roleCode.localeCompare(b.roleCode) || Number(a.locationId != null) - Number(b.locationId != null) || String(a.locationId).localeCompare(String(b.locationId)) || String(a.shiftCode).localeCompare(String(b.shiftCode)) || a.id - b.id);
}

/** Chain-wide and mandatory rules: chain admin only. A location manager may edit their location's other rules. */
function canEditRule(access, rule) {
  if (access.isAdmin) return true;
  return rule.locationId != null && access.locationIds.includes(String(rule.locationId)) && !rule.mandatory;
}

export async function saveRule(access, input) {
  const r = {
    id: input.id ? Number(input.id) : null,
    location_id: input.locationId == null ? null : String(input.locationId),
    shift_code: input.shiftCode || null,
    days_json: Array.isArray(input.days) && input.days.length ? input.days.map(Number) : null,
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
  if (!(await listRoles()).some((x) => x.code === r.role_code)) throw err('BAD_REQUEST', `unknown role ${r.role_code}`);
  const rule = { ...normalizeRule({ ...r, params_json: r.params }), updatedBy: access.username, updatedAt: new Date().toISOString() };
  if (!canEditRule(access, rule)) throw err('FORBIDDEN', 'only the chain admin can create chain-wide or mandatory rules');
  await updateConfig('staffingRules', [], access.username, (rules) => {
    if (rule.id) {
      const prev = rules.find((x) => x.id === rule.id);
      if (!prev) throw err('NOT_FOUND', 'rule not found');
      if (!canEditRule(access, prev)) throw err('FORBIDDEN', 'only the chain admin can change this rule');
    } else rule.id = nextId(rules);
    return [...rules.filter((x) => x.id !== rule.id), rule];
  });
  await audit(access.username, 'STAFFING_RULE_SAVED', 'staffing_rule', rule.id, rule.locationId, rule);
  return rule.id;
}

export async function deleteRule(access, id) {
  let prev = null;
  await updateConfig('staffingRules', [], access.username, (rules) => {
    prev = rules.find((x) => x.id === Number(id));
    if (!prev) throw err('NOT_FOUND', 'rule not found');
    if (!canEditRule(access, prev)) throw err('FORBIDDEN', 'only the chain admin can delete this rule');
    return rules.filter((x) => x.id !== prev.id);
  });
  await audit(access.username, 'STAFFING_RULE_DELETED', 'staffing_rule', prev.id, prev.locationId, prev);
}

export async function listBaseline(access, locationId) {
  assertLocation(access, locationId);
  return (await locationConfig(locationId)).baseline
    .map((b) => ({ locationId: String(locationId), ...b }))
    .sort((a, b) => a.shiftCode.localeCompare(b.shiftCode) || a.weekday - b.weekday || a.roleCode.localeCompare(b.roleCode));
}

export async function saveBaseline(access, { locationId, shiftCode, weekday, roleCode, headcount, note = null }) {
  assertLocation(access, locationId);
  if (!(Number.isInteger(Number(headcount)) && Number(headcount) >= 0)) throw err('BAD_REQUEST', 'headcount must be a whole number ≥ 0');
  if (!(weekday >= 0 && weekday <= 6)) throw err('BAD_REQUEST', 'weekday 0..6');
  const entry = { shiftCode, weekday: Number(weekday), roleCode, headcount: Number(headcount), note };
  const same = (b) => b.shiftCode === entry.shiftCode && b.weekday === entry.weekday && b.roleCode === entry.roleCode;
  await updateLocationConfig(access, locationId, (cfg) => ({ ...cfg, baseline: [...cfg.baseline.filter((b) => !same(b)), entry] }));
  await audit(access.username, 'STAFFING_BASELINE_SAVED', 'staffing_baseline', null, locationId, entry);
}

// ---------------------------------------------------------------- the proposal

async function pastPlanDiffs(locationId, beforeWeek, limit) {
  const plans = await q(
    `SELECT id, week_start, proposal_json, final_json FROM joya_staffing_plans WHERE location_id=:l AND status='APPROVED' AND week_start < :w ORDER BY week_start DESC LIMIT ${Number(limit) || 4}`,
    { l: locationId, w: beforeWeek },
  );
  const out = [];
  for (const p of plans) {
    const sum = (lines) => {
      const m = new Map();
      for (const l of lines || []) {
        if (l.isPeakExtra) continue;
        const k = `${l.date}|${l.shiftCode}|${l.roleCode}`;
        m.set(k, (m.get(k) || 0) + l.headcount);
      }
      return m;
    };
    const propMap = sum(parseJson(p.proposal_json));
    const fin = sum(parseJson(p.final_json));
    const keys = new Set([...propMap.keys(), ...fin.keys()]);
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
  let rules = (await allRules()).filter((r) => r.active && (r.locationId == null || r.locationId === String(locationId)));
  if (extraRules.length) {
    const extra = extraRules.map((r, i) => ({ ...normalizeRule({ ...r, id: 1e9 + i, active: 1, location_id: locationId }), whatIf: true }));
    // a what-if rule replaces stored rules of the same role and type for its scope
    rules = rules.filter((r) => !extra.some((x) => x.roleCode === r.roleCode && x.type === r.type)).concat(extra);
  }
  const roles = await listRoles();
  const roleOrder = roles.map((r) => r.code);
  const baselineRows = (await locationConfig(locationId)).baseline;
  const learned = learnedAdjustments(await pastPlanDiffs(locationId, weekStart, st.learnedAdjustWindow || 4), { minPlans: st.learnedAdjustMinPlans || 3, window: st.learnedAdjustWindow || 4 });

  const lines = [];
  const warnings = [];
  for (const slot of forecast.slots) {
    const demand = Object.fromEntries(Object.entries(slot.demand).map(([u, f]) => [u, { value: f.value, n: f.n, confidence: f.confidence }]));
    const res = computeSlot(rules, { locationId, shiftCode: slot.shiftCode, weekday: slot.weekday, start: slot.start, end: slot.end }, demand, roleOrder);
    const ruled = new Set(rules.filter((r) => r.active).map((r) => r.roleCode));
    // baseline: roles that no rule covers keep the staffing example as the proposal
    for (const b of baselineRows.filter((b) => b.shiftCode === slot.shiftCode && b.weekday === slot.weekday)) {
      const line = res.lines.find((l) => l.roleCode === b.roleCode && !l.isPeakExtra);
      if (line) line.explain.baseline = b.headcount;
      else if (!ruled.has(b.roleCode) && b.headcount > 0) {
        res.lines.push({ roleCode: b.roleCode, headcount: b.headcount, start: slot.start, end: slot.end, isPeakExtra: false, minRequired: 0, explain: { rules: [], demand: null, calc: [`BASELINE = ${b.headcount}`], notes: [{ code: 'FROM_BASELINE' }], baseline: b.headcount } });
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
  const demo = await source.isDemoLocation(locationId);
  const proposal = p.lines.map((l, i) => ({ id: i + 1, date: l.date, shiftCode: l.shiftCode, roleCode: l.roleCode, headcount: l.headcount, start: l.start, end: l.end, isPeakExtra: !!l.isPeakExtra, minRequired: l.minRequired, explain: l.explain }));
  const lines = proposal.map(({ explain, ...l }) => ({ ...l, origin: 'PROPOSED', proposalLineId: l.id, note: null, updatedBy: access.username }));
  const planId = (
    await q(
      `INSERT INTO joya_staffing_plans (location_id, week_start, status, forecast_json, rules_json, proposal_json, lines_json, edits_json, is_demo, created_by)
       VALUES (:l, :w, 'DRAFT', :f, :r, :p, :x, '[]', :d, :by)`,
      {
        l: locationId,
        w: ws,
        f: JSON.stringify({ ...p.forecast, warnings: p.warnings }),
        r: JSON.stringify(p.rules),
        p: JSON.stringify(proposal),
        x: JSON.stringify(lines),
        d: demo ? 1 : 0,
        by: access.username,
      },
    )
  ).insertId;
  await audit(access.username, 'STAFFING_PROPOSED', 'staffing_plan', planId, locationId, { weekStart: ws, lines: p.lines.length, warnings: p.warnings.length });
  return { planId, existing: false };
}

const shapeLine = (l) => ({
  id: l.id,
  date: l.date,
  weekday: weekdayOf(l.date),
  shiftCode: l.shiftCode,
  roleCode: l.roleCode,
  headcount: l.headcount,
  start: l.start,
  end: l.end,
  hours: Math.round(durH(l.start, l.end) * 100) / 100,
  isPeakExtra: !!l.isPeakExtra,
  minRequired: l.minRequired || 0,
});
const lineOrder = (a, b) => a.date.localeCompare(b.date) || a.shiftCode.localeCompare(b.shiftCode) || Number(a.isPeakExtra) - Number(b.isPeakExtra) || a.roleCode.localeCompare(b.roleCode) || a.id - b.id;

export async function getPlan(access, planId) {
  const p = await one(`SELECT * FROM joya_staffing_plans WHERE id=:id`, { id: planId });
  if (!p) throw err('NOT_FOUND', 'plan not found');
  assertLocation(access, p.location_id);
  const lines = [...(parseJson(p.lines_json) || [])].sort(lineOrder);
  const props = [...(parseJson(p.proposal_json) || [])].sort(lineOrder);
  const propById = new Map(props.map((x) => [x.id, x]));
  return {
    plan: {
      id: p.id,
      locationId: p.location_id,
      locationName: (await source.locationNames()).get(p.location_id) ?? null,
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
      const prop = r.proposalLineId ? propById.get(r.proposalLineId) : null;
      return { ...shapeLine(r), origin: r.origin, note: r.note, updatedBy: r.updatedBy, proposed: prop ? { headcount: prop.headcount, start: prop.start, end: prop.end } : null, explain: prop ? prop.explain : null };
    }),
    proposal: props.map((r) => ({ ...shapeLine(r), explain: r.explain })),
    edits: parseJson(p.edits_json) || [],
    violations: violations(lines.map(shapeLine)),
  };
}

/**
 * Change one plan row inside a transaction under a row lock: fn(row, { lines, edits, addEdit }) may change
 * `lines` and call addEdit({ lineId?, action, before?, after?, note? }); returns the extra columns to set.
 */
async function updatePlan(access, planId, { via = 'UI' } = {}, fn) {
  await tx(async (c) => {
    const row = await lockRow(c, 'joya_staffing_plans', planId);
    if (!row) throw err('NOT_FOUND', 'plan not found');
    const lines = parseJson(row.lines_json) || [];
    const edits = parseJson(row.edits_json) || [];
    const addEdit = (e) => edits.push({ id: nextId(edits), lineId: null, before: null, after: null, note: null, ...e, via, by: access.username, at: new Date().toISOString() });
    const set = (await fn(row, { lines, edits, addEdit })) || {};
    const cols = { ...set, lines_json: JSON.stringify(lines), edits_json: JSON.stringify(edits) };
    await c.q(`UPDATE joya_staffing_plans SET ${Object.keys(cols).map((k) => `${k}=:${k}`).join(', ')} WHERE id=:id`, { ...cols, id: planId });
  });
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
  const locs = inList('loc', locationIds);
  const names = await source.locationNames();
  const rows = await q(
    `SELECT p.id, p.location_id, p.week_start, p.status, p.is_demo, p.created_by, p.approved_by, p.approved_at, p.lines_json
       FROM joya_staffing_plans p
      WHERE p.location_id IN (${locs.sql}) ORDER BY p.week_start DESC, p.id DESC LIMIT ${Math.min(Math.max(parseInt(limit, 10) || 30, 1), 200)}`,
    locs.params,
  );
  return rows.map((r) => ({ id: r.id, locationId: r.location_id, locationName: names.get(r.location_id) ?? null, weekStart: ymd(r.week_start), status: r.status, isDemo: !!r.is_demo, people: (parseJson(r.lines_json) || []).reduce((s, l) => s + (Number(l.headcount) || 0), 0), createdBy: r.created_by, approvedBy: r.approved_by, approvedAt: r.approved_at }));
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
  await updatePlan(access, planId, { via }, (row, { lines, addEdit }) => {
    if (row.status !== 'DRAFT') throw err('CONFLICT', `the plan is ${row.status}; reopen it to edit`);
    for (const o of checked) {
      if (o.op === 'add') {
        const id = nextId(lines);
        lines.push({ id, date: o.date, shiftCode: o.shiftCode, roleCode: o.roleCode, headcount: o.headcount, start: o.start, end: o.end, isPeakExtra: false, minRequired: 0, origin: 'ADDED', proposalLineId: null, note: o.note, updatedBy: access.username });
        addEdit({ lineId: id, action: 'ADD', after: o, note: o.note });
        continue;
      }
      const i = lines.findIndex((l) => l.id === o.lineId);
      if (i < 0) throw err('BAD_REQUEST', `line ${o.lineId} is not on this plan`);
      if (o.op === 'remove' || (o.op === 'set' && o.headcount === 0)) {
        lines.splice(i, 1);
        addEdit({ lineId: o.lineId, action: 'REMOVE', before: o.before, note: o.note });
      } else {
        Object.assign(lines[i], { headcount: o.headcount, start: o.start, end: o.end, note: o.note ?? lines[i].note, updatedBy: access.username });
        addEdit({ lineId: o.lineId, action: 'SET', before: o.before, after: { headcount: o.headcount, start: o.start, end: o.end }, note: o.note });
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
  await updatePlan(access, planId, {}, (row, { addEdit }) => {
    if (row.status !== 'DRAFT') throw err('CONFLICT', `the plan is ${row.status}`);
    addEdit({ action: 'APPROVE', note: note || null });
    return { status: 'APPROVED', final_json: JSON.stringify(final), approved_by: access.username, approved_at: new Date(), note: note || row.note };
  });
  await audit(access.username, 'STAFFING_APPROVED', 'staffing_plan', planId, plan.locationId, { lines: final.length });
  return getPlan(access, planId);
}

export async function reject(access, planId, { note } = {}) {
  const { plan } = await getPlan(access, planId);
  if (plan.status !== 'DRAFT') throw err('CONFLICT', `the plan is ${plan.status}`);
  await updatePlan(access, planId, {}, (row, { addEdit }) => {
    addEdit({ action: 'REJECT', note: note || null });
    return { status: 'REJECTED', rejected_by: access.username, rejected_at: new Date(), note: note || row.note };
  });
  await audit(access.username, 'STAFFING_REJECTED', 'staffing_plan', planId, plan.locationId, { note });
  return getPlan(access, planId);
}

export async function reopen(access, planId) {
  const { plan } = await getPlan(access, planId);
  if (plan.status !== 'APPROVED') throw err('CONFLICT', 'only an approved plan can be reopened');
  await updatePlan(access, planId, {}, (row, { addEdit }) => {
    addEdit({ action: 'REOPEN', before: plan.final });
    return { status: 'DRAFT', final_json: null, approved_by: null, approved_at: null };
  });
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
