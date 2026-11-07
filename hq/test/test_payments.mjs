// Unit tests for the pure payment logic (src/services/payments.js, no DB). Run: node test/test_payments.mjs
import assert from 'assert/strict';
import { weekWindow, weekOfMonth, monthDay, nextOccurrences, normalizePayee, nameScore, bankLineName, isTransferLine, bankLineKey, pickMatches, normalizeOp, dueText } from '../src/services/payments.js';

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
const today = '2026-11-07';

console.log('payments: dates');
t('week windows: 1–7, 8–14, 15–21, 22–end (February, a 31-day month)', () => {
  assert.deepEqual(weekWindow('2026-12', 1), { from: '2026-12-01', to: '2026-12-07' });
  assert.deepEqual(weekWindow('2026-12', 2), { from: '2026-12-08', to: '2026-12-14' });
  assert.deepEqual(weekWindow('2026-12', 4), { from: '2026-12-22', to: '2026-12-31' });
  assert.deepEqual(weekWindow('2026-02', 4), { from: '2026-02-22', to: '2026-02-28' });
  assert.throws(() => weekWindow('2026-02', 5), /1, 2, 3 or 4/);
  assert.throws(() => weekWindow('2026-2', 1), /YYYY-MM/);
  assert.equal(weekOfMonth('2026-12-21'), 3);
  assert.equal(weekOfMonth('2026-12-31'), 4);
});
t('a day the month does not have = its last day', () => {
  assert.equal(monthDay('2026-11', 31), '2026-11-30');
  assert.equal(monthDay('2026-02', 30), '2026-02-28');
  assert.equal(monthDay('2028-02', 30), '2028-02-29');
  assert.equal(monthDay('2026-11', 15), '2026-11-15');
});
t('monthly occurrences: day 31 clamps, the first month counts only when its day is still ahead', () => {
  assert.deepEqual(nextOccurrences({ day: 31 }, today, 4).map((o) => o.dueDate), ['2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28']);
  assert.deepEqual(nextOccurrences({ day: 5 }, today, 2).map((o) => o.dueDate), ['2026-12-05', '2027-01-05']);
  assert.deepEqual(nextOccurrences({ day: 7 }, today, 1).map((o) => o.dueDate), ['2026-11-07']); // today itself counts
});
t('weekly-window occurrences: a window that still reaches today counts; until stops the series', () => {
  const w = nextOccurrences({ week: 2 }, '2026-11-10', 3);
  assert.deepEqual(w.map((o) => [o.dueKind, o.dueDate, o.dueTo]), [['WEEK', '2026-11-08', '2026-11-14'], ['WEEK', '2026-12-08', '2026-12-14'], ['WEEK', '2027-01-08', '2027-01-14']]);
  assert.deepEqual(nextOccurrences({ week: 2 }, '2026-11-15', 1).map((o) => o.dueDate), ['2026-12-08']);
  assert.deepEqual(nextOccurrences({ day: 10, until: '2026-12-31' }, today, 12).map((o) => o.dueDate), ['2026-11-10', '2026-12-10']);
});
t('due text: a day, or the week of the month with its days', () => {
  assert.equal(dueText('DATE', '2026-11-15', null), '15.11.2026');
  assert.equal(dueText('WEEK', '2026-12-08', '2026-12-14'), 'שבוע 2 של 12/2026 (8.12–14.12)');
});

console.log('payments: names and bank lines');
t('normalised payee: quotes, punctuation and בע"מ / ltd go', () => {
  assert.equal(normalizePayee('ר.ר.ג גלוז בע"מ'), 'ררג גלוז');
  assert.equal(normalizePayee('א.ב. שירותים'), 'אב שירותים');
  assert.equal(normalizePayee("  אבי   כהן  "), 'אבי כהן');
  assert.equal(normalizePayee('Supplier Ltd.'), 'supplier');
  assert.equal(normalizePayee('מי רעננה בע״מ'), 'מי רעננה');
});
t('name score: contained = 1, else the share of the payee words found (prefixes count)', () => {
  assert.equal(nameScore(normalizePayee('גלוז'), 'לטובת: ר.ר.ג גלוז בע"מ'), 1);
  assert.equal(nameScore(normalizePayee('שופרסל אמיגה'), 'שופרסל'), 1);
  assert.equal(nameScore(normalizePayee('נטו מלינדה סחר'), 'לטובת: נטו מלינדה'), 2 / 3);
  assert.equal(nameScore(normalizePayee('שופרסל'), 'לטובת: ר.ר.ג גלוז בע"מ'), 0);
  assert.equal(nameScore('', 'x'), 0);
});
t('the name in a bank line: after לטובת: up to עבור:; a standing order = the action', () => {
  assert.equal(bankLineName({ actionCode: '485', details: 'לטובת: נאור ירון עבור: החזר הוצאות' }), 'נאור ירון');
  assert.equal(bankLineName({ actionCode: '485', details: 'לטובת: שופרסל אמיגה' }), 'שופרסל אמיגה');
  assert.equal(bankLineName({ actionCode: '515', action: 'עודד דניאל בע"', details: 'עבור: גויה רעננה מזהה 000219678' }), 'עודד דניאל בע"');
  assert.equal(bankLineName({ actionCode: '485', action: 'העברה לאחר', details: null }), 'העברה לאחר');
});
t('a transfer line: 485 and 515 yes, fees (473), cheques and money in no', () => {
  assert.equal(isTransferLine({ actionCode: '485', action: 'העברה מהבנק', debit: 100 }), true);
  assert.equal(isTransferLine({ actionCode: '515', action: 'בזק-הוראות קבע', debit: 100 }), true);
  assert.equal(isTransferLine({ actionCode: '450', action: 'העברה לבנק אחר', debit: 100 }), true);
  assert.equal(isTransferLine({ actionCode: '473', action: 'עמ העברה/הפקדה', debit: 10.25 }), false);
  assert.equal(isTransferLine({ actionCode: '493', action: 'שיק', debit: 2197 }), false);
  assert.equal(isTransferLine({ actionCode: '485', action: 'העברה מהבנק', debit: null, credit: 500 }), false);
  assert.equal(bankLineKey({ account: '12-584-136663', date: '2026-10-20', reference: '488706348', debit: 2755 }), '12-584-136663|2026-10-20|488706348|2755.00');
});

console.log('payments: matching with the bank');
const line = (date, name, debit, extra = {}) => ({ account: 'A', date, actionCode: '485', action: 'העברה מהבנק', details: name ? `לטובת: ${name}` : null, reference: `${date}-${debit}-${name || ''}`, debit, ...extra });
const plan = (id, payee, amount, dueDate, dueTo = null) => ({ id, payeeNorm: normalizePayee(payee), amount, dueDate, dueTo });
t('the line whose name fits the payee pays it; the fee line next to it is ignored', () => {
  const rows = [line('2026-10-20', 'שופרסל אמיגה', 2755), { ...line('2026-10-20', null, 10.25), actionCode: '473', action: 'עמ העברה/הפקדה' }];
  const m = pickMatches([plan(1, 'שופרסל', 2755, '2026-10-20')], rows, '2026-10-25');
  assert.deepEqual(m.matched.map((x) => [x.paymentId, x.how]), [[1, 'name']]);
  assert.deepEqual(m.candidates, {});
});
t('two payments of the same amount: the named line goes to its payee, the other line is the only one left', () => {
  const rows = [line('2026-11-02', 'אבי כהן', 1000), line('2026-11-03', null, 1000)];
  const m = pickMatches([plan(1, 'אבי כהן', 1000, '2026-11-01'), plan(2, 'דני לוי', 1000, '2026-11-01')], rows, '2026-11-07');
  assert.deepEqual(m.matched.map((x) => [x.paymentId, x.how, x.row.date]), [[1, 'name', '2026-11-02'], [2, 'only', '2026-11-03']]);
});
t('two payments, two unnamed lines of the same amount: nothing is paid, both get candidates', () => {
  const rows = [line('2026-11-02', null, 1000), line('2026-11-03', null, 1000)];
  const m = pickMatches([plan(1, 'אבי כהן', 1000, '2026-11-01'), plan(2, 'דני לוי', 1000, '2026-11-01')], rows, '2026-11-07');
  assert.deepEqual(m.matched, []);
  assert.deepEqual(Object.keys(m.candidates), ['1', '2']);
  assert.equal(m.candidates[1].length, 2);
});
t('one line, two payments that could be it: no match, both get the candidate; a wrong-name line never pays', () => {
  const rows = [line('2026-11-02', null, 1000)];
  const m = pickMatches([plan(1, 'אבי כהן', 1000, '2026-11-01'), plan(2, 'דני לוי', 1000, '2026-11-02')], rows, '2026-11-07');
  assert.deepEqual(m.matched, []);
  assert.deepEqual(Object.keys(m.candidates), ['1', '2']);
  const m2 = pickMatches([plan(1, 'אבי כהן', 1000, '2026-11-01'), plan(2, 'דני לוי', 1000, '2026-11-02')], [line('2026-11-02', 'דני לוי', 1000)], '2026-11-07');
  assert.deepEqual(m2.matched.map((x) => [x.paymentId, x.how]), [[2, 'name']]);
  assert.deepEqual(m2.candidates, {});
});
t('the same line from two uploads counts once; the date window is −7 … +21 days; lines after today do not count', () => {
  const l = line('2026-11-10', 'אבי כהן', 500);
  const m = pickMatches([plan(1, 'אבי כהן', 500, '2026-11-10')], [l, { ...l, id: 99 }], '2026-11-12');
  assert.equal(m.matched.length, 1);
  assert.deepEqual(m.candidates, {});
  const early = pickMatches([plan(1, 'אבי כהן', 500, '2026-11-10')], [line('2026-11-02', 'אבי כהן', 500)], '2026-11-12');
  assert.equal(early.matched.length, 0);
  const late = pickMatches([plan(1, 'אבי כהן', 500, '2026-10-10', '2026-10-14')], [line('2026-11-04', 'אבי כהן', 500)], '2026-11-12');
  assert.equal(late.matched.length, 1); // 21 days after the end of the week window
  const future = pickMatches([plan(1, 'אבי כהן', 500, '2026-11-10')], [line('2026-11-13', 'אבי כהן', 500)], '2026-11-12');
  assert.equal(future.matched.length, 0);
});
t('a standing order is matched by its action text; an amount that differs by agorot is not the same', () => {
  const so = { account: 'A', date: '2026-10-16', actionCode: '515', action: 'עודד דניאל בע"', details: 'עבור: גויה רעננה מזהה 000219678', reference: '50462704', debit: 1434 };
  assert.deepEqual(pickMatches([plan(1, 'עודד דניאל', 1434, '2026-10-15')], [so], '2026-10-20').matched.map((x) => x.how), ['name']);
  assert.equal(pickMatches([plan(1, 'עודד דניאל', 1434.5, '2026-10-15')], [so], '2026-10-20').matched.length, 0);
});

console.log('payments: the ops of the planner');
t('add: amount as text, a day; a past day is refused, today is fine', () => {
  const op = normalizeOp({ op: 'add', payee: ' אבי כהן ', amount: '5,000 ₪', dueDate: '2026-11-15', note: 'שכירות' }, { today });
  assert.deepEqual(op, { op: 'add', payee: 'אבי כהן', payeeNorm: 'אבי כהן', amount: 5000, dueKind: 'DATE', dueDate: '2026-11-15', dueTo: null, repeat: null, note: 'שכירות' });
  assert.throws(() => normalizeOp({ op: 'add', payee: 'x', amount: 5, dueDate: '2026-11-06' }, { today }), /has passed/);
  assert.equal(normalizeOp({ op: 'add', payee: 'x', amount: 5, dueDate: today }, { today }).dueDate, today);
  assert.throws(() => normalizeOp({ op: 'add', payee: '', amount: 5, dueDate: today }, { today }), /payee/);
  assert.throws(() => normalizeOp({ op: 'add', payee: 'x', amount: 0, dueDate: today }, { today }), /amount/);
  assert.throws(() => normalizeOp({ op: 'add', payee: 'x', amount: 5 }, { today }), /needs a day/);
});
t('a normalised week op stays a week when it is normalised again (the proposal comes back to applyOps)', () => {
  const once = normalizeOp({ op: 'add', payee: 'x', amount: 100, dueWeek: { year: 2026, month: 12, week: 2 } }, { today });
  assert.deepEqual(normalizeOp(once, { today }), once);
  const mv = normalizeOp({ op: 'move', id: 5, dueWeek: { year: 2026, month: 12, week: 2 } }, { today });
  assert.deepEqual(normalizeOp(mv, { today }), mv);
  assert.throws(() => normalizeOp({ op: 'add', payee: 'x', amount: 100, dueKind: 'WEEK', dueDate: '2026-10-08', dueTo: '2026-10-14' }, { today }), /has passed/);
});
t('add: "N payments" closes the series after the N-th one (count → until)', () => {
  const op = normalizeOp({ op: 'add', payee: 'אימפורט', amount: 4000, repeat: { every: 'month', week: 3, count: 5 } }, { today });
  assert.deepEqual([op.dueKind, op.dueDate, op.dueTo], ['WEEK', '2026-11-15', '2026-11-21']);
  assert.deepEqual(op.repeat, { every: 'month', week: 3, count: 5, until: '2027-03-21' });
  assert.equal(nextOccurrences(op.repeat, op.dueDate, 12).length, 5);
  const byDay = normalizeOp({ op: 'add', payee: 'x', amount: 100, dueDate: '2026-12-01', repeat: { count: 3 } }, { today });
  assert.deepEqual(byDay.repeat, { every: 'month', day: 1, count: 3, until: '2027-02-01' });
  assert.throws(() => normalizeOp({ op: 'add', payee: 'x', amount: 100, dueDate: '2026-12-01', repeat: { count: 1 } }, { today }), /2–60/);
});
t('add: a week of a month; a week that passed is refused', () => {
  const op = normalizeOp({ op: 'add', payee: 'בעל הבית', amount: 20000, dueWeek: { month: '2026-12', week: 2 } }, { today });
  assert.equal(op.dueKind, 'WEEK');
  assert.equal(op.dueDate, '2026-12-08');
  assert.equal(op.dueTo, '2026-12-14');
  assert.throws(() => normalizeOp({ op: 'add', payee: 'x', amount: 5, dueWeek: { month: '2026-10', week: 4 } }, { today }), /has passed/);
  const now = normalizeOp({ op: 'add', payee: 'x', amount: 5, dueWeek: { month: '2026-11', week: 1 } }, { today }); // 1–7.11, today is the 7th
  assert.equal(now.dueTo, '2026-11-07');
  const num = normalizeOp({ op: 'add', payee: 'x', amount: 5, dueWeek: { year: 2026, month: 12, week: 2 } }, { today }); // the planner's form: numbers
  assert.deepEqual([num.dueDate, num.dueTo], ['2026-12-08', '2026-12-14']);
  assert.throws(() => normalizeOp({ op: 'add', payee: 'x', amount: 5, dueWeek: { year: 2026, month: 13, week: 2 } }, { today }), /YYYY-MM/);
});
t('add with a repeat: the rule follows the first day / week when not given; a repeat alone starts at the next occurrence', () => {
  assert.deepEqual(normalizeOp({ op: 'add', payee: 'x', amount: 5, dueDate: '2026-11-15', repeat: { every: 'month' } }, { today }).repeat, { every: 'month', day: 15 });
  assert.deepEqual(normalizeOp({ op: 'add', payee: 'x', amount: 5, dueWeek: { month: '2026-12', week: 2 }, repeat: {} }, { today }).repeat, { every: 'month', week: 2 });
  const r = normalizeOp({ op: 'add', payee: 'x', amount: 5, repeat: { every: 'month', day: 10, until: '2027-06-30' } }, { today });
  assert.equal(r.dueDate, '2026-11-10');
  assert.deepEqual(r.repeat, { every: 'month', day: 10, until: '2027-06-30' });
  assert.equal(normalizeOp({ op: 'add', payee: 'x', amount: 5, repeat: { week: 1 } }, { today }).dueDate, '2026-11-01'); // week 1 of November still reaches the 7th
  assert.throws(() => normalizeOp({ op: 'add', payee: 'x', amount: 5, repeat: { every: 'week' } }, { today }), /monthly/);
});
t('a known payee in another spelling takes the known spelling', () => {
  const known = [{ name: 'ר.ר.ג גלוז בע"מ', norm: normalizePayee('ר.ר.ג גלוז בע"מ') }];
  assert.equal(normalizeOp({ op: 'add', payee: 'ררג גלוז', amount: 5, dueDate: today }, { today, known }).payee, 'ר.ר.ג גלוז בע"מ');
  assert.equal(normalizeOp({ op: 'add', payee: 'גלוז', amount: 5, dueDate: today }, { today, known }).payee, 'גלוז');
});
t('move / amount / cancel need an id; scope is one or series; an unknown op is refused', () => {
  assert.deepEqual(normalizeOp({ op: 'move', id: 12, dueDate: '2026-11-20' }, { today }), { op: 'move', id: 12, dueKind: 'DATE', dueDate: '2026-11-20', dueTo: null, scope: 'one' });
  assert.deepEqual(normalizeOp({ op: 'amount', id: '12', amount: 6000, scope: 'series' }, { today }), { op: 'amount', id: 12, amount: 6000, scope: 'series' });
  assert.deepEqual(normalizeOp({ op: 'cancel', id: 12 }, { today }), { op: 'cancel', id: 12, scope: 'one' });
  assert.throws(() => normalizeOp({ op: 'cancel' }, { today }), /id/);
  assert.throws(() => normalizeOp({ op: 'move', id: 12 }, { today }), /needs a day/);
  assert.throws(() => normalizeOp({ op: 'cancel', id: 12, scope: 'all' }, { today }), /scope/);
  assert.throws(() => normalizeOp({ op: 'pay', id: 12 }, { today }), /unknown payment op/);
});

console.log(`\n${n} passed${process.exitCode ? ', with failures' : ''}`);
