import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as XLSX from 'xlsx';
import { prepareFile, worthReading } from '../src/files.js';
import { parseMessage } from '../src/gmail.js';
import { fetchLink, isPrivate } from '../src/download.js';
import { parseOutput, ModelUnavailable } from '../src/model.js';
import { loadState, MAX_ATTEMPTS } from '../src/state.js';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const b64 = (s) => Buffer.from(s).toString('base64url');

test('reads headers, html text, links and nested attachments', () => {
  const html = '<html><head><style>x{}</style></head><body><p>שלום &amp; hello</p><a href="https://inv.co/d?a=1&amp;b=2">להורדת החשבונית</a><a href="https://x.co/unsubscribe">הסרה</a><a href="mailto:a@b.c">m</a></body></html>';
  const m = parseMessage({ id: 'm1', payload: { mimeType: 'multipart/mixed', headers: [{ name: 'From', value: 'a@b' }, { name: 'Subject', value: 'חשבונית' }], parts: [
    { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: b64('hello https://inv.co/d?a=1&b=2') } }, { mimeType: 'text/html', body: { data: b64(html) } }] },
    { mimeType: 'application/pdf', filename: 'i.pdf', body: { attachmentId: 'A', size: 9 }, headers: [{ name: 'Content-Disposition', value: 'attachment' }] },
  ] } });
  assert.equal(m.subject, 'חשבונית');
  assert.match(m.text, /שלום & hello/);
  assert.deepEqual(m.links, [{ url: 'https://inv.co/d?a=1&b=2', text: 'להורדת החשבונית' }]);
  assert.equal(m.attachments[0].attachmentId, 'A');
});
test('a logo is skipped, a scanned invoice image is read', () => {
  assert.equal(worthReading({ mimeType: 'image/png', size: 3000, inline: true }), false);
  assert.equal(worthReading({ mimeType: 'image/jpeg', size: 400000, inline: false }), true);
  assert.equal(worthReading({ mimeType: 'application/pdf', size: 100 }), true);
});
test('excel files become text; both xlsx and old xls', () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['חשבונית מס', 777], ['סה"כ', 117]]), 'א');
  for (const [name, bookType] of [['i.xlsx', 'xlsx'], ['i.xls', 'biff8']]) {
    const f = prepareFile({ id: 'f1', name, bytes: XLSX.write(book, { type: 'buffer', bookType }) });
    assert.equal(f.kind, 'sheet'); assert.match(f.text, /חשבונית מס,777/);
  }
});
test('a pdf is known by its bytes; a password pdf and unknown types are marked', () => {
  assert.equal(prepareFile({ id: 'f', name: 'noext', bytes: Buffer.from('%PDF-1.7 x') }).ext, 'pdf');
  assert.equal(prepareFile({ id: 'f', name: 'a.pdf', bytes: Buffer.from('%PDF-1.7 /Encrypt 5 0 R') }).kind, 'unreadable');
  assert.equal(prepareFile({ id: 'f', name: 'a.zip', bytes: Buffer.from('PK') }).kind, 'unreadable');
});
test('private addresses are blocked', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '172.20.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1', '100.64.0.1']) assert.equal(isPrivate(ip), true, ip);
  for (const ip of ['8.8.8.8', '2606:4700::1']) assert.equal(isPrivate(ip), false, ip);
  for (const url of ['http://127.0.0.1/local-api/v1', 'http://[::1]/', 'http://localhost/', 'http://169.254.169.254/latest', 'file:///etc/passwd', 'ftp://x.co/a', 'https://x.co:3021/', 'https://u:p@x.co/']) await assert.rejects(fetchLink(url), undefined, url);
});
test('model output: result, plan limit and bad output are told apart', () => {
  const line = (o) => `${JSON.stringify(o)}\n`;
  assert.deepEqual(parseOutput(line({ type: 'system' }) + line({ type: 'result', structured_output: { a: 1 } }), 0, ''), { a: 1 });
  assert.throws(() => parseOutput(line({ type: 'result', is_error: true, result: "You've hit your usage limit" }), 1, ''), ModelUnavailable);
  assert.throws(() => parseOutput(line({ type: 'result', is_error: true, result: 'Not logged in · Please run /login' }), 1, ''), ModelUnavailable);
  assert.throws(() => parseOutput('', 1, "error: unknown option '--safe-mode'"), ModelUnavailable);
  assert.throws(() => parseOutput(line({ type: 'result', is_error: true, result: 'Could not process PDF' }), 1, ''), (e) => !(e instanceof ModelUnavailable));
});
test('state: done emails stay done after reload; failures retry, then need review', () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'st-')), 's.json');
  const s = loadState(file);
  s.record('a', { status: 'filed' });
  assert.equal(loadState(file).isDone('a'), true);
  for (let i = 1; i <= MAX_ATTEMPTS; i++) { assert.equal(s.isDone('b'), false); s.fail('b', {}, 'x'); }
  assert.equal(s.messages.b.status, 'needs_review');
  assert.equal(s.isDone('b'), true);
});
