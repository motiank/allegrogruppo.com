/**
 * Shared-key gate for the AI runner (hq/runner) on /api/joya/ai/runner/*.
 * The key is JOYA_API_KEY in the env of both services; the runner sends it as X-Joya-Key.
 *
 * When JOYA_API_KEY is not set (dev), only loopback callers pass, so a forgotten key never
 * opens the routes to the internet. The loopback check uses req.socket.remoteAddress on
 * purpose (no X-Forwarded-For), same reasoning as trade-hub/src/auth/machineAuth.js.
 */
import log from '../../lib/log.js';

const HEADER = 'x-joya-key';
let warned = false;

export function isLoopback(addr) {
  return addr === '::1' || addr === '127.0.0.1' || (typeof addr === 'string' && addr.startsWith('::ffff:127.'));
}

export function requireMachineKey(req, res, next) {
  const key = process.env.JOYA_API_KEY;
  if (key) return req.get(HEADER) === key ? next() : res.status(403).json({ error: 'invalid machine key' });
  if (!warned) {
    warned = true;
    log.warn('JOYA_API_KEY is not set — runner routes accept loopback callers only');
  }
  if (isLoopback(req.socket?.remoteAddress)) return next();
  return res.status(503).json({ error: 'JOYA_API_KEY not configured on this service' });
}
