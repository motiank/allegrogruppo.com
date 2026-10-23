/**
 * Joya Headquarter API — everything under /api/joya.
 *
 *   user (UI login with Joya access, see access.js): every route except /joya/ai/runner/*
 *   machine (X-Joya-Key = JOYA_API_KEY, the AI runner in hq/runner): /joya/ai/runner/*
 *
 * Errors: 400 BAD_REQUEST, 403 FORBIDDEN / NO_JOYA_ACCESS, 404 NOT_FOUND, 409 CONFLICT,
 * 422 MANDATORY_MIN (a staffing change under a mandatory minimum; `details.violations`),
 * 502 UPSTREAM (the Allegro API failed or cannot be reached), 503 NOT_LOADED (an Allegro table is missing).
 * Source data (sales, employees, clock times, payroll) is read from the Allegro API — see services/source.js.
 */
import { Router } from 'express';
import { requireJoya, requireAdmin, requirePayroll, scopeLocations } from './access.js';
import { requireMachineKey } from './auth/machineKey.js';
import { q, parseJson, todayLocal } from './db.js';
import * as master from './services/master.js';
import * as imports from './services/imports.js';
import * as repl from './services/replenishment.js';
import * as staffing from './services/staffing.js';
import * as analytics from './services/analytics.js';
import * as payroll from './services/payroll.js';
import * as quality from './services/quality.js';
import * as work from './services/work.js';
import * as ai from './services/ai.js';
import { forecastWeek } from './services/demand.js';
import { addDays } from './lib/recommend.js';
import logger from '../lib/log.js';
import { clearCache as clearAllegroCache, get as allegroGet, apiBase } from '../lib/allegro.js';
import { syncLocations } from './services/source.js';

const r = Router();
const STATUS = { BAD_REQUEST: 400, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, MANDATORY_MIN: 422, UPSTREAM: 502, NOT_LOADED: 503 };

const h = (fn) => async (req, res) => {
  try {
    const out = await fn(req, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (e) {
    const status = STATUS[e.code];
    if (status) return res.status(status).json({ error: e.message, code: e.code, details: e.details ?? null });
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'already exists', code: 'CONFLICT' });
    logger.error(`[joya] ${req.method} ${req.originalUrl}: ${e.stack || e.message}`);
    res.status(500).json({ error: 'server error' });
  }
};
const id = (req, key = 'id') => {
  const n = parseInt(req.params[key], 10);
  if (!Number.isFinite(n) || n <= 0) throw Object.assign(new Error(`bad ${key}`), { code: 'BAD_REQUEST' });
  return n;
};
const locsOf = (req) => scopeLocations(req.joya, req.query.locationIds ?? req.query.locationId);
function period(req) {
  const to = req.query.to || addDays(todayLocal(), -1);
  const from = req.query.from || addDays(to, -6);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw Object.assign(new Error('from/to must be YYYY-MM-DD, from ≤ to'), { code: 'BAD_REQUEST' });
  return [from, to];
}

// ---------------------------------------------------------------- AI runner (machine) — before the user gate
r.get('/joya/ai/runner/pending', requireMachineKey, h(async () => ({ ids: await ai.pendingForRunner() })));
r.post('/joya/ai/runner/:id/claim', requireMachineKey, h(async (req) => ({ claimed: await ai.claim(id(req)) })));
r.get('/joya/ai/runner/:id/context', requireMachineKey, h(async (req) => ai.contextFor(id(req))));
r.post('/joya/ai/runner/:id/compute', requireMachineKey, h(async (req) => ai.compute(id(req), req.body || {})));
r.post('/joya/ai/runner/:id/answer', requireMachineKey, h(async (req) => (await ai.answer(id(req), req.body || {}), { ok: true })));

r.use('/joya', requireJoya);

// ---------------------------------------------------------------- me, master data
r.get(
  '/joya/me',
  h(async (req) => {
    const a = req.joya;
    const locations = await master.listLocations(a);
    return {
      username: a.username,
      role: a.role,
      isAdmin: a.isAdmin,
      payroll: a.payroll,
      locations,
      demo: await quality.demoFlags(locations.map((l) => l.id)),
      roles: await master.listRoles(),
      shifts: await master.listShifts(a.locationIds),
      integrations: quality.integrations(null),
      today: todayLocal(),
    };
  }),
);
r.get('/joya/locations', h(async (req) => ({ locations: await master.listLocations(req.joya) })));
r.post('/joya/locations', requireAdmin, h(async (req) => ({ location: await master.upsertLocation(req.joya, req.body || {}) })));
r.get('/joya/users', requireAdmin, h(async () => ({ users: await master.listUsers() })));
r.get('/joya/settings', h(async () => ({ settings: await master.listSettings() })));
r.put('/joya/settings/:name', requireAdmin, h(async (req) => (await master.saveSetting(req.joya, req.params.name, req.body?.value), { settings: await master.listSettings() })));
r.get('/joya/roles', h(async () => ({ roles: await master.listRoles() })));
r.post('/joya/roles', requireAdmin, h(async (req) => (await master.saveRole(req.joya, req.body || {}), { roles: await master.listRoles() })));
r.get('/joya/shifts', h(async (req) => ({ shifts: await master.listShifts(locsOf(req)) })));
r.post('/joya/shifts', h(async (req) => ({ shift: await master.saveShift(req.joya, req.body || {}) })));
r.get(
  '/joya/menu',
  h(async (req) => {
    const loc = Number(req.query.locationId);
    if (!scopeLocations(req.joya, loc).length) throw Object.assign(new Error('no access to this location'), { code: 'FORBIDDEN' });
    return { items: await master.listMenu(loc) };
  }),
);
r.post('/joya/menu', h(async (req) => ({ id: await master.saveMenuItem(req.joya, req.body || {}) })));
r.get('/joya/menu/:id/recipe', h(async (req) => master.getRecipe(req.joya, id(req))));
r.put('/joya/menu/:id/recipe', h(async (req) => master.saveRecipe(req.joya, id(req), req.body?.lines)));
r.get('/joya/ingredients', h(async (req) => ({ ingredients: await master.listIngredients({ search: req.query.search }) })));
r.post('/joya/ingredients', h(async (req) => ({ ingredient: await master.saveIngredient(req.joya, req.body || {}) })));
r.get('/joya/employees', h(async (req) => ({ employees: await master.listEmployees(req.joya, locsOf(req)), unmatched: await master.unmatchedEmployeeIds(locsOf(req)) })));
r.get('/joya/role-aliases', h(async (req) => ({ aliases: await master.listRoleAliases(req.joya.locationIds) })));
r.post('/joya/role-aliases', requireAdmin, h(async (req) => (await master.saveRoleAlias(req.joya, req.body || {}), { aliases: await master.listRoleAliases(req.joya.locationIds) })));
// is the Allegro API reachable? (Settings → connections)
r.get('/joya/source/check', h(async () => {
  try {
    await allegroGet('/health');
    return { connected: true, url: apiBase(), error: null };
  } catch (e) {
    return { connected: false, url: apiBase(), error: e.message };
  }
}));
// read Allegro again now (after a change there): forget the 5-minute memory cache, look for new branches
r.post('/joya/source/refresh', h(async () => {
  clearAllegroCache();
  await syncLocations({ force: true });
  return { ok: true };
}));

// ---------------------------------------------------------------- imports
r.get('/joya/import/kinds', h(async (req) => ({ kinds: imports.describeKinds(req.joya) })));
r.post('/joya/import/preview', h(async (req) => imports.preview(req.joya, req.body || {})));
r.post(
  '/joya/import',
  h(async (req) => {
    const out = await imports.runImport(req.joya, req.body || {});
    if (req.body?.kind === 'ORDER_HISTORY' && req.body.locationId) await repl.refreshPatterns(Number(req.body.locationId)).catch(() => {});
    return out;
  }),
);
r.get('/joya/import/batches', h(async (req) => ({ batches: await imports.listBatches(req.joya, { locationIds: req.joya.locationIds, limit: req.query.limit }) })));
r.delete('/joya/import/batches/:id', h(async (req) => imports.deleteBatch(req.joya, id(req))));

// ---------------------------------------------------------------- replenishment
r.get('/joya/orders', h(async (req) => ({ lists: await repl.listLists(req.joya, { locationIds: locsOf(req), status: req.query.status, limit: req.query.limit }) })));
r.post('/joya/orders/generate', h(async (req) => repl.generate(req.joya, Number(req.body?.locationId), req.body?.date, { force: !!req.body?.force })));
r.post('/joya/orders/manual', h(async (req) => repl.createManual(req.joya, Number(req.body?.locationId), req.body?.date)));
r.get('/joya/orders/:id', h(async (req) => repl.getList(req.joya, id(req))));
r.post('/joya/orders/:id/check-ops', h(async (req) => ({ preview: await repl.checkOps(req.joya, id(req), req.body?.ops) })));
r.post('/joya/orders/:id/ops', h(async (req) => repl.applyOps(req.joya, id(req), req.body?.ops)));
r.post('/joya/orders/:id/approve', h(async (req) => repl.approve(req.joya, id(req), req.body || {})));
r.post('/joya/orders/:id/ordered', h(async (req) => repl.markOrdered(req.joya, id(req), req.body || {})));
r.post('/joya/orders/:id/reject', h(async (req) => repl.reject(req.joya, id(req), req.body || {})));
r.post('/joya/orders/:id/reopen', h(async (req) => repl.reopen(req.joya, id(req))));
r.get('/joya/orders/:id/text', h(async (req) => ({ text: await repl.listText(req.joya, id(req)) })));
r.get('/joya/patterns', h(async (req) => ({ patterns: await repl.getPatterns(req.joya, Number(req.query.locationId)) })));
r.post('/joya/patterns/refresh', h(async (req) => {
  const loc = Number(req.body?.locationId);
  if (!scopeLocations(req.joya, loc).length) throw Object.assign(new Error('no access to this location'), { code: 'FORBIDDEN' });
  return { items: await repl.refreshPatterns(loc) };
}));
r.get('/joya/shortages', h(async (req) => ({ shortages: await repl.listShortages(req.joya, { locationIds: locsOf(req), days: req.query.days }) })));
r.post('/joya/shortages', h(async (req) => repl.reportShortage(req.joya, req.body || {})));
r.delete('/joya/shortages/:id', h(async (req) => (await repl.deleteShortage(req.joya, id(req)), { ok: true })));

// ---------------------------------------------------------------- staffing
r.get('/joya/staffing/rules', h(async (req) => ({ rules: await staffing.listRules(req.joya, req.query.locationId ? Number(req.query.locationId) : null) })));
r.post('/joya/staffing/rules', h(async (req) => ({ id: await staffing.saveRule(req.joya, req.body || {}) })));
r.delete('/joya/staffing/rules/:id', h(async (req) => (await staffing.deleteRule(req.joya, id(req)), { ok: true })));
r.get('/joya/staffing/baseline', h(async (req) => ({ baseline: await staffing.listBaseline(req.joya, Number(req.query.locationId)) })));
r.post('/joya/staffing/baseline', h(async (req) => (await staffing.saveBaseline(req.joya, req.body || {}), { baseline: await staffing.listBaseline(req.joya, Number(req.body?.locationId)) })));
r.get(
  '/joya/staffing/forecast',
  h(async (req) => {
    const loc = Number(req.query.locationId);
    if (!scopeLocations(req.joya, loc).length) throw Object.assign(new Error('no access to this location'), { code: 'FORBIDDEN' });
    return forecastWeek(loc, staffing.sundayOf(req.query.weekStart || addDays(todayLocal(), 7)));
  }),
);
r.get('/joya/staffing/plans', h(async (req) => ({ plans: await staffing.listPlans(req.joya, { locationIds: locsOf(req), limit: req.query.limit }) })));
r.post('/joya/staffing/plans/propose', h(async (req) => staffing.propose(req.joya, Number(req.body?.locationId), req.body?.weekStart, { force: !!req.body?.force })));
r.get('/joya/staffing/plans/:id', h(async (req) => staffing.getPlan(req.joya, id(req))));
r.post('/joya/staffing/plans/:id/check-ops', h(async (req) => ({ preview: await staffing.checkOps(req.joya, id(req), req.body?.ops) })));
r.post('/joya/staffing/plans/:id/ops', h(async (req) => staffing.applyOps(req.joya, id(req), req.body?.ops)));
r.post('/joya/staffing/plans/:id/approve', h(async (req) => staffing.approve(req.joya, id(req), req.body || {})));
r.post('/joya/staffing/plans/:id/reject', h(async (req) => staffing.reject(req.joya, id(req), req.body || {})));
r.post('/joya/staffing/plans/:id/reopen', h(async (req) => staffing.reopen(req.joya, id(req))));
r.get('/joya/staffing/plans/:id/actual', h(async (req) => staffing.compareActual(req.joya, id(req))));
r.get(
  '/joya/staffing/plans/:id/export.csv',
  h(async (req, res) => {
    const { fileName, csv } = await staffing.exportCsv(req.joya, id(req), req.query.lang === 'en' ? 'en' : 'he');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(csv);
  }),
);

// ---------------------------------------------------------------- sales, labor
r.get('/joya/sales/summary', h(async (req) => analytics.salesSummary(locsOf(req), ...period(req))));
r.get('/joya/sales/daily', h(async (req) => analytics.salesDaily(locsOf(req), ...period(req))));
r.get('/joya/sales/shifts', h(async (req) => analytics.salesByShift(locsOf(req), ...period(req))));
r.get('/joya/sales/dishes', h(async (req) => analytics.salesByDish(locsOf(req), ...period(req), req.query.limit)));
r.get('/joya/sales/anomalies', h(async (req) => analytics.anomalies(locsOf(req), ...period(req))));
r.get('/joya/labor/summary', h(async (req) => analytics.laborSummary(req.joya, locsOf(req), ...period(req))));
r.get('/joya/labor/planned-vs-actual', h(async (req) => analytics.plannedVsActual(req.joya, locsOf(req), ...period(req))));

// ---------------------------------------------------------------- payroll checks
r.post('/joya/payroll/checks', h(async (req) => payroll.runChecks(req.joya, Number(req.body?.locationId), req.body?.period)));
r.get('/joya/payroll/issues', h(async (req) => ({ issues: await payroll.listIssues(req.joya, { locationIds: locsOf(req), period: req.query.period, status: req.query.status }) })));
r.post('/joya/payroll/issues/:id/resolve', h(async (req) => (await payroll.resolveIssue(req.joya, id(req), req.body || {}), { ok: true })));
r.post('/joya/payroll/corrections', h(async (req) => payroll.correctAttendance(req.joya, req.body || {})));
r.get('/joya/payroll/attendance', h(async (req) => ({ rows: await payroll.attendanceRows(req.joya, Number(req.query.locationId), ...period(req)) })));
r.get('/joya/payroll/lines', requirePayroll, h(async (req) => payroll.payrollLines(req.joya, Number(req.query.locationId), req.query.period)));

// ---------------------------------------------------------------- quality, tasks, inquiries, overview, audit
r.get('/joya/quality', h(async (req) => quality.report(req.joya, locsOf(req))));
r.get('/joya/tasks', h(async (req) => ({ tasks: await work.listTasks(req.joya, { locationIds: locsOf(req), status: req.query.status, owner: req.query.owner, overdue: req.query.overdue === '1' }) })));
r.post('/joya/tasks', h(async (req) => ({ task: await work.saveTask(req.joya, req.body || {}) })));
r.get('/joya/inquiries', h(async (req) => ({ inquiries: await work.listInquiries(req.joya, { locationIds: locsOf(req), status: req.query.status }) })));
r.post('/joya/inquiries', h(async (req) => ({ inquiry: await work.saveInquiry(req.joya, req.body || {}) })));
r.get('/joya/inquiries/:id', h(async (req) => ({ inquiry: await work.getInquiry(req.joya, id(req)) })));
r.post('/joya/inquiries/:id/action', h(async (req) => ({ inquiry: await work.inquiryAction(req.joya, id(req), req.body || {}) })));
r.get('/joya/overview', h(async (req) => work.overview(req.joya, locsOf(req), { days: req.query.days || 7 })));
r.get(
  '/joya/audit',
  h(async (req) => {
    const entity = String(req.query.entity || '');
    const entityId = Number(req.query.entityId);
    if (!entity || !Number.isFinite(entityId)) throw Object.assign(new Error('entity and entityId are required'), { code: 'BAD_REQUEST' });
    const rows = await q(`SELECT * FROM joya_audit_log WHERE entity=:e AND entity_id=:i ORDER BY id`, { e: entity, i: entityId });
    const visible = rows.filter((x) => x.location_id == null ? req.joya.isAdmin : req.joya.locationIds.includes(x.location_id));
    return { entries: visible.map((x) => ({ id: x.id, by: x.username, action: x.action, at: x.created_at, detail: parseJson(x.detail_json) })) };
  }),
);

// ---------------------------------------------------------------- AI (user side)
r.post('/joya/ai/ask', h(async (req) => ({ request: await ai.ask(req.joya, req.body || {}) })));
r.get('/joya/ai/requests', h(async (req) => ({ requests: await ai.listRequests(req.joya, { contextKind: req.query.contextKind, contextId: req.query.contextId, limit: req.query.limit }) })));
r.get('/joya/ai/requests/:id', h(async (req) => ({ request: await ai.getRequest(req.joya, id(req)) })));
r.post('/joya/ai/requests/:id/apply', h(async (req) => ai.applyProposal(req.joya, id(req))));
r.post('/joya/ai/requests/:id/discard', h(async (req) => ({ request: await ai.discardProposal(req.joya, id(req)) })));

export default r;
