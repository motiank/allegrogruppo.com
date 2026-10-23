// Client of the Allegro admin Local Data API — the only source of Joya's source data
// (branches, Beecomm sales and dish sales, employees, Tabit clock times, payroll, labor cost).
// See ~/dvlp/allegrogruppo.com/local_api_readme.md. Read-only; loopback only on the Allegro side.
//
// Nothing is stored: answers are kept in memory for ALLEGRO_CACHE_MS (default 5 min) so a page
// that asks the same thing twice does not call twice. A restart forgets everything.
//
// Env: ALLEGRO_API_URL (default http://localhost:3021/local-api/v1), ALLEGRO_CACHE_MS, ALLEGRO_TIMEOUT_MS.
import log from './log.js';

const base = () => (process.env.ALLEGRO_API_URL || 'http://localhost:3021/local-api/v1').replace(/\/$/, '');
const ttl = () => Number(process.env.ALLEGRO_CACHE_MS ?? 5 * 60_000);
const timeout = () => Number(process.env.ALLEGRO_TIMEOUT_MS ?? 60_000);

const cache = new Map(); // url → { at, promise }
const MAX_ENTRIES = 2000;

/**
 * The error a route turns into 502/503: code UPSTREAM (Allegro failed), NOT_LOADED (its table is missing)
 * or NOT_SUPPORTED (this Allegro version has no such endpoint yet — a 404).
 */
function upstream(message, code = 'UPSTREAM') {
  return Object.assign(new Error(`Allegro API: ${message}`), { code });
}

function urlOf(path, params = {}) {
  const qs = Object.entries(params)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(Array.isArray(v) ? v.join(',') : v)}`)
    .join('&');
  return `${base()}${path}${qs ? `?${qs}` : ''}`;
}

async function fetchJson(url) {
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeout()) });
  } catch (e) {
    throw upstream(`not reachable (${e.cause?.code || e.name})`);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const code = body?.error?.code === 'not_loaded' ? 'NOT_LOADED' : res.status === 404 ? 'NOT_SUPPORTED' : 'UPSTREAM';
    throw upstream(`${res.status} ${body?.error?.message || res.statusText}`, code);
  }
  return { data: body?.data, meta: body?.meta || {} };
}

/** GET path?params → { data, meta }, from memory when asked within the cache time. */
export function get(path, params = {}) {
  const url = urlOf(path, params);
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < ttl()) return hit.promise;
  const promise = fetchJson(url).catch((e) => {
    cache.delete(url); // never keep a failure
    throw e;
  });
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(url, { at: Date.now(), promise });
  return promise;
}

/** Forget every cached answer (after a change in Allegro the user wants to see now). */
export function clearCache() {
  cache.clear();
  log.info('allegro cache cleared');
}

export const apiBase = base;
