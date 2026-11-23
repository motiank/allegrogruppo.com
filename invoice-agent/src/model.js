// One model call through the claude CLI (subscription login, no API key), like hq/runner/model.js.
// The model gets NO tools, safe mode (no CLAUDE.md, skills, hooks or MCP), no saved session and an
// empty working directory. It only reads what we send and answers JSON, so an email cannot make it
// touch this machine. PDFs and images go inside the message (stream-json input).
import { spawn } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';

const TIMEOUT_MS = 180_000;
// "unknown option": the CLI was being replaced by its own update at that moment.
const UNAVAILABLE = /limit|rate|quota|overloaded|log ?in|auth|credit|subscription|unknown option/i;

// "Prompt is too long … (limit 1000000)" has the word limit, but it is the email's fault: the run must go on.
const EMAIL_FAULT = /prompt is too long/i;
const unavailable = (msg) => UNAVAILABLE.test(msg) && !EMAIL_FAULT.test(msg);

/** The model cannot answer now (plan limit, not logged in). Not the email's fault: stop the run. */
export class ModelUnavailable extends Error {}

/** Reads the CLI's stream-json output. */
export function parseOutput(out, code, err) {
  const lines = out.split('\n').filter((l) => l.trim().startsWith('{')).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const result = lines.findLast((l) => l.type === 'result');
  if (!result) {
    const msg = `claude exit ${code}, no result: ${(err || out).slice(0, 300)}`;
    throw unavailable(msg) ? new ModelUnavailable(msg) : new Error(msg);
  }
  if (result.is_error || !result.structured_output) {
    const msg = `claude error: ${String(result.result ?? result.subtype).slice(0, 300)}`;
    throw result.is_error && unavailable(msg) ? new ModelUnavailable(msg) : new Error(msg);
  }
  return result.structured_output;
}

export function createModel({ cli, model, workDir, systemPrompt, schema }) {
  mkdirSync(workDir, { recursive: true });
  const promptFile = path.join(path.dirname(workDir), 'system-prompt.md');
  writeFileSync(promptFile, systemPrompt);
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--model', model, '--tools', '', '--safe-mode', '--no-session-persistence', '--system-prompt-file', promptFile, '--json-schema', JSON.stringify(schema)];
  // Without the key in the environment the CLI uses the subscription login, never paid API usage.
  // A model call must not start a CLI update: an update during a run breaks the next calls.
  const { ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, ...rest } = process.env;
  const env = { ...rest, DISABLE_AUTOUPDATER: '1' };

  return (blocks) => new Promise((resolve, reject) => {
    const child = spawn(cli, args, { cwd: workDir, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`model call timed out after ${TIMEOUT_MS} ms`)); }, TIMEOUT_MS);
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (err += c));
    child.stdin.on('error', () => {});
    child.on('error', (e) => { clearTimeout(timer); reject(new ModelUnavailable(`cannot start ${cli}: ${e.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      try { resolve(parseOutput(out, code, err)); } catch (e) { reject(e); }
    });
    child.stdin.end(`${JSON.stringify({ type: 'user', message: { role: 'user', content: blocks } })}\n`);
  });
}
