// One request, start to finish: context → plan (model) → compute (joya-hq) → write (model)
// → check the numbers → answer (joya-hq). Separate from index.js so tests can drive it with
// a fake model and a fake hub.
import { unverifiedNumbers } from './verify.js';
import { fillTotals, floorMoney } from '../lib/answerTables.js';

const MAX_RESULT_CHARS = 60_000;

function trimResults(results) {
  return results.map((r) => {
    const s = JSON.stringify(r.result ?? null);
    if (s.length <= MAX_RESULT_CHARS) return r;
    return { ...r, result: JSON.parse(JSON.stringify(r.result, (k, v) => (Array.isArray(v) && v.length > 60 ? [...v.slice(0, 60), `… ${v.length - 60} more rows`] : v))) };
  });
}

export function parseJsonObject(text) {
  const s = String(text || '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('the model gave no JSON object');
  return JSON.parse(s.slice(a, b + 1));
}

/**
 * The team rules the chain admin approved in the chat — instructions, so they go in their own block and not inside
 * <context> (which is data only). Empty when there are none.
 */
export function rulesBlock(ctx) {
  const rules = Array.isArray(ctx.teamRules) ? ctx.teamRules : [];
  if (!rules.length) return [];
  return ['<team_rules>', ...rules.map((r) => `${r.id}. [${r.area || 'ALL'}] ${r.text}`), '</team_rules>'];
}

// The earlier questions of the same chat, oldest first. withAnswers: the writer also gets their (cut) answers.
export function historyBlock(ctx, { withAnswers = false } = {}) {
  const list = Array.isArray(ctx.history) ? ctx.history : [];
  if (!list.length) return [];
  const items = list.map((h) => ({ question: h.question, askedAt: h.askedAt, calcs: h.calcs || [], ...(withAnswers ? { answer: h.answer || '' } : {}) }));
  return ['<history>', JSON.stringify(items), '</history>'];
}

export function planPrompt(ctx) {
  const { teamRules, history, ...data } = ctx;
  return [
    'Plan the answer to this request. Reply with the JSON object only.',
    ...rulesBlock(ctx),
    ...historyBlock(ctx),
    '<context>',
    JSON.stringify(data),
    '</context>',
  ].join('\n');
}

export function writePrompt(ctx, computed, plan) {
  const parts = [
    `request.lang = ${ctx.request.lang}`,
    ...rulesBlock(ctx),
    ...historyBlock(ctx, { withAnswers: true }),
    '<request>',
    JSON.stringify({ question: ctx.request.question, contextKind: ctx.request.contextKind, today: ctx.today }),
    '</request>',
    '<context>',
    JSON.stringify({ locations: ctx.locations, roles: ctx.roles, shifts: ctx.shifts, object: ctx.object }),
    '</context>',
    '<results>',
    JSON.stringify(trimResults(computed.results || [])),
    '</results>',
  ];
  if (computed.proposal) parts.push('<proposal>', JSON.stringify({ type: computed.proposal.type, op: computed.proposal.op, rule: computed.proposal.rule, before: computed.proposal.before, preview: computed.proposal.preview, text: computed.proposal.text, note: computed.proposal.note }), '</proposal>');
  if (computed.proposalError) parts.push('<proposal_error>', JSON.stringify(computed.proposalError), '</proposal_error>');
  if (plan.note) parts.push(`planner note: ${plan.note}`);
  parts.push('Write the answer now (plain text, with a table only as the rules say).');
  return parts.join('\n');
}

/** The plan as the hub takes it: only well-formed calculation entries, the rest null. */
export function cleanPlan(plan) {
  const p = plan && typeof plan === 'object' ? plan : {};
  return {
    calcs: Array.isArray(p.calcs) ? p.calcs.filter((c) => c && typeof c.calc === 'string') : [],
    ops: Array.isArray(p.ops) ? p.ops : null,
    whatIf: Array.isArray(p.whatIf) ? p.whatIf : null,
    draft: typeof p.draft === 'string' ? p.draft : null,
    rule: p.rule && typeof p.rule === 'object' && !Array.isArray(p.rule) ? p.rule : null,
    note: typeof p.note === 'string' ? p.note : null,
  };
}

/**
 * @param {object} p
 * @param {number} p.id
 * @param {object} p.hub      { get(path), post(path, body) } → parsed JSON
 * @param {object} p.planner  { call(prompt) → { text } }
 * @param {object} p.writer   { call(prompt) → { text } }
 * @param {string} [p.instructionsVersion]  stored with the answer
 */
export async function handle({ id, hub, planner, writer, log = console, instructionsVersion = null }) {
  const started = Date.now();
  const claimed = await hub.post(`/joya/ai/runner/${id}/claim`, {});
  if (!claimed?.claimed) return { skipped: true };
  try {
    const ctx = await hub.get(`/joya/ai/runner/${id}/context`);
    let p = await planner.call(planPrompt(ctx));
    let cost = p.costUsd ?? 0;
    let raw;
    try {
      raw = parseJsonObject(p.text);
    } catch (e) {
      // one retry with the error, then give up
      p = await planner.call(`${planPrompt(ctx)}\n\nYour previous reply was not valid JSON (${e.message}). Reply with the JSON object only.`);
      cost += p.costUsd ?? 0;
      raw = parseJsonObject(p.text);
    }
    const plan = cleanPlan(raw);
    const computed = await hub.post(`/joya/ai/runner/${id}/compute`, { calcs: plan.calcs, ops: plan.ops, whatIf: plan.whatIf, draft: plan.draft, rule: plan.rule });
    const w = await writer.call(writePrompt(ctx, computed, plan));
    cost += w.costUsd ?? 0;
    // money in whole ₪, cut down; table totals are recalculated by the system from the table's rows; missing numbers in a table are 0 (owner)
    const { text: answer, totals } = fillTotals(floorMoney(String(w.text || '').trim()));
    const unverified = unverifiedNumbers(answer, totals, computed.results, computed.proposal, ctx.request.question, ctx.today, ctx.object, ctx.shifts, ctx.locations);
    await hub.post(`/joya/ai/runner/${id}/answer`, {
      answer,
      meta: { durationMs: Date.now() - started, model: w.model ?? null, instructionsVersion, costUsd: cost, calcs: plan.calcs.map((c) => c.calc), teamRules: (ctx.teamRules || []).map((r) => r.id), unverifiedNumbers: unverified, plannerNote: plan.note },
    });
    log.info?.(`[joya] #${id} answered in ${Date.now() - started} ms (${plan.calcs.length} calcs${computed.proposal ? ', proposal' : ''}${unverified.length ? `, ${unverified.length} unverified numbers` : ''})`);
    return { answered: true, unverified };
  } catch (e) {
    log.error?.(`[joya] #${id} failed: ${e.message}`);
    await hub.post(`/joya/ai/runner/${id}/answer`, { failed: true, error: e.message.slice(0, 500) }).catch(() => {});
    return { failed: true, error: e.message };
  }
}
