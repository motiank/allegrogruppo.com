// One request, start to finish: context → plan (model) → compute (joya-hq) → write (model)
// → check the numbers → answer (joya-hq). Separate from index.js so tests can drive it with
// a fake model and a fake hub.
import { unverifiedNumbers } from './verify.js';
import { fillTotals, floorMoney } from '../lib/answerTables.js';

const MAX_RESULT_CHARS = 60_000;

// keep = rows per list when the result is big (60); a file answer that is not shown in the chat keeps only 10
function trimResults(results, keep = 60) {
  return results.map((r) => {
    const s = JSON.stringify(r.result ?? null);
    if (s.length <= MAX_RESULT_CHARS && keep >= 60) return r;
    return { ...r, result: JSON.parse(JSON.stringify(r.result, (k, v) => (Array.isArray(v) && v.length > keep ? [...v.slice(0, keep), `… ${v.length - keep} more rows (all of them are in the file)`] : v))) };
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

/**
 * The context as JSON. In a live session (`sent` = what this conversation was given before, part by part) a part that
 * did not change is left out and named in "sameAsBefore": the model has it from an earlier message.
 */
function contextJson(data, sent) {
  if (!sent) return JSON.stringify(data);
  const out = {};
  const same = [];
  for (const [k, v] of Object.entries(data)) {
    const j = JSON.stringify(v ?? null);
    if (k !== 'request' && sent[k] === j) same.push(k);
    else {
      out[k] = v;
      sent[k] = j;
    }
  }
  if (same.length) out.sameAsBefore = same;
  return JSON.stringify(out);
}

const PREVIOUS_ANSWER_CHARS = 1500;
const cut = (t) => (t.length > PREVIOUS_ANSWER_CHARS ? `${t.slice(0, PREVIOUS_ANSWER_CHARS)} …` : t);

// live: { sent, first, previousAnswer } — a live session: only the changed context; the history only in its first message
export function planPrompt(ctx, live = null) {
  const { teamRules, history, chat, ...data } = ctx;
  return [
    'Plan the answer to this request. Reply with the JSON object only.',
    ...rulesBlock(ctx),
    ...(!live || live.first ? historyBlock(ctx) : []),
    // a live session: the answer the user got for the previous message (the planner did not see it)
    ...(live?.previousAnswer ? ['<previous_answer>', cut(live.previousAnswer), '</previous_answer>'] : []),
    '<context>',
    contextJson(data, live?.sent),
    '</context>',
  ].join('\n');
}

export function writePrompt(ctx, computed, plan, live = null) {
  const parts = [
    `request.lang = ${ctx.request.lang}`,
    ...rulesBlock(ctx),
    ...(!live || live.first ? historyBlock(ctx, { withAnswers: true }) : []),
    '<request>',
    JSON.stringify({ question: ctx.request.question, contextKind: ctx.request.contextKind, today: ctx.today }),
    '</request>',
    '<context>',
    contextJson({ locations: ctx.locations, roles: ctx.roles, shifts: ctx.shifts, object: ctx.object }, live?.sent),
    '</context>',
    '<results>',
    JSON.stringify(trimResults(computed.results || [], computed.file && !computed.file.show ? 10 : undefined)),
    '</results>',
  ];
  if (computed.proposal) parts.push('<proposal>', JSON.stringify({ type: computed.proposal.type, op: computed.proposal.op, rule: computed.proposal.rule, before: computed.proposal.before, preview: computed.proposal.preview, text: computed.proposal.text, note: computed.proposal.note, company: computed.proposal.company, ops: computed.proposal.ops }), '</proposal>');
  if (computed.proposalError) parts.push('<proposal_error>', JSON.stringify(computed.proposalError), '</proposal_error>');
  // a file answer: the sheet that was made (the chat shows its link under the answer) or why it was not
  if (computed.file) parts.push('<file>', JSON.stringify({ kind: computed.file.kind, name: computed.file.name, rows: computed.file.rows, tabs: computed.file.tabs, show: computed.file.show }), '</file>');
  if (computed.fileError) parts.push('<file_error>', JSON.stringify(computed.fileError), '</file_error>');
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
    payments: Array.isArray(p.payments) ? p.payments.filter((o) => o && typeof o === 'object') : null,
    // a file answer: { kind: 'sheet', title?, show? } — the rows go into a Google Sheet, the chat gets the link
    file: p.file && typeof p.file === 'object' && !Array.isArray(p.file) ? { kind: 'sheet', title: typeof p.file.title === 'string' ? p.file.title : null, show: p.file.show === true, columns: Array.isArray(p.file.columns) ? p.file.columns : null } : null,
    note: typeof p.note === 'string' ? p.note : null,
  };
}

/**
 * @param {object} p
 * @param {number} p.id
 * @param {object} p.hub      { get(path), post(path, body) } → parsed JSON
 * @param {object} p.planner  { call(prompt) → { text } } — one-time calls
 * @param {object} p.writer   { call(prompt) → { text } }
 * @param {object} [p.sessions]  ChatSessions (session.js): the live sessions; without it every call is one-time
 * @param {string} [p.instructionsVersion]  stored with the answer
 */
export async function handle({ id, hub, planner, writer, sessions = null, log = console, instructionsVersion = null }) {
  const started = Date.now();
  const claimed = await hub.post(`/joya/ai/runner/${id}/claim`, {});
  if (!claimed?.claimed) return { skipped: true };
  try {
    const ctx = await hub.get(`/joya/ai/runner/${id}/context`);
    if (!sessions || !ctx.chat?.key) return await answerOne({ id, ctx, hub, planner, writer, log, instructionsVersion, started });
    // the questions of one chat go one after the other through its live session
    return await sessions.run(ctx.chat.key, async () => {
      const s = sessions.open(ctx.chat, id);
      if (!s) return answerOne({ id, ctx, hub, planner, writer, log, instructionsVersion, started });
      let out;
      try {
        out = await answerOne({ id, ctx, hub, planner: s.planner, writer: s.writer, live: s, log, instructionsVersion, started });
      } finally {
        sessions.done(s, id, out?.answered ? { answered: true, results: out.results, answer: out.answer } : { answered: false });
      }
      return out;
    });
  } catch (e) {
    log.error?.(`[joya] #${id} failed: ${e.message}`);
    await hub.post(`/joya/ai/runner/${id}/answer`, { failed: true, error: e.message.slice(0, 500) }).catch(() => {});
    return { failed: true, error: e.message };
  }
}

// live: the chat's live session ({ sent, turns, pastResults }) — the model already has the earlier questions
async function answerOne({ id, ctx, hub, planner, writer, live = null, log, instructionsVersion, started }) {
  const lv = live ? { sent: live.sent.plan, first: live.turns === 0, previousAnswer: live.lastAnswer } : null;
  let p = await planner.call(planPrompt(ctx, lv));
  let cost = p.costUsd ?? 0;
  let raw;
  try {
    raw = parseJsonObject(p.text);
  } catch (e) {
    // one retry with the error, then give up (a live session has the request already)
    const again = `Your previous reply was not valid JSON (${e.message}). Reply with the JSON object only.`;
    p = await planner.call(live ? again : `${planPrompt(ctx)}\n\n${again}`);
    cost += p.costUsd ?? 0;
    raw = parseJsonObject(p.text);
  }
  const plan = cleanPlan(raw);
  const computed = await hub.post(`/joya/ai/runner/${id}/compute`, { calcs: plan.calcs, ops: plan.ops, whatIf: plan.whatIf, draft: plan.draft, rule: plan.rule, payments: plan.payments, file: plan.file });
  const w = await writer.call(writePrompt(ctx, computed, plan, live ? { sent: live.sent.write, first: live.turns === 0 } : null));
  cost += w.costUsd ?? 0;
  // money in whole ₪, cut down; table totals are recalculated by the system from the table's rows; missing numbers in a table are 0 (owner)
  const { text: answer, totals } = fillTotals(floorMoney(String(w.text || '').trim()));
  // in a live session the answer may also quote the results of the earlier questions of the conversation
  const unverified = unverifiedNumbers(answer, totals, computed.results, live?.pastResults ?? [], computed.proposal, ctx.request.question, ctx.today, ctx.object, ctx.shifts, ctx.locations);
  await hub.post(`/joya/ai/runner/${id}/answer`, {
    answer,
    meta: { durationMs: Date.now() - started, model: w.model ?? null, instructionsVersion, costUsd: cost, calcs: plan.calcs.map((c) => c.calc), teamRules: (ctx.teamRules || []).map((r) => r.id), unverifiedNumbers: unverified, plannerNote: plan.note, ...(live ? { liveTurn: live.turns + 1 } : {}) },
  });
  log.info?.(`[joya] #${id} answered in ${Date.now() - started} ms (${plan.calcs.length} calcs${computed.proposal ? ', proposal' : ''}${unverified.length ? `, ${unverified.length} unverified numbers` : ''}${live ? `, live turn ${live.turns + 1}` : ''})`);
  return { answered: true, unverified, answer, results: trimResults(computed.results || []) };
}
