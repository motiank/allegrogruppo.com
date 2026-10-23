// Labelled evaluation of the Joya HQ planner: runs each question of eval/fixtures.json through the
// runner's real planner path (planPrompt → model → parseJsonObject → cleanPlan) against the fixed
// contexts in eval/contexts.json, and grades the plan against the labels: which calculations, their
// dates / locations / params, the proposed changes, what-if and draft. Nothing is sent to joya-hq.
// Uses the real model through `claude -p` — every run costs subscription usage (~32 calls, ~5–10 s each).
//
//   node joya/scripts/eval.mjs [--model=haiku] [--only=<key substring>] [--concurrency=4]
//
// The contexts come from hq/scripts/joya-eval-context.mjs (demo data on the local mirror).
// The writer step is not evaluated here (it needs the hub's results).
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TriageModel } from '../model.js';
import { PLAN_PROMPT, INSTRUCTIONS_VERSION } from '../hq-analyst.js';
import { planPrompt, parseJsonObject, cleanPlan } from '../runner.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const stateDir = path.join(here, '../state');
mkdirSync(stateDir, { recursive: true });
const { contexts, capturedAt } = JSON.parse(readFileSync(path.join(here, '../eval/contexts.json'), 'utf8'));
const fixtures = JSON.parse(readFileSync(path.join(here, '../eval/fixtures.json'), 'utf8')).fixtures.filter((f) => !arg('only') || f.key.includes(arg('only')));
const modelName = arg('model', process.env.JOYA_MODEL ?? 'sonnet');
const model = new TriageModel({ model: modelName, workDir: path.join(stateDir, 'plan-eval'), systemPrompt: PLAN_PROMPT, timeoutMs: 120_000 });

/** 'a|b' in a label accepts either; numbers compare as numbers; "10:00" matches "10:00:00". */
function same(actual, expected) {
  if (typeof expected === 'string' && expected.includes('|')) return expected.split('|').some((e) => same(actual, e));
  if (typeof expected === 'number') return Number(actual) === expected;
  if (typeof expected === 'string' && typeof actual === 'string') return actual === expected || actual.startsWith(`${expected}:`);
  return actual === expected;
}
const partial = (obj, exp) => obj && Object.entries(exp).every(([k, v]) => same(obj[k], v));
const locIds = (p) => {
  const v = p?.locationIds ?? (p?.locationId != null ? [p.locationId] : null);
  return v == null ? null : (Array.isArray(v) ? v : [v]).map(Number).sort();
};

function grade(f, plan) {
  const e = f.expect;
  const fails = [];
  const names = plan.calcs.map((c) => c.calc);
  for (const want of e.calcs || []) if (!want.split('|').some((n) => names.includes(n))) fails.push(`calc ${want} missing (got ${names.join(', ') || 'none'})`);
  for (const [calc, want] of Object.entries(e.params || {})) {
    const got = plan.calcs.filter((c) => c.calc === calc);
    if (got.length && !got.some((c) => partial(c.params, want))) fails.push(`${calc} params ${JSON.stringify(got[0].params)} ≠ ${JSON.stringify(want)}`);
  }
  if (e.range) {
    const dated = plan.calcs.filter((c) => c.params?.from || c.params?.to);
    if (!dated.length) fails.push('no dated calculation');
    for (const c of dated) if (!same(c.params.from, e.range.from) || !same(c.params.to, e.range.to)) fails.push(`${c.calc} range ${c.params.from}..${c.params.to} ≠ ${e.range.from}..${e.range.to}`);
  }
  if (e.location) {
    const want = [...e.location].sort().join(',');
    for (const c of plan.calcs) {
      const got = locIds(c.params);
      if (got?.join(',') !== want) fails.push(`${c.calc} locations ${got ? got.join(',') : 'all'} ≠ ${want}`);
    }
  }
  if (e.maxCalcs != null && plan.calcs.length > e.maxCalcs) fails.push(`${plan.calcs.length} calcs > ${e.maxCalcs}`);
  const ops = plan.ops || [];
  if (Array.isArray(e.ops)) {
    for (const want of e.ops) if (!ops.some((o) => partial(o, want))) fails.push(`op ${JSON.stringify(want)} missing (got ${JSON.stringify(ops)})`);
    if (ops.length > e.ops.length) fails.push(`${ops.length} ops, expected ${e.ops.length}`);
  } else if (e.ops === 'some') {
    if (!ops.length) fails.push('no ops');
  } else if (ops.length) fails.push(`unexpected ops ${JSON.stringify(ops)}`);
  const hasWhatIf = !!plan.whatIf?.length;
  if (!!e.whatIf !== hasWhatIf) fails.push(e.whatIf ? 'whatIf missing' : `unexpected whatIf ${JSON.stringify(plan.whatIf)}`);
  const hasDraft = !!plan.draft?.trim();
  if (!!e.draft !== hasDraft) fails.push(e.draft ? 'draft missing' : 'unexpected draft');
  return fails;
}

function contextFor(f) {
  const base = contexts[f.kind];
  if (!base) throw new Error(`no context of kind ${f.kind} in eval/contexts.json`);
  const ctx = structuredClone(base);
  Object.assign(ctx.request, { question: f.question, lang: f.lang || 'he' });
  if (f.inquiryContent && ctx.object?.inquiry) ctx.object.inquiry.content = f.inquiryContent;
  return ctx;
}

async function runOne(f) {
  const started = Date.now();
  try {
    const r = await model.call(planPrompt(contextFor(f)));
    const plan = cleanPlan(parseJsonObject(r.text));
    const fails = grade(f, plan);
    return { key: f.key, ok: !fails.length, fails, plan, ms: Date.now() - started, costUsd: r.costUsd };
  } catch (e) {
    return { key: f.key, ok: false, fails: [`error: ${e.message}`], ms: Date.now() - started };
  }
}

const results = [];
const queue = [...fixtures];
const concurrency = Number(arg('concurrency', 4));
console.log(`joya planner eval: ${fixtures.length} questions, model ${modelName}, ${INSTRUCTIONS_VERSION}, contexts of ${capturedAt}\n`);
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      const r = await runOne(f);
      results.push(r);
      console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${f.key.padEnd(22)} ${String(r.ms).padStart(6)} ms${r.ok ? '' : `\n         ${r.fails.join('\n         ')}`}`);
    }
  }),
);

const passed = results.filter((r) => r.ok).length;
const byKind = {};
for (const f of fixtures) {
  const k = (byKind[f.kind] ??= { n: 0, ok: 0 });
  k.n++;
  if (results.find((r) => r.key === f.key)?.ok) k.ok++;
}
const report = {
  at: new Date().toISOString(),
  model: modelName,
  instructionsVersion: INSTRUCTIONS_VERSION,
  contextsCapturedAt: capturedAt,
  passed,
  total: results.length,
  byKind,
  medianMs: results.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(results.length / 2)],
  costUsd: results.reduce((s, r) => s + (r.costUsd ?? 0), 0),
  results: results.sort((a, b) => a.key.localeCompare(b.key)),
};
const file = path.join(stateDir, `eval-${report.at.slice(0, 19).replace(/[:T]/g, '-')}.json`);
writeFileSync(file, JSON.stringify(report, null, 1));
console.log(`\n${passed}/${results.length} passed  ${Object.entries(byKind).map(([k, v]) => `${k} ${v.ok}/${v.n}`).join('  ')}  median ${report.medianMs} ms\n→ ${file}`);
