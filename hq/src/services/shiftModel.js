// The shift profile and the people needed per role in next week's shifts, learned from the last
// `profileWeeks` weeks of the branch (src/lib/shiftModel.js has the method). Sales: Beecomm checks;
// staff: Allegro /shifts/by-shift (from the Tabit clock times). Nothing is stored.
import { getSettings, todayLocal } from '../db.js';
import { addDays } from '../lib/recommend.js';
import { loadByShift, shiftProfile, learnRatios, forecastShifts } from '../lib/shiftModel.js';
import { assertLocation } from '../access.js';
import * as source from './source.js';

// roles whose load includes deliveries (Allegro role names; a role mapped to the Joya role 'cook' is one too)
const KITCHEN = ['טבח', 'פס קר', 'פס חם', 'מחבתות', 'טאבון', 'הכנות', 'קונדיטור'];

async function settings() {
  const st = await getSettings('staffing');
  return {
    weeks: st.profileWeeks || 13,
    split: st.shiftSplit || '17:00',
    deliveryAsDiners: st.deliveryAsDiners ?? 1,
    minPresence: st.minPresence ?? 0.5,
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
    method: `average per weekday and shift over the dates with sales; morning = checks opened before ${s.split}, evening = from ${s.split}; diners = sit-down checks, deliveries = all other checks`,
    shifts: shiftProfile(h.load),
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
  const prof = shiftProfile(h.load);
  const ratios = staff.available ? learnRatios(h.load, staff.rows, { isKitchen, deliveryAsDiners: s.deliveryAsDiners }) : [];
  const dates = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const staffDays = new Set((staff.rows || []).map((r) => r.date)).size;
  return {
    period: { from: start, to: addDays(start, 6) },
    learnedFrom: { from: h.from, to: h.to, salesDays: Object.keys(h.load).length, staffDays },
    source: 'Beecomm checks + Allegro /shifts/by-shift (Tabit clock times)',
    method:
      `expected load = average of the same weekday and shift over the last ${w} weeks; people = load ÷ (diners per person of that role and shift, learned from the same weeks), ` +
      `rounded to the nearest; a role that worked in at least ${Math.round(s.minPresence * 100)}% of those shifts gets at least 1; kitchen roles count 1 delivery as ${s.deliveryAsDiners} diner(s)`,
    staffData: staff.available ? (staffDays ? 'ok' : 'none in the period') : staff.reason,
    ratios: ratios.map(({ role, shift, kitchen, perPerson, shifts, hoursPerPerson }) => ({ role, shift, kitchen, perPerson, shifts, hoursPerPerson })),
    shifts: forecastShifts(dates, prof, ratios, { deliveryAsDiners: s.deliveryAsDiners, minPresence: s.minPresence }),
  };
}
