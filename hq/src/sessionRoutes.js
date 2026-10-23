// GET /api/session, POST /api/login, POST /api/logout — for client/App.js.
import { Router } from 'express';
import { checkPassword, issueSessionCookie, clearSessionCookie, getSessionUser } from './auth/session.js';

const r = Router();

// Public: "not logged in" is a normal answer, not an error.
r.get('/session', (req, res) => {
  const user = getSessionUser(req);
  res.json({ authenticated: !!user, username: user?.username ?? null });
});

r.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = checkPassword(username, password);
  if (!user) return res.status(401).json({ error: 'Invalid username or password' });
  issueSessionCookie(res, user.username);
  res.json({ ok: true, username: user.username });
});

r.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

export default r;
