// Unit tests for the pure Joya logic (no DB). Run: node test/test_joya_lib.mjs
import assert from 'assert/strict';
import { parseCsv, toCsv } from '../src/lib/csv.js';
import { applyMapping, parseNumber, parseDate, parseDateTime, suggestMapping } from '../src/lib/fields.js';
import { shiftDemand, forecastUnit } from '../src/lib/demand.js';
import { computeSlot, learnedAdjustments, validateRule } from '../src/lib/staffingRules.js';
import { recommend, convert } from '../src/lib/recommend.js';
import { shiftOfCheck, loadByShift, shiftProfile, learnRatios, forecastShifts } from '../src/lib/shiftModel.js';

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
});

console.log(`\n${n} passed${process.exitCode ? ', some FAILED' : ''}`);
