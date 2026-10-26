// How many people of each role a shift needs, learned from the branch's own past (no fixed numbers).
//
//   1. Shift profile: for every past date with sales, the load of each shift — diners of sit-down checks,
//      and delivery/takeaway checks. Morning = checks opened before `split`, evening = from `split`
//      (a check opened after midnight belongs to the evening of its business date). Per weekday × shift an
//      exponential moving average (EMA) over the weeks, oldest first, so recent weeks weigh more: "Sunday
//      morning 53 diners". Span N weeks → each week's weight is α = 2 / (N + 1), the older value keeps 1 − α.
//   2. Ratios: from the shifts that have both sales and clock data (Allegro /shifts/by-shift), per role
//      and shift: load ÷ people = "1 waiter per 37 diners". Kitchen roles count each delivery as
//      `deliveryAsDiners` diners; other roles count diners only. Only shifts where the role worked count.
//      Also per weekday when the role worked at least `minWeekdayShifts` of them: on a busy Friday each
//      person serves more diners than on a quiet Monday, so one all-week ratio over-staffs the peaks.
//   3. Forecast of a date + shift: the profile's load ÷ the ratio (of that weekday when learned), rounded to the nearest, at least 1.
//      Only roles that worked in at least `minPresence` of those weekday shifts: the ratio of a rare role
//      is learned from the few shifts it worked, so load ÷ ratio is about 1 on every shift — it would
//      add a person to every shift for a role that comes once a week.
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

/**
 * Load per weekday × shift over the dates that had sales: an EMA with a span of `emaWeeks` weeks (the
 * first date starts it), or the plain average when emaWeeks is not given.
 */
export function shiftProfile(load, { emaWeeks } = {}) {
  const alpha = emaWeeks ? 2 / (Number(emaWeeks) + 1) : null;
  const acc = {};
  for (const date of Object.keys(load).sort()) {
    const day = load[date];
    const wd = weekdayOf(date);
    for (const s of SHIFTS) {
      const a = (acc[`${wd}:${s}`] ||= { weekday: wd, shift: s, days: 0, diners: 0, deliveries: 0, open: 0 });
      a.days++;
      if (alpha == null) {
        a.diners += day[s].diners;
        a.deliveries += day[s].deliveries;
      } else if (a.days === 1) {
        a.diners = day[s].diners;
        a.deliveries = day[s].deliveries;
      } else {
        a.diners = alpha * day[s].diners + (1 - alpha) * a.diners;
        a.deliveries = alpha * day[s].deliveries + (1 - alpha) * a.deliveries;
      }
      if (day[s].checks) a.open++;
    }
  }
  const avg = (a, x) => r1(alpha == null ? x / a.days : x);
  return Object.values(acc)
    .map((a) => ({ weekday: a.weekday, shift: a.shift, days: a.days, openDays: a.open, diners: avg(a, a.diners), deliveries: avg(a, a.deliveries) }))
    .sort((x, y) => x.weekday - y.weekday || SHIFTS.indexOf(x.shift) - SHIFTS.indexOf(y.shift));
}

const loadFor = (slot, kitchen, deliveryAsDiners) => slot.diners + (kitchen ? slot.deliveries * deliveryAsDiners : 0);

/**
 * Learn per role and shift. staff: rows { date, shift, role, people, hours } (Allegro /shifts/by-shift).
 * Only dates with both sales and clock rows are used.
 * → [{ role, shift, kitchen, perPerson, perPersonWd: { [weekday]: ratio }, shifts, people, hoursPerPerson, presence: { [weekday]: share }, usual: { [weekday]: avg people } }]
 */
export function learnRatios(load, staff, { isKitchen = () => false, deliveryAsDiners = 1, minWeekdayShifts = 3 } = {}) {
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
    const loadWd = {};
    for (const [d, v] of m) {
      if (!v.people) continue;
      n++;
      people += v.people;
      hours += v.hours;
      loadSum += loadFor(load[d][shift], kitchen, deliveryAsDiners);
      const wd = weekdayOf(d);
      present[wd] = (present[wd] || 0) + 1;
      peopleWd[wd] = (peopleWd[wd] || 0) + v.people;
      loadWd[wd] = (loadWd[wd] || 0) + loadFor(load[d][shift], kitchen, deliveryAsDiners);
    }
    if (!n) continue;
    const presence = {};
    const usual = {};
    const perPersonWd = {};
    for (const wd of Object.keys(daysOfWeekday)) {
      presence[wd] = Math.round(((present[wd] || 0) / daysOfWeekday[wd]) * 100) / 100;
      usual[wd] = r1((peopleWd[wd] || 0) / daysOfWeekday[wd]);
      if ((present[wd] || 0) >= minWeekdayShifts && loadWd[wd] > 0) perPersonWd[wd] = r1(loadWd[wd] / peopleWd[wd]);
    }
    out.push({ role, shift, kitchen, perPerson: loadSum > 0 ? r1(loadSum / people) : null, perPersonWd, shifts: n, people, hoursPerPerson: r1(hours / people), presence, usual });
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
        const perPerson = r.perPersonWd?.[wd] ?? r.perPerson;
        if (!perPerson || presence < minPresence) continue;
        const load = p.diners + (r.kitchen ? p.deliveries * deliveryAsDiners : 0);
        const people = Math.max(1, Math.round(load / perPerson));
        roles.push({ role: r.role, people, load: r1(load), perPerson, usual: r.usual[wd] ?? null, presence });
      }
      out.push({ date, weekday: wd, shift, diners: p.diners, deliveries: p.deliveries, basedOnDays: p.days, roles, totalPeople: roles.reduce((a, x) => a + x.people, 0) });
    }
  }
  return out;
}

/**
 * Past shifts as they really were: per date and shift the load and, per role, the people and hours from the
 * clock times, the diners per person they served, and the people the learned ratio says were needed
 * (needed = load ÷ the role's diners per person of that weekday when learned, else of all days; diff =
 * people − needed, + = more people than usual for that load). Plus a summary per role and shift.
 * load / staff: as in learnRatios; ratios: learnRatios(); only dates in `dates` with sales and clock rows.
 */
export function staffingActual(dates, load, staff, ratios, { isKitchen = () => false, deliveryAsDiners = 1 } = {}) {
  const want = new Set(dates);
  const ratio = new Map(ratios.map((r) => [`${r.role}\u0000${r.shift}`, r]));
  const cell = new Map(); // date:shift → Map role → { people, hours }
  for (const r of staff) {
    if (!want.has(r.date) || !load[r.date] || !Number(r.people)) continue;
    const k = `${r.date}\u0000${r.shift}`;
    if (!cell.has(k)) cell.set(k, new Map());
    const m = cell.get(k);
    const prev = m.get(r.role) || { people: 0, hours: 0 };
    m.set(r.role, { people: prev.people + Number(r.people), hours: prev.hours + Number(r.hours || 0) });
  }
  const shifts = [];
  const sum = new Map(); // role:shift → totals
  for (const date of [...want].sort()) {
    const wd = weekdayOf(date);
    for (const shift of SHIFTS) {
      const m = cell.get(`${date}\u0000${shift}`);
      if (!m) continue;
      const slot = load[date][shift];
      const roles = [];
      for (const [role, v] of m) {
        const kitchen = !!isKitchen(role);
        const l = loadFor(slot, kitchen, deliveryAsDiners);
        const sk = `${role}\u0000${shift}`;
        const learned = ratio.get(sk);
        const usualPerPerson = learned ? learned.perPersonWd?.[wd] ?? learned.perPerson : null;
        const needed = usualPerPerson ? Math.max(1, Math.round(l / usualPerPerson)) : null;
        roles.push({ role, people: v.people, hours: r1(v.hours), load: r1(l), perPerson: r1(l / v.people), usualPerPerson, needed, diff: needed == null ? null : v.people - needed });
        if (!sum.has(sk)) sum.set(sk, { role, shift, kitchen, shifts: 0, people: 0, hours: 0, load: 0, over: 0, under: 0, min: null, max: null });
        const s = sum.get(sk);
        const pp = l / v.people;
        s.shifts++;
        s.people += v.people;
        s.hours += v.hours;
        s.load += l;
        if (needed != null && v.people > needed) s.over++;
        if (needed != null && v.people < needed) s.under++;
        s.min = s.min == null ? pp : Math.min(s.min, pp);
        s.max = s.max == null ? pp : Math.max(s.max, pp);
      }
      roles.sort((a, b) => b.people - a.people);
      shifts.push({ date, weekday: wd, shift, diners: slot.diners, deliveries: slot.deliveries, roles, allRolesPeople: roles.reduce((a, x) => a + x.people, 0), allRolesHours: r1(roles.reduce((a, x) => a + x.hours, 0)) });
    }
  }
  const summary = [...sum.values()]
    .map((s) => ({
      role: s.role,
      shift: s.shift,
      kitchen: s.kitchen,
      shifts: s.shifts,
      avgPeople: r1(s.people / s.shifts),
      perPerson: s.load > 0 ? r1(s.load / s.people) : null,
      minPerPerson: r1(s.min),
      maxPerPerson: r1(s.max),
      hoursPerPerson: r1(s.hours / s.people),
      shiftsOver: s.over,
      shiftsUnder: s.under,
    }))
    .sort((a, b) => SHIFTS.indexOf(a.shift) - SHIFTS.indexOf(b.shift) || b.avgPeople * b.shifts - a.avgPeople * a.shifts);
  return { shifts, summary };
}
