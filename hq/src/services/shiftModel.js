// The shift profile and the people needed per role in next week's shifts, learned from the last
// `profileWeeks` weeks of the branch (src/lib/shiftModel.js has the method). Sales: Beecomm checks;
// staff: Allegro /shifts/by-shift (from the Tabit clock times). Nothing is stored.
import { getSettings, todayLocal, err } from '../db.js';
import { addDays } from '../lib/recommend.js';
import { loadByShift, shiftProfile, learnRatios, forecastShifts, staffingActual } from '../lib/shiftModel.js';
import { assertLocation } from '../access.js';
import * as source from './source.js';

// roles whose load includes deliveries (Allegro role names; a role mapped to the Joya role 'cook' is one too)
const KITCHEN = ['טבח', 'פס קר', 'פס חם', 'מחבתות', 'טאבון', 'הכנות', 'קונדיטור'];

async function settings() {
  const st = await getSettings('staffing');
  return {
    weeks: st.profileWeeks || 8,
    emaWeeks: st.profileEmaWeeks || 4,
    split: st.shiftSplit || '17:00',
    deliveryAsDiners: st.deliveryAsDiners ?? 1,
    minPresence: st.minPresence ?? 0.5,
    minWeekdayShifts: st.minWeekdayShifts ?? 3,
    minHours: st.minHoursInShift ?? 1,
    kitchen: st.kitchenRoles || KITCHEN,
  };
}

async function history(locationId, weeks, s) {
  const to = addDays(todayLocal(), -1);
  const from = addDays(to, -7 * weeks + 1);
  const load = loadByShift(await source.checks(locationId, from, to), s.split);
  return { from, to, load };
}

/** Average diners and deliveries per weekday × shift over the last weeks. */
export async function profile(access, locationId, { weeks } = {}) {
  assertLocation(access, locationId);
  const s = await settings();
  const w = Math.min(Number(weeks) || s.weeks, 26);
  const h = await history(locationId, w, s);
  return {
    period: { from: h.from, to: h.to },
    source: 'Beecomm checks via Allegro (/beecomm/orders/stored)',
    method: `per weekday and shift, an exponential moving average (EMA, span ${s.emaWeeks} weeks — recent weeks weigh more) over the dates with sales in the last ${w} weeks; morning = checks opened before ${s.split}, evening = from ${s.split}; diners = sit-down checks, deliveries = all other checks`,
    shifts: shiftProfile(h.load, { emaWeeks: s.emaWeeks }),
  };
}

/** People per role for every shift of the week starting `weekStart` (default: the next Sunday). */
export async function forecastWeek(access, locationId, { weekStart, weeks } = {}) {
  assertLocation(access, locationId);
  const s = await settings();
  const w = Math.min(Number(weeks) || s.weeks, 26);
  const today = todayLocal();
  let start = weekStart || addDays(today, 1);
  while (new Date(start + 'T00:00:00Z').getUTCDay() !== 0) start = addDays(start, 1);
  const h = await history(locationId, w, s);
  const staff = await source.shiftStaff(locationId, h.from, h.to, { split: s.split, minHours: s.minHours });
  const aliases = await source.roleAliases();
  const isKitchen = (role) => s.kitchen.includes(role) || aliases.get(role) === 'cook';
  const prof = shiftProfile(h.load, { emaWeeks: s.emaWeeks });
  const ratios = staff.available ? learnRatios(h.load, staff.rows, { isKitchen, deliveryAsDiners: s.deliveryAsDiners, minWeekdayShifts: s.minWeekdayShifts }) : [];
  const dates = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const staffDays = new Set((staff.rows || []).map((r) => r.date)).size;
  return {
    period: { from: start, to: addDays(start, 6) },
    learnedFrom: { from: h.from, to: h.to, salesDays: Object.keys(h.load).length, staffDays },
    source: 'Beecomm checks + Allegro /shifts/by-shift (Tabit clock times)',
    method:
      `expected load = exponential moving average (EMA, span ${s.emaWeeks} weeks — recent weeks weigh more) of the same weekday and shift over the last ${w} weeks; people = load ÷ (diners per person of that role and shift, learned from the same weeks — from the same weekday ` +
      `when the role worked at least ${s.minWeekdayShifts} of them, else from all days), ` +
      `rounded to the nearest, at least 1; only roles that worked in at least ${Math.round(s.minPresence * 100)}% of those weekday shifts; kitchen roles count 1 delivery as ${s.deliveryAsDiners} diner(s)`,
    staffData: staff.available ? (staffDays ? 'ok' : 'none in the period') : staff.reason,
    ratios: ratios.map(({ role, shift, kitchen, perPerson, shifts, hoursPerPerson }) => ({ role, shift, kitchen, perPerson, shifts, hoursPerPerson })),
    shifts: forecastShifts(dates, prof, ratios, { deliveryAsDiners: s.deliveryAsDiners, minPresence: s.minPresence }),
  };
}

/**
 * Past shifts from `from` to `to` as they really were (Tabit clock times): per shift the diners and, per role,
 * the people, hours and diners per person, vs the people the learned ratio says were needed. The ratios are
 * learned from the `weeks` weeks ending at `to` (at least the period itself). Detail per shift only for
 * periods up to 14 days; longer periods give the summary and the shifts with the biggest differences.
 */
export async function actualStaffing(access, locationId, { from, to, role, weeks } = {}) {
  assertLocation(access, locationId);
  const s = await settings();
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  if (days > 92) throw err('BAD_REQUEST', 'the period is longer than 92 days');
  const w = Math.min(Math.max(Number(weeks) || s.weeks, Math.ceil(days / 7)), 26);
  const learnFrom = addDays(to, -7 * w + 1) < from ? addDays(to, -7 * w + 1) : from;
  const load = loadByShift(await source.checks(locationId, learnFrom, to), s.split);
  const staff = await source.shiftStaff(locationId, learnFrom, to, { split: s.split, minHours: s.minHours });
  const base = { period: { from, to }, source: 'Beecomm checks + Allegro /shifts/by-shift (Tabit clock times)' };
  if (!staff.available) return { ...base, staffData: staff.reason, shifts: [], summary: [] };
  const aliases = await source.roleAliases();
  const isKitchen = (r) => s.kitchen.includes(r) || aliases.get(r) === 'cook';
  const ratios = learnRatios(load, staff.rows, { isKitchen, deliveryAsDiners: s.deliveryAsDiners, minWeekdayShifts: s.minWeekdayShifts });
  const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
  const out = staffingActual(dates, load, staff.rows, ratios, { isKitchen, deliveryAsDiners: s.deliveryAsDiners });
  const pick = (r) => !role || r.role.includes(role);
  const shifts = out.shifts.map((x) => ({ ...x, roles: x.roles.filter(pick) })).filter((x) => x.roles.length);
  const big = shifts.flatMap((x) => x.roles.filter((r) => r.diff).map((r) => ({ date: x.date, weekday: x.weekday, shift: x.shift, diners: x.diners, deliveries: x.deliveries, ...r })));
  big.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  const missingSales = dates.filter((d) => !load[d]);
  const missingClock = dates.filter((d) => load[d] && !out.shifts.some((x) => x.date === d));
  return {
    ...base,
    learnedFrom: { from: learnFrom, to },
    method:
      `diners per person = the shift's diners (kitchen roles: + ${s.deliveryAsDiners} per delivery) ÷ the people of the role with at least ${s.minHours} h in the shift (morning < ${s.split} ≤ evening); ` +
      `needed = the same load ÷ the role's usual diners per person, learned from the clock times of ${learnFrom}..${to} (same weekday when the role worked at least ${s.minWeekdayShifts} of them); diff = people − needed`,
    staffData: staff.rows.length ? 'ok' : 'none in the period',
    missingDays: { sales: missingSales, clockTimes: missingClock },
    summary: out.summary.filter(pick),
    ...(days <= 14 ? { shifts } : {}),
    mostOver: big.filter((r) => r.diff > 0).slice(0, 10),
    mostUnder: big.filter((r) => r.diff < 0).slice(0, 10),
  };
}
