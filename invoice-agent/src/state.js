// Which emails were read. A local JSON file, written after every email.
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';

export const MAX_ATTEMPTS = 3;
const DONE = new Set(['filed', 'duplicate', 'ignored', 'needs_review']);

export function loadState(file) {
  const state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { messages: {} };
  const save = () => {
    writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 2));
    renameSync(`${file}.tmp`, file);
  };
  return {
    messages: state.messages,
    isDone: (id) => DONE.has(state.messages[id]?.status),
    record(id, entry) {
      state.messages[id] = { ...state.messages[id], ...entry, at: new Date().toISOString() };
      save();
    },
    /** A failure: the email is tried again in the next run, then goes to needs_review. */
    fail(id, entry, reason) {
      const attempts = (state.messages[id]?.attempts ?? 0) + 1;
      this.record(id, { ...entry, attempts, reason, status: attempts >= MAX_ATTEMPTS ? 'needs_review' : 'error' });
    },
  };
}

const watched = new Set();

/** Only one run at a time. A lock left by a dead process does not count. */
export function takeLock(file) {
  if (existsSync(file)) {
    const pid = Number(readFileSync(file, 'utf8'));
    try {
      process.kill(pid, 0);
      return false;
    } catch (e) {
      if (e.code === 'EPERM') return false;
      rmSync(file, { force: true });
    }
  }
  try {
    writeFileSync(file, String(process.pid), { flag: 'wx' });
  } catch {
    return false;
  }
  if (!watched.has(file)) {
    watched.add(file);
    process.on('exit', () => freeLock(file));
  }
  return true;
}

/** Frees the lock, only if this process holds it. */
export function freeLock(file) {
  try {
    if (Number(readFileSync(file, 'utf8')) === process.pid) rmSync(file, { force: true });
  } catch { /* no lock file */ }
}
