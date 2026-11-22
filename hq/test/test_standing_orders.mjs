// The known bank payments of the שקלפ page (src/services/standingOrders.js): learned from the bank file's standing-order
// lines, expected on the same day of the month, real lines where the bank already covers the day. No DB, no API.
//   node --test test/test_standing_orders.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bankPaymentsInWindow, shiftMonth, daysInMonth, monthsBetween } from '../src/services/standingOrders.js';

const ACC = '12-584-136663';
const line = (date, action, debit, o = {}) => ({ account: ACC, date, actionCode: '515', action, details: null, reference: o.reference ?? action.length, debit, ...o });
const history = [
  // מע"מ on the 15th and 20th of every month (two lines on the 15th), three months
  line('2026-08-15', 'מע"מ', 50000, { reference: 2761997 }), line('2026-08-15', 'מע"מ', 100000, { reference: 2761997 }),
  line('2026-09-15', 'מע"מ', 50000, { reference: 2761997 }), line('2026-09-15', 'מע"מ', 110000, { reference: 2761997 }),
  line('2026-10-15', 'מע"מ', 50000, { reference: 2761997 }), line('2026-10-15', 'מע"מ', 117031, { reference: 2761997 }),
  // Tabit on the 15th/16th, three months
  line('2026-08-16', 'טאביט טכנולוגי', 531), line('2026-09-15', 'טאביט טכנולוגי', 531), line('2026-10-15', 'טאביט טכנולוגי', 531),
  // a one-time standing order (one month only) → not known
  line('2026-09-03', 'חד פעמי', 999),
  // a 469 standing order on the 1st, two months
  line('2026-10-01', 'הוראת-קבע', 3600, { actionCode: '469', details: 'לטובת: אנקונינה איציק עבור: 20-403', reference: 104303 }),
  line('2026-09-01', 'הוראת-קבע', 3600, { actionCode: '469', details: 'לטובת: אנקונינה איציק עבור: 20-403', reference: 104303 }),
  // a fee and a cheque are never standing orders
  line('2026-10-03', 'ד.ניהול קבועים', 78, { actionCode: '473' }), line('2026-10-03', 'שיק', 1200, { actionCode: '493' }),
  // money in with a 515 code is ignored (debit 0)
  { account: ACC, date: '2026-10-05', actionCode: '515', action: 'זיכוי', debit: 0, credit: 500 },
];

test('what repeats in the last months is known: payee, usual day (the middle one), the last amount of the month', () => {
  const { known } = bankPaymentsInWindow(history, { from: '2026-11-01', to: '2026-11-30' });
  // by the usual day, then by the payee's name (ט before מ)
  assert.deepEqual(known.map((k) => [k.payee, k.day, k.lastAmount, k.months]), [
    ['אנקונינה איציק', 1, 3600, 2],
    ['טאביט טכנולוגי', 15, 531, 3],
    ['מע"מ', 15, 167031, 3],
  ]);
  assert.equal(known.find((k) => k.payee === 'מע"מ').lastDate, '2026-10-15');
});

test('a future month gets the expected lines on the usual day; nothing is paid yet', () => {
  const { items } = bankPaymentsInWindow(history, { from: '2026-12-01', to: '2026-12-31', lastBankDay: '2026-11-20' });
  assert.deepEqual(items.map((x) => [x.date, x.payee, x.amount, x.expected, x.late]), [
    ['2026-12-01', 'אנקונינה איציק', 3600, true, undefined],
    ['2026-12-15', 'טאביט טכנולוגי', 531, true, undefined],
    ['2026-12-15', 'מע"מ', 167031, true, undefined],
  ]);
});

test('the current month: the real lines where the bank covers the day, the rest expected; a day that passed without a line is late', () => {
  const rows = [...history, line('2026-11-15', 'מע"מ', 60000, { reference: 2761997 }), line('2026-11-15', 'מע"מ', 108031, { reference: 2761997 })];
  const { items } = bankPaymentsInWindow(rows, { from: '2026-11-01', to: '2026-11-30', lastBankDay: '2026-11-20' });
  const paid = items.filter((x) => x.paid);
  assert.deepEqual(paid.map((x) => [x.date, x.payee, x.amount]), [['2026-11-15', 'מע"מ', 60000], ['2026-11-15', 'מע"מ', 108031]]);
  const expected = items.filter((x) => x.expected);
  assert.deepEqual(expected.map((x) => [x.date, x.payee, x.late === true]), [
    ['2026-11-01', 'אנקונינה איציק', true], // its day passed, the bank file reaches the 20th, no line → late
    ['2026-11-15', 'טאביט טכנולוגי', true],
  ]);
  assert.equal(items.some((x) => x.payee === 'מע"מ' && x.expected), false); // paid this month → not expected again
});

test('a window of several months, the 31st in a short month, and the month helpers', () => {
  const rows = [line('2026-08-31', 'סוף חודש', 100), line('2026-10-31', 'סוף חודש', 120)];
  const { items } = bankPaymentsInWindow(rows, { from: '2026-11-01', to: '2027-02-28' });
  assert.deepEqual(items.map((x) => x.date), ['2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28']);
  assert.equal(items[0].amount, 120);
  assert.equal(shiftMonth('2026-01', 4), '2025-09');
  assert.equal(shiftMonth('2026-11', -2), '2027-01');
  assert.equal(daysInMonth('2028-02'), 29);
  assert.deepEqual(monthsBetween('2026-11', '2027-01'), ['2026-11', '2026-12', '2027-01']);
});

test('history older than the lookback does not count; a payee seen in one month only is not known', () => {
  const rows = [line('2026-03-10', 'ישן', 10), line('2026-04-10', 'ישן', 10), line('2026-10-10', 'חדש', 10)];
  const { known, items } = bankPaymentsInWindow(rows, { from: '2026-11-01', to: '2026-11-30' });
  assert.deepEqual(known, []);
  assert.deepEqual(items, []);
});
