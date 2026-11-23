import dotenv from 'dotenv';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });

const env = process.env;
export const paths = {
  credentials: path.join(root, 'credentials.json'),
  companies: path.join(root, 'config', 'companies.json'),
  targets: path.join(root, 'config', 'targets.json'),
  mailboxes: path.join(root, 'config', 'mailboxes.json'),
  data: path.join(root, 'data'),
  token: path.join(root, 'data', 'token.json'),
  state: path.join(root, 'data', 'state.json'),
  lock: path.join(root, 'data', 'run.lock'),
  claudeWork: path.join(root, 'data', 'claude-work'),
};
mkdirSync(paths.data, { recursive: true });

// Form 101 emails hold employee ID photos: they are not invoices, so they never go to the model.
// Owner's decision (2026-11-05): never miss an invoice, so every email with an attachment is read, even
// though payslips and employee files then reach the model. Form 101 emails are skipped in process.js.
const DEFAULT_QUERY = '{has:attachment subject:invoice subject:invoices subject:receipt subject:חשבונית subject:חשבוניות subject:חשבון subject:החשבון subject:קבלה "חשבונית" "חשבוניות" "החשבונית" "החשבוניות" "לחשבונית" "בחשבונית" "וחשבונית" "invoice" "invoices" filename:חשבונית filename:חשבוניות filename:invoice filename:receipt}';

export const config = {
  model: env.MODEL || 'sonnet',
  claudeBin: env.CLAUDE_BIN || 'claude',
  maxInvoices: Number(env.MAX_INVOICES_PER_RUN || 10),
  maxEmails: Number(env.MAX_EMAILS_PER_RUN || 20),
  driveRoot: env.DRIVE_ROOT_FOLDER || 'Invoices',
  gmailQuery: [env.GMAIL_QUERY || DEFAULT_QUERY, env.GMAIL_AFTER ? `after:${env.GMAIL_AFTER}` : ''].filter(Boolean).join(' '),
};

export function loadCompanies() {
  if (!existsSync(paths.companies)) throw new Error('config/companies.json is missing. Copy config/companies.example.json and fill in your companies.');
  const list = JSON.parse(readFileSync(paths.companies, 'utf8'));
  if (!Array.isArray(list) || !list.length || list.some((c) => !c.name)) throw new Error('config/companies.json must be a list of companies, each with a "name".');
  return list;
}

const readList = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null);

/**
 * The Drive folders that get invoices. The first one is the default: it gets every company with no "target" and
 * _unmatched. { name, folderName } = a folder found by name in the main login's Drive (made if missing);
 * { name, folderId } = an existing folder, for example in another person's Drive, shared with the main login as editor.
 */
export function loadTargets() {
  const list = readList(paths.targets) ?? [{ name: 'main', folderName: config.driveRoot }];
  if (!Array.isArray(list) || !list.length || list.some((t) => !t.name || (!t.folderId && !t.folderName))) throw new Error('config/targets.json must be a list of { name, folderName } or { name, folderId }.');
  return list;
}

const fileKey = (email) => email.toLowerCase().replace(/[^a-z0-9@._-]/g, '_');

/**
 * The mailboxes to read. main = the mailbox whose saved login (data/token.json) is also the Drive login.
 * login "saved": read by every normal run. login "ask": read only by `npm run backfill`, which asks for an
 * approval in the browser each time and keeps no login. With no file: the main mailbox only, as before.
 */
export function loadMailboxes() {
  const list = (readList(paths.mailboxes) ?? [{ main: true, login: 'saved' }]).map((m) => ({
    ...m,
    email: m.email?.toLowerCase(),
    token: m.main ? paths.token : path.join(paths.data, `token-${fileKey(m.email ?? '')}.json`),
    state: m.main ? paths.state : path.join(paths.data, `state-${fileKey(m.email ?? '')}.json`),
  }));
  if (list.filter((m) => m.main).length !== 1) throw new Error('config/mailboxes.json needs exactly one mailbox with "main": true.');
  if (list.some((m) => (!m.main && !m.email) || !['saved', 'ask'].includes(m.login))) throw new Error('config/mailboxes.json: every mailbox needs "email" and "login": "saved" or "ask".');
  if (list.find((m) => m.main).login !== 'saved') throw new Error('config/mailboxes.json: the main mailbox must have "login": "saved".');
  return list;
}
