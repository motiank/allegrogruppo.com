import assert from 'node:assert/strict';
import { test } from 'node:test';
import { processEmail } from '../src/process.js';
import { companies, fakeGmail, fakeStore, invoice, PDF, pdfAttachment } from './helpers.js';

const answer = (o) => ({ decision: 'not_invoice', reason: 'r', link_ids: [], invoices: [], ...o });
const run = (o) => processEmail({ id: 'm1', store: fakeStore(), companies, fetchLink: async () => { throw new Error('no fetch expected'); }, ...o });

test('attachment with an invoice is filed under its number', async () => {
  const store = fakeStore();
  const r = await run({ store, gmail: fakeGmail({ attachments: [pdfAttachment] }), ask: async () => answer({ decision: 'invoices', invoices: [invoice()] }) });
  assert.equal(r.status, 'filed'); assert.equal(r.filed, 1);
  assert.ok(store.paths().some((p) => p.endsWith('/48213.pdf')));
});
test('email without invoice is ignored and nothing is saved', async () => {
  const store = fakeStore();
  const r = await run({ store, gmail: fakeGmail({ attachments: [pdfAttachment] }), ask: async () => answer({}) });
  assert.equal(r.status, 'ignored'); assert.equal(store.items.size, 0);
});
test('Form 101 with no invoice word: skipped, the model never sees it', async () => {
  for (const email of [{ subject: 'Fwd: טופס 101 - ישראל ישראלי' }, { subject: 'עובד חדש', attachments: [{ ...pdfAttachment, name: 'טופס_101.pdf' }] }]) {
    const r = await run({ gmail: fakeGmail({ attachments: [pdfAttachment], ...email }), ask: async () => assert.fail('model called') });
    assert.equal(r.status, 'ignored');
  }
});
test('Form 101 that also has an invoice word goes to the model', async () => {
  for (const email of [{ subject: 'טופס 101 וחשבונית' }, { subject: 'טופס 101', text: 'מצורפת גם invoice' }, { subject: 'טופס 101', attachments: [{ ...pdfAttachment, name: 'חשבונית.pdf' }] }]) {
    const r = await run({ gmail: fakeGmail({ attachments: [pdfAttachment], ...email }), ask: async () => answer({ decision: 'invoices', invoices: [invoice()] }) });
    assert.equal(r.status, 'filed');
  }
});
test('the number 101 alone is not Form 101', async () => {
  const r = await run({ gmail: fakeGmail({ subject: 'דור גז 101', attachments: [pdfAttachment] }), ask: async () => answer({ decision: 'invoices', invoices: [invoice()] }) });
  assert.equal(r.status, 'filed');
});
test('no attachment and no links: no model call', async () => {
  const r = await run({ gmail: fakeGmail({}), ask: async () => assert.fail('model called') });
  assert.equal(r.status, 'ignored');
});
test('no attachment: follows the link, reads the file, files it', async () => {
  const store = fakeStore();
  const asked = [];
  const ask = async (blocks) => { asked.push(blocks); return blocks.some((b) => b.type === 'document') ? answer({ decision: 'invoices', invoices: [invoice()] }) : answer({ decision: 'follow_link', link_ids: ['L1'] }); };
  const r = await run({ store, ask, gmail: fakeGmail({ links: [{ url: 'https://inv.co/1', text: 'download' }] }), fetchLink: async (u) => { assert.equal(u, 'https://inv.co/1'); return { type: 'file', name: 'doc.pdf', bytes: PDF }; } });
  assert.equal(r.status, 'filed'); assert.equal(asked.length, 2);
});
test('link goes to a page, the page has the file link', async () => {
  const seen = [];
  const ask = async (blocks) => {
    const text = blocks[0].text;
    if (blocks.some((b) => b.type === 'document')) return answer({ decision: 'invoices', invoices: [invoice()] });
    return answer({ decision: 'follow_link', link_ids: [text.includes('L2:') ? 'L2' : 'L1'] });
  };
  const fetchLink = async (u) => { seen.push(u); return u.endsWith('/page') ? { type: 'page', url: u, text: 'your invoice', links: [{ url: 'https://inv.co/file.pdf', text: 'PDF' }] } : { type: 'file', name: 'file.pdf', bytes: PDF }; };
  const r = await run({ ask, fetchLink, gmail: fakeGmail({ links: [{ url: 'https://inv.co/page', text: 'view' }] }) });
  assert.equal(r.status, 'filed'); assert.deepEqual(seen, ['https://inv.co/page', 'https://inv.co/file.pdf']);
});
test('the model cannot make the code open an address that is not in the list', async () => {
  const r = await run({ gmail: fakeGmail({ links: [{ url: 'https://inv.co/1', text: '' }] }), ask: async () => answer({ decision: 'follow_link', link_ids: ['http://evil.co/?leak=1', 'L99'] }) });
  assert.equal(r.status, 'needs_review');
});
test('model gives a bad link number first: it is asked again, then the invoice is filed', async () => {
  const answers = [answer({ decision: 'follow_link', link_ids: [] }), answer({ decision: 'follow_link', link_ids: ['1'] }), answer({ decision: 'invoices', invoices: [invoice()] })];
  const r = await run({ ask: async () => answers.shift(), gmail: fakeGmail({ links: [{ url: 'https://inv.co/1', text: '' }] }), fetchLink: async () => ({ type: 'file', name: 'a.pdf', bytes: PDF }) });
  assert.equal(r.status, 'filed');
});
test('a link that fails once is tried again', async () => {
  let n = 0;
  const ask = async (b) => (b.some((x) => x.type === 'document') ? answer({ decision: 'invoices', invoices: [invoice()] }) : answer({ decision: 'follow_link', link_ids: ['L1'] }));
  const r = await run({ ask, gmail: fakeGmail({ links: [{ url: 'https://inv.co/1', text: '' }] }), fetchLink: async () => { if (!n++) throw new Error('reset'); return { type: 'file', name: 'a.pdf', bytes: PDF }; } });
  assert.equal(r.status, 'filed');
});
test('a link that always leads on stops after the round limit', async () => {
  let n = 0; let calls = 0;
  const ask = async (b) => { calls++; return answer({ decision: 'follow_link', link_ids: [...b[0].text.matchAll(/L\d+/g)].map((m) => m[0]) }); };
  const fetchLink = async () => ({ type: 'page', url: 'x', text: '', links: [{ url: `https://a.co/${++n}`, text: '' }] });
  const r = await run({ ask, fetchLink, gmail: fakeGmail({ links: [{ url: 'https://a.co/0', text: '' }] }) });
  assert.equal(r.status, 'needs_review'); assert.ok(calls <= 4);
});
test('a failing link does not fail the email', async () => {
  const r = await run({ gmail: fakeGmail({ links: [{ url: 'https://a.co/0', text: '' }] }), fetchLink: async () => { throw new Error('the site answered 403'); }, ask: async (b) => (b[0].text.includes('403') ? answer({ decision: 'no_file', reason: 'login needed' }) : answer({ decision: 'follow_link', link_ids: ['L1'] })) });
  assert.equal(r.status, 'needs_review'); assert.equal(r.reason, 'login needed');
});
test('invoice without a number: not filed, needs review', async () => {
  const store = fakeStore();
  const r = await run({ store, gmail: fakeGmail({ attachments: [pdfAttachment] }), ask: async () => answer({ decision: 'invoices', invoices: [invoice({ number: '' })] }) });
  assert.equal(r.status, 'needs_review'); assert.equal(store.uploads, 0);
});
test('two invoices in one email: both filed; second email with the same invoice = duplicate', async () => {
  const store = fakeStore();
  const ask = async () => answer({ decision: 'invoices', invoices: [invoice(), invoice({ number: '48214' })] });
  const gmail = fakeGmail({ attachments: [pdfAttachment] });
  assert.equal((await run({ store, gmail, ask })).filed, 2);
  const again = await run({ store, gmail, ask });
  assert.equal(again.status, 'duplicate'); assert.equal(again.filed, 0);
});
test('dry run saves nothing', async () => {
  const r = await run({ store: null, dryRun: true, gmail: fakeGmail({ attachments: [pdfAttachment] }), ask: async () => answer({ decision: 'invoices', invoices: [invoice()] }) });
  assert.equal(r.filed, 1);
});
