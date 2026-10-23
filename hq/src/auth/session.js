/**
 * Logins of Joya HQ are the Allegro admin users (repo-root users.json, managed in the admin).
 * The password is checked with the admin's own method (admin/server/auth userApi.getUserKey), so a
 * change there applies here too. Only users with status "active" may log in. The username is the
 * e-mail. Which locations a user may see: src/access.js (from the Allegro role and branches only).
 *
 * Session: a JWT in the httpOnly cookie `joya_session`, signed with JOYA_SESSION_SECRET and
 * audience 'joya-hq' — Joya's own cookie, separate from the admin's `user` cookie.
 */
import { readFileSync } from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import { REPO_ROOT } from '../../lib/env.js';
import log from '../../lib/log.js';
import { userApi } from '../../../admin/server/auth/index.js';

export const COOKIE_NAME = 'joya_session';
export const USERS_FILE = process.env.ALLEGRO_USERS_FILE || path.join(REPO_ROOT, 'users.json');
const AUDIENCE = 'joya-hq';
const TOKEN_TTL = '7d';
const COOKIE_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

/** The Allegro users (read fresh each time, so an admin change applies at once). */
export function loadUsers() {
  try {
    const users = JSON.parse(readFileSync(USERS_FILE, 'utf8'));
    if (!Array.isArray(users)) throw new Error('users.json must be a JSON array');
    return users;
  } catch (e) {
    log.error(`failed to read ${USERS_FILE}: ${e.message}`);
    return [];
  }
}

const sameEmail = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/** The active Allegro user with this e-mail: { username, role, restaurants }, or null. Never the password. */
export function allegroUser(email) {
  const u = loadUsers().find((x) => sameEmail(x.email, email));
  if (!u || u.status !== 'active') return null;
  return { username: u.email, role: u.role, restaurants: Array.isArray(u.restaurants) ? u.restaurants : [] };
}

/** The user for an e-mail + password, or null. */
export function checkPassword(email, password) {
  const u = loadUsers().find((x) => sameEmail(x.email, email));
  if (!u || u.status !== 'active' || !password || !u.authKey) return null;
  if (userApi.getUserKey(u.email, String(password)) !== u.authKey) return null;
  return { username: u.email };
}

function secret() {
  const s = process.env.JOYA_SESSION_SECRET;
  if (!s) throw new Error('JOYA_SESSION_SECRET is not set');
  return s;
}

export function signSession(username, expiresIn = TOKEN_TTL) {
  return jwt.sign({ sub: username }, secret(), { expiresIn, audience: AUDIENCE });
}

export function issueSessionCookie(res, username) {
  res.cookie(COOKIE_NAME, signSession(username), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: COOKIE_MAX_AGE_MS,
    path: '/',
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

/** { username } from the session cookie, or null (no cookie, bad or expired token, no secret). */
export function getSessionUser(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token || !process.env.JOYA_SESSION_SECRET) return null;
  try {
    const payload = jwt.verify(token, process.env.JOYA_SESSION_SECRET, { audience: AUDIENCE });
    return { username: payload.sub };
  } catch {
    return null;
  }
}
