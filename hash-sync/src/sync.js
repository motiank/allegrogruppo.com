// One scheduled run: load, then verify. Exit code 0 means the target matches the source, row by row.
// A second run stops at once while the first one is still working.
//   node src/sync.js --company pastalina --name Pastalina [--snapshot-year 2026] [--production]
import { spawnSync } from 'node:child_process';
import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib.js';

const lockFile = join(ROOT, '.sync.lock');

function isRunning(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function takeLock() {
  try {
    closeSync(openSync(lockFile, 'wx'));
  } catch {
    const pid = Number(readFileSync(lockFile, 'utf8'));
    if (pid && isRunning(pid)) return false;
    console.log(`Removing the lock of a stopped run (${pid})`);
  }
  writeFileSync(lockFile, String(process.pid));
  return true;
}

const run = (script) => spawnSync(process.execPath, [join(ROOT, 'src', script), ...process.argv.slice(2)], { stdio: 'inherit' }).status;
const stamp = (text) => console.log(`${new Date().toISOString()} ${text}`);

if (!takeLock()) {
  stamp('Another sync is still running. This run stops.');
  process.exit(0);
}

let status;
try {
  stamp('Sync started');
  status = run('load.js');
  if (status === 0) status = run('verify.js');
  stamp(status === 0 ? 'Sync finished, no differences' : `Sync FAILED, exit code ${status}`);
} finally {
  unlinkSync(lockFile);
}
process.exit(status ?? 1);
