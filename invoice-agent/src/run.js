// One run: up to MAX_INVOICES_PER_RUN invoices, then exit. Cron starts it every 15 minutes.
// Reads every mailbox with a saved login (config/mailboxes.json) and files each invoice in the Drive folder of
// its company (config/targets.json). Drive is always written with the main mailbox's login.
import path from 'path';
import { SCHEMA, SYSTEM_PROMPT } from './agent.js';
import { config, loadCompanies, loadMailboxes, loadTargets, paths } from './config.js';
import { fetchLink } from './download.js';
import { createDrive } from './drive.js';
import { createGmail } from './gmail.js';
import { loadClient } from './google.js';
import { createModel, ModelUnavailable } from './model.js';
import { processEmail } from './process.js';
import { loadState, takeLock } from './state.js';
import { openTargets } from './targets.js';

const log = (m) => console.log(`${new Date().toISOString()} ${m}`);

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (!takeLock(paths.lock)) return log('another run is still working, exit');

  const companies = loadCompanies();
  const mailboxes = loadMailboxes().filter((m) => m.login === 'saved');
  const mainAuth = loadClient();
  const store = dryRun ? null : createDrive(mainAuth);
  const rootId = dryRun ? null : await openTargets({ store, companies, targets: loadTargets() });
  const ask = createModel({ cli: config.claudeBin, model: config.model, workDir: path.join(paths.claudeWork, 'empty'), systemPrompt: SYSTEM_PROMPT, schema: SCHEMA });

  let emails = 0;
  let invoices = 0;
  log(`start${dryRun ? ' (dry run, nothing is saved)' : ''}: ${config.gmailQuery}`);
  for (const box of mailboxes) {
    if (invoices >= config.maxInvoices || emails >= config.maxEmails) break;
    const tag = box.main ? '' : `[${box.email}] `;
    try {
      const base = createGmail(box.main ? mainAuth : loadClient(box.token));
      // A row from another mailbox names it (gmail_account), because a message id belongs to one mailbox.
      const gmail = box.main ? base : { ...base, get: async (id) => ({ ...(await base.get(id)), account: box.email }) };
      const state = loadState(box.state);
      for await (const id of gmail.list(config.gmailQuery)) {
        if (invoices >= config.maxInvoices || emails >= config.maxEmails) break;
        if (state.isDone(id)) continue;
        emails++;
        try {
          const { filed, ...entry } = await processEmail({ id, gmail, ask, fetchLink, store, rootId, companies, dryRun, log });
          invoices += filed;
          log(`${tag}${id} ${entry.status}: ${entry.subject} — ${entry.reason}`);
          if (!dryRun) state.record(id, { ...entry, attempts: 0 });
        } catch (e) {
          if (e instanceof ModelUnavailable) throw e;
          log(`${tag}${id} failed: ${e.message}`);
          if (!dryRun) state.fail(id, {}, e.message.slice(0, 300));
        }
      }
    } catch (e) {
      // The main mailbox or the model failing stops the run. Another mailbox failing (its login ended) must not
      // stop the main one.
      if (box.main || e instanceof ModelUnavailable) throw e;
      log(`${tag}skipped: ${e.message}${/invalid_grant/.test(e.message) ? ` — its Google login has ended. Run: npm run auth -- --mailbox ${box.email}` : ''}`);
    }
  }
  log(`done: ${emails} emails read, ${invoices} invoices ${dryRun ? 'found' : 'filed'}`);
}

main().then(() => process.exit(0), (e) => {
  log(`STOPPED: ${e.message}`);
  if (/invalid_grant/.test(e.message)) log('The Google login has ended. Run: npm run auth');
  process.exit(1);
});
