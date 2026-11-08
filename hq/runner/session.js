// Live chat sessions: one claude process per chat that stays alive between questions, so the model keeps the
// conversation itself (owner 2026-11-08: "keeping the session alive"). The prompt goes in on stdin and the answer
// comes back on stdout as stream-json lines, one turn after the other, in the same process. Same safety as
// model.js: no tools, safe mode, no saved session, an empty working dir.
//
// Scope (owner 2026-11-08): one session = one user + one chat (GENERAL: + the restaurant). Two processes per session,
// the planner and the writer. A session closes after 30 minutes without a question, when the conversation passes
// 150K tokens, or when the chat changed under it (a question deleted or asked again, one answered without it);
// at most 6 live sessions — the oldest idle one closes first. The next question then starts a new session from
// the hub's <history>.
import { spawn } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';

export class LiveModel {
  constructor({ cli = 'claude', model = 'sonnet', workDir, systemPrompt, timeoutMs = 120_000, thinkingTokens = 0 }) {
    Object.assign(this, { model, timeoutMs });
    mkdirSync(workDir, { recursive: true });
    const promptFile = path.join(workDir, 'system-prompt.md');
    writeFileSync(promptFile, systemPrompt);
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--model', model, '--tools', '', '--safe-mode', '--no-session-persistence', '--system-prompt-file', promptFile];
    this.child = spawn(cli, args, { cwd: workDir, env: { ...process.env, MAX_THINKING_TOKENS: String(thinkingTokens) }, stdio: ['pipe', 'pipe', 'pipe'] });
    this.alive = true;
    this.contextTokens = 0; // the size of the conversation at the last turn
    this.costSoFar = 0;
    this.pending = null; // { resolve, reject, timer, started }
    this.queue = Promise.resolve();
    this.err = '';
    let buf = '';
    this.child.stdout.on('data', (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) this.onLine(line);
      }
    });
    this.child.stderr.on('data', (c) => (this.err = (this.err + c).slice(-2000)));
    this.child.on('error', (e) => this.die(e));
    this.child.on('close', (code) => this.die(new Error(`claude exit ${code}: ${this.err.slice(0, 300)}`)));
  }

  onLine(line) {
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      return;
    }
    if (j.type !== 'result' || !this.pending) return;
    const { resolve, reject, timer, started } = this.pending;
    this.pending = null;
    clearTimeout(timer);
    if (j.is_error) return reject(new Error(`claude error: ${String(j.result ?? j.subtype).slice(0, 300)}`));
    const u = j.usage ?? {};
    const inputTokens = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    this.contextTokens = inputTokens + (u.output_tokens ?? 0);
    // the result's cost is for the whole process so far: this turn is the difference
    const total = j.total_cost_usd ?? null;
    const costUsd = total == null ? null : total - this.costSoFar;
    if (total != null) this.costSoFar = total;
    resolve({ text: j.result ?? '', costUsd, durationMs: Date.now() - started, apiMs: j.duration_api_ms ?? null, inputTokens, outputTokens: u.output_tokens ?? null, model: Object.keys(j.modelUsage ?? {})[0] ?? this.model });
  }

  die(e) {
    if (!this.alive) return;
    this.alive = false;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(e);
      this.pending = null;
    }
  }

  /** One turn; turns of the same process wait for each other. */
  call(userPrompt) {
    const turn = this.queue.then(
      () =>
        new Promise((resolve, reject) => {
          if (!this.alive) return reject(new Error('the live session is closed'));
          const timer = setTimeout(() => {
            this.close();
            reject(new Error(`model call timed out after ${this.timeoutMs} ms`));
          }, this.timeoutMs);
          this.pending = { resolve, reject, timer, started: Date.now() };
          this.child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: userPrompt } })}\n`);
        }),
    );
    this.queue = turn.catch(() => {});
    return turn;
  }

  close() {
    if (!this.alive) return;
    this.die(new Error('the live session is closed'));
    this.child.stdin.end();
    const k = setTimeout(() => this.child.kill('SIGTERM'), 5000);
    k.unref?.();
  }
}

export const SESSION_DEFAULTS = { maxSessions: 6, idleMs: 30 * 60_000, maxTokens: 150_000 };

export class ChatSessions {
  /** makeModel(role: 'plan' | 'write') → a LiveModel-like object { call, close, alive, contextTokens } */
  constructor({ makeModel, maxSessions = SESSION_DEFAULTS.maxSessions, idleMs = SESSION_DEFAULTS.idleMs, maxTokens = SESSION_DEFAULTS.maxTokens, log = {}, now = () => Date.now() }) {
    Object.assign(this, { makeModel, maxSessions, idleMs, maxTokens, log, now });
    this.sessions = new Map(); // key → session
    this.locks = new Map(); // key → the promise of the last request of that chat
  }

  /** Runs fn for one chat at a time: the questions of the same chat wait for each other. */
  run(key, fn) {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const p = prev.then(fn, fn);
    const tail = p.catch(() => {});
    this.locks.set(key, tail);
    tail.then(() => this.locks.get(key) === tail && this.locks.delete(key));
    return p;
  }

  /**
   * The live session for this chat, or a new one; null when all the places are busy (the runner then answers with
   * one-time calls). chat = { key, priorIds }: the ids of the chat's earlier answered questions, newest first.
   */
  open(chat, requestId) {
    this.sweep();
    let s = this.sessions.get(chat.key);
    if (s) {
      const why = this.staleReason(s, chat);
      if (!why) return this.take(s);
      this.drop(s, why);
    }
    if (this.sessions.size >= this.maxSessions) {
      const idle = [...this.sessions.values()].filter((x) => !x.busy).sort((a, b) => a.lastUsed - b.lastUsed)[0];
      if (!idle) return null;
      this.drop(idle, 'room for a new chat');
    }
    s = { key: chat.key, planner: this.makeModel('plan'), writer: this.makeModel('write'), firstId: requestId, handled: new Set(), sent: { plan: {}, write: {} }, pastResults: [], lastAnswer: null, turns: 0, lastUsed: this.now(), busy: false };
    this.sessions.set(chat.key, s);
    this.log.info?.(`[joya] live session opened for ${chat.key} (${this.sessions.size} live)`);
    return this.take(s);
  }

  take(s) {
    s.busy = true;
    s.lastUsed = this.now();
    return s;
  }

  /** Why the session no longer matches the chat, or null. */
  staleReason(s, chat) {
    if (!s.planner.alive || !s.writer.alive) return 'the process ended';
    if (this.now() - s.lastUsed > this.idleMs) return 'idle';
    if (Math.max(s.planner.contextTokens, s.writer.contextTokens) > this.maxTokens) return 'too long';
    // the chat's answered questions since the session started must be exactly the ones it answered
    const since = new Set((chat.priorIds || []).map(Number).filter((id) => id >= s.firstId));
    if (since.size !== s.handled.size || [...since].some((id) => !s.handled.has(id))) return 'the chat changed';
    return null;
  }

  /** After a request: answered → the session knows it; failed → the session is closed (its state is unknown). */
  done(s, id, { answered, results = [], answer = null }) {
    s.busy = false;
    s.lastUsed = this.now();
    if (!answered) return this.drop(s, 'the request failed');
    s.handled.add(Number(id));
    s.turns++;
    s.pastResults.push(...results);
    s.lastAnswer = answer;
  }

  drop(s, why) {
    s.planner.close();
    s.writer.close();
    if (this.sessions.get(s.key) === s) this.sessions.delete(s.key);
    this.log.info?.(`[joya] live session closed for ${s.key}: ${why} (${this.sessions.size} live)`);
  }

  /** Closes the sessions with no question for idleMs (so their memory is freed). */
  sweep() {
    for (const s of [...this.sessions.values()]) if (!s.busy && this.now() - s.lastUsed > this.idleMs) this.drop(s, 'idle');
  }

  closeAll() {
    for (const s of [...this.sessions.values()]) this.drop(s, 'runner stopped');
  }
}
