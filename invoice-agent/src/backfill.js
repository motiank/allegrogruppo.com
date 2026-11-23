// Backfill: reads the invoices of ANOTHER mailbox (for example the owner's own mail) and files them in the
// same Drive as the normal run. Used from time to time, by hand.
//
// The login of that mailbox is NOT kept: the user approves in the browser at the start, the token lives only
// in this process's memory (read-only mail right, no Drive right), and it is cancelled at Google when the
// process ends. A stopped backfill starts again with a new approval and continues where it stopped: the
// emails already read are in data/state-<mailbox>.json.
//
//   npm run backfill                        the last 2 years of the mailbox with "login": "ask" in config/mailboxes.json
//   npm run backfill -- --mailbox a@b.c     that mailbox, when there are several
//   npm run backfill -- --after 2025/01/01  from a date
//   npm run backfill -- --dry-run --max 20  a test: real emails, real Claude, nothing saved
import path from 'path';
import { google } from 'googleapis';
import { SCHEMA, SYSTEM_PROMPT } from './agent.js';
import { approveInBrowser } from './approve.js';
import { config, loadCompanies, loadMailboxes, loadTargets, paths } from './config.js';
import { fetchLink } from './download.js';
import { createDrive } from './drive.js';
import { createGmail } from './gmail.js';
import { GMAIL_SCOPE, loadClient } from './google.js';
import { createModel, ModelUnavailable } from './model.js';
import { processEmail } from './process.js';
import { freeLock, loadState, takeLock } from './state.js';
import { openTargets } from './targets.js';

const MODEL_WAIT_MS = 15 * 60_000;      // the plan limit was reached: wait, then try the same email again
const UPDATE_WAIT_MS = 2 * 60_000;       // the CLI was updating itself
const MODEL_WAIT_MAX_MS = 24 * 3_600_000;
const MAX_PASSES = 3;                   // failed emails are tried again, like in the normal run
const APPROVAL_MS = 15 * 60_000;

const log = (m) => console.log(`${new Date().toISOString()} ${m}`);
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const twoYearsAgo = () => { const d = new Date(); d.setFullYear(d.getFullYear() - 2); return d.toISOString().slice(0, 10).replace(/-/g, '/'); };

let revoke = async () => {};
let stopping = false;
async function stop(code) {
  if (stopping) return;
  stopping = true;
  await revoke();
  process.exit(code);
}
process.on('SIGINT', () => { log('stopped by the user'); stop(130); });
process.on('SIGTERM', () => { log('stopped (SIGTERM)'); stop(143); });

/** The run lock, only while one invoice is written to Drive: the 15-minute job writes the same index.json. */
async function withLock(fn) {
  while (!takeLock(paths.lock)) await sleep(5_000);
  try { return await fn(); } finally { freeLock(paths.lock); }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const max = Number(arg('--max') || Infinity);
  const after = arg('--after') || twoYearsAgo();
  if (!/^\d{4}\/\d{2}\/\d{2}$/.test(after)) throw new Error('--after must be YYYY/MM/DD');
  const query = `${process.env.GMAIL_QUERY || config.gmailQuery.replace(/\s*after:\S+$/, '')} after:${after}`;

  const companies = loadCompanies();
  const driveAuth = loadClient(); // the main login (the Drive of the main mailbox)
  const driveAccount = (await google.gmail({ version: 'v1', auth: driveAuth }).users.getProfile({ userId: 'me' })).data.emailAddress;

  // Which mailbox: the one named, else the only one with "login": "ask". With none in the config, any mailbox but the main.
  const asked = loadMailboxes().filter((m) => m.login === 'ask');
  const named = arg('--mailbox')?.toLowerCase();
  if (named && !asked.some((m) => m.email === named)) throw new Error(`${named} is not a mailbox with "login": "ask" in config/mailboxes.json.`);
  if (!named && asked.length > 1) throw new Error(`Which mailbox? Add --mailbox with one of: ${asked.map((m) => m.email).join(', ')}`);
  const want = named ?? asked[0]?.email;

  log(`Approve READ-ONLY access to ${want ?? 'the mailbox to scan'}, in the browser. The files are written with the login of ${driveAccount}.`);
  const { client, tokens } = await approveInBrowser({ scopes: [GMAIL_SCOPE], timeoutMs: APPROVAL_MS, log, loginHint: want });
  const account = (await google.gmail({ version: 'v1', auth: client }).users.getProfile({ userId: 'me' })).data.emailAddress;
  if (account.toLowerCase() === driveAccount.toLowerCase()) {
    // Never cancel this login: it is the one the 15-minute job uses.
    throw new Error(`${account} is the main mailbox, the normal run already reads it. Start again and choose the other account.`);
  }
  const cancel = async () => {
    try {
      await client.revokeToken(tokens.refresh_token);
      log(`The login of ${account} was cancelled at Google. Nothing was saved on this machine.`);
    } catch (e) {
      log(`Could not cancel the login of ${account} at Google (${e.message}). It was never saved on this machine; you can remove it at https://myaccount.google.com/connections`);
    }
  };

  if (want && account.toLowerCase() !== want) {
    await cancel(); // a login nobody asked for is not left open
    throw new Error(`The approval was for ${account}, not ${want}. Start again and choose ${want}.`);
  }
  revoke = cancel;

  const state = loadState(path.join(paths.data, `state-${account.toLowerCase().replace(/[^a-z0-9@._-]/g, '_')}.json`));
  const base = createGmail(client);
  const gmail = { ...base, get: async (id) => ({ ...(await base.get(id)), account }) };
  const store = dryRun ? null : createDrive(driveAuth);
  const rootId = dryRun ? null : await openTargets({ store, companies, targets: loadTargets() });
  const ask = createModel({ cli: config.claudeBin, model: config.model, workDir: path.join(paths.claudeWork, 'empty'), systemPrompt: SYSTEM_PROMPT, schema: SCHEMA });

  log(`start${dryRun ? ' (dry run, nothing is saved)' : ''}: mailbox ${account} → Drive of ${driveAccount}: ${query}`);
  const ids = [];
  for await (const id of base.list(query)) ids.push(id);
  log(`${ids.length} emails match, ${ids.filter((id) => state.isDone(id)).length} of them were read before`);

  let emails = 0;
  let invoices = 0;
  for (let pass = 1; pass <= MAX_PASSES && emails < max; pass++) {
    const todo = ids.filter((id) => !state.isDone(id));
    if (!todo.length) break;
    if (pass > 1) log(`pass ${pass}: ${todo.length} emails that failed are tried again`);
    for (const id of todo) {
      if (emails >= max) break;
      emails++;
      for (let waited = 0; ; waited += MODEL_WAIT_MS) {
        try {
          const { filed, ...entry } = await processEmail({ id, gmail, ask, fetchLink, store, rootId, companies, dryRun, log, guard: dryRun ? undefined : withLock });
          invoices += filed;
          log(`${id} ${entry.status}: ${entry.subject} — ${entry.reason}`);
          if (!dryRun) state.record(id, { ...entry, attempts: 0 });
        } catch (e) {
          if (e instanceof ModelUnavailable) {
            if (waited >= MODEL_WAIT_MAX_MS) throw e;
            // "unknown option": the CLI is updating itself, that takes a minute or two. A plan limit takes longer.
            const wait = /unknown option/i.test(e.message) ? UPDATE_WAIT_MS : MODEL_WAIT_MS;
            log(`Claude cannot answer now (${e.message.trim().slice(0, 200)}). Waiting ${wait / 60_000} minutes, then the same email again.`);
            await sleep(wait);
            waited += wait - MODEL_WAIT_MS;
            continue;
          }
          log(`${id} failed: ${e.message}`);
          if (!dryRun) state.fail(id, {}, e.message.slice(0, 300));
        }
        break;
      }
      if (emails % 50 === 0) log(`progress: ${emails} emails read in this run, ${invoices} invoices ${dryRun ? 'found' : 'filed'}`);
    }
    if (dryRun) break;
  }
  const left = ids.filter((id) => !state.isDone(id)).length;
  log(`done: ${emails} emails read, ${invoices} invoices ${dryRun ? 'found' : 'filed'}${dryRun ? '' : `, ${left} emails left`}`);
}

main().then(() => stop(0), async (e) => {
  log(`STOPPED: ${e.message}`);
  await stop(1);
});
