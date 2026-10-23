// Demand per shift from the POS checks, and the forecast for a week.
import { ymdhms, getSettings } from '../db.js';
import { shiftDemand, forecastUnit, UNITS } from '../lib/demand.js';
import { addDays } from '../lib/recommend.js';
import { listShifts } from './master.js';
import { checks as sourceChecks } from './source.js';

const weekdayOf = (d) => new Date(d + 'T00:00:00Z').getUTCDay();

/** checks of [from, to] grouped by business date (Allegro /beecomm/orders/stored) */
export async function loadChecks(locationId, from, to) {
  const rows = await sourceChecks(locationId, from, to);
  const byDate = new Map();
  for (const r of rows) {
    const d = r.business_date;
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push({ opened_at: ymdhms(r.opened_at), closed_at: ymdhms(r.closed_at), diners: r.diners, net_amount: r.net_amount });
  }
  return byDate;
}

/** Actual demand of one location for every shift of every date in [from, to]. */
export async function actualDemand(locationId, from, to) {
  const shifts = (await listShifts([locationId])).filter((s) => s.active);
  const checks = await loadChecks(locationId, from, addDays(to, 1));
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const wd = weekdayOf(d);
    for (const s of shifts.filter((x) => x.days.includes(wd))) {
      const day = checks.get(d);
      out.push({ date: d, weekday: wd, shiftCode: s.code, hasData: !!day?.length, demand: day?.length ? shiftDemand(day, { start_time: s.start, end_time: s.end }, d) : null });
    }
  }
  return out;
}

/**
 * Forecast every shift of the week starting `weekStart` (a Sunday): the median of the
 * same weekday over the previous `historyWeeks` weeks, per demand unit.
 */
export async function forecastWeek(locationId, weekStart) {
  const st = await getSettings('staffing');
  const weeks = st.historyWeeks || 8;
  const minDays = st.minDaysForForecast || 3;
  const shifts = (await listShifts([locationId])).filter((s) => s.active);
  const from = addDays(weekStart, -7 * weeks);
  const checks = await loadChecks(locationId, from, weekStart);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i);
    const wd = weekdayOf(date);
    for (const s of shifts.filter((x) => x.days.includes(wd))) {
      const history = [];
      for (let k = 1; k <= weeks; k++) {
        const hd = addDays(date, -7 * k);
        const day = checks.get(hd);
        history.push({ date: hd, hasData: !!day?.length, demand: day?.length ? shiftDemand(day, { start_time: s.start, end_time: s.end }, hd) : null });
      }
      const demand = Object.fromEntries(UNITS.map((u) => [u, forecastUnit(history, u, minDays)]));
      days.push({ date, weekday: wd, shiftCode: s.code, shiftName: s.name, start: s.start, end: s.end, demand, history: history.map((h) => ({ date: h.date, hasData: h.hasData, values: h.demand?.values ?? null, missingDiners: h.demand?.missingDiners ?? null, checks: h.demand?.checks ?? null })) });
    }
  }
  return { weekStart, historyWeeks: weeks, minDays, slots: days };
}

/** Demand of one weekday + shift on recent weeks (for "show demand on recent Thursdays"). */
export async function recentSameWeekday(locationId, weekday, shiftCode, weeks = 8, asOf) {
  const shifts = (await listShifts([locationId])).filter((s) => s.active && (!shiftCode || s.code === shiftCode));
  let last = asOf;
  while (weekdayOf(last) !== Number(weekday)) last = addDays(last, -1);
  if (last >= asOf) last = addDays(last, -7);
  const from = addDays(last, -7 * (weeks - 1));
  const checks = await loadChecks(locationId, from, addDays(last, 1));
  const out = [];
  for (let k = 0; k < weeks; k++) {
    const d = addDays(last, -7 * k);
    for (const s of shifts.filter((x) => x.days.includes(Number(weekday)))) {
      const day = checks.get(d);
      out.push({ date: d, shiftCode: s.code, hasData: !!day?.length, values: day?.length ? shiftDemand(day, { start_time: s.start, end_time: s.end }, d).values : null });
    }
  }
  return out;
}
