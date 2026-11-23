// Saves a Google login.
//   npm run auth                         the main mailbox and its Drive → data/token.json
//   npm run auth -- --mailbox a@b.c      one more mailbox with "login": "saved" (read-only mail) → data/token-a@b.c.json
import { google } from 'googleapis';
import { approveInBrowser } from './approve.js';
import { loadMailboxes } from './config.js';
import { GMAIL_SCOPE, saveToken, SCOPES } from './google.js';

async function main() {
  const i = process.argv.indexOf('--mailbox');
  const email = i > 0 ? process.argv[i + 1]?.toLowerCase() : null;
  const box = email ? loadMailboxes().find((m) => m.email === email) : null;
  if (email && !box) throw new Error(`${email} is not in config/mailboxes.json.`);
  if (box && !box.main && box.login !== 'saved') throw new Error(`${email} has "login": "ask": its login is never saved. Read it with: npm run backfill -- --mailbox ${email}`);
  const extra = box && !box.main;

  const { client, tokens } = await approveInBrowser({ scopes: extra ? [GMAIL_SCOPE] : SCOPES, loginHint: email ?? undefined });
  const { data } = await google.gmail({ version: 'v1', auth: client }).users.getProfile({ userId: 'me' });
  if (email && data.emailAddress.toLowerCase() !== email) throw new Error(`The approval was for ${data.emailAddress}, not ${email}. Nothing was saved. Try again and choose ${email}.`);
  saveToken(tokens, box?.token);
  console.log(`Connected to ${data.emailAddress}. The login is saved in data/.`);
}

main().then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1); });
