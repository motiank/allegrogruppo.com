// Who may see what in Joya Headquarter.
//
// Login: the Allegro admin users (src/auth/session.js). Joya access comes from the Allegro user:
//   role admin        → CHAIN_ADMIN: every location, settings, rules, users; payroll
//   role restMngr     → LOCATION_MANAGER of the user's `restaurants` (Allegro branch ids, "*" = all); payroll
//   role accountant   → ACCOUNTANT of the user's `restaurants`: only the accounting area (הנהלת חשבונות) and its
//                       calculations (sales, payments, the bank of those companies); no payroll (owner 2026-10-31)
//   any other role    → no access
// Users and their rights live only in the admin's users.json (owner, 2026-10-24): no Joya table or file
// of users. payroll = wages, payroll lines, labor cost in money, payroll checks.
//
// Every route checks the location it touches with canLocation(); lists are filtered
// with scopeLocations(). The AI calculations run with the asking user's access too.
import { getSessionUser, allegroUser } from './auth/session.js';
import { locations } from './services/source.js';

/**
 * The Joya access of an Allegro user (allegroUser shape); known = the location ids (Allegro branch
 * ids) Allegro has now. null = no Joya access.
 */
export function accessFor(user, known) {
  let role;
  let ids;
  let payroll;
  if (user.role === 'admin') {
    role = 'CHAIN_ADMIN';
    ids = known;
    payroll = true;
  } else if (user.role === 'restMngr') {
    role = 'LOCATION_MANAGER';
    const all = user.restaurants.includes('*');
    ids = known.filter((id) => all || user.restaurants.includes(id));
    payroll = true;
  } else if (user.role === 'accountant') {
    role = 'ACCOUNTANT';
    const all = user.restaurants.includes('*');
    ids = known.filter((id) => all || user.restaurants.includes(id));
    payroll = false;
  } else return null;
  const isAdmin = role === 'CHAIN_ADMIN';
  return { username: user.username, role, isAdmin, locationIds: ids, payroll, accounting: isAdmin || role === 'ACCOUNTANT' };
}

export async function loadAccess(username) {
  if (!username) return null;
  const user = allegroUser(username);
  if (!user) return null;
  // locations are the Allegro branches (read from the API, kept in memory for 5 min)
  return accessFor(user, (await locations()).map((l) => l.id));
}

// Also for the chain admin: a location id must be a branch Allegro knows.
export function canLocation(access, locationId) {
  if (!access || locationId == null) return false;
  return access.locationIds.includes(String(locationId));
}

/** The requested location ids limited to what the user may see (all allowed when none asked). */
export function scopeLocations(access, requested) {
  const asked = requested == null || requested === '' ? null : String(requested).split(',').map((s) => s.trim()).filter(Boolean);
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

// The accountant sees only the accounting area: its chat and what the page needs to show it.
// Matched on the full path (baseUrl + path): mounted with r.use('/joya', …), req.path alone has no /joya.
const ACCOUNTANT_ROUTES = [/\/joya\/me$/, /\/joya\/locations$/, /\/joya\/ai\/(ask|requests)(\/|$)/];
export function limitAccountant(req, res, next) {
  const path = `${req.baseUrl || ''}${req.path}`;
  if (req.joya?.role !== 'ACCOUNTANT' || ACCOUNTANT_ROUTES.some((re) => re.test(path))) return next();
  res.status(403).json({ error: 'the accountant sees the accounting area only', code: 'FORBIDDEN' });
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
