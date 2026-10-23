// Staffing rules → headcount per role for one shift slot. Pure and deterministic:
// the same rules and the same demand always give the same answer, and every
// number carries the rule and the calculation that produced it.
//
// Rule types (joya_staffing_rules.rule_type):
//   FIXED      exactly params.count                      demand is not used
//   MIN        never fewer than params.count             with `mandatory` = a floor managers cannot go under
//   MAX        never more than params.count
//   RATIO      ceil(demand / params.per)                 e.g. 1 waiter per 25 diners per shift
//   STEPS      params.steps = [{ above, count }]: the count of the highest step whose
//              `above` is below the demand (strictly greater: demand 60 with above 60 is not over it)
//   PEAK_EXTRA params.count more people from params.start to params.end when the
//              demand (usually a peak-hour unit) is above params.above
//
// Choosing rules: for each role and rule type only the MOST SPECIFIC matching rule is
// used — location (4) + shift (2) + days (1) points; a tie goes to the newer rule (higher id).
// RATIO and STEPS both present → the larger result. MIN wins over MAX when they disagree
// (with a warning). Demand unknown → RATIO/STEPS are not computed (never "0 staff"): the
// headcount is the minimum when there is one, else the role is reported as "cannot compute".

export const RULE_TYPES = ['FIXED', 'MIN', 'MAX', 'RATIO', 'STEPS', 'PEAK_EXTRA'];

export function ruleMatches(rule, slot) {
  if (!rule.active) return false;
  if (rule.locationId != null && rule.locationId !== slot.locationId) return false;
  if (rule.shiftCode && rule.shiftCode !== slot.shiftCode) return false;
  if (Array.isArray(rule.days) && rule.days.length && !rule.days.includes(slot.weekday)) return false;
  return true;
}

export const specificity = (r) => (r.locationId != null ? 4 : 0) + (r.shiftCode ? 2 : 0) + (Array.isArray(r.days) && r.days.length ? 1 : 0);

function pick(rules) {
  return [...rules].sort((a, b) => specificity(b) - specificity(a) || b.id - a.id)[0] || null;
}

const scopeOf = (r) => ({ location: r.locationId != null, shift: !!r.shiftCode, days: Array.isArray(r.days) && r.days.length ? r.days : null });
const ruleRef = (r) => ({ id: r.id, type: r.type, unit: r.unit || null, params: r.params, mandatory: !!r.mandatory, scope: scopeOf(r), note: r.note || null });

/**
 * @param {Array} rules   normalized rules (see normalizeRule)
 * @param {{locationId, shiftCode, weekday, start, end}} slot   start/end 'HH:MM:SS'
 * @param {Object<string, {value:number|null, n?:number, confidence?:string}>} demand  by unit
 * @param {string[]} roleOrder  role codes in display order
 * @returns {{ lines: Array, warnings: Array }}
 */
export function computeSlot(rules, slot, demand, roleOrder = []) {
  const matching = rules.filter((r) => ruleMatches(r, slot));
  const roles = [...new Set(matching.map((r) => r.roleCode))].sort((a, b) => {
    const ia = roleOrder.indexOf(a);
    const ib = roleOrder.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b);
  });
  const lines = [];
  const warnings = [];

  for (const role of roles) {
    const of = (type) => pick(matching.filter((r) => r.roleCode === role && r.type === type));
    const fixed = of('FIXED');
    const min = of('MIN');
    const max = of('MAX');
    const ratio = of('RATIO');
    const steps = of('STEPS');
    const peak = of('PEAK_EXTRA');
    const used = [];
    const calc = [];
    const notes = [];
    let base = null;
    let decider = null;
    let demandUsed = null;

    if (fixed) {
      base = Number(fixed.params.count);
      decider = fixed;
      used.push(ruleRef(fixed));
      calc.push(`FIXED = ${base}`);
    } else {
      const results = [];
      for (const r of [ratio, steps].filter(Boolean)) {
        used.push(ruleRef(r));
        const d = demand?.[r.unit];
        if (!d || d.value == null) {
          notes.push({ code: 'DEMAND_UNKNOWN', unit: r.unit, ruleId: r.id });
          continue;
        }
        demandUsed = demandUsed || { unit: r.unit, value: d.value, n: d.n ?? null, confidence: d.confidence ?? null };
        if (r.type === 'RATIO') {
          const per = Number(r.params.per);
          const v = per > 0 ? Math.ceil(d.value / per) : 0;
          results.push({ v, r });
          calc.push(`ceil(${d.value} / ${per}) = ${v}`);
        } else {
          const st = [...(r.params.steps || [])].sort((a, b) => a.above - b.above);
          let v = 0;
          let hit = null;
          for (const s of st) if (d.value > s.above) {
            v = Number(s.count);
            hit = s;
          }
          results.push({ v, r });
          calc.push(hit ? `${d.value} > ${hit.above} → ${v}` : `${d.value} ≤ ${st[0]?.above ?? 0} → 0`);
        }
      }
      if (results.length) {
        const best = results.sort((a, b) => b.v - a.v)[0];
        base = best.v;
        decider = best.r;
        if (results.length > 1) calc.push(`max → ${base}`);
      }
    }

    let headcount = base;
    if (min) {
      used.push(ruleRef(min));
      const m = Number(min.params.count);
      if (headcount == null) {
        headcount = m;
        decider = decider || min;
        calc.push(`MIN = ${m}`);
        if (ratio || steps) notes.push({ code: 'MIN_ONLY_DEMAND_UNKNOWN' });
      } else if (headcount < m) {
        calc.push(`max(${headcount}, MIN ${m}) = ${m}`);
        headcount = m;
      }
    }
    if (max && headcount != null) {
      used.push(ruleRef(max));
      const m = Number(max.params.count);
      if (headcount > m) {
        const floor = min ? Number(min.params.count) : 0;
        if (floor > m) warnings.push({ code: 'MIN_ABOVE_MAX', role, min: floor, max: m });
        const capped = Math.max(m, floor);
        calc.push(`min(${headcount}, MAX ${m}) = ${capped}`);
        headcount = capped;
      }
    }

    const minRequired = Math.max(fixed?.mandatory ? Number(fixed.params.count) : 0, min?.mandatory ? Number(min.params.count) : 0);

    if (headcount == null) {
      warnings.push({ code: 'CANNOT_COMPUTE', role, reason: 'DEMAND_UNKNOWN', units: [ratio?.unit, steps?.unit].filter(Boolean) });
    } else if (headcount > 0) {
      lines.push({
        roleCode: role,
        headcount,
        start: (decider || fixed || min)?.roleStart || slot.start,
        end: (decider || fixed || min)?.roleEnd || slot.end,
        isPeakExtra: false,
        minRequired,
        explain: { rules: used, demand: demandUsed, calc, notes },
      });
    } else if (minRequired > 0) {
      warnings.push({ code: 'ZERO_BELOW_MANDATORY', role, minRequired });
    }

    if (peak) {
      const d = demand?.[peak.unit];
      if (!d || d.value == null) {
        warnings.push({ code: 'PEAK_DEMAND_UNKNOWN', role, unit: peak.unit, ruleId: peak.id });
      } else if (d.value > Number(peak.params.above)) {
        lines.push({
          roleCode: role,
          headcount: Number(peak.params.count),
          start: peak.params.start ? normTime(peak.params.start) : slot.start,
          end: peak.params.end ? normTime(peak.params.end) : slot.end,
          isPeakExtra: true,
          minRequired: 0,
          explain: {
            rules: [ruleRef(peak)],
            demand: { unit: peak.unit, value: d.value, n: d.n ?? null, confidence: d.confidence ?? null },
            calc: [`${d.value} > ${peak.params.above} → +${peak.params.count}`],
            notes: [],
          },
        });
      }
    }
  }
  return { lines, warnings };
}

export function normTime(t) {
  if (t == null || t === '') return null;
  const m = String(t).match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}:${m[3] ?? '00'}`;
}

/** DB row → the shape computeSlot reads. */
export function normalizeRule(row) {
  const params = typeof row.params_json === 'string' ? JSON.parse(row.params_json) : row.params_json || {};
  const days = typeof row.days_json === 'string' ? JSON.parse(row.days_json) : row.days_json;
  return {
    id: row.id,
    locationId: row.location_id ?? null,
    shiftCode: row.shift_code || null,
    days: Array.isArray(days) ? days.map(Number) : null,
    roleCode: row.role_code,
    type: row.rule_type,
    unit: row.demand_unit || null,
    params,
    roleStart: row.role_start ? normTime(String(row.role_start)) : null,
    roleEnd: row.role_end ? normTime(String(row.role_end)) : null,
    mandatory: !!row.mandatory,
    active: row.active == null ? true : !!row.active,
    note: row.note || null,
  };
}

/** Validate a rule from the UI. Returns an error message or null. */
export function validateRule(r) {
  if (!r.role_code) return 'role_code is required';
  if (!RULE_TYPES.includes(r.rule_type)) return `rule_type must be one of ${RULE_TYPES.join(', ')}`;
  const p = r.params || {};
  const needsUnit = ['RATIO', 'STEPS', 'PEAK_EXTRA'].includes(r.rule_type);
  if (needsUnit && !r.demand_unit) return 'this rule type needs a demand unit';
  const nonNegInt = (v) => Number.isInteger(Number(v)) && Number(v) >= 0;
  if (['FIXED', 'MIN', 'MAX', 'PEAK_EXTRA'].includes(r.rule_type) && !nonNegInt(p.count)) return 'params.count must be a whole number ≥ 0';
  if (r.rule_type === 'RATIO' && !(Number(p.per) > 0)) return 'params.per must be > 0';
  if (r.rule_type === 'STEPS') {
    if (!Array.isArray(p.steps) || !p.steps.length) return 'params.steps must be a list';
    if (p.steps.some((s) => !(Number(s.above) >= 0) || !nonNegInt(s.count))) return 'every step needs above ≥ 0 and a whole count';
  }
  if (r.rule_type === 'PEAK_EXTRA') {
    if (!(Number(p.above) >= 0)) return 'params.above must be ≥ 0';
    if ((p.start && !normTime(p.start)) || (p.end && !normTime(p.end))) return 'params.start / params.end must be HH:MM';
  }
  return null;
}

/**
 * What managers keep changing. From approved plans (newest first), for each
 * (weekday, shift, role): how the approved headcount differed from the proposal.
 * A change seen in at least `minPlans` of the last `window` plans, always in the same
 * direction, becomes a suggested adjustment (the median change). It is shown on the
 * proposal with its reason; it never changes a rule, and never goes under the floor.
 */
export function learnedAdjustments(plans, { minPlans = 3, window = 4 } = {}) {
  const recent = plans.slice(0, window);
  const deltas = new Map();
  for (const p of recent) {
    for (const d of p.diffs) {
      const k = `${d.weekday}|${d.shiftCode}|${d.roleCode}`;
      if (!deltas.has(k)) deltas.set(k, []);
      deltas.get(k).push({ planId: p.planId, weekStart: p.weekStart, delta: d.delta });
    }
  }
  const out = {};
  for (const [k, list] of deltas) {
    const nonZero = list.filter((x) => x.delta !== 0);
    if (nonZero.length < minPlans) continue;
    const allUp = nonZero.every((x) => x.delta > 0);
    const allDown = nonZero.every((x) => x.delta < 0);
    if (!allUp && !allDown) continue;
    const sorted = nonZero.map((x) => x.delta).sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    out[k] = { delta: med, seen: nonZero.length, window: recent.length, plans: nonZero };
  }
  return out;
}
