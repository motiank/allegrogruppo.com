import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileInvoice } from '../src/filing.js';
import { ModelUnavailable, parseOutput } from '../src/model.js';
import { processEmail } from '../src/process.js';
import { freeLock, takeLock } from '../src/state.js';
import { companies, fakeGmail, fakeStore, invoice, PDF, pdfAttachment } from './helpers.js';

const result = (o) => JSON.stringify({ type: 'result', ...o });

test('an email that is too long for the model is the email\'s fault, not a plan limit', () => {
  const out = result({ is_error: true, result: 'Prompt is too long · the request is ~2025833 tokens (limit 1000000)' });
  assert.throws(() => parseOutput(out, 1, ''), (e) => !(e instanceof ModelUnavailable) && /too long/.test(e.message));
  assert.throws(() => parseOutput(result({ is_error: true, result: 'You have hit your usage limit' }), 1, ''), ModelUnavailable);
});

test('the lock can be freed and taken again; a lock of another process is not freed', () => {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'lock-')), 'run.lock');
  assert.equal(takeLock(file), true);
  assert.equal(takeLock(file), false);
  freeLock(file);
  assert.equal(existsSync(file), false);
  assert.equal(takeLock(file), true);
  freeLock(file);
  writeFileSync(file, String(process.ppid));
  freeLock(file);
  assert.equal(existsSync(file), true);
  assert.equal(takeLock(file), false);
});

test('a row from another mailbox names the mailbox; the main mailbox adds nothing', async () => {
  const store = fakeStore();
  const rootId = await store.folder('Invoices');
  const place = { company: companies[0].name, direction: 'expense', party: 'Acme', partyTaxId: '514000111' };
  const file = { ext: 'pdf', mimeType: 'application/pdf', bytes: PDF };
  await fileInvoice({ store, rootId, place, inv: invoice(), file, email: { id: 'm1', account: 'other@example.com' } });
  await fileInvoice({ store, rootId, place, inv: invoice({ number: '2' }), file, email: { id: 'm2' } });
  const index = [...store.items.values()].find((o) => o.name === 'index.json').value;
  assert.equal(index.invoices[0].gmail_account, 'other@example.com');
  assert.equal('gmail_account' in index.invoices[1], false);
});

test('the filing runs inside the guard', async () => {
  const store = fakeStore();
  const rootId = await store.folder('Invoices');
  let inside = 0;
  const ask = async () => ({ decision: 'invoices', reason: 'ok', link_ids: [], invoices: [invoice()] });
  const r = await processEmail({ id: 'm1', gmail: fakeGmail({ attachments: [pdfAttachment] }), ask, fetchLink: async () => { throw new Error('no'); }, store, rootId, companies, dryRun: false, guard: async (fn) => { inside++; return fn(); } });
  assert.equal(r.status, 'filed');
  assert.equal(inside, 1);
});

test('rematch: a row of a newly added company leaves _unmatched; the party folder of a known tax id is reused', async () => {
  const { plan, placeRow } = await import('../src/rematch.js');
  const rows = [
    { from: 'Acme', from_tax_id: '514000111', to: 'איטליה פרימיום', to_tax_id: '515000222', number: '7', file: 'expense/Acme/7.pdf', drive_file_id: 'd1', books: { matched: false } },
    { from: 'Parking', from_tax_id: '1', to: 'A person', to_tax_id: '', number: '8', file: 'expense/Parking/8.pdf', drive_file_id: 'd2' },
    { from: 'פרימיום איטליה בע״מ', from_tax_id: '515000222', to: 'Wolt', to_tax_id: '9', number: '9', file: 'expense/x/9.pdf', drive_file_id: 'd3' },
  ];
  const { moves, stay } = plan(rows, companies);
  assert.deepEqual(stay.map((r) => r.number), ['8']);
  assert.deepEqual(moves.map((m) => [m.row.number, m.places[0].direction]), [['7', 'expense'], ['9', 'income']]);
  const index = { invoices: [{ direction: 'expense', party_folder: 'Acme Supplies Ltd', party_tax_id: '514000111', number: '1' }] };
  const placed = placeRow(rows[0], moves[0].places[0], index);
  assert.equal(placed.duplicate, false);
  assert.equal(placed.row.file, 'expense/Acme Supplies Ltd/7.pdf');
  assert.equal('books' in placed.row, false);
  index.invoices.push(placed.row);
  assert.equal(placeRow(rows[0], moves[0].places[0], index).duplicate, true);
});

test('a taxIdOnly company is matched by its tax id, never by its name', async () => {
  const { findCompany } = await import('../src/filing.js');
  const list = [...companies, { name: 'ג\'ויה רום בע"מ', taxIds: ['513000444'], taxIdOnly: true }];
  assert.equal(findCompany('משהו אחר', '513000444', list)?.name, 'ג\'ויה רום בע"מ');
  assert.equal(findCompany('ג\'ויה רום רמת החייל', '', list), undefined);
  assert.equal(findCompany('פסטה לינה בע"מ (ג\'ויה רום רמת החייל)', '', list)?.name, 'פסטה לינה בע"מ');
});

test('targets: a company goes to its own Drive folder; the rest and _unmatched go to the first target', async () => {
  const { openTargets } = await import('../src/targets.js');
  const store = fakeStore();
  const list = [...companies, { name: 'אן-קור בע"מ', taxIds: ['516000555'], target: 'owner' }];
  const targets = [{ name: 'main', folderName: 'Invoices' }, { name: 'owner', folderId: 'OWNER_FOLDER' }];
  const rootOf = await openTargets({ store, companies: list, targets });
  const mainId = await store.folder('Invoices');
  assert.equal(rootOf('אן-קור בע"מ'), 'OWNER_FOLDER');
  assert.equal(rootOf(companies[0].name), mainId);
  assert.equal(rootOf('_unmatched'), mainId);
  await assert.rejects(openTargets({ store, companies: [{ name: 'x', target: 'nope' }], targets }), /not in config\/targets.json/);

  // processEmail files by the company's root
  const ask = async () => ({ decision: 'invoices', reason: 'ok', link_ids: [], invoices: [invoice({ to_name: 'אן-קור', to_tax_id: '516000555' })] });
  const seen = [];
  const r = await processEmail({ id: 'm1', gmail: fakeGmail({ attachments: [pdfAttachment] }), ask, fetchLink: async () => { throw new Error('no'); }, store, rootId: (c) => { seen.push(c); return rootOf(c); }, companies: list, dryRun: false });
  assert.equal(r.status, 'filed');
  assert.deepEqual(seen, ['אן-קור בע"מ']);
  assert.ok([...store.items.values()].some((o) => o.name === 'אן-קור בע״מ' && o.parent === 'OWNER_FOLDER'));
});

test('latest: sorted by the time the agent found the invoice, not by the invoice date', async () => {
  const { latest } = await import('../src/latest.js');
  const rows = [
    { company: 'A', number: '1', date: '2026-11-20', filed_at: '2026-11-01T10:00:00Z' },
    { company: 'B', number: '2', date: '2024-12-01', filed_at: '2026-11-21T10:00:00Z' },
    { company: 'A', number: '3', date: '2025-06-01', filed_at: '2026-11-20T10:00:00Z' },
    { company: 'A', number: '4', date: '2025-06-01' },
  ];
  const now = Date.parse('2026-11-22T00:00:00Z');
  assert.deepEqual(latest(rows, { n: 2 }).map((r) => r.number), ['2', '3']);
  assert.deepEqual(latest(rows, { days: 3, now }).map((r) => r.number), ['2', '3']);
  assert.deepEqual(latest(rows, { company: 'A' }).map((r) => r.number), ['3', '1']);
});
