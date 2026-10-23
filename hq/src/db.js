// Small helpers shared by the Joya services.
import { executeSql, getDbPool } from '../lib/dbpool.js';

export async function q(sql, params = {}) {
  const [rows] = await executeSql(sql, params);
  return rows;
}

export async function one(sql, params = {}) {
  const rows = await q(sql, params);
  return rows[0] || null;
}

/** Run fn(conn) inside a transaction. conn.q / conn.one mirror the helpers above. */
export async function tx(fn) {
  const pool = getDbPool();
  const conn = await pool.getConnection();
  const wrap = {
    q: async (sql, params = {}) => (await conn.execute(sql, params))[0],
    one: async (sql, params = {}) => (await conn.execute(sql, params))[0][0] || null,
  };
  try {
    await conn.beginTransaction();
    const out = await fn(wrap);
    await conn.commit();
    return out;
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

export function parseJson(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

export const toMs = (v) => {
  if (v == null) return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
};

/** A DATE column → 'YYYY-MM-DD' (the pool uses timezone 'Z', so the UTC parts are the stored date). */
export const ymd = (v) => {
  if (v == null) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  return v.toISOString().slice(0, 10);
};

/** A DATETIME column → 'YYYY-MM-DD HH:MM:SS' wall-clock text. */
export const ymdhms = (v) => {
  if (v == null) return null;
  if (typeof v === 'string') return v.replace('T', ' ').slice(0, 19);
  return v.toISOString().slice(0, 19).replace('T', ' ');
};

export const hms = (v) => (v == null ? null : String(v).slice(0, 8));

export function err(code, message) {
  return Object.assign(new Error(message), { code });
}

export async function audit(username, action, entity, entityId, locationId, detail) {
  await q(
    `INSERT INTO joya_audit_log (username, action, entity, entity_id, location_id, detail_json)
     VALUES (:u, :a, :e, :id, :loc, :d)`,
    { u: username ?? null, a: action, e: entity, id: entityId ?? null, loc: locationId ?? null, d: detail == null ? null : JSON.stringify(detail) },
  );
}

const settingsCache = { at: 0, map: null };
export async function getSettings(name) {
  if (!settingsCache.map || Date.now() - settingsCache.at > 30_000) {
    const rows = await q(`SELECT name, value_json FROM joya_settings`);
    settingsCache.map = Object.fromEntries(rows.map((r) => [r.name, parseJson(r.value_json) || {}]));
    settingsCache.at = Date.now();
  }
  return name ? settingsCache.map[name] || {} : settingsCache.map;
}
export function clearSettingsCache() {
  settingsCache.map = null;
}

/** A config document of joya_settings (roles, roleAliases, staffingRules, location:<id>…), or `fallback`. */
export async function getConfig(name, fallback) {
  const all = await getSettings();
  return all[name] ?? fallback;
}

/** Read-modify-write one config document under a row lock: fn(current copy) returns the new value. */
export async function updateConfig(name, fallback, by, fn) {
  const value = await tx(async (c) => {
    const row = await c.one(`SELECT value_json FROM joya_settings WHERE name=:n FOR UPDATE`, { n: name });
    const next = await fn(structuredClone(row ? parseJson(row.value_json) ?? fallback : fallback));
    await c.q(`INSERT INTO joya_settings (name, value_json, updated_by) VALUES (:n, :v, :by) ON DUPLICATE KEY UPDATE value_json=VALUES(value_json), updated_by=VALUES(updated_by)`, {
      n: name,
      v: JSON.stringify(next),
      by: by ?? null,
    });
    return next;
  });
  clearSettingsCache();
  return value;
}

/** Read one JSON row for update inside a transaction: lockRow(c, 'joya_staffing_plans', id). */
export async function lockRow(c, table, id) {
  return c.one(`SELECT * FROM ${table} WHERE id=:id FOR UPDATE`, { id });
}

/** The next id for a list of { id } (the lines and edits kept inside a JSON column). */
export const nextId = (arr) => (arr || []).reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;

/** IN-list placeholders for named params: inList('l', [1,2]) → { sql: ':l0,:l1', params: {l0:1,l1:2} } */
export function inList(prefix, values) {
  const params = {};
  const names = values.map((v, i) => {
    params[`${prefix}${i}`] = v;
    return `:${prefix}${i}`;
  });
  return { sql: names.length ? names.join(',') : 'NULL', params };
}

export const todayLocal = (tz = process.env.JOYA_TZ || 'Asia/Jerusalem') => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
