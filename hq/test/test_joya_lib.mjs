// Unit tests for the pure Joya logic (no DB). Run: node test/test_joya_lib.mjs
import assert from 'assert/strict';
import { parseCsv, toCsv } from '../src/lib/csv.js';
import { applyMapping, parseNumber, parseDate, parseDateTime, suggestMapping } from '../src/lib/fields.js';
import { shiftDemand, forecastUnit } from '../src/lib/demand.js';
import { computeSlot, learnedAdjustments, validateRule } from '../src/lib/staffingRules.js';
import { recommend, convert } from '../src/lib/recommend.js';
import { splitAnswer, cellNumber, fillTotals, floorMoney } from '../lib/answerTables.js';
import { shiftOfCheck, loadByShift, shiftProfile, learnRatios, forecastShifts, staffingActual } from '../src/lib/shiftModel.js';
import { addRow, blankSums, vatLine, isHever, isHakafa } from '../src/lib/vatRules.js';
import { tabsOf, flattenRow, cleanName, cellDate } from '../src/lib/sheetTabs.js';

let n = 0;
const t = (name, fn) => {
  try {
    fn();
    n++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}\n${e.stack}`);
    process.exitCode = 1;
  }
};

console.log('csv + fields');
t('parses BOM, quotes, semicolons, Hebrew headers', () => {
  const { headers, rows } = parseCsv('﻿מספר חשבון;תאריך;סכום\n"A;1";01/10/2026;"1,234.50"\nB2;02/10/2026;\n');
  assert.deepEqual(headers, ['מספר חשבון', 'תאריך', 'סכום']);
  assert.equal(rows[0]['מספר חשבון'], 'A;1');
  assert.equal(rows[1]['סכום'], '');
});
t('numbers: thousands, decimal comma, empty = null (never 0)', () => {
  assert.equal(parseNumber('1,234.50'), 1234.5);
  assert.equal(parseNumber('12,5'), 12.5);
  assert.equal(parseNumber('1,234'), 1234);
  assert.equal(parseNumber('₪ 99'), 99);
  assert.equal(parseNumber(''), null);
  assert.ok(Number.isNaN(parseNumber('abc')));
});
t('dates: Israeli day/month by default, ISO always', () => {
  assert.equal(parseDate('03/10/2026'), '2026-10-03');
  assert.equal(parseDate('2026-10-03'), '2026-10-03');
  assert.equal(parseDate('10/03/2026', 'MDY'), '2026-10-03');
  assert.ok(Number.isNaN(parseDate('31/02/2026')));
  assert.equal(parseDateTime('03/10/2026 12:05'), '2026-10-03 12:05:00');
});
t('mapping rejects bad rows with a reason; missing diners stay null', () => {
  const rows = [
    { c: 'X1', o: '01/10/2026 12:00', d: '' },
    { c: 'X2', o: 'nonsense', d: '2' },
    { c: '', o: '01/10/2026 13:00', d: '2' },
  ];
  const { records, rejected } = applyMapping('SALES_CHECKS', rows, { check_id: 'c', opened_at: 'o', diners: 'd' });
  assert.equal(records.length, 1);
  assert.equal(records[0].diners, null);
  assert.equal(records[0].business_date, '2026-10-01');
  assert.equal(rejected.length, 2);
});
t('mapping suggestion uses Hebrew synonyms', () => {
  const m = suggestMapping('SALES_ITEMS', ['תאריך', 'קוד פריט', 'כמות', 'סכום']);
  assert.equal(m.business_date, 'תאריך');
  assert.equal(m.item_code, 'קוד פריט');
  assert.equal(m.qty, 'כמות');
});
t('CSV export has a BOM and quotes commas', () => {
  const s = toCsv(['a', 'b'], [['x,y', 1]]);
  assert.ok(s.startsWith('﻿'));
  assert.ok(s.includes('"x,y",1'));
});

console.log('demand');
const morning = { start_time: '08:00:00', end_time: '16:00:00' };
const checks = [
  { opened_at: '2026-10-01 08:10:00', closed_at: '2026-10-01 09:00:00', diners: 2 },
  { opened_at: '2026-10-01 12:05:00', closed_at: '2026-10-01 13:00:00', diners: 4 },
  { opened_at: '2026-10-01 12:30:00', closed_at: '2026-10-01 13:30:00', diners: 3 },
  { opened_at: '2026-10-01 17:00:00', closed_at: '2026-10-01 18:00:00', diners: 9 }, // evening, not in the window
];
t('shift demand units are explicit and exact', () => {
  const d = shiftDemand(checks, morning, '2026-10-01');
  assert.equal(d.values.ORDERS_PER_SHIFT, 3);
  assert.equal(d.values.DINERS_PER_SHIFT, 9);
  assert.equal(d.values.DINERS_PEAK_HOUR, 7);
  assert.equal(d.values.ORDERS_PEAK_HOUR, 2);
  assert.equal(d.values.CONCURRENT_DINERS_PEAK, 7);
});
t('too many missing diner counts → diner units unknown (null), orders still counted', () => {
  const d = shiftDemand([{ opened_at: '2026-10-01 09:00:00', diners: null }, { opened_at: '2026-10-01 10:00:00', diners: 2 }], morning, '2026-10-01');
  assert.equal(d.values.DINERS_PER_SHIFT, null);
  assert.equal(d.values.ORDERS_PER_SHIFT, 2);
  assert.equal(d.missingDiners, 1);
});
t('forecast = median of days WITH data; missing days are listed, not zero', () => {
  const h = [10, null, 30, 20].map((v, i) => ({ date: `2026-09-${10 + i}`, hasData: v != null, demand: v == null ? null : { values: { DINERS_PER_SHIFT: v } } }));
  const f = forecastUnit(h, 'DINERS_PER_SHIFT', 3);
  assert.equal(f.value, 20);
  assert.equal(f.n, 3);
  assert.deepEqual(f.missingDates, ['2026-09-11']);
  assert.equal(forecastUnit([{ date: 'x', hasData: false }], 'DINERS_PER_SHIFT', 3).value, null);
});

console.log('staffing rules');
const rules = [
  { id: 1, locationId: null, shiftCode: null, days: null, roleCode: 'waiter', type: 'RATIO', unit: 'DINERS_PER_SHIFT', params: { per: 40 }, active: true },
  { id: 2, locationId: null, shiftCode: null, days: null, roleCode: 'waiter', type: 'MIN', params: { count: 2 }, mandatory: true, active: true },
  { id: 3, locationId: 1, shiftCode: 'morning', days: null, roleCode: 'checker', type: 'FIXED', params: { count: 1 }, mandatory: true, active: true },
  { id: 4, locationId: 1, shiftCode: 'morning', days: null, roleCode: 'barista', type: 'FIXED', params: { count: 1 }, mandatory: true, active: true },
  { id: 5, locationId: null, shiftCode: null, days: null, roleCode: 'cook', type: 'STEPS', unit: 'ORDERS_PEAK_HOUR', params: { steps: [{ above: 0, count: 2 }, { above: 15, count: 3 }, { above: 30, count: 4 }] }, active: true },
  { id: 6, locationId: null, shiftCode: null, days: null, roleCode: 'runner', type: 'RATIO', unit: 'DINERS_PEAK_HOUR', params: { per: 30 }, active: true },
  { id: 7, locationId: null, shiftCode: null, days: null, roleCode: 'runner', type: 'STEPS', unit: 'DINERS_PEAK_HOUR', params: { steps: [{ above: 50, count: 2 }] }, active: true },
  { id: 8, locationId: null, shiftCode: null, days: null, roleCode: 'waiter', type: 'PEAK_EXTRA', unit: 'DINERS_PEAK_HOUR', params: { above: 45, count: 1, start: '12:00', end: '15:00' }, active: true },
  { id: 9, locationId: 1, shiftCode: null, days: [4], roleCode: 'waiter', type: 'RATIO', unit: 'DINERS_PER_SHIFT', params: { per: 50 }, active: true },
];
const slot = { locationId: 1, shiftCode: 'morning', weekday: 4, start: '08:00:00', end: '16:00:00' };
const demand = { DINERS_PER_SHIFT: { value: 142, n: 8 }, DINERS_PEAK_HOUR: { value: 52, n: 8 }, ORDERS_PEAK_HOUR: { value: 18, n: 8 } };
t('predictable: Thursday morning example', () => {
  const { lines } = computeSlot(rules, slot, demand, ['cook', 'checker', 'barista', 'runner', 'waiter']);
  const by = (r, peak = false) => lines.find((l) => l.roleCode === r && l.isPeakExtra === peak);
  assert.equal(by('cook').headcount, 3); // 18 > 15
  assert.equal(by('checker').headcount, 1);
  assert.equal(by('barista').headcount, 1);
  assert.equal(by('runner').headcount, 2); // max(ceil(52/30)=2, steps 52>50 → 2)
  assert.equal(by('waiter').headcount, 3); // the location+Thursday rule (per 50) wins: ceil(142/50) = 3
  assert.deepEqual(by('waiter').explain.rules.map((r) => r.id).sort(), [2, 9]);
  assert.equal(by('waiter', true).headcount, 1); // 52 > 45 → +1 waiter 12:00–15:00
  assert.equal(by('waiter', true).start, '12:00:00');
  assert.equal(by('checker').minRequired, 1);
  // same input, same output
  assert.deepEqual(computeSlot(rules, slot, demand).lines, computeSlot(rules, slot, demand).lines);
});
t('unknown demand → minimum only, never 0 staff; no rule → cannot compute', () => {
  const { lines, warnings } = computeSlot(rules, { ...slot, weekday: 1 }, {});
  assert.equal(lines.find((l) => l.roleCode === 'waiter').headcount, 2);
  assert.ok(lines.find((l) => l.roleCode === 'waiter').explain.notes.some((x) => x.code === 'MIN_ONLY_DEMAND_UNKNOWN'));
  assert.ok(warnings.some((w) => w.code === 'CANNOT_COMPUTE' && w.role === 'cook'));
  assert.ok(!lines.some((l) => l.roleCode === 'cook'));
});
t('rule validation', () => {
  assert.equal(validateRule({ role_code: 'cook', rule_type: 'RATIO', params: { per: 0 }, demand_unit: 'ORDERS_PER_SHIFT' }), 'params.per must be > 0');
  assert.equal(validateRule({ role_code: 'cook', rule_type: 'STEPS', params: { steps: [{ above: 10, count: 2 }] } }), 'this rule type needs a demand unit');
  assert.equal(validateRule({ role_code: 'cook', rule_type: 'FIXED', params: { count: 2 } }), null);
});
t('learned adjustments need repeated, same-direction edits', () => {
  const plans = [1, 2, 3, 4].map((i) => ({ planId: i, weekStart: `2026-09-0${i}`, diffs: [{ weekday: 5, shiftCode: 'evening', roleCode: 'waiter', delta: i === 2 ? 0 : 1 }, { weekday: 1, shiftCode: 'morning', roleCode: 'cook', delta: i % 2 ? 1 : -1 }] }));
  const adj = learnedAdjustments(plans, { minPlans: 3, window: 4 });
  assert.equal(adj['5|evening|waiter'].delta, 1);
  assert.equal(adj['5|evening|waiter'].seen, 3);
  assert.equal(adj['1|morning|cook'], undefined);
});

console.log('replenishment recommender');
const ING = [
  { id: 1, name: 'Tomatoes', unit: 'kg' },
  { id: 2, name: 'Milk', unit: 'l' },
  { id: 3, name: 'Basil', unit: 'unit' },
  { id: 4, name: 'Napkins', unit: 'box' },
];
// sales: dish linked to tomatoes sells 20/day; milk dishes 10/day; complete data
const linked = { 1: 20, 2: 10 };
const linkedSales = (ing, from, to) => {
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 864e5);
  if (!linked[ing]) return { units: null, dishes: 0, days, daysMissing: 0 };
  return { units: linked[ing] * days, dishes: 1, days, daysMissing: 0 };
};
const list = (listId, date, lines, status = 'ORDERED', recommended = null) => ({ listId, date, status, lines, recommended });
const examples = [
  list(5, '2026-10-08', [{ ingredientId: 1, qty: 10 }, { ingredientId: 2, qty: 6 }, { ingredientId: 4, qty: 1 }], 'ORDERED', [1, 2, 3]),
  list(4, '2026-10-04', [{ ingredientId: 1, qty: 8 }, { ingredientId: 2, qty: 6 }], 'ORDERED', [1, 2, 3]),
  list(3, '2026-10-01', [{ ingredientId: 1, qty: 6 }, { ingredientId: 2, qty: 5 }], 'ORDERED', [1, 2, 3]),
  list(2, '2026-09-28', [{ ingredientId: 1, qty: 8 }, { ingredientId: 2, qty: 6 }, { ingredientId: 3, qty: 5 }], 'ORDERED'),
  list(1, '2026-09-24', [{ ingredientId: 1, qty: 8 }, { ingredientId: 2, qty: 6 }]),
];
const S = { minExamplesForRatio: 3, minExamplesForQty: 2 };
t('final lists drive the quantity, with the numbers behind it', () => {
  const res = recommend({ asOf: '2026-10-12', ingredients: ING, examples, linkedSales, shortages: {}, settings: S });
  const tom = res.lines.find((l) => l.ingredientId === 1);
  assert.equal(tom.method, 'SALES_RATIO');
  assert.equal(tom.section, 'SUGGESTED');
  // ratios = qty / (20 × days since the previous order): 10/80=.125, 8/60=.133, 6/60=.1, 8/80=.1;
  // recency weights 1, .84, .71, .59 → weighted median .125 → .125 × (20 × 4 days since 10-08) = 10
  assert.equal(tom.basis.pattern.ratio, 0.125);
  assert.equal(tom.qty, 10);
  assert.equal(tom.basis.ratios.length, 4);
  assert.ok(tom.basis.calc[0].includes('×'));
  assert.equal(tom.basis.examples[0].listId, 5);
});
t('history changes the next recommendation (manager raised quantities)', () => {
  const raised = examples.map((e) => ({ ...e, lines: e.lines.map((l) => (l.ingredientId === 1 ? { ...l, qty: l.qty * 2 } : l)) }));
  const a = recommend({ asOf: '2026-10-12', ingredients: ING, examples, linkedSales, settings: S }).lines.find((l) => l.ingredientId === 1).qty;
  const b = recommend({ asOf: '2026-10-12', ingredients: ING, examples: raised, linkedSales, settings: S }).lines.find((l) => l.ingredientId === 1).qty;
  assert.equal(b, a * 2);
});
t('no supported quantity → line kept for the manager with qty null (nothing invented)', () => {
  const res = recommend({ asOf: '2026-10-12', ingredients: ING, examples, linkedSales, settings: S });
  const napkins = res.lines.find((l) => l.ingredientId === 4); // ordered once
  assert.equal(napkins.section, 'CHECK');
  assert.equal(napkins.qty, null);
  assert.equal(napkins.method, 'NONE');
  assert.ok(napkins.basis.reasons.some((r) => r.code === 'ORDERED_ONCE'));
});
t('an item the manager keeps removing moves to CHECK with the reason', () => {
  // basil: suggested in lists 3,4,5 and removed every time; last ordered 09-28
  const res = recommend({ asOf: '2026-10-12', ingredients: ING, examples, linkedSales, settings: S });
  const basil = res.lines.find((l) => l.ingredientId === 3);
  assert.equal(basil.section, 'CHECK');
  const p = res.patterns.find((x) => x.ingredientId === 3);
  assert.equal(p.removedCount, 3);
});
t('shortage report: included, quantity raised by the visible setting', () => {
  const res = recommend({ asOf: '2026-10-09', ingredients: ING, examples, linkedSales, shortages: { 2: ['2026-10-09'] }, settings: { ...S, shortageBumpPct: 50 } });
  const milk = res.lines.find((l) => l.ingredientId === 2);
  assert.equal(milk.section, 'SUGGESTED');
  assert.ok(milk.basis.reasons.some((r) => r.code === 'SHORTAGE'));
  assert.ok(milk.basis.calc.some((c) => c.includes('+50%')));
});
t('incomplete sales window → falls back to history median and says why', () => {
  const gappy = (ing, from, to) => ({ ...linkedSales(ing, from, to), daysMissing: to === '2026-10-12' ? 2 : 0 });
  const tom = recommend({ asOf: '2026-10-12', ingredients: ING, examples, linkedSales: gappy, settings: S }).lines.find((l) => l.ingredientId === 1);
  assert.equal(tom.method, 'HISTORY_MEDIAN');
  assert.ok(tom.basis.notes.some((x) => x.code === 'SALES_WINDOW_INCOMPLETE'));
});
t('approved-only lists weigh less than ordered ones', () => {
  const ex = [list(2, '2026-10-08', [{ ingredientId: 4, qty: 10 }], 'APPROVED'), list(1, '2026-10-01', [{ ingredientId: 4, qty: 2 }], 'ORDERED')];
  const res = recommend({ asOf: '2026-10-12', ingredients: ING, examples: ex, linkedSales, settings: { ...S, halfLifeLists: 100 } });
  assert.equal(res.patterns.find((p) => p.ingredientId === 4).weightedMedianQty, 2);
});
t('unit conversion for recipe estimates', () => {
  assert.equal(convert(250, 'g', 'kg'), 0.25);
  assert.equal(convert(1, 'kg', 'l'), null);
});

console.log('shift model (learned staffing)');
// two Sundays: morning 40 diners + 10 deliveries, evening 80 diners
const smChecks = [];
for (const d of ['2026-09-06', '2026-09-13']) {
  for (let i = 0; i < 10; i++) smChecks.push({ business_date: d, opened_at: `${d} 12:00:00`, order_type: 1, diners: 4 });
  for (let i = 0; i < 10; i++) smChecks.push({ business_date: d, opened_at: `${d} 13:00:00`, order_type: 2, diners: 0 });
  for (let i = 0; i < 16; i++) smChecks.push({ business_date: d, opened_at: `${d} 19:00:00`, order_type: 1, diners: 5 });
}
smChecks.push({ business_date: '2026-09-13', opened_at: '2026-09-14 00:30:00', order_type: 1, diners: 0 });
t('a check is morning before the split, evening from it and after midnight', () => {
  assert.equal(shiftOfCheck('2026-09-06 16:59:00', '2026-09-06'), 'morning');
  assert.equal(shiftOfCheck('2026-09-06 17:00:00', '2026-09-06'), 'evening');
  assert.equal(shiftOfCheck('2026-09-07 00:30:00', '2026-09-06'), 'evening');
  assert.equal(shiftOfCheck('2026-09-06 16:30:00', '2026-09-06', '16:00'), 'evening');
});
t('profile: average diners and deliveries per weekday and shift', () => {
  const p = shiftProfile(loadByShift(smChecks));
  assert.deepEqual(p.map((x) => [x.weekday, x.shift, x.diners, x.deliveries, x.days]), [[0, 'morning', 40, 10, 2], [0, 'evening', 80, 0, 2]]);
});
t('profile: an EMA puts more weight on recent weeks (dates in any order)', () => {
  const day = (diners, deliveries) => ({ morning: { diners, deliveries, checks: 1 }, evening: { diners: 0, deliveries: 0, checks: 0 } });
  const load = { '2026-09-20': day(40, 4), '2026-09-06': day(10, 0), '2026-09-13': day(20, 2) };
  // span 3 weeks → α = 0.5: 10 → 0.5·20 + 0.5·10 = 15 → 0.5·40 + 0.5·15 = 27.5
  const mo = shiftProfile(load, { emaWeeks: 3 }).find((x) => x.shift === 'morning');
  assert.deepEqual([mo.diners, mo.deliveries, mo.days, mo.openDays], [27.5, 2.5, 3, 3]); // deliveries 0 → 1 → 2.5
  assert.equal(shiftProfile(load).find((x) => x.shift === 'morning').diners, 23.3); // the plain average
});
t('ratios: diners per person per role; kitchen counts deliveries; forecast rounds to the nearest', () => {
  const load = loadByShift(smChecks);
  const staff = [];
  for (const d of ['2026-09-06', '2026-09-13']) {
    staff.push({ date: d, shift: 'morning', role: 'מלצר', people: 1, hours: 6 }, { date: d, shift: 'evening', role: 'מלצר', people: 2, hours: 12 });
    staff.push({ date: d, shift: 'morning', role: 'פס קר', people: 1, hours: 7 });
  }
  const r = learnRatios(load, staff, { isKitchen: (x) => x === 'פס קר' });
  const of = (role, shift) => r.find((x) => x.role === role && x.shift === shift);
  assert.equal(of('מלצר', 'morning').perPerson, 40);
  assert.equal(of('מלצר', 'evening').perPerson, 40);
  assert.equal(of('פס קר', 'morning').perPerson, 50); // 40 diners + 10 deliveries
  assert.equal(of('מלצר', 'morning').hoursPerPerson, 6);
  // a busier profile: 100 diners in the evening → 100 / 40 = 2.5 → 3 waiters
  const prof = [{ weekday: 0, shift: 'morning', days: 2, openDays: 2, diners: 30, deliveries: 0 }, { weekday: 0, shift: 'evening', days: 2, openDays: 2, diners: 100, deliveries: 0 }];
  const f = forecastShifts(['2026-10-25'], prof, r);
  const ev = f.find((x) => x.shift === 'evening');
  assert.equal(ev.roles.find((x) => x.role === 'מלצר').people, 3);
  // morning: 30 / 40 = 0.75 → 1 waiter; 30 / 50 = 0.6 → 1 cook (present every Sunday anyway)
  const mo = f.find((x) => x.shift === 'morning');
  assert.deepEqual(mo.roles.map((x) => [x.role, x.people]), [['מלצר', 1], ['פס קר', 1]]);
});
t('ratios: a shift without clock data is not used; a rare role gets no minimum of 1', () => {
  const load = loadByShift(smChecks);
  const staff = [
    { date: '2026-09-06', shift: 'evening', role: 'ראנר', people: 1, hours: 4 },
    { date: '2026-09-06', shift: 'evening', role: 'מלצר', people: 2, hours: 12 },
    { date: '2026-09-13', shift: 'evening', role: 'מלצר', people: 2, hours: 12 },
  ];
  const r = learnRatios(load, staff);
  const runner = r.find((x) => x.role === 'ראנר');
  assert.equal(runner.presence[0], 0.5);
  const prof = [{ weekday: 0, shift: 'evening', days: 2, openDays: 2, diners: 20, deliveries: 0 }];
  const ev = forecastShifts(['2026-10-25'], prof, r, { minPresence: 0.6 })[0];
  assert.equal(ev.roles.find((x) => x.role === 'ראנר'), undefined); // 20 / 80 rounds to 0 and it is rare
  assert.equal(ev.roles.find((x) => x.role === 'מלצר').people, 1); // 20 / 40 = 0.5 → 1
  // a busy shift: 60 / 80 rounds to 1, but the runner worked only half of the Sundays → still not needed
  const busy = forecastShifts(['2026-10-25'], [{ ...prof[0], diners: 60 }], r, { minPresence: 0.6 })[0];
  assert.equal(busy.roles.find((x) => x.role === 'ראנר'), undefined);
  assert.equal(busy.roles.find((x) => x.role === 'מלצר').people, 2); // 60 / 40 = 1.5 → 2
});

t('ratios: learned per weekday when the role worked enough of them (a busy Friday is not a quiet Monday)', () => {
  // 3 Mondays: 20 diners, 1 waiter; 3 Fridays: 120 diners, 3 waiters (40 each); 2 Tuesdays: 30 diners, 1 waiter
  const load = {};
  const staff = [];
  const add = (date, diners, people) => {
    load[date] = { morning: { diners: 0, deliveries: 0, checks: 0 }, evening: { diners, deliveries: 0, checks: 1 } };
    staff.push({ date, shift: 'evening', role: 'מלצר', people, hours: 6 * people });
  };
  ['2026-09-07', '2026-09-14', '2026-09-21'].forEach((d) => add(d, 20, 1));
  ['2026-09-11', '2026-09-18', '2026-09-25'].forEach((d) => add(d, 120, 3));
  ['2026-09-08', '2026-09-15'].forEach((d) => add(d, 30, 1));
  const r = learnRatios(load, staff);
  const w = r.find((x) => x.role === 'מלצר');
  assert.equal(w.perPerson, 34.3); // all days: 480 diners / 14 people
  assert.deepEqual(w.perPersonWd, { 1: 20, 5: 40 }); // Tuesday: only 2 shifts → no own ratio
  const prof = [1, 2, 5].map((wd, i) => ({ weekday: wd, shift: 'evening', days: 3, openDays: 3, diners: [20, 30, 120][i], deliveries: 0 }));
  const f = forecastShifts(['2026-10-26', '2026-10-27', '2026-10-30'], prof, r);
  assert.deepEqual(f.map((x) => [x.weekday, x.roles[0].people, x.roles[0].perPerson]), [
    [1, 1, 20],
    [2, 1, 34.3], // 30 / 34.3 → 1, from the all-days ratio
    [5, 3, 40], // 120 / 40; the all-days ratio would say 120 / 34.3 → 4
  ]);
});

t('actual: diners per person per past shift, needed by the learned ratio, and a summary per role', () => {
  // 4 Friday evenings: 120 diners + 10 deliveries; waiters 3, 3, 3, 5; one cook each time
  const load = {};
  const staff = [];
  ['2026-09-04', '2026-09-11', '2026-09-18', '2026-09-25'].forEach((d, i) => {
    load[d] = { morning: { diners: 0, deliveries: 0, checks: 0 }, evening: { diners: 120, deliveries: 10, checks: 40 } };
    staff.push({ date: d, shift: 'evening', role: 'מלצר', people: i === 3 ? 5 : 3, hours: 18 }, { date: d, shift: 'evening', role: 'טבח', people: 1, hours: 7 });
  });
  const isKitchen = (r) => r === 'טבח';
  const ratios = learnRatios(load, staff, { isKitchen });
  const a = staffingActual(['2026-09-18', '2026-09-25', '2026-09-26'], load, staff, ratios, { isKitchen });
  assert.equal(a.shifts.length, 2); // 09-26 has no data
  const last = a.shifts[1];
  assert.deepEqual(last.roles.map((r) => [r.role, r.people, r.perPerson, r.usualPerPerson, r.needed, r.diff]), [
    ['מלצר', 5, 24, 34.3, 3, 2], // 120 / 5; the ratio is 480 / 14 → 120 / 34.3 → 3
    ['טבח', 1, 130, 130, 1, 0], // a cook counts the deliveries too
  ]);
  assert.equal(last.allRolesPeople, 6);
  const w = a.summary.find((x) => x.role === 'מלצר');
  assert.deepEqual([w.shifts, w.avgPeople, w.perPerson, w.minPerPerson, w.maxPerPerson, w.shiftsOver, w.shiftsUnder], [2, 4, 30, 24, 40, 1, 0]);
});

t('table totals: the total row is recalculated from the rows, missing numbers are 0, rates / dates / % are not summed', () => {
  const a = ['שעות:', '| עובד | תאריך | שעות | שכר לשעה ₪ | עלות ₪ | אחוז |', '|---|---|---|---|---|---|', '| דנה | 18.10 | 12.5 | 40 | 1,200 | 10% |', '| יוסי | 19.10 | — | 45 | 2,350.5 | 20% |', '| רון | 20.10 | 7 | 38 |  | 5% |', '| סה"כ | — | 99 | — | 9,999 | 35% |'].join('\n');
  const out = fillTotals(a);
  assert.deepEqual(out.totals, [19.5, 3550.5]);
  const rows = splitAnswer(out.text)[1].rows;
  assert.deepEqual(rows[1], ['יוסי', '19.10', '0', '45', '2,350.5', '20%']);
  assert.deepEqual(rows[3], ['סה"כ', '—', '19.5', '—', '3,550.5', '35%']);
  // no total row, or two total rows: only the missing numbers become 0
  assert.equal(fillTotals('| a | b |\n|---|---|\n| x | 1 |\n| y | 2 |').text, '| a | b |\n|---|---|\n| x | 1 |\n| y | 2 |');
  assert.deepEqual(fillTotals('| a | b |\n|---|---|\n| Total | 5 |\n| x | 1 |\n| Total | 9 |').totals, []);
  assert.deepEqual(fillTotals('| שבוע | ₪ |\n|---|---|\n| 1 | 1,000 |\n| 2 | -250 |\n| סה״כ | 0 |').totals, [750]);
  // a total column (last header "סה"כ") is summed per row; a broken number in a total cell is fixed too
  const c = fillTotals('| מקור | רעננה | רמת החיל | סה"כ |\n|---|---|---|---|\n| אשראי | 448,341 | 344,730 | 793,000 |\n| מזומן | 6,784 | -17,196 | |\n| **סה"כ** | **455,125** | **327,534** | **1,964,79** |');
  const cr = splitAnswer(c.text)[0].rows;
  assert.deepEqual(cr[0], ['אשראי', '448,341', '344,730', '793,071']);
  assert.deepEqual(cr[1], ['מזומן', '6,784', '-17,196', '-10,412']);
  assert.deepEqual(cr[2], ['סה"כ', '455,125', '327,534', '782,659']);
});
t('money is cut down to whole shekels; %, hours and counts keep their decimals', () => {
  assert.equal(floorMoney('הכנסות 13,878.4 ₪, ₪ 1,234.99, טיפים 5.6%, 3.5 שעות'), 'הכנסות 13,878 ₪, ₪ 1,234, טיפים 5.6%, 3.5 שעות');
  const a = floorMoney('| עובד | שעות | עלות ₪ | אחוז | הכנסות | סועדים |\n|---|---|---|---|---|---|\n| דנה | 12.5 | 2,350.5 | 10.5% | -17.6 | 3.5 |');
  assert.deepEqual(splitAnswer(a)[0].rows[0], ['דנה', '12.5', '2,350', '10.5%', '-17', '3.5']);
});
t('answer tables: a pipe table becomes a table block between the text; numbers are read for Excel', () => {
  const b = splitAnswer('שלום\n\n| שבוע | אשראי | שינוי |\n|---|---:|---|\n| 18.10–24.10 | 221,776 ₪ | -3.6% |\n| 11.10–17.10 | **256,062** |\n\nסוף\n| not | a table |');
  assert.deepEqual(b.map((x) => x.type), ['text', 'table', 'text']);
  assert.deepEqual(b[1].header, ['שבוע', 'אשראי', 'שינוי']);
  assert.deepEqual(b[1].rows, [['18.10–24.10', '221,776 ₪', '-3.6%'], ['11.10–17.10', '256,062', '']]); // ** removed, short row filled
  assert.equal(b[2].text, 'סוף\n| not | a table |'); // no separator line → text
  assert.deepEqual(cellNumber('221,776 ₪'), { value: 221776, percent: false, money: true });
  assert.deepEqual(cellNumber('-3.6%'), { value: -3.6, percent: true, money: false });
  assert.equal(cellNumber('(1,200)').value, -1200);
  assert.equal(cellNumber('18.10–24.10'), null);
  assert.equal(cellNumber('1,23'), null);
});

// ---- the VAT report rules (owner 2026-11-03 / 2026-11-09): הקפה out, 20% of both PRIVATE LABEL BRAND brands deducted
t('vatRules: both PRIVATE LABEL BRAND brands are חבר, מולטיפס and the card brands are not; הקפה = the type-5 total row', () => {
  assert.equal(isHever({ type: 1, brand: 'PRIVATE LABEL BRAND - חבר' }), true);
  assert.equal(isHever({ type: 1, brand: 'PRIVATE LABEL BRAND' }), true);
  assert.equal(isHever({ type: 1, brand: 'private label brand ' }), true);
  assert.equal(isHever({ type: 1, brand: 'VISA' }), false);
  assert.equal(isHever({ type: 24, brand: 'BUYME' }), false);
  assert.equal(isHever({ type: 1, brand: null }), false);
  assert.equal(isHakafa({ type: 5, brand: null }), true);
  assert.equal(isHakafa({ type: 1, brand: null }), false);
});
t('vatRules: a month — income from the type totals only, הקפה taken out, 20% of חבר deducted, VAT 18/118', () => {
  const rows = [
    { type: 1, brand: null, charges: 1200, refunded: 200 }, // credit total 1000 (the brand rows below are inside it)
    { type: 1, brand: 'VISA', charges: 500, refunded: 0 },
    { type: 1, brand: 'PRIVATE LABEL BRAND - חבר', charges: 300, refunded: 0 },
    { type: 1, brand: 'PRIVATE LABEL BRAND', charges: 100, refunded: 0 },
    { type: 1, brand: 'MASTERCARD', charges: 300, refunded: 200 },
    { type: 2, brand: null, charges: 400, refunded: 0 }, // cash
    { type: 5, brand: null, charges: 250, refunded: 50 }, // הקפה 200 → out
    { type: 24, brand: null, charges: 100, refunded: 0 }, // מולטיפס: income, no deduction
  ];
  const m = rows.reduce(addRow, blankSums());
  assert.deepEqual(m, { income: 1700, hakafa: 200, hever: 400 });
  const l = vatLine(m);
  assert.equal(l.income, 1700);
  assert.equal(l.hakafa, 200);
  assert.equal(l.hever, 400);
  assert.equal(l.deduction, 80);
  assert.equal(l.vatIncome, 1420); // 1700 − 200 − 80
  assert.equal(l.vat, Math.round((1420 * 18) / 118 * 100) / 100);
  assert.equal(Math.round((l.vatIncomeBeforeVat + l.vat) * 100) / 100, 1420);
});

// ---- file answers (owner 2026-11-09): every row list of the results becomes a sheet tab
t('sheetTabs: row lists become tabs, biggest first; containers, warnings and plain lists are not tabs; nested objects flatten', () => {
  const results = [
    { calc: 'supplier_invoices', params: {}, result: { report: 'supplier_invoices', warnings: [{ code: 'x' }], companies: [{ company: 'פסטה לינה', count: 3, rows: [{ docNumber: 143, date: '2026-01-01', amount: 2152, supplierName: 'מיט', extra: { a: 1 } }, { docNumber: 144, date: '2026-01-02', amount: 10, tags: ['x', 'y'] }] }] } },
    { calc: 'missing_invoices', params: {}, result: { channels: [{ channel: 'drive', companies: [{ company: 'PL', statuses: ['a'], rows: [{ n: 1 }, { n: 2 }, { n: 3 }] }] }], otherChannels: 'x' } },
    { calc: 'failed', error: 'boom' },
  ];
  const tabs = tabsOf(results);
  assert.deepEqual(tabs.map((x) => [x.name, x.rows.length, x.calc]), [['drive · PL', 3, 'missing_invoices'], ['פסטה לינה', 2, 'supplier_invoices']]);
  assert.deepEqual(tabs[1].columns, ['docNumber', 'date', 'amount', 'supplierName', 'extra.a', 'tags']);
  assert.equal(tabs[1].rows[1].tags, 'x; y');
  assert.deepEqual(flattenRow({ a: { b: { c: 1 } }, d: null }), { 'a.b.c': 1, d: null });
  assert.equal(cleanName('a/b:c*[d]?'), 'a b c d');
  assert.equal(cleanName('x'.repeat(40)).length, 31);
  assert.equal(cellDate('2026-11-09').toISOString(), '2026-11-09T00:00:00.000Z');
  assert.equal(cellDate('2026-11-09 10:00:00').toISOString(), '2026-11-09T00:00:00.000Z');
  assert.equal(cellDate('מיט 2'), null);
  assert.equal(cellDate(2026), null);
  // no list at all → a key / value tab, so any data can go into a sheet
  const kv = tabsOf([{ calc: 'x', result: { total: 5, note: 'n', warnings: [{ a: 1 }], sub: { a: 1 } } }]);
  assert.deepEqual(kv.map((t) => [t.name, t.columns, t.rows]), [['x', ['key', 'value'], [{ key: 'total', value: 5 }, { key: 'note', value: 'n' }, { key: 'sub.a', value: 1 }]]]);
});
t('sheetTabs: two lists with the same name get different tab names', () => {
  const tabs = tabsOf([{ calc: 'a', result: { x: { rows: [{ v: 1 }] }, y: { rows: [{ v: 2 }] } } }]);
  assert.deepEqual(tabs.map((x) => x.name), ['a', 'a 2']);
});

console.log(`\n${n} passed${process.exitCode ? ', some FAILED' : ''}`);

console.log('finance (the books)');
const { dates: finDates, warningsOf } = await import('../src/services/finance.js');
const { mayRun, FINANCE_CALCS, CALCS, catalogue } = await import('../src/services/ai.js');
t('finance dates: from required, to optional, order checked', () => {
  assert.deepEqual(finDates({ from: '2026-01-01', to: '2026-03-31' }), { from: '2026-01-01', to: '2026-03-31' });
  assert.deepEqual(finDates({ from: '2026-01-01' }), { from: '2026-01-01' });
  assert.deepEqual(finDates({}, { required: false }), {});
  assert.throws(() => finDates({}), /from must be/);
  assert.throws(() => finDates({ from: '2026-13-01' }), /from must be/);
  assert.throws(() => finDates({ from: '2026-03-01', to: '2026-02-01' }), /after/);
});
t('finance warnings: high first, affects kept only when present', () => {
  const w = warningsOf([{ code: 'not_validated', severity: 'info', message: 'x', affects: [] }, { code: 'no_salary_expense', severity: 'high', message: 'y', affects: ['2026-08'] }]);
  assert.deepEqual(w.map((x) => x.code), ['no_salary_expense', 'not_validated']);
  assert.deepEqual(w[0].affects, ['2026-08']);
  assert.ok(!('affects' in w[1]));
  assert.deepEqual(warningsOf(null), []);
});
t('the books are for the chain admin only; every finance calc is in the catalogue', () => {
  const admin = { role: 'CHAIN_ADMIN', isAdmin: true };
  const manager = { role: 'LOCATION_MANAGER', isAdmin: false };
  const accountant = { role: 'ACCOUNTANT', isAdmin: false };
  assert.equal(FINANCE_CALCS.size, 29); // 2026-11-08: + missing_invoices; 2026-11-09: + supplier_invoices; 2026-11-10: + statement_compare; 2026-11-11: + priority_cheques
  for (const name of FINANCE_CALCS) {
    assert.ok(CALCS[name] && typeof CALCS[name].run === 'function', `${name} is a calc`);
    assert.equal(mayRun(admin, name), true);
    assert.equal(mayRun(manager, name), false, `${name} not for a manager`);
    assert.equal(mayRun(accountant, name), false, `${name} not for the accountant yet`);
  }
  assert.equal(mayRun(accountant, 'cards_vs_bank'), true);
  assert.equal(mayRun(manager, 'sales_summary'), true);
  const names = catalogue().map((c) => c.name);
  for (const name of FINANCE_CALCS) assert.ok(names.includes(name));
  for (const c of catalogue()) assert.ok(c.about && c.params, `${c.name} documented`);
});
const ta = async (name, fn) => {
  try {
    await fn();
    n++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}\n${e.stack}`);
    process.exitCode = 1;
  }
};
await ta('finance calcs refuse a non-admin before calling Allegro, and check their params', async () => {
  const manager = { role: 'LOCATION_MANAGER', isAdmin: false, locationIds: ['demo-tlv'], payroll: true };
  await assert.rejects(() => CALCS.pnl.run(manager, { from: '2026-01-01' }), /chain admin only/);
  const { aging, accountCard, payrollCheck, journalSearch, cheques } = await import('../src/services/finance.js');
  await assert.rejects(() => aging([], {}), /side must be/);
  await assert.rejects(() => accountCard([], { from: '2026-01-01' }), /account .* or q/);
  await assert.rejects(() => payrollCheck([], { month: '2026-13' }), /month must be/);
  await assert.rejects(() => journalSearch([], {}), /give a period/);
  await assert.rejects(() => cheques([], { state: 'lost' }), /state must be/);
  // the day groups: soonest day first, each day's count and sum, the payee from the account when the cheque has none
  const { chequesByDay } = await import('../src/services/finance.js');
  const days = chequesByDay([
    { reference: 3, payee: 'ג', amount: 100.5, dueDate: '2026-12-01' },
    { reference: 1, payee: 'א', amount: 200, dueDate: '2026-11-15' },
    { reference: 2, payee: null, accountName: 'ב', amount: 0.1, dueDate: '2026-11-15' },
  ]);
  assert.deepEqual(days.map((d) => [d.dueDate, d.count, d.amount]), [['2026-11-15', 2, 200.1], ['2026-12-01', 1, 100.5]]);
  assert.deepEqual(days[0].cheques.map((c) => c.payee), ['א', 'ב']);
  assert.deepEqual(chequesByDay([]), []);
  // with no companies nothing is read: an empty, well-formed result
  const empty = await cheques([], { state: 'future' });
  assert.deepEqual([empty.report, empty.companies], ['cheques', []]);
});

console.log(`\n${n} checks passed`);
