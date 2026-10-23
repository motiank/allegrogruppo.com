// Source data, read from the Allegro admin Local Data API (lib/allegro.js) — never stored here.
//
//   locations      /branches          a Joya location is a link row: joya_locations.allegro_branch_id
//   sales checks   /beecomm/orders/stored   closed orders (status 2); amount = netTotal − serviceAmount
//   dish sales     /beecomm/items/stored    per business day; amount = totalSales − order and item discounts
//   employees      /employees               Joya's employee id IS Allegro's employeeId
//   clock times    /shifts/raw              Tabit detailed report; an attendance id IS the raw shift id
//   staff per shift /shifts/by-shift        people and clock hours per date × shift × role (from Tabit)
//   payroll        /payroll, /shifts/summary, /labor/daily
//   freshness      /status
//
// What Joya keeps is its own: decisions, edits, rules, notes, corrections (keyed by the ids above),
// and joya_role_aliases (Allegro role name → Joya role code). Dated data is fetched per branch and
// calendar month, so the 5-minute memory cache serves every question about the same month.
import { get } from '../../lib/allegro.js';
import { q, todayLocal } from '../db.js';
import { addDays } from '../lib/recommend.js';
import log from '../../lib/log.js';

const nextMonth = (m) => addDays(`${m}-01`, 32).slice(0, 7);
const monthEnd = (m) => addDays(`${nextMonth(m)}-01`, -1);
export function monthsBetween(from, to) {
  const out = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = nextMonth(m)) out.push(m);
  return out;
}
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

// ---------------------------------------------------------------- locations

/**
 * The Allegro branches as Joya locations. A branch seen for the first time gets a link row
 * (active when it has Beecomm orders in the last 60 days); names follow Allegro. When Allegro
 * cannot be reached, the link rows already known are used as they are.
 */
let lastSync = 0;
export async function syncLocations({ force = false } = {}) {
  if (!force && Date.now() - lastSync < 5 * 60_000) return;
  lastSync = Date.now();
  let branches;
  try {
    branches = (await get('/branches')).data || [];
  } catch (e) {
    log.warn(`locations: ${e.message} — using the known links`);
    lastSync = 0;
    return;
  }
  const known = new Map((await q(`SELECT id, allegro_branch_id, name FROM joya_locations WHERE allegro_branch_id IS NOT NULL`)).map((r) => [r.allegro_branch_id, r]));
  const fresh = branches.filter((b) => !known.has(b.id));
  let recent = new Set();
  if (fresh.length) {
    const st = await status().catch(() => null);
    const since = addDays(todayLocal(), -60);
    recent = new Set((st?.branches || []).filter((s) => s.beecomm?.orders?.lastDate >= since).map((s) => s.branch));
  }
  for (const b of fresh) {
    await q(`INSERT IGNORE INTO joya_locations (code, name, allegro_branch_id, active, is_demo) VALUES (:c, :n, :b, :a, :d)`, { c: String(b.id).slice(0, 40), n: b.name, b: b.id, a: recent.has(b.id) ? 1 : 0, d: b.demo ? 1 : 0 });
  }
  for (const b of branches) {
    const k = known.get(b.id);
    if (k && k.name !== b.name) await q(`UPDATE joya_locations SET name=:n WHERE id=:id`, { n: b.name, id: k.id });
  }
  if (fresh.length) clearLinkCache();
}

let linkCache = { at: 0, map: null };
/** locationId ↔ branchId, from the link rows (refreshed every 30 s). */
async function links() {
  if (!linkCache.map || Date.now() - linkCache.at > 30_000) {
    const rows = await q(`SELECT id, allegro_branch_id FROM joya_locations WHERE allegro_branch_id IS NOT NULL`);
    linkCache = { at: Date.now(), map: { toBranch: new Map(rows.map((r) => [r.id, r.allegro_branch_id])), toLocation: new Map(rows.map((r) => [r.allegro_branch_id, r.id])) } };
  }
  return linkCache.map;
}
export function clearLinkCache() {
  linkCache.map = null;
}
export async function branchOf(locationId) {
  return (await links()).toBranch.get(Number(locationId)) ?? null;
}
export async function locationOf(branchId) {
  return (await links()).toLocation.get(branchId) ?? null;
}

/** branchId → its company { key, label } as Allegro has it (empty when Allegro cannot be reached). */
export async function branchCompanies() {
  try {
    const branches = (await get('/branches')).data || [];
    return new Map(branches.filter((b) => b.company?.key).map((b) => [b.id, { key: b.company.key, label: b.company.label || b.company.key }]));
  } catch (e) {
    log.warn(`companies: ${e.message}`);
    return new Map();
  }
}

// ---------------------------------------------------------------- role names

let aliasCache = { at: 0, map: null };
/** Allegro role name → Joya role code (null = not mapped yet). */
export async function roleAliases() {
  if (!aliasCache.map || Date.now() - aliasCache.at > 30_000) {
    aliasCache = { at: Date.now(), map: new Map((await q(`SELECT alias, role_code FROM joya_role_aliases`)).map((r) => [r.alias, r.role_code])) };
  }
  return aliasCache.map;
}
export function clearAliasCache() {
  aliasCache.map = null;
}
const cleanRole = (s) => (s == null ? null : String(s).trim().replace(/\s+/g, ' ') || null);
export async function roleCodeOf(name) {
  const n = cleanRole(name);
  return n ? (await roleAliases()).get(n) ?? null : null;
}

// ---------------------------------------------------------------- dated data, per branch and month

async function byMonth(path, branch, from, to, extra = {}) {
  const out = [];
  for (const m of monthsBetween(from, to)) {
    const { data } = await get(path, { from: `${m}-01`, to: monthEnd(m), branch, ...extra });
    out.push(...(data || []));
  }
  return out;
}

/** Closed checks of one location, shaped like the old joya_sales_checks rows. */
export async function checks(locationId, from, to) {
  const branch = await branchOf(locationId);
  if (!branch) return [];
  const rows = await byMonth('/beecomm/orders/stored', branch, from, to);
  return rows
    .filter((o) => o.status === 2 && o.businessDate >= from && o.businessDate <= to)
    .map((o) => ({
      location_id: Number(locationId),
      external_check_id: o.orderId,
      business_date: o.businessDate,
      opened_at: o.openedAt,
      closed_at: o.closedAt ?? null,
      diners: num(o.diners),
      net_amount: o.netTotal == null ? null : r2(Number(o.netTotal) - Number(o.serviceAmount ?? 0)),
      order_type: o.orderType ?? null,
    }));
}

/** Dish sales per business day (no lines per check exist in Beecomm). */
export async function dishSales(locationId, from, to) {
  const branch = await branchOf(locationId);
  if (!branch) return [];
  const rows = await byMonth('/beecomm/items/stored', branch, from, to, { group: 'day' });
  return rows
    .filter((r) => r.businessDate >= from && r.businessDate <= to)
    .map((r) => ({
      business_date: r.businessDate,
      code: String(r.dishId),
      name: String(r.dishName ?? '').trim() || String(r.dishId),
      qty: Number(r.quantity ?? 0),
      net_amount: r.totalSales == null ? null : r2(Number(r.totalSales) - Number(r.orderDiscountSum ?? 0) - Number(r.discountSum ?? 0)),
      category: r.category1 || r.category0 || null,
      isCombo: !!r.isCombo,
    }));
}

/**
 * Raw clock-in/out rows of one location. id = the Allegro raw shift id; employeeId = Allegro's
 * employeeId (null when Allegro could not match the Tabit name safely — it never guesses).
 */
export async function rawShifts(locationId, from, to) {
  const branch = await branchOf(locationId);
  if (!branch) return [];
  let rows;
  try {
    rows = await byMonth('/shifts/raw', branch, from, to);
  } catch (e) {
    if (e.code !== 'NOT_LOADED') throw e;
    return []; // the Tabit table does not exist in Allegro yet: no clock rows (data quality says why)
  }
  const out = [];
  for (const r of rows) {
    if (r.date < from || r.date > to) continue;
    out.push({
      id: Number(r.id),
      locationId: Number(locationId),
      date: r.date,
      block: r.block ?? 1,
      employeeId: r.employeeId ?? null,
      employeeName: r.employeeName ?? null,
      externalId: r.employeeId != null ? String(r.employeeId) : `name:${r.employeeName}`,
      clockIn: r.clockIn ?? null,
      clockOut: r.clockOut ?? null,
      roleName: cleanRole(r.role),
      roleCode: await roleCodeOf(r.role),
    });
  }
  return out;
}

/**
 * People and clock hours per date × shift × role (Allegro /shifts/by-shift, computed there from the Tabit
 * clock times). { available: false, reason } when Allegro has no clock rows table or no such endpoint yet.
 */
export async function shiftStaff(locationId, from, to, { split = '17:00', minHours = 1 } = {}) {
  const branch = await branchOf(locationId);
  if (!branch) return { available: true, rows: [] };
  try {
    const rows = await byMonth('/shifts/by-shift', branch, from, to, { split, minHours });
    return {
      available: true,
      rows: rows.filter((r) => r.date >= from && r.date <= to).map((r) => ({ date: r.date, shift: r.shift, role: cleanRole(r.role), people: Number(r.people) || 0, hours: Number(r.hours) || 0 })),
    };
  } catch (e) {
    if (e.code === 'NOT_SUPPORTED') return { available: false, reason: 'Allegro has no /shifts/by-shift endpoint yet' };
    if (e.code === 'NOT_LOADED') return { available: false, reason: 'no Tabit clock times are loaded in Allegro' };
    throw e;
  }
}

// ---------------------------------------------------------------- employees and payroll

/** Every employee of the given locations (active and not), without national ids or phones. */
export async function employees(locationIds) {
  const { data } = await get('/employees', { active: 'all' });
  const { toLocation } = await links();
  const want = new Set(locationIds.map(Number));
  const out = [];
  for (const e of data || []) {
    if (e.duplicateOf) continue;
    const loc = toLocation.get(e.branch);
    if (loc == null || !want.has(loc)) continue;
    const roleNames = (e.roles || []).map((x) => cleanRole(x.role)).filter(Boolean);
    const hourly = String(e.wageType || '').startsWith('hourly') && Number(e.wage) > 0 ? Number(e.wage) : null;
    out.push({
      id: e.employeeId,
      name: e.name,
      locationId: loc,
      roleNames,
      roleCode: roleNames.length ? await roleCodeOf(roleNames[0]) : null,
      wageType: e.wageType ?? null,
      hourlyWage: hourly,
      contractor: !!e.contractor,
      active: !!e.active,
    });
  }
  return out.sort((a, b) => Number(b.active) - Number(a.active) || String(a.name).localeCompare(String(b.name)));
}

/** employeeId → name, for the given locations. */
export async function employeeNames(locationIds) {
  return new Map((await employees(locationIds)).map((e) => [e.id, e.name]));
}

/** The saved payroll month of one location (one row per employee, with the payslip input `tlush`). */
export async function payroll(locationId, period) {
  const branch = await branchOf(locationId);
  if (!branch) return [];
  return (await get('/payroll', { month: period, branch })).data || [];
}

/** Monthly hours per employee after the payroll rules (breaks, overtime buckets). */
export async function shiftsSummary(locationId, period) {
  const branch = await branchOf(locationId);
  if (!branch) return [];
  return (await get('/shifts/summary', { month: period, branch })).data || [];
}

/** Daily labor cost per location: hours after the rules, payslip gross, coverage. */
export async function laborDaily(locationId, from, to) {
  const branch = await branchOf(locationId);
  if (!branch) return [];
  const rows = await byMonth('/labor/daily', branch, from, to);
  return rows.filter((r) => r.date >= from && r.date <= to);
}

// ---------------------------------------------------------------- freshness

/** /status: what Allegro has loaded per branch, and which of its sources exist at all. */
export async function status() {
  const { data, meta } = await get('/status');
  return { branches: data || [], sources: meta?.sources || {} };
}

