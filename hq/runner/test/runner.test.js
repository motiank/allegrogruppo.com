// The Joya runner with a fake model and a fake hub. Run: node joya/test/runner.test.js
import assert from 'assert/strict';
import { handle, parseJsonObject } from '../runner.js';
import { unverifiedNumbers } from '../verify.js';

let passed = 0;
const t = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}\n${e.stack}`);
    process.exitCode = 1;
  }
};

function fakeHub({ results = [], proposal = null } = {}) {
  const calls = [];
  return {
    calls,
    async get(p) {
      calls.push(['GET', p]);
      return { request: { id: 7, question: 'כמה מכרנו בשבוע שעבר?', lang: 'he', contextKind: 'GENERAL' }, today: '2026-10-12', locations: [{ id: 1, name: 'A' }], shifts: [], roles: [], calculations: [], object: null };
    },
    async post(p, body) {
      calls.push(['POST', p, body]);
      if (p.endsWith('/claim')) return { claimed: true };
      if (p.endsWith('/compute')) return { results, proposal, proposalError: null };
      return { ok: true };
    },
  };
}
const model = (text) => ({ calls: [], async call(prompt) { this.calls.push(prompt); return { text: typeof text === 'function' ? text(prompt) : text, model: 'fake' }; } });

console.log('joya runner');
await t('plan → compute → write → answer, numbers checked', async () => {
  const hub = fakeHub({ results: [{ calc: 'sales_summary', params: {}, result: { period: { from: '2026-10-05', to: '2026-10-11' }, source: 'joya_sales_checks', locations: [{ current: { revenue: 48210.5, checks: 812 } }] } }] });
  const planner = model('{"calcs":[{"calc":"sales_summary","params":{"from":"2026-10-05","to":"2026-10-11"}}],"ops":null,"whatIf":null,"draft":null,"note":"sales"}');
  const writer = model('בשבוע 5–11.10 ההכנסות היו ₪48,211 מתוך 812 חשבונות (קופת Bikum). צפי: 99,999.');
  const out = await handle({ id: 7, hub, planner, writer, log: {} });
  assert.equal(out.answered, true);
  const compute = hub.calls.find((c) => c[1].endsWith('/compute'));
  assert.equal(compute[2].calcs[0].calc, 'sales_summary');
  const ans = hub.calls.find((c) => c[1].endsWith('/answer'));
  assert.deepEqual(ans[2].meta.unverifiedNumbers, ['99,999']);
  assert.ok(writer.calls[0].includes('<results>'));
  assert.ok(planner.calls[0].includes('<context>'));
});
await t('a reply that is not JSON is retried once, then the request fails cleanly', async () => {
  const hub = fakeHub();
  const planner = model('sorry, I cannot');
  const out = await handle({ id: 7, hub, planner, writer: model('x'), log: {} });
  assert.equal(out.failed, true);
  assert.equal(planner.calls.length, 2);
  const ans = hub.calls.find((c) => c[1].endsWith('/answer'));
  assert.equal(ans[2].failed, true);
});
await t('a request another runner took is skipped', async () => {
  const hub = fakeHub();
  hub.post = async (p) => (p.endsWith('/claim') ? { claimed: false } : assert.fail('must not continue'));
  const out = await handle({ id: 7, hub, planner: model('{}'), writer: model('x'), log: {} });
  assert.equal(out.skipped, true);
});
await t('ops and what-if go to the hub only as proposals', async () => {
  const hub = fakeHub({ proposal: { type: 'STAFFING_OPS', preview: [] } });
  const planner = model('{"calcs":[],"ops":[{"op":"add","date":"2026-10-15","shiftCode":"morning","roleCode":"waiter","headcount":1,"start":"12:00"}],"whatIf":null}');
  await handle({ id: 7, hub, planner, writer: model('הוספת מלצר ממתינה לאישור שלך.'), log: {} });
  const compute = hub.calls.find((c) => c[1].endsWith('/compute'));
  assert.equal(compute[2].ops[0].roleCode, 'waiter');
  assert.ok(!hub.calls.some((c) => /apply/.test(c[1])), 'the runner never applies');
});

await t('a broken calcs list does not fail the request', async () => {
  const hub = fakeHub();
  const planner = model('{"calcs":[null,{"params":{}},{"calc":"sales_daily","params":{}}],"ops":"no"}');
  const out = await handle({ id: 7, hub, planner, writer: model('ok'), log: {} });
  assert.equal(out.answered, true);
  const compute = hub.calls.find((c) => c[1].endsWith('/compute'));
  assert.deepEqual(compute[2].calcs, [{ calc: 'sales_daily', params: {} }]);
  assert.equal(compute[2].ops, null);
});
await t('the prompt version and the cost of every model call are stored', async () => {
  const hub = fakeHub();
  let n = 0;
  const planner = { async call() { n++; return { text: n === 1 ? 'not json' : '{"calcs":[]}', costUsd: 0.01 }; } };
  const writer = { async call() { return { text: 'ok', costUsd: 0.02, model: 'fake' }; } };
  await handle({ id: 7, hub, planner, writer, log: {}, instructionsVersion: 'joya-hq-1+abcd1234' });
  const meta = hub.calls.find((c) => c[1].endsWith('/answer'))[2].meta;
  assert.equal(meta.instructionsVersion, 'joya-hq-1+abcd1234');
  assert.equal(Math.round(meta.costUsd * 100), 4);
});

console.log('number check');
await t('rounded, thousands and percentages match; invented ones do not', () => {
  const r = { a: 48210.46, b: 0.123, c: 812, d: '2026-10-05', e: 12345 };
  assert.deepEqual(unverifiedNumbers('48,210 · 48,210.46 · 12.3% · 812 · 5.10.2026 · 12.3K', r), []);
  assert.deepEqual(unverifiedNumbers('813 and 3 and 1', r), ['813', '3']);
});
await t('JSON is found inside extra text', () => {
  assert.deepEqual(parseJsonObject('Here: {"calcs":[]} done'), { calcs: [] });
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
