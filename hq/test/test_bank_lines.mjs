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
];

test('totalsOf sums in and out and the net', () => {
  assert.deepEqual(totalsOf(rows), { count: 5, moneyIn: 12000.25, moneyOut: 15301.5, net: -3301.25 });
  assert.deepEqual(totalsOf([]), { count: 0, moneyIn: 0, moneyOut: 0, net: 0 });
});

test('actionFacets: most frequent first, the empty action is "—"', () => {
  const f = actionFacets(rows);
  assert.deepEqual(f.map((x) => [x.action, x.count]), [['שיק', 2], ['העברה מהבנק', 1], ['מקס איט פיננסי', 1], ['—', 1]]);
  assert.equal(f[0].moneyOut, 10291);
});

test('filterLines: words in the details / payee / reference, the action exactly, the side', () => {
  assert.equal(filterLines(rows, { q: 'כהן' }).length, 1);
  assert.equal(filterLines(rows, { q: 'שכר אבי' }).length, 1, 'every word must be there, in any order');
  assert.equal(filterLines(rows, { q: '16958' }).length, 1, 'the reference is searched');
  assert.equal(filterLines(rows, { action: 'שיק' }).length, 2);
  assert.equal(filterLines(rows, { action: '—' }).length, 1, 'the empty action is chosen as "—"');
  assert.equal(filterLines(rows, { side: 'in' }).length, 1);
  assert.equal(filterLines(rows, { side: 'out', action: 'שיק', q: 'רעננה' }).length, 1);
  assert.equal(filterLines(rows, {}).length, 5);
  assert.deepEqual(totalsOf(filterLines(rows, { action: 'שיק' })), { count: 2, moneyIn: 0, moneyOut: 10291, net: -10291 });
});
