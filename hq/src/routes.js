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
import express, { Router } from 'express';
import { createRequire } from 'module';
import { requireJoya, limitAccountant, requireAdmin, requirePayroll, scopeLocations, canLocation } from './access.js';
import { requireMachineKey } from './auth/machineKey.js';
import { q, parseJson, todayLocal } from './db.js';
import * as master from './services/master.js';
import * as repl from './services/replenishment.js';
import * as staffing from './services/staffing.js';
import * as analytics from './services/analytics.js';
import * as payroll from './services/payroll.js';
import * as quality from './services/quality.js';
import * as work from './services/work.js';
import * as ai from './services/ai.js';
import * as payments from './services/payments.js';
import { answerTableXlsx } from './services/answerExcel.js';
import multer from 'multer';
import { extractAttachment, MAX_FILE_BYTES } from './services/attachments.js';
const askUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: 1 } }).single('file');
import { forecastWeek } from './services/demand.js';
import { addDays } from './lib/recommend.js';
import logger from '../lib/log.js';
import { clearCache as clearAllegroCache, get as allegroGet, postFiles, apiBase } from '../lib/allegro.js';
import { financeBankAccounts, financeBankReport, financeBankReportFile, financeBankReportFacets } from './services/source.js';

const RESTAURANTS = createRequire(import.meta.url)('../../shared/restaurants.json');

const r = Router();
const STATUS = { BAD_REQUEST: 400, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, MANDATORY_MIN: 422, UPSTREAM: 502, NOT_SUPPORTED: 502, NOT_LOADED: 503 };

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
// a location id is an Allegro branch id (a string)
const locId = (v) => (v == null || v === '' ? null : String(v).trim());
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

r.use('/joya', requireJoya, limitAccountant);

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
      demo: Object.fromEntries(locations.map((l) => [l.id, l.isDemo])),
      roles: await master.listRoles(),
      shifts: await master.listShifts(a.locationIds),
      integrations: quality.integrations(null),
      today: todayLocal(),
    };
  }),
);
r.get('/joya/locations', h(async (req) => ({ locations: await master.listLocations(req.joya) })));
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
    const loc = locId(req.query.locationId);
    if (!canLocation(req.joya, loc)) throw Object.assign(new Error('no access to this location'), { code: 'FORBIDDEN' });
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
// read Allegro again now (after a change there): forget the 5-minute memory cache (also the branches)
r.post('/joya/source/refresh', h(async () => {
  clearAllegroCache();
  return { ok: true };
}));

// ---------------------------------------------------------------- replenishment
r.get('/joya/orders', h(async (req) => ({ lists: await repl.listLists(req.joya, { locationIds: locsOf(req), status: req.query.status, limit: req.query.limit }) })));
r.post('/joya/orders/generate', h(async (req) => repl.generate(req.joya, locId(req.body?.locationId), req.body?.date, { force: !!req.body?.force })));
r.post('/joya/orders/manual', h(async (req) => repl.createManual(req.joya, locId(req.body?.locationId), req.body?.date)));
r.get('/joya/orders/:id', h(async (req) => repl.getList(req.joya, id(req))));
r.post('/joya/orders/:id/check-ops', h(async (req) => ({ preview: await repl.checkOps(req.joya, id(req), req.body?.ops) })));
r.post('/joya/orders/:id/ops', h(async (req) => repl.applyOps(req.joya, id(req), req.body?.ops)));
r.post('/joya/orders/:id/approve', h(async (req) => repl.approve(req.joya, id(req), req.body || {})));
r.post('/joya/orders/:id/ordered', h(async (req) => repl.markOrdered(req.joya, id(req), req.body || {})));
r.post('/joya/orders/:id/reject', h(async (req) => repl.reject(req.joya, id(req), req.body || {})));
r.post('/joya/orders/:id/reopen', h(async (req) => repl.reopen(req.joya, id(req))));
r.get('/joya/orders/:id/text', h(async (req) => ({ text: await repl.listText(req.joya, id(req)) })));
r.get('/joya/patterns', h(async (req) => ({ patterns: await repl.getPatterns(req.joya, locId(req.query.locationId)) })));
r.get('/joya/shortages', h(async (req) => ({ shortages: await repl.listShortages(req.joya, { locationIds: locsOf(req), days: req.query.days }) })));
r.post('/joya/shortages', h(async (req) => repl.reportShortage(req.joya, req.body || {})));
r.delete('/joya/shortages/:id', h(async (req) => (await repl.deleteShortage(req.joya, id(req)), { ok: true })));

// ---------------------------------------------------------------- staffing
r.get('/joya/staffing/rules', h(async (req) => ({ rules: await staffing.listRules(req.joya, locId(req.query.locationId)) })));
r.post('/joya/staffing/rules', h(async (req) => ({ id: await staffing.saveRule(req.joya, req.body || {}) })));
r.delete('/joya/staffing/rules/:id', h(async (req) => (await staffing.deleteRule(req.joya, id(req)), { ok: true })));
r.get('/joya/staffing/baseline', h(async (req) => ({ baseline: await staffing.listBaseline(req.joya, locId(req.query.locationId)) })));
r.post('/joya/staffing/baseline', h(async (req) => (await staffing.saveBaseline(req.joya, req.body || {}), { baseline: await staffing.listBaseline(req.joya, locId(req.body?.locationId)) })));
r.get(
  '/joya/staffing/forecast',
  h(async (req) => {
    const loc = locId(req.query.locationId);
    if (!canLocation(req.joya, loc)) throw Object.assign(new Error('no access to this location'), { code: 'FORBIDDEN' });
    return forecastWeek(loc, staffing.sundayOf(req.query.weekStart || addDays(todayLocal(), 7)));
  }),
);
r.get('/joya/staffing/plans', h(async (req) => ({ plans: await staffing.listPlans(req.joya, { locationIds: locsOf(req), limit: req.query.limit }) })));
r.post('/joya/staffing/plans/propose', h(async (req) => staffing.propose(req.joya, locId(req.body?.locationId), req.body?.weekStart, { force: !!req.body?.force })));
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
r.post('/joya/payroll/checks', h(async (req) => payroll.runChecks(req.joya, locId(req.body?.locationId), req.body?.period)));
r.get('/joya/payroll/issues', h(async (req) => ({ issues: await payroll.listIssues(req.joya, { locationIds: locsOf(req), period: req.query.period, status: req.query.status }) })));
r.post('/joya/payroll/issues/:id/resolve', h(async (req) => (await payroll.resolveIssue(req.joya, id(req), req.body || {}), { ok: true })));
r.post('/joya/payroll/corrections', h(async (req) => payroll.correctAttendance(req.joya, req.body || {})));
r.get('/joya/payroll/attendance', h(async (req) => ({ rows: await payroll.attendanceRows(req.joya, locId(req.query.locationId), ...period(req)) })));
r.get('/joya/payroll/lines', requirePayroll, h(async (req) => payroll.payrollLines(req.joya, locId(req.query.locationId), req.query.period)));

// ---------------------------------------------------------------- the books: the detailed bank reconciliation report
// The admin's report (admin/server/modules/bankRecon.js) through the Finance API, for the chain admin: the bank
// accounts to pick from, the JSON, the Hebrew HTML page (shown in an iframe) and the Excel file. Joya keeps nothing.
// kind / party / q / amount / sections = the report's filters (shared/bankReconFilter.js), done by the admin server
const reportParams = (req) => ({ company: req.query.company, account: req.query.account, from: req.query.from, to: req.query.to, kind: req.query.kind, party: req.query.party, q: req.query.q, amount: req.query.amount, sections: req.query.sections });
r.get('/joya/finance/bank-recon/accounts', requireAdmin, h(async () => financeBankAccounts()));
r.get(
  '/joya/finance/bank-recon/facets',
  requireAdmin,
  h(async (req) => {
    const out = await financeBankReportFacets({ company: req.query.company, account: req.query.account, from: req.query.from, to: req.query.to });
    if (!out.available) throw Object.assign(new Error(out.reason), { code: out.badRequest ? 'BAD_REQUEST' : 'NOT_LOADED' });
    return { kinds: out.data?.kinds || [], parties: out.data?.parties || [] };
  }),
);
r.get(
  '/joya/finance/bank-recon',
  requireAdmin,
  h(async (req, res) => {
    const format = String(req.query.format || 'json');
    if (!['json', 'html', 'xlsx'].includes(format)) throw Object.assign(new Error('format must be json, html or xlsx'), { code: 'BAD_REQUEST' });
    if (format === 'json') {
      const out = await financeBankReport(reportParams(req));
      if (!out.available) throw Object.assign(new Error(out.reason), { code: out.badRequest ? 'BAD_REQUEST' : 'NOT_LOADED' });
      return { report: out.data };
    }
    const file = await financeBankReportFile(reportParams(req), format);
    res.setHeader('Content-Type', file.headers['content-type'] || (format === 'html' ? 'text/html; charset=utf-8' : 'application/octet-stream'));
    if (format === 'xlsx') res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.send(file.buffer);
  }),
);

// ---------------------------------------------------------------- payments (תשלומים): the planned bank transfers
// Joya's own table (services/payments.js), chain admin only. The page reads the board and confirms an unclear bank
// match; changes come from the chat (a PAYMENT_OPS proposal applied in ai.js) or from these routes — the same
// checkOps → applyOps path, so the rules are one.
const paymentOp = async (req, op) => payments.applyOps(req.joya, await payments.checkOps(req.joya, [op], { companyKey: req.body?.companyKey ?? req.query.company ?? null }), { via: 'API' });
r.get('/joya/payments', requireAdmin, h(async (req) => payments.list(req.joya, { companyKey: req.query.company || null, from: req.query.from || null, to: req.query.to || null, status: req.query.status || 'PLANNED' })));
r.get('/joya/payments/payees', requireAdmin, h(async (req) => ({ payees: await payments.payees(req.query.company || null) })));
r.post('/joya/payments', requireAdmin, h(async (req) => paymentOp(req, { ...(req.body || {}), op: 'add' })));
r.patch(
  '/joya/payments/:id',
  requireAdmin,
  h(async (req) => {
    const b = req.body || {};
    const pid = id(req);
    let n = 0;
    if (b.dueDate || b.dueWeek) (n++, await paymentOp(req, { op: 'move', id: pid, dueDate: b.dueDate, dueWeek: b.dueWeek, scope: b.scope }));
    if (b.amount != null) (n++, await paymentOp(req, { op: 'amount', id: pid, amount: b.amount, scope: b.scope }));
    if (!n) throw Object.assign(new Error('nothing to change: dueDate / dueWeek or amount'), { code: 'BAD_REQUEST' });
    return { payment: await payments.get(req.joya, pid) };
  }),
);
r.post('/joya/payments/:id/cancel', requireAdmin, h(async (req) => (await paymentOp(req, { op: 'cancel', id: id(req), scope: req.body?.scope }), { payment: await payments.get(req.joya, id(req)) })));
r.post('/joya/payments/:id/match', requireAdmin, h(async (req) => ({ payment: await payments.confirmMatch(req.joya, id(req), req.body?.bankTxKey) })));

// ---------------------------------------------------------------- quality, overview, audit
r.get('/joya/quality', h(async (req) => quality.report(req.joya, locsOf(req))));
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

// ---------------------------------------------------------------- files dropped in the chat
// The same recognize / import as the Allegro admin's Upload files page (Allegro /files/*); the data goes to the Allegro
// tables, Joya keeps nothing. Rights: the chain admin = every file; a manager = the files of their branches, no bank
// files; the accountant = only the bank files of their companies' accounts (shared/restaurants.json bank_accounts).
async function fileRights(a) {
  if (a.isAdmin) return { 'X-Joya-User': a.username, 'X-Joya-Admin': '1' };
  const out = { 'X-Joya-User': a.username, 'X-Joya-Branches': a.role === 'ACCOUNTANT' ? '' : a.locationIds.join(',') };
  if (a.role === 'ACCOUNTANT') {
    const companies = new Set((await master.listLocations(a)).map((l) => l.company?.key).filter(Boolean));
    out['X-Joya-Bank-Accounts'] = (RESTAURANTS.restaurants || [])
      .filter((g) => companies.has(g.key))
      .flatMap((g) => (g.bank_accounts || []).map((b) => b.account))
      .join(',');
  }
  return out;
}
for (const step of ['recognize', 'import']) {
  r.post(
    `/joya/files/${step}`,
    express.raw({ type: 'multipart/form-data', limit: '60mb' }),
    h(async (req) => {
      if (!Buffer.isBuffer(req.body) || !req.body.length) throw Object.assign(new Error('no files'), { code: 'BAD_REQUEST' });
      const data = await postFiles(`/files/${step}`, req.body, req.get('content-type'), await fileRights(req.joya));
      if (step === 'import') {
        clearAllegroCache(); // the new rows are seen at once
        logger.info(`[joya] ${req.joya.username} imported ${JSON.stringify((data || []).map((x) => ({ name: x.name, kind: x.kind, status: x.status })))}`);
      }
      return { files: data || [] };
    }),
  );
}

// ---------------------------------------------------------------- AI (user side)
r.post('/joya/ai/ask', h(async (req) => ({ request: await ai.ask(req.joya, req.body || {}) })));
// a question with a file (the chat's paperclip — a supplier's / customer's statement to compare): multipart form — question, contextKind, contextId, companyKey, lang, file
r.post(
  '/joya/ai/ask-file',
  (req, res, next) => askUpload(req, res, (e) => (e ? next(Object.assign(new Error(e.code === 'LIMIT_FILE_SIZE' ? 'the file is bigger than 15 MB' : e.message), { code: 'BAD_REQUEST' })) : next())),
  h(async (req) => {
    const f = req.file;
    if (!f) throw Object.assign(new Error('a file is needed'), { code: 'BAD_REQUEST' });
    const name = Buffer.from(String(f.originalname || ''), 'latin1').toString('utf8'); // multer reads names as latin1
    const attachment = await extractAttachment({ name, mime: f.mimetype, buffer: f.buffer });
    const b = req.body || {};
    return { request: await ai.ask(req.joya, { question: b.question, contextKind: b.contextKind, contextId: b.contextId == null || b.contextId === '' ? null : Number(b.contextId), companyKey: b.companyKey || null, locationId: b.locationId || null, lang: b.lang, attachment }) };
  }),
);
r.get('/joya/ai/requests', h(async (req) => ({ requests: await ai.listRequests(req.joya, { contextKind: req.query.contextKind, contextId: req.query.contextId, limit: req.query.limit, beforeId: req.query.beforeId }) })));
r.get('/joya/ai/requests/:id', h(async (req) => ({ request: await ai.getRequest(req.joya, id(req)) })));
r.post('/joya/ai/requests/:id/apply', h(async (req) => ai.applyProposal(req.joya, id(req))));
r.delete('/joya/ai/requests/:id', h(async (req) => (await ai.deleteRequest(req.joya, id(req)), { ok: true })));
r.get(
  '/joya/ai/requests/:id/tables/:n.xlsx',
  h(async (req, res) => {
    const { fileName, buffer } = await answerTableXlsx(req.joya, id(req), Number(req.params.n));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(Buffer.from(buffer));
  }),
);
// the payroll files of a saved month (calc payroll_files), made by the Allegro admin; users with payroll access only
r.get(
  '/joya/payroll/files/:kind.xlsx',
  h(async (req, res) => {
    const { buffer, fileName } = await ai.payrollFile(req.joya, req.query.locationId, req.query.month, req.params.kind);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.send(buffer);
  }),
);
r.post('/joya/ai/requests/:id/retry', h(async (req) => ({ request: await ai.retryRequest(req.joya, id(req)) })));
r.post('/joya/ai/requests/:id/discard', h(async (req) => ({ request: await ai.discardProposal(req.joya, id(req)) })));

export default r;
