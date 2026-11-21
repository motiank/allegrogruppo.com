// The pure helpers of the browser extension's bank run (../../joya-extension/bank-run.js): the date parts the site is
// asked for, the site's account id of a wanted account, the account list shapes. The file is a classic worker script
// (importScripts), so it is loaded in a sandbox with the globals it expects.
//   node --test hq/test/test_bank_extension.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import vm from 'vm';
import path from 'path';
import { fileURLToPath } from 'url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../joya-extension/bank-run.js');
const sandbox = { self: {}, say() {}, toJoya() {}, tabInfo() {}, ask() {}, sleep() {}, chrome: {}, console };
vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
// the helpers' objects come from the sandbox realm (another Object prototype) — compare plain copies
const plain = (v) => JSON.parse(JSON.stringify(v));
const { accountIdFor, matchesAccount } = sandbox.self.joyaBank;
const dateParts = (...a) => plain(sandbox.self.joyaBank.dateParts(...a));
const siteAccounts = (...a) => plain(sandbox.self.joyaBank.siteAccounts(...a));
const accountDigits = (...a) => plain(sandbox.self.joyaBank.accountDigits(...a));

test('dateParts: 10-day parts that cover the window exactly, inclusive', () => {
  assert.deepEqual(dateParts('2026-11-09', '2026-11-22', 10), [
    { from: '2026-11-09', to: '2026-11-18' },
    { from: '2026-11-19', to: '2026-11-22' },
  ]);
  assert.deepEqual(dateParts('2026-11-22', '2026-11-22', 10), [{ from: '2026-11-22', to: '2026-11-22' }]);
  assert.deepEqual(dateParts('2026-11-23', '2026-11-22', 10), []);
  assert.deepEqual(dateParts('junk', '2026-11-22', 10), []);
  assert.equal(dateParts('2025-01-01', '2026-11-22', 10).length, 70); // 691 days
});

test('accountIdFor: the id whose last number is the account wins; else the first id with its last number replaced', () => {
  assert.equal(accountIdFor(['584-55663', '584-136663'], '12-584-136663'), '584-136663');
  assert.equal(accountIdFor(['584-55663'], '12-584-136663'), '584-136663');
  assert.equal(accountIdFor(['12-584-000055663'], '12-584-136663'), '12-584-000136663'); // zero-padded ids keep their length
  assert.equal(accountIdFor(['ABC-55663'], '12-584-136661'), 'ABC-136661');
  assert.equal(accountIdFor([], '12-584-136663'), null);
  assert.equal(accountIdFor(['x'], ''), null);
});

test('siteAccounts and matchesAccount read the account list in its possible shapes', () => {
  const list = siteAccounts({ accounts: [{ bankNumber: 12, branchNumber: 584, accountNumber: 136663, accountClosingReasonCode: 0 }, { bankNumber: 12, branchNumber: 584, accountNumber: 55663, accountClosingReasonCode: 1, accountId: 'X' }] });
  assert.equal(list.length, 2);
  assert.equal(list[1].closed, true);
  assert.equal(list[1].id, 'X');
  assert.ok(matchesAccount(list[0], '12-584-136663'));
  assert.ok(!matchesAccount(list[0], '12-584-136661'));
  assert.ok(matchesAccount({ accountNumber: '0136663' }, '584-136663'));
  assert.deepEqual(accountDigits('12-584-136663'), { branch: '584', number: '136663' });
  assert.deepEqual(siteAccounts(null), []);
});
