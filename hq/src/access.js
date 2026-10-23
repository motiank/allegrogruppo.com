// Who may see what in Joya Headquarter.
//
// Login: the Allegro admin users (src/auth/session.js). Joya access comes from the Allegro user:
//   role admin        → CHAIN_ADMIN: every location, settings, rules, users; payroll
//   role restMngr     → LOCATION_MANAGER of the user's `restaurants` (Allegro branch ids, "*" = all); payroll
//   any other role    → no access
// A joya_user_access row (Settings → Users) overrides that for one user:
//   CHAIN_ADMIN / LOCATION_MANAGER (location_ids) and payroll_access (wages, payroll lines, labor cost in
//   money, payroll checks). A user who is not active in Allegro gets 403 even with a row.
//
// Every route checks the location it touches with canLocation(); lists are filtered
// with scopeLocations(). The AI calculations run with the asking user's access too.
import { getSessionUser, allegroUser } from './auth/session.js';
import { one, q, parseJson } from './db.js';
import { syncLocations } from './services/source.js';

/**
 * The Joya access of an Allegro user (allegroUser shape), with or without a joya_user_access row;
 * linked = the location link rows [{ id, allegro_branch_id }]. null = no Joya access.
 */
export function accessFor(user, row, linked) {
  let role;
  let ids;
  let payroll;
  if (row) {
    role = row.role;
    ids = (parseJson(row.location_ids) || []).map(Number).filter(Number.isFinite);
    payroll = !!row.payroll_access;
  } else if (user.role === 'admin') {
    role = 'CHAIN_ADMIN';
    ids = [];
    payroll = true;
  } else if (user.role === 'restMngr') {
    role = 'LOCATION_MANAGER';
    const all = user.restaurants.includes('*');
    ids = linked.filter((l) => all || user.restaurants.includes(l.allegro_branch_id)).map((l) => l.id);
    payroll = true;
  } else return null;
  const isAdmin = role === 'CHAIN_ADMIN';
  const known = linked.map((l) => l.id);
  return { username: user.username, role, isAdmin, locationIds: isAdmin ? known : ids.filter((id) => known.includes(id)), payroll, fromAllegroRole: !row };
}

export async function loadAccess(username) {
  if (!username) return null;
  const user = allegroUser(username);
  if (!user) return null;
  // locations are the Allegro branches (link rows made on first sight; refreshed at most every 5 min)
  await syncLocations();
  const linked = await q(`SELECT id, allegro_branch_id FROM joya_locations WHERE allegro_branch_id IS NOT NULL`);
  const row = await one(`SELECT * FROM joya_user_access WHERE username = :u`, { u: user.username });
  return accessFor(user, row, linked);
}

export function canLocation(access, locationId) {
  if (!access) return false;
  if (access.isAdmin) return true;
  return access.locationIds.includes(Number(locationId));
}

/** The requested location ids limited to what the user may see (all allowed when none asked). */
export function scopeLocations(access, requested) {
  const asked = requested == null || requested === '' ? null : String(requested).split(',').map(Number).filter(Number.isFinite);
  if (!asked) return access.locationIds;
  return asked.filter((id) => canLocation(access, id));
}

/** Express middleware: req.joya = access, or 401/403. */
export function requireJoya(req, res, next) {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'not authenticated' });
  loadAccess(user.username)
    .then((access) => {
      if (!access) return res.status(403).json({ error: 'no Joya access for this user', code: 'NO_JOYA_ACCESS' });
      req.joya = access;
      next();
    })
    .catch(next);
}

export function requireAdmin(req, res, next) {
  if (!req.joya?.isAdmin) return res.status(403).json({ error: 'chain admin only', code: 'ADMIN_ONLY' });
  next();
}

export function requirePayroll(req, res, next) {
  if (!req.joya?.payroll) return res.status(403).json({ error: 'payroll access only', code: 'PAYROLL_ONLY' });
  next();
}

export function assertLocation(access, locationId) {
  if (!canLocation(access, locationId)) throw Object.assign(new Error('no access to this location'), { code: 'FORBIDDEN' });
}
