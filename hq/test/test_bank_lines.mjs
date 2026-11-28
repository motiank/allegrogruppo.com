// The bank lines page's pure helpers (lib/bankLines.js): the totals, the action facets, the filters.
//   node --test hq/test/test_bank_lines.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { totalsOf, actionFacets, filterLines } from '../lib/bankLines.js';

const rows = [
  { date: '2026-11-03', action: 'שיק', details: 'שיק 16272', reference: '16272', moneyOut: 8291, payee: 'עיריית רעננה', imageId: 'A' },
  { date: '2026-11-03', action: 'העברה מהבנק', details: 'לטובת: אבי כהן עבור: שכר', reference: '452', moneyOut: 5000.5, payee: 'אבי כהן', payeeRole: 'to', payeePurpose: 'שכר' },
  { date: '2026-11-04', action: 'מקס איט פיננסי', details: 'מקס', reference: '1', moneyIn: 12000.25 },
  { date: '2026-11-05', action: 'שיק', details: 'שיק 16958', reference: '16958', moneyOut: 2000 },
  { date: '2026-11-05', action: '', details: 'עמלה', reference: '', moneyOut: 10 },
  { date: '2026-11-06', action: 'תיקון (תאריך ערך: 05/11)', details: 'תיקון', reference: '', moneyIn: 100 },
  { date: '2026-11-07', action: 'תיקון (תאריך ערך: 06/11)', details: 'תיקון', reference: '', moneyIn: 50 },
];

test('totalsOf sums in and out and the net', () => {
  assert.deepEqual(totalsOf(rows), { count: 7, moneyIn: 12150.25, moneyOut: 15301.5, net: -3151.25 });
  assert.deepEqual(totalsOf([]), { count: 0, moneyIn: 0, moneyOut: 0, net: 0 });
});

test('actionFacets: most frequent first, the empty action is "—"', () => {
  const f = actionFacets(rows);
  assert.deepEqual(f.map((x) => [x.action, x.count]), [['שיק', 2], ['תיקון', 2], ['העברה מהבנק', 1], ['מקס איט פיננסי', 1], ['—', 1]], 'the value-date suffix does not split a type');
  assert.equal(f[0].moneyOut, 10291);
  assert.equal(f[1].moneyIn, 150);
});

test('filterLines: words in the details / payee / reference, the action exactly, the side', () => {
  assert.equal(filterLines(rows, { q: 'כהן' }).length, 1);
  assert.equal(filterLines(rows, { q: 'שכר אבי' }).length, 1, 'every word must be there, in any order');
  assert.equal(filterLines(rows, { q: '16958' }).length, 1, 'the reference is searched');
  assert.equal(filterLines(rows, { action: 'שיק' }).length, 2);
  assert.equal(filterLines(rows, { action: '—' }).length, 1, 'the empty action is chosen as "—"');
  assert.equal(filterLines(rows, { side: 'in' }).length, 3);
  assert.equal(filterLines(rows, { side: 'out', action: 'שיק', q: 'רעננה' }).length, 1);
  assert.equal(filterLines(rows, {}).length, 7);
  assert.equal(filterLines(rows, { action: 'תיקון' }).length, 2, 'the type matches every value date');
  assert.deepEqual(totalsOf(filterLines(rows, { action: 'שיק' })), { count: 2, moneyIn: 0, moneyOut: 10291, net: -10291 });
});

test('nameKey / nameFacets / set filters (the header filters, owner 2026-11-28)', async () => {
  const { nameKey, nameFacets } = await import('../lib/bankLines.js');
  assert.equal(nameKey(rows[0]), 'עיריית רעננה', 'the payee first');
  assert.equal(nameKey({ details: 'לטובת: אבי כהן' }), 'אבי כהן', 'the bank prefix is dropped from the details');
  assert.equal(nameKey({ details: '' }), '—');
  assert.equal(nameKey({ event: { payee: 'ספק' } }), 'ספק');
  assert.deepEqual(nameFacets(rows).slice(0, 2).map((f) => [f.name, f.count]), [['תיקון', 2], ['אבי כהן', 1]]);
  assert.equal(filterLines(rows, { actions: new Set(['שיק', 'תיקון']) }).length, 4);
  assert.equal(filterLines(rows, { actions: ['שיק'], names: new Set(['עיריית רעננה']) }).length, 1);
  assert.equal(filterLines(rows, { actions: new Set(), names: [] }).length, 7, 'an empty set is no filter');
});
