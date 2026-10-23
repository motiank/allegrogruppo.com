// How many people of each role a shift needs, learned from the branch's own past (no fixed numbers).
//
//   1. Shift profile: for every past date with sales, the load of each shift — diners of sit-down checks,
//      and delivery/takeaway checks. Morning = checks opened before `split`, evening = from `split`
//      (a check opened after midnight belongs to the evening of its business date). Averaged per
//      weekday × shift: "Sunday morning 53 diners".
//   2. Ratios: from the shifts that have both sales and clock data (Allegro /shifts/by-shift), per role
//      and shift: load ÷ people = "1 waiter per 37 diners". Kitchen roles count each delivery as
//      `deliveryAsDiners` diners; other roles count diners only. Only shifts where the role worked count.
//   3. Forecast of a date + shift: the profile's average load ÷ the ratio, rounded to the nearest; a role
//      that worked in at least `minPresence` of those weekday shifts gets at least 1.
// Pure functions; src/services/shiftModel.js loads the data.

export const SHIFTS = ['morning', 'evening'];
const weekdayOf = (d) => new Date(d + 'T00:00:00Z').getUTCDay();
const r1 = (x) => Math.round(x * 10) / 10;

/** 'morning' | 'evening' of a check, from its open time and business date. */
export function shiftOfCheck(openedAt, businessDate, split = '17:00') {
  const s = String(openedAt || '');
  if (s.slice(0, 10) > businessDate) return 'evening';
  return s.slice(11, 16) < split ? 'morning' : 'evening';
}

/**
 * Checks → load per date and shift: { [date]: { morning: { diners, deliveries, checks }, evening: … } }.
 * A sit-down check is order type 1; every other type (delivery, takeaway, not identified) is a delivery.
 */
export function loadByShift(checks, split = '17:00') {
  const out = {};
  for (const c of checks) {
    const d = c.business_date;
    const day = (out[d] ||= Object.fromEntries(SHIFTS.map((s) => [s, { diners: 0, deliveries: 0, checks: 0 }])));
    const slot = day[shiftOfCheck(c.opened_at, d, split)];
    slot.checks++;
    if (Number(c.order_type) === 1) slot.diners += Number(c.diners) || 0;
    else slot.deliveries++;
  }
  return out;
}

/** Average load per weekday × shift over the dates that had sales. */
export function shiftProfile(load) {
  const acc = {};
  for (const [date, day] of Object.entries(load)) {
    const wd = weekdayOf(date);
    for (const s of SHIFTS) {
      const a = (acc[`${wd}:${s}`] ||= { weekday: wd, shift: s, days: 0, diners: 0, deliveries: 0, open: 0 });
      a.days++;
      a.diners += day[s].diners;
      a.deliveries += day[s].deliveries;
      if (day[s].checks) a.open++;
    }
  }
  return Object.values(acc)
    .map((a) => ({ weekday: a.weekday, shift: a.shift, days: a.days, openDays: a.open, diners: r1(a.diners / a.days), deliveries: r1(a.deliveries / a.days) }))
    .sort((x, y) => x.weekday - y.weekday || SHIFTS.indexOf(x.shift) - SHIFTS.indexOf(y.shift));
}

const loadFor = (slot, kitchen, deliveryAsDiners) => slot.diners + (kitchen ? slot.deliveries * deliveryAsDiners : 0);

/**
 * Learn per role and shift. staff: rows { date, shift, role, people, hours } (Allegro /shifts/by-shift).
 * Only dates with both sales and clock rows are used.
 * → [{ role, shift, kitchen, perPerson, shifts, people, hoursPerPerson, presence: { [weekday]: share }, usual: { [weekday]: avg people } }]
 */
export function learnRatios(load, staff, { isKitchen = () => false, deliveryAsDiners = 1 } = {}) {
  const staffDates = new Set(staff.map((r) => r.date));
  const dates = Object.keys(load).filter((d) => staffDates.has(d));
  const by = new Map(); // role:shift → rows by date
  for (const r of staff) {
    if (!load[r.date]) continue;
    const k = `${r.role}\u0000${r.shift}`;
    if (!by.has(k)) by.set(k, new Map());
    const m = by.get(k);
    const prev = m.get(r.date) || { people: 0, hours: 0 };
    m.set(r.date, { people: prev.people + Number(r.people || 0), hours: prev.hours + Number(r.hours || 0) });
  }
  // how many dates of each weekday had clock data (the base of presence)
  const daysOfWeekday = {};
  for (const d of dates) daysOfWeekday[weekdayOf(d)] = (daysOfWeekday[weekdayOf(d)] || 0) + 1;
  const out = [];
  for (const [k, m] of by) {
    const [role, shift] = k.split('\u0000');
    const kitchen = !!isKitchen(role);
    let people = 0;
    let hours = 0;
    let loadSum = 0;
    let n = 0;
    const present = {};
    const peopleWd = {};
    for (const [d, v] of m) {
      if (!v.people) continue;
      n++;
      people += v.people;
      hours += v.hours;
      loadSum += loadFor(load[d][shift], kitchen, deliveryAsDiners);
      const wd = weekdayOf(d);
      present[wd] = (present[wd] || 0) + 1;
      peopleWd[wd] = (peopleWd[wd] || 0) + v.people;
    }
    if (!n) continue;
    const presence = {};
    const usual = {};
    for (const wd of Object.keys(daysOfWeekday)) {
      presence[wd] = Math.round(((present[wd] || 0) / daysOfWeekday[wd]) * 100) / 100;
      usual[wd] = r1((peopleWd[wd] || 0) / daysOfWeekday[wd]);
    }
    out.push({ role, shift, kitchen, perPerson: loadSum > 0 ? r1(loadSum / people) : null, shifts: n, people, hoursPerPerson: r1(hours / people), presence, usual });
  }
  return out.sort((a, b) => SHIFTS.indexOf(a.shift) - SHIFTS.indexOf(b.shift) || b.people - a.people);
}

/**
 * The forecast of the given dates: per date and shift the expected load (the profile average) and per
 * role the people needed. A shift with no sales on that weekday in the history is left out (closed).
 */
export function forecastShifts(dates, profile, ratios, { deliveryAsDiners = 1, minPresence = 0.5 } = {}) {
  const prof = new Map(profile.map((p) => [`${p.weekday}:${p.shift}`, p]));
  const out = [];
  for (const date of dates) {
    const wd = weekdayOf(date);
    for (const shift of SHIFTS) {
      const p = prof.get(`${wd}:${shift}`);
      if (!p || !p.openDays) continue;
      const roles = [];
      for (const r of ratios.filter((x) => x.shift === shift)) {
        const presence = r.presence[wd] ?? 0;
        if (!r.perPerson || presence === 0) continue;
        const load = p.diners + (r.kitchen ? p.deliveries * deliveryAsDiners : 0);
        let people = Math.round(load / r.perPerson);
        if (presence >= minPresence) people = Math.max(1, people);
        if (!people) continue;
        roles.push({ role: r.role, people, load: r1(load), perPerson: r.perPerson, usual: r.usual[wd] ?? null, presence });
      }
      out.push({ date, weekday: wd, shift, diners: p.diners, deliveries: p.deliveries, basedOnDays: p.days, roles, totalPeople: roles.reduce((a, x) => a + x.people, 0) });
    }
  }
  return out;
}
