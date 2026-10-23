// Sales and labor numbers. Every function returns its period, its source and what is
// missing, so a page (or the AI answer) can say where a number came from. The data comes
// from the Allegro API (./source.js); nothing here is stored.
// A day with no POS rows is MISSING, never a day with zero sales.
import { q, ymd, inList, getSettings } from '../db.js';
import { addDays, daysBetween } from '../lib/recommend.js';
import { median } from '../lib/demand.js';
import { effectiveAttendance } from './attendance.js';
import { listShifts } from './master.js';
import { shiftWindow } from '../lib/demand.js';
import { checks as sourceChecks, dishSales, laborDaily, employees, monthsBetween } from './source.js';

const SALES_SOURCE = 'Beecomm via Allegro (/beecomm/orders/stored)';

const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const div = (a, b) => (a == null || b == null || b === 0 ? null : a / b);
const weekdayOf = (d) => new Date(d + 'T00:00:00Z').getUTCDay();

/** Daily totals per location from checks (revenue, checks, diners) — the base of most numbers. */
export async function dailyTotals(locationIds, from, to) {
  const out = [];
  for (const loc of locationIds) {
    const byDate = new Map();
    for (const c of await sourceChecks(loc, from, to)) {
      let d = byDate.get(c.business_date);
      if (!d) byDate.set(c.business_date, (d = { locationId: loc, date: c.business_date, checks: 0, revenue: null, noAmount: 0, diners: null, noDiners: 0 }));
      d.checks++;
      if (c.net_amount == null) d.noAmount++;
      else d.revenue = (d.revenue ?? 0) + c.net_amount;
      if (c.diners == null) d.noDiners++;
      else d.diners = (d.diners ?? 0) + c.diners;
    }
    for (const d of byDate.values()) out.push({ ...d, revenue: r2(d.revenue) });
  }
  return out;
}

function totals(days) {
  const t = { days: days.length, checks: 0, revenue: 0, diners: 0, noAmount: 0, noDiners: 0 };
  for (const d of days) {
    t.checks += d.checks;
    t.revenue += d.revenue ?? 0;
    t.diners += d.diners ?? 0;
    t.noAmount += d.noAmount;
    t.noDiners += d.noDiners;
  }
  t.revenue = r2(t.revenue);
  t.avgCheck = r2(div(t.revenue, t.checks - t.noAmount));
  // unrounded, for the exact volume / spend split (not sent to the client)
  Object.defineProperty(t, '_raw', { value: { c: t.checks - t.noAmount, a: div(t.revenue, t.checks - t.noAmount), r: t.revenue }, enumerable: false });
  // average per diner only when diner counts are (almost) complete
  t.dinersKnown = t.checks > 0 && t.noDiners / t.checks <= 0.2;
  t.avgPerDiner = t.dinersKnown ? r2(div(t.revenue, t.diners)) : null;
  if (!t.dinersKnown) t.diners = null;
  return t;
}

/**
 * Revenue change split into volume and average spend: ΔR = (C₂ − C₁)·A₁ + (A₂ − A₁)·C₂,
 * C = checks, A = average per check. The two parts add up to the change exactly.
 */
export function decompose(a, b) {
  if (!a || !b || a.avgCheck == null || b.avgCheck == null) return null;
  // checks with an amount only, unrounded averages: the two parts add up to the change exactly
  const A = a._raw ?? { c: a.checks, a: a.avgCheck };
  const B = b._raw ?? { c: b.checks, a: b.avgCheck };
  const volume = (B.c - A.c) * A.a;
  const spend = (B.a - A.a) * B.c;
  return {
    revenueChange: r2(b.revenue - a.revenue),
    revenueChangePct: r2(div(b.revenue - a.revenue, a.revenue) * 100),
    checksChangePct: r2(div(b.checks - a.checks, a.checks) * 100),
    avgCheckChangePct: r2(div(b.avgCheck - a.avgCheck, a.avgCheck) * 100),
    volumeEffect: r2(volume),
    spendEffect: r2(spend),
    formula: 'ΔR = (C2 − C1)·A1 + (A2 − A1)·C2',
  };
}

/** Sales for a period vs the period of the same length right before it, per location. */
export async function salesSummary(locationIds, from, to) {
  const len = daysBetween(from, to) + 1;
  const pFrom = addDays(from, -len);
  const pTo = addDays(from, -1);
  const rows = await dailyTotals(locationIds, pFrom, to);
  const out = [];
  for (const loc of locationIds) {
    const cur = rows.filter((r) => r.locationId === loc && r.date >= from);
    const prev = rows.filter((r) => r.locationId === loc && r.date < from);
    const a = totals(prev);
    const b = totals(cur);
    out.push({
      locationId: loc,
      current: { from, to, ...b, daysWithData: cur.length, daysMissing: len - cur.length },
      previous: { from: pFrom, to: pTo, ...a, daysWithData: prev.length, daysMissing: len - prev.length },
      change: cur.length && prev.length ? decompose(a, b) : null,
    });
  }
  return { period: { from, to }, comparedWith: { from: pFrom, to: pTo }, source: SALES_SOURCE, locations: out };
}

/** Day by day (and by location) for charts. */
export async function salesDaily(locationIds, from, to) {
  const rows = await dailyTotals(locationIds, from, to);
  const dates = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  return {
    period: { from, to },
    source: SALES_SOURCE,
    series: locationIds.map((loc) => ({
      locationId: loc,
      days: dates.map((d) => {
        const r = rows.find((x) => x.locationId === loc && x.date === d);
        return r ? { date: d, revenue: r.revenue, checks: r.checks, diners: r.noDiners / r.checks <= 0.2 ? r.diners : null, missing: false } : { date: d, revenue: null, checks: null, diners: null, missing: true };
      }),
    })),
  };
}

/** Revenue and checks by shift (checks opened inside the shift window). */
export async function salesByShift(locationIds, from, to) {
  const out = [];
  for (const loc of locationIds) {
    const shifts = (await listShifts([loc])).filter((s) => s.active);
    const checks = await sourceChecks(loc, from, to);
    const agg = Object.fromEntries(shifts.map((s) => [s.code, { shiftCode: s.code, name: s.name, checks: 0, revenue: 0, diners: 0, noDiners: 0 }]));
    const outside = { checks: 0, revenue: 0 };
    for (const c of checks) {
      const d = c.business_date;
      const opened = String(c.opened_at).slice(11, 16);
      const [h, m] = opened.split(':').map(Number);
      const min = h * 60 + m;
      const s = shifts.find((x) => {
        if (!x.days.includes(weekdayOf(d))) return false;
        const [ws, we] = shiftWindow(x.start, x.end);
        return (min >= ws && min < we) || (min + 1440 >= ws && min + 1440 < we);
      });
      const a = s ? agg[s.code] : outside;
      a.checks++;
      a.revenue += Number(c.net_amount ?? 0);
      if (s) {
        if (c.diners == null) a.noDiners++;
        else a.diners += c.diners;
      }
    }
    out.push({
      locationId: loc,
      shifts: Object.values(agg).map((a) => ({ ...a, revenue: r2(a.revenue), avgCheck: r2(div(a.revenue, a.checks)), diners: a.checks && a.noDiners / a.checks <= 0.2 ? a.diners : null })),
      outsideShifts: { checks: outside.checks, revenue: r2(outside.revenue) },
    });
  }
  return { period: { from, to }, source: `${SALES_SOURCE} + the location shifts (joya_settings)`, locations: out };
}

/** Dishes: units and revenue in the period vs the previous period of the same length. */
export async function salesByDish(locationIds, from, to, limit = 30) {
  const len = daysBetween(from, to) + 1;
  const pFrom = addDays(from, -len);
  const max = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 500);
  const dishes = [];
  const coverage = [];
  for (const loc of locationIds) {
    const menu = new Map((await q(`SELECT external_code, name FROM joya_menu_items WHERE location_id=:l`, { l: loc })).map((m) => [m.external_code, m.name]));
    const agg = new Map();
    const cur = new Set();
    const prev = new Set();
    for (const r of await dishSales(loc, pFrom, to)) {
      const isCur = r.business_date >= from;
      (isCur ? cur : prev).add(r.business_date);
      let a = agg.get(r.code);
      if (!a) agg.set(r.code, (a = { locationId: loc, name: menu.get(r.code) ?? r.name, code: r.code, category: r.category, onMenu: menu.has(r.code), units: 0, revenue: 0, prevUnits: 0 }));
      if (isCur) {
        a.units += r.qty;
        a.revenue += r.net_amount ?? 0;
      } else a.prevUnits += r.qty;
    }
    dishes.push(...agg.values());
    coverage.push({ locationId: loc, daysWithData: cur.size, prevDaysWithData: prev.size, days: len });
  }
  dishes.sort((a, b) => b.units - a.units);
  return {
    period: { from, to },
    comparedWith: { from: pFrom, to: addDays(from, -1) },
    source: 'Beecomm dish sales via Allegro (/beecomm/items/stored); before order discounts minus discounts',
    coverage,
    dishes: dishes.slice(0, max).map((a) => ({ ...a, revenue: r2(a.revenue), unitsChangePct: r2(div(a.units - a.prevUnits, a.prevUnits) * 100) })),
  };
}

/**
 * Days whose revenue is far from the same weekday of the previous 8 weeks:
 * |x − median| > 3 × 1.4826 × MAD and more than 20 % away. Missing days are listed apart.
 */
export async function anomalies(locationIds, from, to) {
  const rows = await dailyTotals(locationIds, addDays(from, -56), to);
  const out = [];
  const missing = [];
  for (const loc of locationIds) {
    const byDate = new Map(rows.filter((r) => r.locationId === loc).map((r) => [r.date, r]));
    const firstData = [...byDate.keys()].sort()[0];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const cur = byDate.get(d);
      if (!cur) {
        if (firstData && d > firstData) missing.push({ locationId: loc, date: d });
        continue;
      }
      const hist = [];
      for (let k = 1; k <= 8; k++) {
        const h = byDate.get(addDays(d, -7 * k));
        if (h?.revenue != null) hist.push(h.revenue);
      }
      if (hist.length < 4 || cur.revenue == null) continue;
      const med = median(hist);
      const mad = median(hist.map((x) => Math.abs(x - med))) * 1.4826;
      const dev = cur.revenue - med;
      if (Math.abs(dev) > Math.max(3 * mad, 0.2 * med)) {
        out.push({ locationId: loc, date: d, revenue: cur.revenue, expected: r2(med), deviationPct: r2((dev / med) * 100), checks: cur.checks, basis: { weeks: hist.length, mad: r2(mad) } });
      }
    }
  }
  return { period: { from, to }, source: SALES_SOURCE, method: 'same weekday, previous 8 weeks, median ± 3 MAD and ≥ 20%', anomalies: out, missingDays: missing };
}

/**
 * Labor for a period. Hours come from the raw clock rows (with corrections). Money only with
 * payroll access:
 *   known     Allegro /labor/daily: the payslip gross of the saved payroll months, spread over the
 *             days worked (Allegro's own estimate for employees without a payslip is counted, and said)
 *   estimate  clocked hours × the employee's hourly wage (gross); employer cost = gross × the
 *             `labor.employerCostFactorEstimate` setting. Rows with no wage are counted, not guessed.
 * Allegro has no employer cost, so `known` is gross only.
 */
export async function laborSummary(access, locationIds, from, to) {
  const lab = await getSettings('labor');
  const factor = lab.employerCostFactorEstimate ?? 1.25;
  const sales = await salesSummary(locationIds, from, to);
  const att = (await effectiveAttendance(locationIds, from, to)).filter((a) => !a.excluded);
  const wages = new Map();
  if (access.payroll && att.length) for (const e of await employees(locationIds)) wages.set(e.id, e.hourlyWage);
  const months = monthsBetween(from, to);

  const locations = [];
  for (const loc of locationIds) {
    const rows = att.filter((a) => a.locationId === loc);
    const hours = rows.reduce((s, a) => s + (a.hours ?? 0), 0);
    const missingHours = rows.filter((a) => a.hours == null).length;
    const s = sales.locations.find((x) => x.locationId === loc).current;
    const payDays = (await laborDaily(loc, from, to)).filter((d) => d.coverage?.employees > 0);
    const res = {
      locationId: loc,
      hours: r2(hours),
      attendanceRows: rows.length,
      rowsMissingHours: missingHours,
      payrollHours: payDays.length ? r2(payDays.reduce((x, d) => x + Number(d.hours?.total ?? 0), 0)) : null,
      payrollDays: payDays.length,
      revenue: s.revenue,
      salesDaysMissing: s.daysMissing,
      salesPerLaborHour: rows.length && !missingHours ? r2(div(s.revenue, hours)) : null,
    };
    if (access.payroll) {
      let gross = 0;
      let noWage = 0;
      for (const a of rows) {
        const w = a.employeeId ? wages.get(a.employeeId) : null;
        if (w == null || a.hours == null) noWage++;
        else gross += a.hours * w;
      }
      res.estimate = rows.length
        ? {
            grossWage: r2(gross),
            employerCost: r2(gross * factor),
            employerCostFactor: factor,
            rowsWithoutWageOrHours: noWage,
            laborPctOfSales: noWage === 0 && s.revenue ? r2(((gross * factor) / s.revenue) * 100) : null,
            // with sales days missing the percentage is too high (sales understated): say so
            salesComplete: s.daysMissing === 0,
            isEstimate: true,
          }
        : null;
      if (payDays.length) {
        const g = payDays.reduce((x, d) => x + Number(d.gross?.total ?? 0), 0);
        const payDates = new Set(payDays.map((d) => d.date));
        const daily = await dailyTotals([loc], from, to);
        const payRevenue = daily.filter((d) => payDates.has(d.date)).reduce((x, d) => x + (d.revenue ?? 0), 0);
        res.known = {
          months,
          monthsWithPayroll: [...new Set(payDays.map((d) => d.date.slice(0, 7)))],
          days: daysBetween(from, to) + 1,
          daysWithPayroll: payDays.length,
          grossWage: r2(g),
          employeeDaysEstimated: payDays.reduce((x, d) => x + Number(d.coverage?.estimated ?? 0), 0),
          unpricedHours: r2(payDays.reduce((x, d) => x + Number(d.coverage?.unpricedHours ?? 0), 0)),
          employerCostExtra: null,
          totalEmployerCost: null,
          employerCostIncluded: false,
          // gross ÷ the sales of the same days only (days without payroll would dilute it)
          laborPctOfSales: payRevenue ? r2((g / payRevenue) * 100) : null,
          salesComplete: s.daysMissing === 0,
        };
      } else res.known = null;
    }
    locations.push(res);
  }
  return {
    period: { from, to },
    sources: {
      hours: 'Tabit clock rows via Allegro (/shifts/raw) + joya_attendance_corrections',
      sales: SALES_SOURCE,
      known: 'payslip gross via Allegro (/labor/daily)',
      estimate: 'hours × hourly wage (Allegro /employees)',
    },
    payrollVisible: access.payroll,
    locations,
  };
}

/** Planned (approved staffing plans) vs worked hours, per location and week. */
export async function plannedVsActual(access, locationIds, from, to) {
  if (!locationIds.length) return { period: { from, to }, weeks: [] };
  const locs = inList('loc', locationIds);
  const plans = await q(
    `SELECT id, location_id, week_start, final_json FROM joya_staffing_plans WHERE status='APPROVED' AND location_id IN (${locs.sql})
      AND week_start BETWEEN :a AND :b ORDER BY week_start`,
    { ...locs.params, a: addDays(from, -6), b: to },
  );
  const att = (await effectiveAttendance(locationIds, addDays(from, -6), addDays(to, 6))).filter((a) => !a.excluded);
  const weeks = plans.map((p) => {
    const ws = ymd(p.week_start);
    const we = addDays(ws, 6);
    const final = typeof p.final_json === 'string' ? JSON.parse(p.final_json) : p.final_json || [];
    const planned = final.reduce((s, l) => {
      const [sh, sm] = l.start.split(':').map(Number);
      const [eh, em] = l.end.split(':').map(Number);
      let m = eh * 60 + em - (sh * 60 + sm);
      if (m <= 0) m += 1440;
      return s + (l.headcount * m) / 60;
    }, 0);
    const rows = att.filter((a) => a.locationId === p.location_id && a.date >= ws && a.date <= we);
    return {
      planId: p.id,
      locationId: p.location_id,
      weekStart: ws,
      plannedHours: r2(planned),
      actualHours: r2(rows.reduce((s, a) => s + (a.hours ?? 0), 0)),
      attendanceRows: rows.length,
      rowsMissingHours: rows.filter((a) => a.hours == null).length,
    };
  });
  return { period: { from, to }, sources: { planned: 'joya_staffing_plans.final_json (approved)', actual: 'Tabit clock rows via Allegro (/shifts/raw) + corrections' }, weeks };
}
