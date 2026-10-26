// Questions and requests in words (Hebrew or English).
//
// The model never computes a number. The flow:
//   1. the user asks → joya_ai_requests row, THINKING
//   2. the AI runner (hq/runner, `claude -p`, no API key) reads the context and
//      picks calculations from CALCS below (and, for a change request, the changes)
//   3. the hub runs the calculations WITH THE ASKING USER'S ACCESS and validates the
//      changes with the same checks the UI uses → stored in calcs_json / proposal_json
//   4. the runner writes the answer from those results only; numbers in the answer that
//      are not in the results are listed in meta.unverifiedNumbers and shown as a warning
//   5. a proposed change is shown as a diff and saved only when the user taps Apply
import { q, one, err, audit, parseJson, todayLocal } from '../db.js';
import { assertLocation, canLocation, loadAccess } from '../access.js';
import * as analytics from './analytics.js';
import * as quality from './quality.js';
import * as payroll from './payroll.js';
import * as repl from './replenishment.js';
import * as staffing from './staffing.js';
import * as work from './work.js';
import * as shiftModel from './shiftModel.js';
import * as bank from './bank.js';
import * as source from './source.js';
import { recentSameWeekday } from './demand.js';
import { addDays } from '../lib/recommend.js';
import { listRoles, listShifts, listLocations } from './master.js';

const THINKING_TIMEOUT_MS = Number(process.env.JOYA_AI_TIMEOUT_MS ?? 6 * 60_000);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// Most calculations one request may run. Sent to the model in the context (limits.maxCalcs).
export const MAX_CALCS = 6;

function locs(access, p) {
  const ids = p.locationIds ?? (p.locationId != null ? [p.locationId] : null);
  // no location given → the picker choice the question was asked with (access.scopeIds, see compute), else all
  if (!ids) return access.scopeIds ?? access.locationIds;
  const asked = (Array.isArray(ids) ? ids : [ids]).map(String);
  const allowed = asked.filter((id) => canLocation(access, id));
  if (!allowed.length) throw err('FORBIDDEN', 'no access to the requested location(s)');
  return allowed;
}
// Employees with their wages (Allegro /employees), for users with payroll access. No national ids or phones.
async function employeeList(access, p) {
  if (!access.payroll) throw err('FORBIDDEN', 'wages need payroll access');
  const ids = locs(access, p);
  const names = new Map((await listLocations(access)).map((l) => [String(l.id), l.name]));
  const want = p.active === 'all' ? null : p.active === false || p.active === 'false' ? false : true;
  const text = p.q ? String(p.q).trim().toLowerCase() : null;
  const role = p.role ? String(p.role).trim() : null;
  const rows = (await source.employees(ids)).filter(
    (e) =>
      (want == null || e.active === want) &&
      (!text || String(e.name || '').toLowerCase().includes(text)) &&
      (!role || e.roles.some((r) => r.role.includes(role)) || e.roleNames.some((r) => r.includes(role))),
  );
  const max = Math.min(Math.max(Number(p.limit) || 150, 1), 300);
  const byRole = new Map();
  for (const e of rows)
    for (const r of e.roles) {
      const g = byRole.get(r.role) || { role: r.role, employees: 0, rated: 0, sum: 0, min: null, max: null };
      g.employees++;
      if (r.hourlyRate != null) {
        g.rated++;
        g.sum += r.hourlyRate;
        g.min = g.min == null ? r.hourlyRate : Math.min(g.min, r.hourlyRate);
        g.max = g.max == null ? r.hourlyRate : Math.max(g.max, r.hourlyRate);
      }
      byRole.set(r.role, g);
    }
  return {
    source: 'Allegro employees (/employees); wages as set in the admin Employees page',
    note: 'wage = the hourly rate for hourly_* types, a monthly amount for global_* (then hourlyRate is null); hourly_min_* = the minimum wage; *_net = the wage is net. Gross wages, not the employer cost',
    filter: { active: want == null ? 'all' : want, q: p.q || null, role },
    count: rows.length,
    shown: Math.min(rows.length, max),
    byRole: [...byRole.values()]
      .sort((a, b) => b.employees - a.employees)
      .map((g) => ({ role: g.role, employees: g.employees, avgHourlyRate: g.rated ? Math.round((g.sum / g.rated) * 100) / 100 : null, minHourlyRate: g.min, maxHourlyRate: g.max })),
    employees: rows.slice(0, max).map((e) => ({
      name: e.name,
      location: names.get(e.locationId) ?? e.locationId,
      locationId: e.locationId,
      active: e.active,
      contractor: e.contractor,
      wageType: e.wageType,
      wage: e.wage,
      hourlyRate: e.hourlyRate,
      roles: e.roles,
    })),
  };
}
// Bank data is per company and for the chain admin only. companyKeys (keys or names) → those companies; else the
// companies of the locations in scope (the picker choice, see locs).
async function bankCompanies(access, p) {
  if (!access.isAdmin) throw err('FORBIDDEN', 'bank data is for the chain admin only');
  const all = await listLocations(access);
  const known = new Map();
  for (const l of all) if (l.company?.key) known.set(l.company.key, { key: l.company.key, label: l.company.label ?? l.company.key });
  const asked = p.companyKeys ?? (p.companyKey != null ? [p.companyKey] : null);
  if (asked) {
    const list = (Array.isArray(asked) ? asked : [asked]).map(String);
    const found = [...known.values()].filter((c) => list.includes(c.key) || list.includes(c.label));
    if (!found.length) throw err('BAD_REQUEST', `unknown company ${list.join(', ')}`);
    return found;
  }
  const ids = new Set(locs(access, {}));
  return [...known.values()].filter((c) => all.some((l) => ids.has(String(l.id)) && l.company?.key === c.key));
}

function range(p) {
  if (!DATE.test(p.from || '') || !DATE.test(p.to || '')) throw err('BAD_REQUEST', 'from and to must be YYYY-MM-DD');
  if (p.from > p.to) throw err('BAD_REQUEST', 'from is after to');
  return [p.from, p.to];
}

/** The calculations the model may ask for. Each result carries its period and source. */
export const CALCS = {
  sales_summary: {
    params: '{ locationIds?: string[], from: "YYYY-MM-DD", to: "YYYY-MM-DD" }',
    about: 'revenue, checks (= orders), diners, average per check and per diner for the period, compared with the same-length period before; change split into volume effect and average-spend effect',
    run: (a, p) => analytics.salesSummary(locs(a, p), ...range(p)),
  },
  sales_daily: { params: '{ locationIds?, from, to }', about: 'day by day revenue, checks, diners; missing days marked', run: (a, p) => analytics.salesDaily(locs(a, p), ...range(p)) },
  sales_by_shift: { params: '{ locationIds?, from, to }', about: 'revenue, checks, diners per shift', run: (a, p) => analytics.salesByShift(locs(a, p), ...range(p)) },
  payments_summary: {
    params: '{ locationIds?, from, to, brands?: ["VISA", "MASTERCARD", "AMEX", "DINERS"], group?: "week" | "month" }',
    about:
      'payments by type (credit, cash, Wolt, 10bis, Sodexo, Multipass, hakafa…) and card brand: charges with tips, share of all payments, refunds, number and average payment, service (tips); vs the same-length period before. Always: creditCards (= "credit card": VISA + MASTERCARD + AMEX + DINERS only) and membersClub (every other brand of the credit type: the club card, Mishloha…), per location (day by day up to 62 days) and in total. brands: also the sum of only these card brands (selected; selectedTotal). group: also the sums per Sunday–Saturday week or per month (byPeriod per location, byPeriodTotal over all)',
    run: (a, p) => analytics.paymentsSummary(locs(a, p), ...range(p), p.brands, p.group),
  },
  bank_summary: {
    params: '{ companyKeys?: string[], from, to, group?: "week" | "month" }',
    about:
      "the company's bank account(s): money in and out, net, the balance at the start and end and the lowest, the biggest sources and uses (action + details), day by day up to 62 days; group: per Sunday–Saturday week or per month (byPeriod) instead of day by day; vs the same-length period before. Chain admin only",
    run: async (a, p) => bank.bankSummary(await bankCompanies(a, p), ...range(p), p.group),
  },
  cards_vs_bank: {
    params: '{ companyKeys?, from, to }',
    about:
      'week by week (Sunday–Saturday): the credit cards in Beecomm (VISA + MASTERCARD + AMEX + DINERS) of the company\'s restaurants next to what the card companies (Max, Amex, Isracard, Cal) paid into its bank account in the following week, per card company, with the difference in %. Chain admin only',
    run: async (a, p) => {
      const cos = await bankCompanies(a, p);
      const all = await listLocations(a);
      const scope = new Set(locs(a, {}));
      const of = (key) => all.filter((l) => l.company?.key === key && (p.companyKeys || p.companyKey || scope.has(String(l.id)))).map((l) => String(l.id)).filter((id) => canLocation(a, id));
      return bank.cardsVsBank(cos, of, ...range(p));
    },
  },
  bank_transactions: {
    params: '{ companyKeys?, from, to, q?: "text in the action or details, e.g. WOLT, מקס, ביטוח לאומי", side?: "credit" | "debit", order?: "amount" | "date", limit? }',
    about: 'single bank transactions (biggest or newest first) with their count and sums; filter by text and money in/out. Chain admin only',
    run: async (a, p) => bank.bankTransactions(await bankCompanies(a, p), ...range(p), { q: p.q, side: p.side, order: p.order, limit: p.limit }),
  },
  sales_by_dish: { params: '{ locationIds?, from, to, limit? }', about: 'units and revenue per dish vs the previous period', run: (a, p) => analytics.salesByDish(locs(a, p), ...range(p), p.limit) },
  sales_anomalies: { params: '{ locationIds?, from, to }', about: 'days with unusual revenue vs the same weekday of the 8 weeks before, and missing days', run: (a, p) => analytics.anomalies(locs(a, p), ...range(p)) },
  labor_summary: {
    params: '{ locationIds?, from, to }',
    about: 'worked hours, sales per labor hour; with payroll access also labor cost (known from payroll lines for whole months, else an estimate) and labor % of sales',
    run: (a, p) => analytics.laborSummary(a, locs(a, p), ...range(p)),
  },
  planned_vs_actual_hours: { params: '{ locationIds?, from, to }', about: 'approved staffing plan hours vs worked hours per week', run: (a, p) => analytics.plannedVsActual(a, locs(a, p), ...range(p)) },
  shift_demand_recent: {
    params: '{ locationId, weekday: 0-6 (0 = Sunday), shiftCode?, weeks? }',
    about: 'demand units (diners per shift, peak hour, orders…) on the recent same weekdays',
    run: async (a, p) => {
      assertLocation(a, p.locationId);
      const rows = await recentSameWeekday(String(p.locationId), Number(p.weekday), p.shiftCode || null, Math.min(Number(p.weeks) || 8, 26), todayLocal());
      return { period: { from: rows[rows.length - 1]?.date ?? null, to: rows[0]?.date ?? null }, source: 'Beecomm via Allegro (/beecomm/orders/stored)', rows };
    },
  },
  shift_profile: {
    params: '{ locationId, weeks? }',
    about: 'the usual shift: diners and deliveries per weekday and shift (morning / evening), an EMA over the last weeks (default 8; recent weeks weigh more)',
    run: (a, p) => shiftModel.profile(a, String(p.locationId), { weeks: p.weeks }),
  },
  staffing_forecast_week: {
    params: '{ locationId, weekStart?: "YYYY-MM-DD" (a Sunday; default next week), weeks? }',
    about:
      'people needed per role in every shift of a week, without a plan: expected diners from the usual shift (EMA of the last weeks), and per role the diners per person learned from the clock times of the last weeks',
    run: (a, p) => shiftModel.forecastWeek(a, String(p.locationId), { weekStart: p.weekStart, weeks: p.weeks }),
  },
  staffing_actual: {
    params: '{ locationId, from, to, role?: "role name, e.g. מלצר" }',
    about:
      'past shifts as they really were (Tabit clock times): per role and shift the people, hours and diners per person (e.g. diners per waiter), the shifts with more or fewer people than the load needed by the usual ratio, and a summary per role; up to 92 days',
    run: (a, p) => {
      const [from, to] = range(p);
      return shiftModel.actualStaffing(a, String(p.locationId), { from, to, role: p.role, weeks: p.weeks });
    },
  },
  staffing_plan_lines: {
    params: '{ planId, date?, shiftCode?, roleCode? }',
    about: 'the lines of a staffing plan with the rules, demand and calculation behind each number',
    run: async (a, p) => {
      const plan = await staffing.getPlan(a, Number(p.planId));
      const lines = plan.lines.filter((l) => (!p.date || l.date === p.date) && (!p.shiftCode || l.shiftCode === p.shiftCode) && (!p.roleCode || l.roleCode === p.roleCode));
      return { period: { from: plan.plan.weekStart, to: addDays(plan.plan.weekStart, 6) }, source: 'joya_staffing_plans (lines_json + proposal_json)', planStatus: plan.plan.status, lines, violations: plan.violations };
    },
  },
  staffing_forecast: {
    params: '{ planId, date?, shiftCode? }',
    about: 'the demand forecast of a plan and the past dates it came from',
    run: async (a, p) => {
      const plan = await staffing.getPlan(a, Number(p.planId));
      const slots = (plan.plan.forecast?.slots || []).filter((s) => (!p.date || s.date === p.date) && (!p.shiftCode || s.shiftCode === p.shiftCode));
      return { period: { from: plan.plan.weekStart, to: addDays(plan.plan.weekStart, 6) }, source: 'joya_staffing_plans.forecast_json (from Beecomm orders via Allegro)', method: 'median of the same weekday over the previous weeks', slots };
    },
  },
  staffing_rules: { params: '{ locationId }', about: 'the staffing rules that apply to a location', run: async (a, p) => ({ source: 'staffingRules (joya_settings)', rules: await staffing.listRules(a, p.locationId) }) },
  order_list: {
    params: '{ listId }',
    about: 'an order list: working lines, the original recommendation with the basis of each quantity, and the edits',
    run: async (a, p) => {
      const l = await repl.getList(a, Number(p.listId));
      return { period: { date: l.list.date }, source: 'joya_order_lists + recommendation lines', ...l };
    },
  },
  item_patterns: { params: '{ locationId }', about: 'what was learned per item from final order lists', run: async (a, p) => ({ source: 'computed from the final order lists (joya_order_lists)', patterns: await repl.getPatterns(a, String(p.locationId)) }) },
  shortages: { params: '{ locationIds?, days? }', about: 'reported shortages', run: async (a, p) => ({ source: 'joya_shortages', shortages: await repl.listShortages(a, { locationIds: locs(a, p), days: p.days || 30 }) }) },
  data_quality: { params: '{ locationIds? }', about: 'missing, stale and unmapped data per location', run: (a, p) => quality.report(a, locs(a, p)) },
  employees: {
    params: '{ locationIds?, q?: "part of a name", role?: "role name, e.g. מלצר", active?: true | false | "all" (default true), limit? }',
    about:
      'the employees from Allegro: name, location, roles, wage type and wage (hourly rate, or a monthly amount for a global wage), the hourly rate per role, contractor, active; with a count and the average hourly rate per role. Users with payroll access only',
    run: (a, p) => employeeList(a, p),
  },
  payroll_issues: { params: '{ locationIds?, period?: "YYYY-MM", status? }', about: 'payroll preparation issues', run: async (a, p) => ({ source: 'joya_payroll_issues', issues: await payroll.listIssues(a, { locationIds: locs(a, p), period: p.period, status: p.status }) }) },
  pending_decisions: { params: '{ locationIds? }', about: 'drafts waiting for approval, open payroll issues, recent shortages per location', run: async (a, p) => ({ source: 'joya_* status columns', pending: await work.pending(a, locs(a, p)) }) },
};

export function catalogue() {
  return Object.entries(CALCS).map(([name, c]) => ({ name, params: c.params, about: c.about }));
}

// ---------------------------------------------------------------- requests (user side)

const shape = (r) => ({
  id: r.id,
  username: r.username,
  locationId: r.location_id,
  contextKind: r.context_kind,
  contextId: r.context_id,
  question: r.question,
  status: r.status,
  calcs: parseJson(r.calcs_json) || [],
  answer: r.answer_text,
  proposal: parseJson(r.proposal_json),
  proposalStatus: r.proposal_status,
  error: r.error,
  meta: parseJson(r.meta_json),
  lang: r.lang,
  createdAt: r.created_at,
  answeredAt: r.answered_at,
});

// the main-menu areas; a question asked in one is context AREA + the area's number
export const AREAS = { 1: 'STOCK', 2: 'MANPOWER', 3: 'PERFORMANCE', 4: 'BANK' };

async function contextAllowed(access, kind, id) {
  if (kind === 'AREA') {
    if (!AREAS[id]) throw err('BAD_REQUEST', 'unknown area');
    if (AREAS[id] === 'BANK' && !access.isAdmin) throw err('FORBIDDEN', 'the bank area is for the chain admin only');
    return null;
  }
  if (kind === 'ORDER_LIST') return repl.getList(access, id);
  if (kind === 'STAFFING_PLAN') return staffing.getPlan(access, id);
  return null;
}

export async function ask(access, { question, locationId = null, companyKey = null, contextKind = 'GENERAL', contextId = null, lang = 'he' }) {
  if (!String(question || '').trim()) throw err('BAD_REQUEST', 'the question is empty');
  if (String(question).length > 2000) throw err('BAD_REQUEST', 'the question is too long');
  if (!['GENERAL', 'ORDER_LIST', 'STAFFING_PLAN', 'AREA'].includes(contextKind)) throw err('BAD_REQUEST', 'bad context');
  if (locationId != null) assertLocation(access, locationId);
  // a company chosen in the picker (no single restaurant) is kept in meta_json.scope until the answer
  let meta = null;
  if (locationId == null && companyKey != null) {
    const key = String(companyKey);
    if (!(await listLocations(access)).some((l) => (l.company?.key ?? '') === key)) throw err('FORBIDDEN', 'no access to the requested company');
    meta = { scope: { companyKey: key } };
  }
  if (contextKind !== 'GENERAL') await contextAllowed(access, contextKind, contextId);
  const id = (
    await q(`INSERT INTO joya_ai_requests (username, location_id, context_kind, context_id, question, lang, meta_json) VALUES (:u, :l, :k, :c, :qq, :lang, :m)`, {
      m: meta ? JSON.stringify(meta) : null,
      u: access.username,
      l: locationId,
      k: contextKind,
      c: contextId,
      qq: String(question).trim(),
      lang: lang === 'en' ? 'en' : 'he',
    })
  ).insertId;
  return getRequest(access, id);
}

export async function getRequest(access, id) {
  await failStale();
  const r = await one(`SELECT * FROM joya_ai_requests WHERE id=:id`, { id });
  if (!r || r.username !== access.username) throw err('NOT_FOUND', 'not found');
  return shape(r);
}

export async function listRequests(access, { contextKind, contextId, limit = 20 }) {
  await failStale();
  const rows = await q(
    `SELECT * FROM joya_ai_requests WHERE username=:u ${contextKind ? 'AND context_kind=:k' : ''} ${contextId ? 'AND context_id=:c' : ''} ORDER BY id DESC LIMIT ${Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100)}`,
    { u: access.username, k: contextKind, c: contextId },
  );
  return rows.map(shape);
}

/** The user accepts the proposed change: it is applied with their access, logged as via CHAT. */
export async function applyProposal(access, id) {
  const r = await getRequest(access, id);
  if (!r.proposal || r.proposalStatus !== 'PENDING') throw err('CONFLICT', 'nothing to apply');
  const p = r.proposal;
  let result;
  if (p.type === 'ORDER_OPS') result = await repl.applyOps(access, p.listId, p.ops, { via: 'CHAT' });
  else if (p.type === 'STAFFING_OPS') result = await staffing.applyOps(access, p.planId, p.ops, { via: 'CHAT' });
  else throw err('BAD_REQUEST', 'unknown proposal');
  await q(`UPDATE joya_ai_requests SET proposal_status='APPLIED' WHERE id=:id`, { id });
  await audit(access.username, 'AI_PROPOSAL_APPLIED', 'ai_request', id, r.locationId, { type: p.type });
  return { request: await getRequest(access, id), result };
}

/** The user removes one of their questions (and its answer) from the chat. */
export async function deleteRequest(access, id) {
  const r = await getRequest(access, id);
  await q(`DELETE FROM joya_ai_requests WHERE id=:id`, { id });
  await audit(access.username, 'AI_REQUEST_DELETED', 'ai_request', id, r.locationId, { question: r.question.slice(0, 200) });
}

export async function discardProposal(access, id) {
  const r = await getRequest(access, id);
  if (r.proposalStatus !== 'PENDING') throw err('CONFLICT', 'nothing to discard');
  await q(`UPDATE joya_ai_requests SET proposal_status='DISCARDED' WHERE id=:id`, { id });
  return getRequest(access, id);
}

export async function failStale() {
  await q(`UPDATE joya_ai_requests SET status='FAILED', error='no answer from the AI runner in time' WHERE status='THINKING' AND created_at < :t`, {
    t: new Date(Date.now() - THINKING_TIMEOUT_MS),
  });
}

// ---------------------------------------------------------------- runner side (machine key)

export async function pendingForRunner() {
  await failStale();
  const rows = await q(`SELECT id FROM joya_ai_requests WHERE status='THINKING' AND (claimed_at IS NULL OR claimed_at < :t) ORDER BY id LIMIT 10`, { t: new Date(Date.now() - 3 * 60_000) });
  return rows.map((r) => r.id);
}

export async function claim(id) {
  const r = await q(`UPDATE joya_ai_requests SET claimed_at=NOW() WHERE id=:id AND status='THINKING' AND (claimed_at IS NULL OR claimed_at < :t)`, { id, t: new Date(Date.now() - 3 * 60_000) });
  return r.affectedRows === 1;
}

async function requestAccess(id) {
  const r = await one(`SELECT * FROM joya_ai_requests WHERE id=:id`, { id });
  if (!r) throw err('NOT_FOUND', 'not found');
  const access = await loadAccess(r.username);
  if (!access) throw err('FORBIDDEN', 'the asking user no longer has Joya access');
  return { r, access };
}

/**
 * What the user chose in the picker when asking: one restaurant, all (active) restaurants of a company, or null =
 * all the user's. Calculations with no location of their own use it (see locs).
 */
async function scopeOf(access, r) {
  if (r.location_id != null) return { kind: 'LOCATION', locationIds: [String(r.location_id)] };
  const key = parseJson(r.meta_json)?.scope?.companyKey;
  if (key == null) return null;
  const inCo = (await listLocations(access)).filter((l) => (l.company?.key ?? '') === key && l.active);
  return { kind: 'COMPANY', company: inCo[0]?.company?.label ?? key, locationIds: inCo.map((l) => String(l.id)) };
}

/** Everything the model needs to plan: who asks, what they may see, today, the calculations, the object in view. */
export async function contextFor(id) {
  const { r, access } = await requestAccess(id);
  return buildContext(access, r);
}

/** The context for a request row (or a row-like object: the runner eval builds fixed contexts with it). */
export async function buildContext(access, r) {
  const today = todayLocal();
  const scope = await scopeOf(access, r);
  const locations = await listLocations(access);
  const shifts = await listShifts(access.locationIds);
  const roles = await listRoles();
  let object = null;
  if (r.context_kind === 'ORDER_LIST') {
    const l = await repl.getList(access, r.context_id);
    object = {
      kind: 'ORDER_LIST',
      list: { id: l.list.id, locationId: l.list.locationId, date: l.list.date, status: l.list.status },
      lines: l.lines.map((x) => ({ lineId: x.id, ingredientId: x.ingredientId, name: x.name, qty: x.qty, unit: x.unit, removed: x.removed, origin: x.origin, recommendedQty: x.recommended?.qty ?? null })),
      notDue: l.recommendation.filter((x) => x.section === 'NOT_DUE').map((x) => ({ ingredientId: x.ingredientId, name: x.name })),
    };
  } else if (r.context_kind === 'STAFFING_PLAN') {
    const p = await staffing.getPlan(access, r.context_id);
    object = {
      kind: 'STAFFING_PLAN',
      plan: { id: p.plan.id, locationId: p.plan.locationId, weekStart: p.plan.weekStart, status: p.plan.status },
      lines: p.lines.map((x) => ({ lineId: x.id, date: x.date, weekday: x.weekday, shiftCode: x.shiftCode, roleCode: x.roleCode, headcount: x.headcount, start: x.start, end: x.end, isPeakExtra: x.isPeakExtra, minRequired: x.minRequired })),
      rules: await staffing.listRules(access, p.plan.locationId),
    };
  }
  return {
    request: {
      id: r.id,
      question: r.question,
      lang: r.lang,
      contextKind: r.context_kind,
      contextId: r.context_id,
      locationId: r.location_id,
      // the picker choice: { kind: LOCATION | COMPANY, company?, locationIds }; absent = all the user's locations
      ...(scope ? { scope } : {}),
      ...(r.context_kind === 'AREA' ? { area: AREAS[r.context_id] } : {}),
    },
    user: { role: access.role, payroll: access.payroll },
    today,
    locations: locations.map((l) => ({ id: l.id, name: l.name, company: l.company?.label ?? null, companyKey: l.company?.key ?? null, active: l.active, isDemo: l.isDemo })),
    shifts: shifts.map((s) => ({ locationId: s.locationId, code: s.code, name: s.name, days: s.days, start: s.start, end: s.end })),
    roles: roles.map((x) => ({ code: x.code, he: x.nameHe, en: x.nameEn })),
    calculations: catalogue(),
    limits: { maxCalcs: MAX_CALCS },
    changeFormats: CHANGE_FORMATS,
    object,
  };
}

export const CHANGE_FORMATS = {
  ORDER_LIST: [
    '{ "op": "add", "ingredientId"?: number, "name"?: string, "qty"?: number, "unit"?: string, "note"?: string }',
    '{ "op": "set_qty", "lineId": number, "qty": number }',
    '{ "op": "remove", "lineId": number }',
    '{ "op": "restore", "lineId": number }',
  ],
  STAFFING_PLAN: [
    '{ "op": "add", "date": "YYYY-MM-DD", "shiftCode": string, "roleCode": string, "headcount": number, "start"?: "HH:MM", "end"?: "HH:MM" }',
    '{ "op": "set", "lineId": number, "headcount"?: number, "start"?: "HH:MM", "end"?: "HH:MM" }',
    '{ "op": "remove", "lineId": number }',
    'what-if (nothing saved, the plan diff is proposed): { "whatIf": [ { "role_code", "rule_type": "RATIO|STEPS|FIXED|MIN|MAX|PEAK_EXTRA", "demand_unit"?, "params": {…}, "shift_code"?, "days_json"?: [0-6] } ] }',
  ],
};

/**
 * Run the model's plan: calculations with the user's access, and validation of the
 * proposed change. Errors are returned per calculation (the model can explain them).
 */
export async function compute(id, { calcs = [], ops = null, whatIf = null }) {
  const { r, access: user } = await requestAccess(id);
  const scope = await scopeOf(user, r);
  const access = scope?.locationIds.length ? { ...user, scopeIds: scope.locationIds } : user;
  if (r.status !== 'THINKING') throw err('CONFLICT', 'request is not open');
  const results = [];
  const list = Array.isArray(calcs) ? calcs : [];
  for (const [i, c] of list.entries()) {
    if (i >= MAX_CALCS) {
      results.push({ calc: c?.calc, params: c?.params, error: `not run: at most ${MAX_CALCS} calculations per request` });
      continue;
    }
    const def = CALCS[c?.calc];
    if (!def) {
      results.push({ calc: c?.calc, params: c?.params, error: 'unknown calculation' });
      continue;
    }
    try {
      results.push({ calc: c.calc, params: c.params || {}, result: await def.run(access, c.params || {}) });
    } catch (e) {
      results.push({ calc: c.calc, params: c.params, error: e.message });
    }
  }
  let proposal = null;
  let proposalError = null;
  try {
    if (r.context_kind === 'ORDER_LIST' && Array.isArray(ops) && ops.length) {
      const checked = await repl.checkOps(access, r.context_id, ops);
      proposal = { type: 'ORDER_OPS', listId: r.context_id, ops: checked.map(toOrderOp), preview: checked };
    } else if (r.context_kind === 'STAFFING_PLAN' && Array.isArray(whatIf) && whatIf.length) {
      const diff = await staffing.whatIf(access, r.context_id, whatIf);
      const applicable = diff.changes.map((c) => (c.op === 'add' ? { op: 'add', date: c.date, shiftCode: c.shiftCode, roleCode: c.roleCode, headcount: c.headcount, start: c.start, end: c.end, note: 'what-if' } : c.op === 'set' ? { op: 'set', lineId: c.lineId, headcount: c.headcount, start: c.start, end: c.end } : { op: 'remove', lineId: c.lineId }));
      if (applicable.length) await staffing.checkOps(access, r.context_id, applicable);
      proposal = { type: 'STAFFING_OPS', planId: r.context_id, ops: applicable, preview: diff.changes, whatIf, note: diff.note };
    } else if (r.context_kind === 'STAFFING_PLAN' && Array.isArray(ops) && ops.length) {
      const checked = await staffing.checkOps(access, r.context_id, ops);
      proposal = { type: 'STAFFING_OPS', planId: r.context_id, ops: checked.map(toStaffingOp), preview: checked };
    }
  } catch (e) {
    proposalError = { code: e.code || 'ERROR', message: e.message, details: e.details || null };
  }
  await q(`UPDATE joya_ai_requests SET calcs_json=:c, proposal_json=:p, proposal_status=:s WHERE id=:id`, {
    c: JSON.stringify(results),
    p: proposal ? JSON.stringify(proposal) : null,
    s: proposal ? 'PENDING' : null,
    id,
  });
  return { results, proposal, proposalError };
}

const toOrderOp = (o) => (o.op === 'add' ? { op: 'add', ingredientId: o.ingredientId, name: o.name, qty: o.qty, unit: o.unit, note: o.note } : { op: o.op, lineId: o.lineId, qty: o.qty, note: o.note });
const toStaffingOp = (o) => (o.op === 'add' ? { op: 'add', date: o.date, shiftCode: o.shiftCode, roleCode: o.roleCode, headcount: o.headcount, start: o.start, end: o.end, note: o.note } : { op: o.op, lineId: o.lineId, headcount: o.headcount, start: o.start, end: o.end, note: o.note });

export async function answer(id, { answer: text, failed = false, error = null, meta = null }) {
  const r = await one(`SELECT * FROM joya_ai_requests WHERE id=:id`, { id });
  if (!r) throw err('NOT_FOUND', 'not found');
  if (r.status !== 'THINKING') throw err('CONFLICT', 'already answered');
  const scope = parseJson(r.meta_json)?.scope;
  if (scope) meta = { ...(meta || {}), scope };
  await q(`UPDATE joya_ai_requests SET status=:s, answer_text=:a, error=:e, meta_json=:m, answered_at=NOW() WHERE id=:id`, {
    s: failed ? 'FAILED' : 'ANSWERED',
    a: failed ? null : String(text || '').slice(0, 20000),
    e: failed ? String(error || 'failed').slice(0, 2000) : null,
    m: meta ? JSON.stringify(meta) : null,
    id,
  });
}
