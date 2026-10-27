// Sales and labor numbers. Every function returns its period, its source and what is
// missing, so a page (or the AI answer) can say where a number came from. The data comes
// from the Allegro API (./source.js); nothing here is stored.
// A day with no POS rows is MISSING, never a day with zero sales.
import { q, ymd, inList } from '../db.js';
import { addDays, daysBetween } from '../lib/recommend.js';
import { median } from '../lib/demand.js';
import { effectiveAttendance } from './attendance.js';
import { listShifts } from './master.js';
import { shiftWindow } from '../lib/demand.js';
import { checks as sourceChecks, dishSales, laborDaily, laborDailyEmployees, monthsBetween, payments as sourcePayments } from './source.js';

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
 * Labor for a period. Hours come from the raw clock rows (with corrections). Money (payroll access only) comes
 * from the Allegro admin (/labor/daily), computed there with the payroll business logic — never here:
 *   laborCost     the admin's labor cost (the Shifts page formula): weighted hours (100% + 125% × 1.25 + 150% × 1.5,
 *                 after the break rule) × the role's wage; tip + completion for tip roles; monthly salary ÷ days
 *   payslipGross  the payslip (tlush) gross: wages + travel + bonus, spread over the days worked
 * A month without a saved payroll is built by the admin from the Tabit reports like a new payroll (not saved).
 * Hours with no wage in the admin (person not in employees, or a role without a wage) add nothing: they are
 * counted and named, never priced here. Employer cost (pension, social security) is not in Allegro.
 */
export async function laborSummary(access, locationIds, from, to) {
  const sales = await salesSummary(locationIds, from, to);
  const att = (await effectiveAttendance(locationIds, from, to)).filter((a) => !a.excluded);
  const months = monthsBetween(from, to);

  const locations = [];
  for (const loc of locationIds) {
    const rows = att.filter((a) => a.locationId === loc);
    const hours = rows.reduce((s, a) => s + (a.hours ?? 0), 0);
    const missingHours = rows.filter((a) => a.hours == null).length;
    const s = sales.locations.find((x) => x.locationId === loc).current;
    const res = {
      locationId: loc,
      hours: r2(hours),
      attendanceRows: rows.length,
      rowsMissingHours: missingHours,
      revenue: s.revenue,
      daysWithoutSales: s.daysMissing,
      salesPerLaborHour: rows.length && !missingHours ? r2(div(s.revenue, hours)) : null,
    };
    if (access.payroll) {
      const { days, meta } = await laborDaily(loc, from, to);
      const paid = days.filter((d) => d.coverage?.employees > 0);
      const t = meta.totals || {};
      if (paid.length) {
        const sum = (f) => r2(paid.reduce((x, d) => x + (Number(f(d)) || 0), 0));
        const unpricedHours = sum((d) => d.coverage.unpricedHours);
        let withoutWage = [];
        if (unpricedHours > 0) {
          const per = new Map();
          for (const e of await laborDailyEmployees(loc, from, to)) {
            if (!(e.unpricedHours > 0)) continue;
            const p = per.get(e.name) || { name: e.name, inEmployees: e.employeeId != null, hoursWithoutWage: 0 };
            p.hoursWithoutWage += e.unpricedHours;
            per.set(e.name, p);
          }
          withoutWage = [...per.values()].map((p) => ({ ...p, hoursWithoutWage: r2(p.hoursWithoutWage) })).sort((a, b) => b.hoursWithoutWage - a.hoursWithoutWage);
        }
        const payrollHoursTotal = sum((d) => d.hours?.total);
        const byMonth = new Map((meta.payrollMonths || []).map((m) => [m.month, m.payrollSource]));
        res.cost = {
          laborCost: t.adminCost ?? sum((d) => d.adminCost),
          payslipGross: t.gross ?? sum((d) => d.gross?.total),
          // ÷ the admin's daily revenue (Beecomm, before discounts) of the days with payroll rows
          laborPct: { laborCost: t.laborPct?.adminCost ?? null, payslipGross: t.laborPct?.gross ?? null },
          revenueOfPayrollDays: t.revenue ?? null,
          days: daysBetween(from, to) + 1,
          daysWithPayroll: paid.length,
          payrollHours: { h100: sum((d) => d.hours?.h100), h125: sum((d) => d.hours?.h125), h150: sum((d) => d.hours?.h150), total: sum((d) => d.hours?.total) },
          tip: sum((d) => d.tip),
          completion: sum((d) => d.completion),
          payrollMonths: months.map((m) => ({ month: m, payroll: byMonth.get(m) ?? 'none' })),
          employeeDaysWithoutPayslip: sum((d) => d.coverage.estimated),
          hoursWithoutWage: unpricedHours,
          // share of the payroll hours with no wage; over 2% the cost and % are too low to be the real labor cost
          hoursWithoutWagePct: payrollHoursTotal ? r2((unpricedHours / payrollHoursTotal) * 100) : null,
          complete: unpricedHours <= payrollHoursTotal * 0.02,
          peopleWithoutWage: withoutWage.slice(0, 20),
          peopleWithoutWageCount: withoutWage.length,
          employerCostIncluded: false,
        };
      } else res.cost = null;
    }
    locations.push(res);
  }
  return {
    period: { from, to },
    sources: {
      hours: 'Tabit clock rows via Allegro (/shifts/raw) + joya_attendance_corrections',
      sales: SALES_SOURCE,
      cost: 'Allegro admin payroll rules and payslips (/labor/daily)',
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

/**
 * Payments per location for a period (Beecomm דוח תשלומים): per payment type (credit, cash, Wolt, 10bis…)
 * the charges (tips included), their share of all charges, refunds, payments and the average payment, the
 * service (tips) inside them, and the card brands of the type; compared with the same-length period before.
 */
// card brand names as Beecomm writes them; a few spellings people use
const BRAND_ALIAS = { AMX: 'AMEX', 'AMERICAN EXPRESS': 'AMEX', MASTER: 'MASTERCARD', 'MASTER CARD': 'MASTERCARD' };
const brandKey = (b) => {
  const k = String(b || '').trim().toUpperCase();
  return BRAND_ALIAS[k] || k;
};

// A period of a date for weekly / monthly sums. Weeks run Sunday to Saturday (owner, 2026-10-27).
export function periodOf(date, group) {
  if (group === 'month') {
    const [y, m] = date.slice(0, 7).split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { key: date.slice(0, 7), from: `${date.slice(0, 7)}-01`, to: `${date.slice(0, 7)}-${String(last).padStart(2, '0')}` };
  }
  const from = addDays(date, -weekdayOf(date));
  return { key: from, from, to: addDays(from, 6) };
}
export const GROUPS = ['week', 'month'];

// Owner, 2026-10-26: in Beecomm, "credit card" = only these brands of the credit type (אשראי); every other brand
// of that type (PRIVATE LABEL BRAND - חבר, Mishloha…) is the "members club" (מועדון חברים).
export const CREDIT_CARD_BRANDS = ['VISA', 'MASTERCARD', 'AMEX', 'DINERS'];
const CREDIT_TYPE = 1;
const isCreditCard = (brand) => CREDIT_CARD_BRANDS.includes(brandKey(brand));
const newGroup = () => ({ charges: 0, refunded: 0, transactions: 0, prevCharges: 0, brands: new Set(), byDay: new Map() });

/**
 * brands (optional, e.g. ['VISA', 'MASTERCARD', 'AMEX', 'DINERS']): also sum only these card brands — per location
 * `selected` with a day-by-day list, and `selectedTotal` over all the locations.
 */
// rows of weekly / monthly sums, oldest first; partial = the period is cut by from / to; daysWithData counts
// location-days for the total over several locations
function periodRows(map, from, to, locations = 1) {
  return [...map.values()]
    .sort((a, b) => (a.from < b.from ? -1 : 1))
    .map((g) => ({
      from: g.from,
      to: g.to,
      ...(g.from < from || g.to > to ? { partial: true } : {}),
      daysWithData: g.days.size,
      ...(locations > 1 ? { locations } : {}),
      total: r2(g.total),
      creditCards: r2(g.creditCards),
      membersClub: r2(g.membersClub),
      brands: Object.fromEntries(Object.entries(g.brands).map(([k, v]) => [k, r2(v)])),
    }));
}

export async function paymentsSummary(locationIds, from, to, brands = null, group = null) {
  const by = GROUPS.includes(group) ? group : null;
  const newPeriod = (pp) => ({ from: pp.from, to: pp.to, days: new Set(), total: 0, creditCards: 0, membersClub: 0, brands: {} });
  const allPeriods = new Map();
  const len = daysBetween(from, to) + 1;
  const want = Array.isArray(brands) && brands.length ? new Set(brands.map(brandKey)) : null;
  let selTotal = want ? { charges: 0, prevCharges: 0, transactions: 0 } : null;
  const groupTotals = { creditCards: { charges: 0, prevCharges: 0 }, membersClub: { charges: 0, prevCharges: 0 } };
  const pFrom = addDays(from, -len);
  const out = [];
  let reason = null;
  for (const loc of locationIds) {
    const src = await sourcePayments(loc, pFrom, to);
    if (!src.available) {
      reason = src.reason;
      out.push({ locationId: loc, available: false });
      continue;
    }
    const types = new Map();
    const days = new Set();
    const prevDays = new Set();
    const sel = want ? { charges: 0, refunded: 0, transactions: 0, prevCharges: 0, byDay: new Map() } : null;
    const groups = { creditCards: newGroup(), membersClub: newGroup() };
    const periods = new Map();
    for (const r of src.rows) {
      const cur = r.date >= from;
      (cur ? days : prevDays).add(r.date);
      if (by && cur) {
        const pp = periodOf(r.date, by);
        for (const m of [periods, allPeriods]) {
          const g = m.get(pp.key) || newPeriod(pp);
          m.set(pp.key, g);
          g.days.add(m === periods ? r.date : `${loc}|${r.date}`);
          if (r.brand == null && r.inZ) g.total += r.charges;
          if (r.type === CREDIT_TYPE && r.brand != null) {
            g[isCreditCard(r.brand) ? 'creditCards' : 'membersClub'] += r.charges;
            g.brands[brandKey(r.brand)] = (g.brands[brandKey(r.brand)] || 0) + r.charges;
          }
        }
      }
      if (r.type === CREDIT_TYPE && r.brand != null) {
        const g = groups[isCreditCard(r.brand) ? 'creditCards' : 'membersClub'];
        g.brands.add(r.brand);
        if (cur) {
          g.charges += r.charges;
          g.refunded += r.refunded;
          g.transactions += r.transactions;
          g.byDay.set(r.date, (g.byDay.get(r.date) || 0) + r.charges);
        } else g.prevCharges += r.charges;
      }
      if (sel && r.brand != null && want.has(brandKey(r.brand))) {
        if (cur) {
          sel.charges += r.charges;
          sel.refunded += r.refunded;
          sel.transactions += r.transactions;
          sel.byDay.set(r.date, (sel.byDay.get(r.date) || 0) + r.charges);
        } else sel.prevCharges += r.charges;
      }
      let t = types.get(r.type);
      if (!t) types.set(r.type, (t = { type: r.type, name: r.typeName, inZ: r.inZ, charges: 0, refunded: 0, transactions: 0, refundTransactions: 0, service: 0, prevCharges: 0, brands: new Map() }));
      if (r.brand == null) {
        if (cur) {
          t.charges += r.charges;
          t.refunded += r.refunded;
          t.transactions += r.transactions;
          t.refundTransactions += r.refundTransactions;
          t.service += r.service;
        } else t.prevCharges += r.charges;
      } else if (cur) {
        const b = t.brands.get(r.brand) || { brand: r.brand, charges: 0, transactions: 0, refunded: 0 };
        b.charges += r.charges;
        b.transactions += r.transactions;
        b.refunded += r.refunded;
        t.brands.set(r.brand, b);
      }
    }
    const list = [...types.values()];
    // a period with no loaded day is missing, not zero
    const has = days.size > 0;
    const hasPrev = prevDays.size > 0;
    const cur = (x) => (has ? r2(x) : null);
    const prev = (x) => (hasPrev ? r2(x) : null);
    const total = list.filter((t) => t.inZ).reduce((a, t) => a + t.charges, 0);
    const prevTotal = list.filter((t) => t.inZ).reduce((a, t) => a + t.prevCharges, 0);
    if (sel && has) {
      selTotal.charges += sel.charges;
      selTotal.transactions += sel.transactions;
    }
    if (sel && hasPrev) selTotal.prevCharges += sel.prevCharges;
    const groupOut = (g, withDays) => ({
      brands: [...g.brands].sort(),
      charges: cur(g.charges),
      sharePct: has ? r2(div(g.charges, total) * 100) : null,
      refunded: cur(g.refunded),
      transactions: has ? g.transactions : null,
      prevCharges: prev(g.prevCharges),
      changePct: has && hasPrev ? r2(div(g.charges - g.prevCharges, g.prevCharges) * 100) : null,
      ...(withDays ? { byDay: [...g.byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, charges]) => ({ date, weekday: weekdayOf(date), charges: r2(charges) })) } : {}),
    });
    for (const k of ['creditCards', 'membersClub']) {
      if (has) groupTotals[k].charges += groups[k].charges;
      if (hasPrev) groupTotals[k].prevCharges += groups[k].prevCharges;
    }
    out.push({
      locationId: loc,
      available: true,
      daysWithData: days.size,
      prevDaysWithData: prevDays.size,
      days: len,
      totalCharges: cur(total),
      prevTotalCharges: prev(prevTotal),
      totalService: cur(list.filter((t) => t.inZ).reduce((a, t) => a + t.service, 0)),
      // the credit type (אשראי) split the owner's way: credit cards = VISA + MASTERCARD + AMEX + DINERS, the rest = members club
      creditCards: groupOut(groups.creditCards, len <= 62 && !by),
      membersClub: groupOut(groups.membersClub, len <= 62 && !by),
      ...(by ? { byPeriod: periodRows(periods, from, to) } : {}),
      types: list
        .sort((a, b) => b.charges - a.charges || b.prevCharges - a.prevCharges)
        .map((t) => ({
          type: t.type,
          name: t.name,
          inZ: t.inZ,
          charges: cur(t.charges),
          sharePct: has && t.inZ ? r2(div(t.charges, total) * 100) : null,
          prevCharges: prev(t.prevCharges),
          prevSharePct: hasPrev && t.inZ ? r2(div(t.prevCharges, prevTotal) * 100) : null,
          changePct: has && hasPrev ? r2(div(t.charges - t.prevCharges, t.prevCharges) * 100) : null,
          refunded: cur(t.refunded),
          transactions: has ? t.transactions : null,
          refundTransactions: has ? t.refundTransactions : null,
          avgPayment: has ? r2(div(t.charges, t.transactions)) : null,
          service: cur(t.service),
          brands: [...t.brands.values()].sort((a, b) => b.charges - a.charges).map((b) => ({ ...b, charges: r2(b.charges), refunded: r2(b.refunded) })),
        })),
      ...(sel
        ? {
            selected: {
              brands: [...want],
              charges: cur(sel.charges),
              refunded: cur(sel.refunded),
              transactions: has ? sel.transactions : null,
              prevCharges: prev(sel.prevCharges),
              changePct: has && hasPrev ? r2(div(sel.charges - sel.prevCharges, sel.prevCharges) * 100) : null,
              byDay: [...sel.byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, charges]) => ({ date, weekday: weekdayOf(date), charges: r2(charges) })),
            },
          }
        : {}),
    });
  }
  return {
    period: { from, to },
    comparedWith: { from: pFrom, to: addDays(from, -1) },
    source: 'Beecomm payments report via Allegro (/beecomm/payments/stored); charges include service (tips); shares are of the payments inside the Z',
    note: 'creditCards = VISA + MASTERCARD + AMEX + DINERS of the credit type (אשראי) = "credit card" (כרטיסי אשראי); membersClub = every other brand of that type (מועדון חברים: PRIVATE LABEL BRAND - חבר, Mishloha…); the type אשראי = both',
    ...(reason ? { missing: reason } : {}),
    creditCardsTotal: { charges: r2(groupTotals.creditCards.charges), prevCharges: r2(groupTotals.creditCards.prevCharges) },
    membersClubTotal: { charges: r2(groupTotals.membersClub.charges), prevCharges: r2(groupTotals.membersClub.prevCharges) },
    ...(by ? { group: by, byPeriodTotal: periodRows(allPeriods, from, to, locationIds.length) } : {}),
    ...(selTotal ? { selectedTotal: { brands: [...want], charges: r2(selTotal.charges), prevCharges: r2(selTotal.prevCharges), transactions: selTotal.transactions } } : {}),
    locations: out,
  };
}

// American Express pays (owner, 2026-10-27): sales received on the 1st–15th → on the 2nd of the next month; the 16th
// to the end of the month → on the 8th of the next month. A Saturday pay day moves to Sunday (seen in the bank: 9.8.2026).
// Max pays VISA + MASTERCARD (and the rest of the credit cards) every Wednesday for the Sunday–Saturday week before.
const AMEX_PAY_DAYS = [
  { day: 2, half: 'first' },
  { day: 8, half: 'second' },
];
const shiftSaturday = (d) => (weekdayOf(d) === 6 ? addDays(d, 1) : d);
const monthAdd = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1 + n, 1));
  return x.toISOString().slice(0, 7);
};

/**
 * The card money expected in one Sunday–Saturday week (default: this week), from Beecomm sales and the way the card
 * companies pay: creditCards = VISA + MASTERCARD + DINERS of the week before (Max, on this week's Wednesday);
 * amex = the American Express half-month(s) whose pay day (2nd / 8th) falls in this week, else nothing.
 */
export async function cardIncomeWeek(locationIds, weekStart, today) {
  const from = periodOf(weekStart || today, 'week').from;
  const to = addDays(from, 6);
  const prevFrom = addDays(from, -7);
  const prevTo = addDays(from, -1);
  const cards = await paymentsSummary(locationIds, prevFrom, prevTo, ['VISA', 'MASTERCARD', 'DINERS']);
  const amex = [];
  for (const ym of [...new Set([from.slice(0, 7), to.slice(0, 7)])]) {
    for (const p of AMEX_PAY_DAYS) {
      const payDate = shiftSaturday(`${ym}-${String(p.day).padStart(2, '0')}`);
      if (payDate < from || payDate > to) continue;
      const sm = monthAdd(ym, -1);
      const sFrom = p.half === 'first' ? `${sm}-01` : `${sm}-16`;
      const sTo = p.half === 'first' ? `${sm}-15` : periodOf(`${sm}-01`, 'month').to;
      const r = await paymentsSummary(locationIds, sFrom, sTo, ['AMEX']);
      amex.push({
        payDate,
        salesFrom: sFrom,
        salesTo: sTo,
        amount: r.selectedTotal?.charges ?? null,
        byLocation: r.locations.map((l) => ({ locationId: l.locationId, amount: l.selected?.charges ?? null, daysWithData: l.daysWithData ?? 0, days: l.days ?? null })),
      });
    }
  }
  const cc = cards.selectedTotal?.charges ?? null;
  const ax = amex.reduce((a, x) => a + (x.amount || 0), 0);
  return {
    week: { from, to },
    source: 'Beecomm payments (/beecomm/payments/stored); expected bank payouts from the card companies\' pay rules, not the bank file',
    note: 'creditCards = VISA + MASTERCARD + DINERS sold in the week before, paid by Max on this week\'s Wednesday (about 1.6% fee comes off); amex = American Express, paid by its own rule (sales of the 1st–15th on the 2nd of the next month, of the 16th–end on the 8th; a Saturday pay day moves to Sunday); amounts are Beecomm gross with tips, before fees',
    creditCards: {
      brands: ['VISA', 'MASTERCARD', 'DINERS'],
      salesWeek: { from: prevFrom, to: prevTo },
      payDate: addDays(from, 3),
      amount: cc,
      byLocation: cards.locations.map((l) => ({ locationId: l.locationId, amount: l.selected?.charges ?? null, daysWithData: l.daysWithData ?? 0, byDay: l.selected?.byDay ?? [] })),
    },
    amex: { payments: amex, amount: amex.length ? r2(ax) : 0, ...(amex.length ? {} : { none: 'no American Express pay day (2nd / 8th) in this week' }) },
    total: cc == null ? null : r2(cc + ax),
  };
}
