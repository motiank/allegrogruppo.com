// Data quality: what is missing, stale or wrongly mapped, per location and source.
// Nothing here fills a gap — it only says where the gaps are. The source data is in Allegro;
// its /status says how far each branch is loaded, so "not loaded yet" is told apart from "missing".
import { q, parseJson, getSettings, todayLocal } from '../db.js';
import { locationConfig } from './master.js';
import { addDays, daysBetween } from '../lib/recommend.js';
import { apiBase } from '../../lib/allegro.js';
import { status, locations, checks as sourceChecks, dishSales, rawShifts, roleAliases } from './source.js';

/**
 * The integrations as they really are. Sales (Beecomm), clock times (Tabit), employees and payroll
 * are read live from the Allegro admin Local Data API — nothing of it is stored here. Instagram and
 * Google inquiries are still typed in by hand.
 */
export function integrations(reachable = null) {
  const env = (k) => !!process.env[k];
  return [
    { source: 'ALLEGRO', name: 'Allegro admin API (Beecomm, Tabit, payroll)', connected: reachable === true, method: 'API', kinds: ['SALES_CHECKS', 'SALES_ITEMS', 'EMPLOYEES', 'ATTENDANCE', 'PAYROLL'], url: apiBase(), credentialsConfigured: true },
    { source: 'INSTAGRAM', name: 'Instagram', connected: false, method: 'MANUAL', kinds: ['INQUIRIES'], credentialsConfigured: env('JOYA_INSTAGRAM_TOKEN') },
    { source: 'GOOGLE', name: 'Google Business Profile', connected: false, method: 'MANUAL', kinds: ['INQUIRIES'], credentialsConfigured: env('JOYA_GOOGLE_CREDENTIALS') },
  ];
}

export async function report(access, locationIds) {
  const dq = await getSettings('dataQuality');
  const staleDays = dq.staleDays ?? 3;
  const today = todayLocal();
  const yesterday = addDays(today, -1);
  const from28 = addDays(today, -28);
  let st = null;
  let unreachable = null;
  try {
    st = await status();
  } catch (e) {
    unreachable = e.message;
  }
  const aliases = await roleAliases();
  const known = new Map((await locations()).map((l) => [l.id, l]));
  const out = [];
  for (const loc of locationIds) {
    const L = known.get(loc);
    if (!L) continue;
    const issues = [];
    const shifts = { n: (await locationConfig(loc)).shifts.filter((s) => s.active !== false).length };
    const base = { locationId: loc, locationName: L.name, isDemo: L.isDemo };
    if (unreachable) {
      issues.push({ code: 'ALLEGRO_UNREACHABLE', severity: 'HIGH', message: unreachable });
      if (!Number(shifts?.n)) issues.push({ code: 'NO_SHIFTS_DEFINED', severity: 'HIGH' });
      out.push({ ...base, sources: {}, issues });
      continue;
    }
    const S = st.branches.find((b) => b.branch === L.id) || {};
    const orders = S.beecomm?.orders || null;
    const itemsSt = S.beecomm?.items || null;
    const stale = (d) => d == null || daysBetween(d, today) > staleDays;
    const unavailable = (k) => st.sources?.[k]?.available === false;

    // ---- sales checks: days without sales are checked only up to what Allegro has loaded; they are closed days (owner
    // 2026-10-27: the data is the real work), so only a LOW note
    const checks = { lastDate: orders?.lastDate ?? null, rows: Number(orders?.rows || 0), demoRows: 0 };
    const recent = checks.rows ? await sourceChecks(loc, from28, yesterday) : [];
    const have = new Set(recent.map((c) => c.business_date));
    const missingDays = [];
    if (orders?.firstDate && orders?.lastDate) {
      const start = from28 > orders.firstDate ? from28 : orders.firstDate;
      const end = orders.lastDate < yesterday ? orders.lastDate : yesterday;
      for (let d = start; d <= end; d = addDays(d, 1)) if (!have.has(d)) missingDays.push(d);
    }
    if (unavailable('beecommOrders')) issues.push({ code: 'SOURCE_NOT_LOADED', severity: 'HIGH', source: 'beecommOrders', reason: st.sources.beecommOrders.reason });
    else if (!checks.rows) issues.push({ code: 'NO_SALES_CHECKS', severity: 'HIGH' });
    else if (stale(checks.lastDate)) issues.push({ code: 'STALE_SALES', severity: 'MEDIUM', lastDate: checks.lastDate, days: daysBetween(checks.lastDate, today) });
    if (missingDays.length) issues.push({ code: 'MISSING_SALES_DAYS', severity: 'LOW', dates: missingDays.slice(-14), count: missingDays.length });
    const n = recent.length;
    const noDiners = recent.filter((c) => c.diners == null).length;
    const noClose = recent.filter((c) => c.closed_at == null).length;
    const noAmount = recent.filter((c) => c.net_amount == null).length;
    if (n && noDiners / n > 0.05) issues.push({ code: 'CHECKS_WITHOUT_DINERS', severity: noDiners / n > 0.2 ? 'HIGH' : 'LOW', count: noDiners, of: n });
    if (n && noClose / n > 0.05) issues.push({ code: 'CHECKS_WITHOUT_CLOSE_TIME', severity: 'LOW', count: noClose, of: n });
    if (n && noAmount) issues.push({ code: 'CHECKS_WITHOUT_AMOUNT', severity: 'MEDIUM', count: noAmount, of: n });

    // ---- dish sales and the menu (the menu is still entered here)
    const items = { lastDate: itemsSt?.lastDate ?? null, rows: Number(itemsSt?.rows || 0), demoRows: 0 };
    if (unavailable('beecommItems')) issues.push({ code: 'SOURCE_NOT_LOADED', severity: 'HIGH', source: 'beecommItems', reason: st.sources.beecommItems.reason });
    else if (!items.rows) issues.push({ code: 'NO_SALES_ITEMS', severity: 'HIGH' });
    else if (stale(items.lastDate)) issues.push({ code: 'STALE_SALES_ITEMS', severity: 'MEDIUM', lastDate: items.lastDate, days: daysBetween(items.lastDate, today) });
    const menuCodes = new Set((await q(`SELECT external_code FROM joya_menu_items WHERE location_id=:l`, { l: loc })).map((m) => m.external_code));
    const unmatched = new Map();
    if (items.rows) {
      for (const r of await dishSales(loc, from28, yesterday)) {
        if (menuCodes.has(r.code)) continue;
        const u = unmatched.get(r.code) || { code: r.code, name: r.name, rows: 0 };
        u.rows++;
        unmatched.set(r.code, u);
      }
    }
    if (unmatched.size) issues.push({ code: 'UNMATCHED_ITEM_CODES', severity: 'MEDIUM', count: unmatched.size, items: [...unmatched.values()].sort((a, b) => b.rows - a.rows).slice(0, 20) });
    const recipes = (await q(`SELECT recipe_json FROM joya_menu_items WHERE location_id=:l AND active=1`, { l: loc })).map((m) => parseJson(m.recipe_json) || []);
    const menu = { n: recipes.length, no_recipe: recipes.filter((r) => !r.length).length, no_qty: recipes.flat().filter((l) => l.qty == null).length };
    if (!Number(menu?.n)) issues.push({ code: 'NO_MENU', severity: 'HIGH' });
    if (Number(menu?.no_recipe)) issues.push({ code: 'DISHES_WITHOUT_INGREDIENTS', severity: 'MEDIUM', count: Number(menu.no_recipe), of: Number(menu.n) });
    if (Number(menu?.no_qty)) issues.push({ code: 'RECIPE_LINES_WITHOUT_QTY', severity: 'INFO', count: Number(menu.no_qty) });

    // ---- clock rows (Tabit detailed report, uploaded in Allegro) and role names
    const raw = unavailable('tabitShifts') ? [] : await rawShifts(loc, addDays(today, -35), yesterday);
    const att = { lastDate: raw.length ? raw.map((r) => r.date).sort().at(-1) : null, rows: raw.length, demoRows: 0 };
    if (unavailable('tabitShifts')) issues.push({ code: 'SOURCE_NOT_LOADED', severity: 'MEDIUM', source: 'tabitShifts', reason: st.sources.tabitShifts.reason });
    else if (!att.rows) issues.push({ code: 'NO_ATTENDANCE', severity: 'MEDIUM' });
    else if (stale(att.lastDate)) issues.push({ code: 'STALE_ATTENDANCE', severity: 'LOW', lastDate: att.lastDate, days: daysBetween(att.lastDate, today) });
    const unmatchedEmp = new Map();
    for (const r of raw.filter((x) => x.employeeId == null)) unmatchedEmp.set(r.employeeName, (unmatchedEmp.get(r.employeeName) || 0) + 1);
    if (unmatchedEmp.size) issues.push({ code: 'UNMATCHED_EMPLOYEE_IDS', severity: 'HIGH', ids: [...unmatchedEmp].slice(0, 20).map(([id, rows]) => ({ source: 'TABIT', id, rows })) });
    const recentRaw = raw.filter((r) => r.date >= from28);
    const noRole = recentRaw.filter((r) => r.roleCode == null).length;
    if (noRole) issues.push({ code: 'ATTENDANCE_WITHOUT_ROLE', severity: 'LOW', count: noRole });
    const names = new Map();
    for (const r of recentRaw) if (r.roleName && !aliases.get(r.roleName)) names.set(r.roleName, (names.get(r.roleName) || 0) + 1);
    if (names.size) issues.push({ code: 'UNMAPPED_ROLE_NAMES', severity: 'MEDIUM', names: [...names].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([name, rows]) => ({ name, rows })) });

    if (!Number(shifts?.n)) issues.push({ code: 'NO_SHIFTS_DEFINED', severity: 'HIGH' });
    const lastPayroll = S.payrollMonths?.[0]?.month ?? null;
    if (access.payroll && !lastPayroll) issues.push({ code: 'NO_PAYROLL', severity: 'LOW' });

    out.push({
      ...base,
      sources: {
        SALES_CHECKS: checks,
        SALES_ITEMS: items,
        ATTENDANCE: att,
        PAYROLL: access.payroll ? { lastPeriod: lastPayroll, rows: Number(S.payrollMonths?.[0]?.employees || 0), demoRows: 0 } : undefined,
      },
      issues,
    });
  }
  return { today, staleDays, integrations: integrations(!unreachable), locations: out };
}
