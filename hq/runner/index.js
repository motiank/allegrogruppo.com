#!/usr/bin/env node
/**
 * Joya HQ AI runner — `npm run runner` in hq/ (a service next to Joya HQ on the server, see README.md).
 *
 * Polls the Joya Headquarter service (hq/) for questions and change requests written in the Joya Headquarter
 * app, plans which calculations to run (claude -p, subscription login, no API key),
 * lets the SERVICE compute the numbers with the asking user's access, writes the answer
 * from those results, flags any number it cannot find in them, and posts it back.
 * It never writes to the database and never applies a change: proposals wait for the
 * user's Apply in the app.
 *
 * Env (names only):
 *   JOYA_HQ_URL        joya-hq API base (default http://<JOYA_HQ_HOST>:<JOYA_HQ_PORT>/api = http://127.0.0.1:4300/api)
 *   JOYA_API_KEY       machine key (X-Joya-Key); with none, joya-hq accepts loopback only
 *   JOYA_MODEL         sonnet
 *   JOYA_POLL_MS       3000
 *   JOYA_CONCURRENCY   2
 *   JOYA_STATE_DIR     working dir for the model calls (hq/runner/state)
 *   JOYA_LIVE_SESSIONS     6 — live chat sessions at most (session.js; 0 = every call one-time)
 *   JOYA_SESSION_IDLE_MIN  30 — a session with no question for this long closes
 *   JOYA_SESSION_MAX_TOKENS 150000 — a longer conversation starts again from the history
 */
import '../lib/env.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { TriageModel } from './model.js';
import { PLAN_PROMPT, WRITE_PROMPT, INSTRUCTIONS_VERSION } from './hq-analyst.js';
import { handle } from './runner.js';
import { LiveModel, ChatSessions, SESSION_DEFAULTS } from './session.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;
const cfg = {
  // The same host and port joya-hq listens on (server.js): 'localhost' may resolve to ::1, where it does not listen.
  hubUrl: (env.JOYA_HQ_URL ?? `http://${env.JOYA_HQ_HOST || '127.0.0.1'}:${env.JOYA_HQ_PORT || env.PORT || 4300}/api`).replace(/\/$/, ''),
  apiKey: env.JOYA_API_KEY || null,
  model: env.JOYA_MODEL ?? 'sonnet',
  pollMs: Number(env.JOYA_POLL_MS ?? 3000),
  concurrency: Number(env.JOYA_CONCURRENCY ?? 2),
  stateDir: env.JOYA_STATE_DIR ?? path.join(here, 'state'),
  liveSessions: Number(env.JOYA_LIVE_SESSIONS ?? SESSION_DEFAULTS.maxSessions),
  idleMs: Number(env.JOYA_SESSION_IDLE_MIN ?? 30) * 60_000,
  maxTokens: Number(env.JOYA_SESSION_MAX_TOKENS ?? SESSION_DEFAULTS.maxTokens),
};
const ts = () => new Date().toISOString();
const log = { info: (m) => console.log(`${ts()} ${m}`), error: (m) => console.error(`${ts()} ERROR ${m}`) };

async function req(method, p, body) {
  const res = await fetch(cfg.hubUrl + p, {
    method,
    headers: { 'content-type': 'application/json', ...(cfg.apiKey ? { 'x-joya-key': cfg.apiKey } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${data?.error ?? ''}`);
  return data;
}
const hub = { get: (p) => req('GET', p), post: (p, b) => req('POST', p, b) };

// Separate empty working dirs: the repo's files must never become part of the context.
const planner = new TriageModel({ model: cfg.model, workDir: path.join(cfg.stateDir, 'plan'), systemPrompt: PLAN_PROMPT, timeoutMs: 120_000 });
const writer = new TriageModel({ model: cfg.model, workDir: path.join(cfg.stateDir, 'write'), systemPrompt: WRITE_PROMPT, timeoutMs: 120_000 });
// the live chat sessions: a claude process per chat that stays alive between its questions
const sessions = cfg.liveSessions > 0
  ? new ChatSessions({
      maxSessions: cfg.liveSessions,
      idleMs: cfg.idleMs,
      maxTokens: cfg.maxTokens,
      log,
      makeModel: (role) => new LiveModel({ model: cfg.model, workDir: path.join(cfg.stateDir, `live-${role}`), systemPrompt: role === 'plan' ? PLAN_PROMPT : WRITE_PROMPT, timeoutMs: 120_000 }),
    })
  : null;

const running = new Set();
async function tick() {
  try {
    const { ids } = await hub.get('/joya/ai/runner/pending');
    for (const id of ids) {
      if (running.has(id) || running.size >= cfg.concurrency) continue;
      running.add(id);
      handle({ id, hub, planner, writer, sessions, log, instructionsVersion: INSTRUCTIONS_VERSION }).finally(() => running.delete(id));
    }
  } catch (e) {
    log.error(`poll: ${e.message}`);
  }
}

log.info(`Joya HQ runner: service ${cfg.hubUrl}, model ${cfg.model}, ${INSTRUCTIONS_VERSION}, poll ${cfg.pollMs} ms, live sessions ${cfg.liveSessions}${cfg.apiKey ? '' : ' (no JOYA_API_KEY: loopback only)'}`);
tick();
setInterval(tick, cfg.pollMs);
// free the memory of the idle sessions even when no question comes
if (sessions) setInterval(() => sessions.sweep(), 60_000);
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => (sessions?.closeAll(), process.exit(0)));
