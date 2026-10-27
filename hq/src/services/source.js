// Source data, read from the Allegro admin Local Data API (lib/allegro.js) — never stored here.
//
//   locations      /branches, /status a Joya location id IS the Allegro branch id (nothing stored)
//   sales checks   /beecomm/orders/stored   closed orders (status 2); amount = netTotal − serviceAmount
//   dish sales     /beecomm/items/stored    per business day; amount = totalSales − order and item discounts
//   payments       /beecomm/payments/stored per business day, payment type and card brand (דוח תשלומים)
//   employees      /employees               Joya's employee id IS Allegro's employeeId
//   clock times    /shifts/raw              Tabit detailed report; an attendance id IS the raw shift id
//   staff per shift /shifts/by-shift        people and clock hours per date × shift × role (from Tabit)
//   payroll        /payroll, /shifts/summary
//   labor cost     /labor/daily(/employees)  the admin's payroll rules and payslips (never computed here)
//   freshness      /status
//   bank           /bank/transactions/stored  per company (its bank accounts), from the uploaded bank files
//
// What Joya keeps is its own: decisions, edits, rules, notes, corrections (keyed by the ids above),
// and the roleAliases config (Allegro role name → Joya role code). Dated data is fetched per branch and
// calendar month, so the 5-minute memory cache serves every question about the same month.
import { get } from '../../lib/allegro.js';
import { getConfig, todayLocal } from '../db.js';
import { addDays } from '../lib/recommend.js';
import log from '../../lib/log.js';
import { effectiveHourlyRate } from '../../../shared/wage.js';

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
    aliasCache = { at: Date.now(), map: new Map(Object.entries(await getConfig('roleAliases', {}))) };
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

/**
 * The Beecomm payments report per business day (דוח תשלומים): one row per payment type (cardBrand null)
 * and per card brand inside it. { available: false, reason } when Allegro does not have it yet.
 */
export async function payments(locationId, from, to) {
  const branch = String(locationId);
  try {
    const rows = await byMonth('/beecomm/payments/stored', branch, from, to, { group: 'day' });
    return {
      available: true,
      rows: rows
        .filter((r) => r.businessDate >= from && r.businessDate <= to)
        .map((r) => ({
          date: r.businessDate,
          type: Number(r.paymentType),
          typeName: r.paymentTypeName ?? String(r.paymentType),
          brand: r.cardBrand ?? null,
          inZ: r.inZ !== false,
          charges: num(r.totalCharges) ?? 0,
          refunded: num(r.totalRefunded) ?? 0,
          transactions: num(r.transactions) ?? 0,
          refundTransactions: num(r.refundTransactions) ?? 0,
          service: num(r.service) ?? 0,
        })),
    };
  } catch (e) {
    if (e.code === 'NOT_SUPPORTED') return { available: false, reason: 'Allegro has no /beecomm/payments/stored endpoint yet' };
    if (e.code === 'NOT_LOADED') return { available: false, reason: 'the Beecomm payments report is not loaded in Allegro yet' };
    throw e;
  }
}

/**
 * Bank transactions of one company (its accounts in Allegro's restaurants.json). group: 'day' (money in/out and the
 * closing balance per date), 'details' (summed per action + details) or 'none' (the rows). q / side filter.
 * { available: false, reason } when Allegro does not have them.
 */
export async function bank(companyKey, from, to, { group = 'none', q = null, side = null } = {}) {
  try {
    const { data, meta } = await get('/bank/transactions/stored', { company: companyKey, from, to, group, ...(q ? { q } : {}), ...(side ? { side } : {}) });
    const rows = (data || []).map((r) => ({ ...r, credit: num(r.credit), debit: num(r.debit), ...(r.balance !== undefined ? { balance: num(r.balance) } : {}), ...(r.closingBalance !== undefined ? { closingBalance: num(r.closingBalance) } : {}) }));
    return { available: true, accounts: Array.isArray(meta?.accounts) ? meta.accounts : [], rows };
  } catch (e) {
    if (e.code === 'NOT_SUPPORTED') return { available: false, reason: 'Allegro has no /bank/transactions/stored endpoint yet' };
    if (e.code === 'NOT_LOADED') return { available: false, reason: 'no bank file was uploaded in Allegro yet' };
    throw e;
  }
}

/** The bank accounts Allegro has, with how far each is loaded (/status meta.bank). */
export async function bankStatus() {
  const { meta } = await get('/status');
  return meta?.bank || [];
}

// ---------------------------------------------------------------- employees and payroll

const MIN_HOURLY_WAGE = Number(process.env.MIN_HOURLY_WAGE) || 35.4;
// role entry first, then the employee level, then the legacy hourly_wage (-1 = minimum); null = a global (monthly) wage
function rateOf(e, role = null) {
  const opts = { minHourlyWage: MIN_HOURLY_WAGE };
  const r = role && role.new_wage_type ? effectiveHourlyRate(role, opts) : null;
  if (r != null) return r;
  const emp = e.wageType ? effectiveHourlyRate({ new_wage_type: e.wageType, wage: e.wage }, opts) : null;
  if (emp != null) return emp;
  if (e.hourlyWage == null || e.hourlyWage === '') return null;
  return Number(e.hourlyWage) === -1 ? MIN_HOURLY_WAGE : Number(e.hourlyWage);
}

// the amount as set; none for a minimum-wage type or the -1 "minimum" sentinel (then hourlyRate = the minimum)
const wageOf = (type, w) => (w == null || w === '' || Number(w) === -1 || String(type || '').startsWith('hourly_min_') ? null : Number(w));

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
      // the raw wage (an hourly rate, or a monthly amount for global_*) and the rate per role, as the admin
      // Shifts page resolves it (role wage, else employee wage; hourly_min_* = the minimum wage)
      wage: wageOf(e.wageType, e.wage),
      hourlyRate: rateOf(e),
      roles: (e.roles || [])
        .filter((x) => cleanRole(x.role))
        .map((x) => ({ role: cleanRole(x.role), wageType: x.new_wage_type ?? null, wage: wageOf(x.new_wage_type, x.wage), hourlyRate: rateOf(e, x) })),
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

/**
 * The labor cost of one location over a period, as the Allegro admin computes it (/labor/daily): the payroll rules
 * (hours after breaks in 100/125/150%, the role's wage, tip + completion for tip roles, monthly salaries) and the
 * payslip (tlush). A month whose payroll is not saved yet is built by the admin from the Tabit reports like a new
 * payroll. { data: days, meta: { totals, payrollMonths } }.
 */
export async function laborDaily(locationId, from, to) {
  const { data, meta } = await get('/labor/daily', { from, to, branch: String(locationId) });
  return { days: data || [], meta: meta || {} };
}

/** The same per employee per worked day (who is in a day's cost, and whose hours have no wage). */
export async function laborDailyEmployees(locationId, from, to) {
  return (await get('/labor/daily/employees', { from, to, branch: String(locationId) })).data || [];
}

// ---------------------------------------------------------------- freshness

/** /status: what Allegro has loaded per branch, and which of its sources exist at all. */
export async function status() {
  const { data, meta } = await get('/status');
  return { branches: data || [], sources: meta?.sources || {} };
}

