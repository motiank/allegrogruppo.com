// Source data, read from the Allegro admin Local Data API (lib/allegro.js) — never stored here.
//
//   locations      /branches, /status a Joya location id IS the Allegro branch id (nothing stored)
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
 * The Allegro branches as Joya locations — nothing about them is stored here. A location id IS the
 * Allegro branch id; name and company come from /branches; a location is active when its branch had
 * Beecomm orders in the last 60 days (/status). When Allegro cannot be reached, the last list read
 * since this server started is used (empty before the first read).
 */
let lastLocations = [];
export async function locations() {
  let branches;
  try {
    branches = (await get('/branches')).data || [];
  } catch (e) {
    log.warn(`locations: ${e.message} — using the last list read`);
    return lastLocations;
  }
  let recent = null;
  try {
    const since = addDays(todayLocal(), -60);
    recent = new Set((await status()).branches.filter((s) => s.beecomm?.orders?.lastDate >= since).map((s) => s.branch));
  } catch (e) {
    log.warn(`locations: no /status (${e.message}) — every branch counts as active`);
  }
  lastLocations = branches.map((b) => ({
    id: String(b.id),
    name: b.name,
    company: b.company?.key ? { key: b.company.key, label: b.company.label || b.company.key } : null,
    active: !recent || recent.has(b.id),
    isDemo: !!b.demo,
  }));
  return lastLocations;
}

/** Is this location a demonstration restaurant (served only by the fake API)? */
export async function isDemoLocation(id) {
  return !!(await locations()).find((l) => l.id === String(id))?.isDemo;
}

/** location id → its name, from Allegro (for lists of Joya records). */
export async function locationNames() {
  return new Map((await locations()).map((l) => [l.id, l.name]));
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
  const branch = String(locationId);
  const rows = await byMonth('/beecomm/orders/stored', branch, from, to);
  return rows
    .filter((o) => o.status === 2 && o.businessDate >= from && o.businessDate <= to)
    .map((o) => ({
      location_id: String(locationId),
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
  const branch = String(locationId);
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
  const branch = String(locationId);
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
      locationId: String(locationId),
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
  const branch = String(locationId);
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
  const want = new Set(locationIds.map(String));
  const out = [];
  for (const e of data || []) {
    if (e.duplicateOf) continue;
    const loc = String(e.branch);
    if (!want.has(loc)) continue;
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
  const branch = String(locationId);
  return (await get('/payroll', { month: period, branch })).data || [];
}

/** Monthly hours per employee after the payroll rules (breaks, overtime buckets). */
export async function shiftsSummary(locationId, period) {
  const branch = String(locationId);
  return (await get('/shifts/summary', { month: period, branch })).data || [];
}

/** Daily labor cost per location: hours after the rules, payslip gross, coverage. */
export async function laborDaily(locationId, from, to) {
  const branch = String(locationId);
  const rows = await byMonth('/labor/daily', branch, from, to);
  return rows.filter((r) => r.date >= from && r.date <= to);
}

// ---------------------------------------------------------------- freshness

/** /status: what Allegro has loaded per branch, and which of its sources exist at all. */
export async function status() {
  const { data, meta } = await get('/status');
  return { branches: data || [], sources: meta?.sources || {} };
}

