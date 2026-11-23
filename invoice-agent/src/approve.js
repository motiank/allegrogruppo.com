// Opens the browser, the user approves, Google sends the code back to a small local server.
// Returns the client and the tokens. It saves nothing: the caller decides if the login is kept.
import { randomBytes } from 'crypto';
import http from 'http';
import open from 'open';
import { newClient } from './google.js';

export async function approveInBrowser({ scopes, timeoutMs = 5 * 60_000, log = console.log, loginHint }) {
  const state = randomBytes(16).toString('hex');
  const server = http.createServer();
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const redirectUri = `http://127.0.0.1:${server.address().port}/`;
  const client = newClient(redirectUri);
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  const url = client.generateAuthUrl({ access_type: 'offline', prompt: 'select_account consent', scope: scopes, state, code_challenge: codeChallenge, code_challenge_method: 'S256', ...(loginHint ? { login_hint: loginHint } : {}) });

  let code;
  try {
    code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`No approval within ${Math.round(timeoutMs / 60_000)} minutes.`)), timeoutMs);
      server.on('request', (req, res) => {
        const q = new URL(req.url, redirectUri).searchParams;
        if (!q.get('code') && !q.get('error')) return res.writeHead(404).end();
        const good = q.get('state') === state && q.get('code');
        res.writeHead(good ? 200 : 400, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(good ? 'Connected. You can close this window.' : 'Not connected. Go back to the terminal.');
        clearTimeout(timer);
        good ? resolve(q.get('code')) : reject(new Error(`Google answered: ${q.get('error') ?? 'bad state value'}`));
      });
      log(`Opening the browser. If it does not open, go to:\n\n${url}\n`);
      open(url).catch(() => {});
    });
  } finally {
    server.close();
  }

  const { tokens } = await client.getToken({ code, codeVerifier, redirect_uri: redirectUri });
  if (!tokens.refresh_token) throw new Error('Google gave no refresh token. Try again.');
  const granted = tokens.scope?.split(' ') ?? [];
  const missing = scopes.filter((s) => !granted.includes(s));
  if (missing.length) throw new Error(`These rights were not approved: ${missing.join(', ')}. Try again and tick every box.`);
  client.setCredentials(tokens);
  return { client, tokens };
}
