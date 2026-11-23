import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileInvoice, findCompany, problem, route, safeName, UNMATCHED } from '../src/filing.js';
import { companies, fakeStore, invoice, PDF } from './helpers.js';

const file = { id: 'f1', ext: 'pdf', mimeType: 'application/pdf', bytes: PDF };
const put = (store, inv, place = route(inv, companies)[0]) => fileInvoice({ store, rootId: undefined, place, inv, file, email: { id: 'm1' } });

test('our company is the buyer: expense under the supplier', () => {
  assert.deepEqual(route(invoice(), companies), [{ company: 'פרימיום איטליה בע"מ', direction: 'expense', party: 'Acme Supplies Ltd', partyTaxId: '514000111' }]);
});
test('our company is the seller: income under the customer', () => {
  const r = route(invoice({ from_name: 'x', from_tax_id: '515000333', to_name: 'Customer', to_tax_id: '1' }), companies);
  assert.equal(r[0].direction, 'income'); assert.equal(r[0].company, 'פסטה לינה בע"מ'); assert.equal(r[0].party, 'Customer');
});
test('between two of our companies: filed on both sides', () => {
  const r = route(invoice({ from_tax_id: '515000333', from_name: 'פסטה לינה' }), companies);
  assert.deepEqual(r.map((p) => p.direction), ['income', 'expense']);
});
test('no company of ours: goes to _unmatched', () => {
  assert.equal(route(invoice({ to_name: 'Other', to_tax_id: '999' }), companies)[0].company, UNMATCHED);
});
test('company found by name without a tax id, ignoring בע"מ and spaces', () => {
  assert.equal(findCompany('פסטה  לינה בע״מ', '', companies).name, 'פסטה לינה בע"מ');
});
test('company found when the invoice adds a branch to the name', () => {
  assert.equal(findCompany(`פסטה לינה בע"מ (ג'ויה רום רמת החייל)`, '', companies).name, 'פסטה לינה בע"מ');
  assert.equal(findCompany('פסטה ושות', '', companies), undefined);
});
test('file name cannot leave its folder', () => {
  assert.ok(!safeName('../../etc/passwd').includes('/'));
  assert.ok(!safeName('12/34').includes('/'));
});
test('bad data is not filed', () => {
  const files = [{ id: 'f1' }];
  assert.equal(problem(invoice(), files), null);
  assert.match(problem(invoice({ number: '' }), files), /number/);
  assert.match(problem(invoice({ total: 0 }), files), /total/);
  assert.match(problem(invoice({ date: '30/10/2026' }), files), /date/);
  assert.match(problem(invoice({ file_id: 'f9' }), files), /file/);
});
test('files in the asked structure, with index.json', async () => {
  const s = fakeStore();
  await put(s, invoice());
  assert.deepEqual(s.paths(), ['פרימיום איטליה בע״מ/expense/Acme Supplies Ltd/48213.pdf', 'פרימיום איטליה בע״מ/index.json']);
  const index = [...s.items.values()].find((o) => o.name === 'index.json').value;
  const row = index.invoices[0];
  assert.equal(row.total, 1170); assert.equal(row.allocation_number, '202611223344'); assert.equal(row.from, 'Acme Supplies Ltd'); assert.equal(row.gmail_message_id, 'm1');
});
test('the same invoice twice is filed once', async () => {
  const s = fakeStore();
  assert.equal((await put(s, invoice())).duplicate, false);
  assert.equal((await put(s, invoice())).duplicate, true);
  assert.equal(s.uploads, 1);
});
test('same tax id, other spelling: same supplier folder', async () => {
  const s = fakeStore();
  await put(s, invoice());
  await put(s, invoice({ number: '2', from_name: 'ACME SUPPLIES' }));
  assert.ok(s.paths().includes('פרימיום איטליה בע״מ/expense/Acme Supplies Ltd/2.pdf'));
});
test('crash after upload, before index: the file is not uploaded again', async () => {
  const s = fakeStore();
  const write = s.writeJson;
  s.writeJson = async () => { throw new Error('crash'); };
  await assert.rejects(put(s, invoice()));
  s.writeJson = write;
  await put(s, invoice());
  assert.equal(s.uploads, 1);
  assert.equal([...s.items.values()].find((o) => o.name === 'index.json').value.invoices.length, 1);
});
