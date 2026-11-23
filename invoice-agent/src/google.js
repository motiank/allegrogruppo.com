import { chmodSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { google } from 'googleapis';
import { paths } from './config.js';

// gmail.readonly: the script can never change or send mail.
// drive.file: the script sees only the files and folders it created itself.
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export const SCOPES = [GMAIL_SCOPE, 'https://www.googleapis.com/auth/drive.file'];

export function newClient(redirectUri) {
  if (!existsSync(paths.credentials)) throw new Error('credentials.json is missing. See "Google setup" in README.md.');
  const raw = JSON.parse(readFileSync(paths.credentials, 'utf8'));
  const c = raw.installed ?? raw.web;
  if (!c) throw new Error('credentials.json is not an OAuth client file.');
  return new google.auth.OAuth2(c.client_id, c.client_secret, redirectUri);
}

export function saveToken(tokens, file = paths.token) {
  writeFileSync(file, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  chmodSync(file, 0o600);
}

/** The client for a run. Google refreshes the access token by itself. */
export function loadClient(file = paths.token) {
  if (!existsSync(file)) throw new Error(file === paths.token ? 'Not connected to Google. Run: npm run auth' : `No saved login in ${file}. Run: npm run auth -- --mailbox <email>`);
  const client = newClient();
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  client.setCredentials(saved);
  client.on('tokens', (t) => saveToken({ ...saved, ...t }, file));
  return client;
}
