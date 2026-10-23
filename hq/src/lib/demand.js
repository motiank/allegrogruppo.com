// Demand of one shift, computed from the POS checks (Bikum). Pure functions.
//
// Units (each staffing rule names one):
//   DINERS_PER_SHIFT        sum of `diners` on checks OPENED inside the shift window
//   DINERS_PEAK_HOUR        the highest sum of diners on checks opened in one clock hour of the shift
//   CONCURRENT_DINERS_PEAK  the most diners seated at the same moment (sampled every 15 min);
//                           needs `closed_at` on the checks
//   ORDERS_PER_SHIFT        number of checks OPENED inside the shift window. An "order" is one POS
//                           check (bill); Bikum kitchen tickets are not in the data we have.
//   ORDERS_PEAK_HOUR        the highest number of checks opened in one clock hour of the shift
//
// Missing values are never read as zero: a check with no diner count is left out of
// the diner sums and counted in `missingDiners`; when more than MAX_MISSING_SHARE of
// the checks lack it, the diner units are NULL ("not known").

export const UNITS = ['DINERS_PER_SHIFT', 'DINERS_PEAK_HOUR', 'CONCURRENT_DINERS_PEAK', 'ORDERS_PER_SHIFT', 'ORDERS_PEAK_HOUR'];
export const MAX_MISSING_SHARE = 0.2;

const toMin = (hhmmss) => {
  const [h, m] = String(hhmmss).split(':').map(Number);
  return h * 60 + m;
};

/** Minutes since the business date's midnight for a 'YYYY-MM-DD HH:MM:SS' local time. */
function minutesFrom(businessDate, dt) {
  const base = Date.UTC(+businessDate.slice(0, 4), +businessDate.slice(5, 7) - 1, +businessDate.slice(8, 10));
  const s = typeof dt === 'string' ? dt : localString(dt);
  const t = Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +s.slice(11, 13), +s.slice(14, 16));
  return Math.round((t - base) / 60000);
}

/** mysql2 returns DATETIME as a Date built with timezone 'Z'; read it back as wall-clock text. */
export function localString(d) {
  if (d == null) return null;
  if (typeof d === 'string') return d.replace('T', ' ').slice(0, 19);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/** [startMin, endMin) of a shift relative to its business date; an end before the start runs past midnight. */
export function shiftWindow(startTime, endTime) {
  const s = toMin(startTime);
  let e = toMin(endTime);
  if (e <= s) e += 24 * 60;
  return [s, e];
}

/**
 * @param {Array<{opened_at, closed_at?, diners?}>} checks  checks of ONE business date
 * @param {{start_time, end_time}} shift
 * @param {string} businessDate 'YYYY-MM-DD'
 */
export function shiftDemand(checks, shift, businessDate) {
  const [ws, we] = shiftWindow(shift.start_time, shift.end_time);
  const inShift = [];
  for (const c of checks) {
    const o = minutesFrom(businessDate, c.opened_at);
    if (o >= ws && o < we) inShift.push({ o, c: c.closed_at ? minutesFrom(businessDate, c.closed_at) : null, d: c.diners == null ? null : Number(c.diners) });
  }
  const orders = inShift.length;
  const missingDiners = inShift.filter((x) => x.d == null).length;
  const missingClose = inShift.filter((x) => x.c == null).length;
  const dinersKnown = orders > 0 && missingDiners / orders <= MAX_MISSING_SHARE;

  const hours = Math.ceil((we - ws) / 60);
  const dinersByHour = new Array(hours).fill(0);
  const ordersByHour = new Array(hours).fill(0);
  for (const x of inShift) {
    const h = Math.min(hours - 1, Math.floor((x.o - ws) / 60));
    ordersByHour[h]++;
    if (x.d != null) dinersByHour[h] += x.d;
  }
  const hourLabels = dinersByHour.map((_, i) => {
    const m = (ws + i * 60) % (24 * 60);
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  });

  let concurrent = null;
  if (orders > 0 && dinersKnown && missingClose / orders <= MAX_MISSING_SHARE) {
    concurrent = 0;
    for (let t = ws; t < we; t += 15) {
      let n = 0;
      for (const x of inShift) if (x.c != null && x.d != null && x.o <= t && x.c > t) n += x.d;
      if (n > concurrent) concurrent = n;
    }
  }

  return {
    checks: orders,
    missingDiners,
    missingClose,
    byHour: hourLabels.map((h, i) => ({ hour: h, orders: ordersByHour[i], diners: dinersKnown ? dinersByHour[i] : null })),
    values: {
      DINERS_PER_SHIFT: dinersKnown ? inShift.reduce((a, x) => a + (x.d ?? 0), 0) : null,
      DINERS_PEAK_HOUR: dinersKnown ? Math.max(...dinersByHour) : null,
      CONCURRENT_DINERS_PEAK: concurrent,
      ORDERS_PER_SHIFT: orders,
      ORDERS_PEAK_HOUR: orders ? Math.max(...ordersByHour) : 0,
    },
  };
}

export function median(nums) {
  const a = nums.filter((n) => n != null && Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * Forecast one unit for one weekday+shift from past same-weekday dates.
 * Dates with no POS data at all are "missing" (left out), never zero.
 * @param {Array<{date, hasData, demand}>} history newest first
 */
export function forecastUnit(history, unit, minDays) {
  const used = history.filter((h) => h.hasData && h.demand?.values?.[unit] != null);
  const values = used.map((h) => ({ date: h.date, value: h.demand.values[unit] }));
  const value = median(values.map((v) => v.value));
  return {
    unit,
    value: value == null ? null : Math.round(value * 10) / 10,
    method: 'MEDIAN_SAME_WEEKDAY',
    n: values.length,
    missingDates: history.filter((h) => !h.hasData).map((h) => h.date),
    confidence: value == null ? 'NONE' : values.length >= Math.max(minDays, 6) ? 'HIGH' : values.length >= minDays ? 'MEDIUM' : 'LOW',
    values,
  };
}
