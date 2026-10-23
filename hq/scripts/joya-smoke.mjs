/**
 * End-to-end check of the Joya Headquarter API against a running hub on the LOCAL MIRROR, with
 * the demo records (scripts/joya-seed-demo.mjs) and the fake Allegro API serving their source data.
 *
 *   node scripts/fake-allegro.mjs 4399                                                 (terminal 1)
 *   ALLEGRO_API_URL=http://localhost:4399/local-api/v1 ALLEGRO_USERS_FILE=/tmp/joya-smoke-users.json \
 *     JOYA_HQ_PORT=4360 node server.js                                                   (terminal 2)
 *   ALLEGRO_USERS_FILE=/tmp/joya-smoke-users.json node scripts/joya-smoke.mjs http://localhost:4360
 *
 * Writes its own Allegro users file (never the real users.json) with three test users, and signs
 * login cookies for them with JOYA_SESSION_SECRET: a chain admin with payroll access and a location
 * manager without it (both joya_user_access rows, removed after), and an Allegro restMngr with no row
 * (access from the Allegro role and branches).
 * Plays the AI runner itself (fixed "model" output), so no Claude call is made.
 */
import '../lib/env.js';
import path from 'path';
import { writeFileSync, rmSync } from 'fs';
import jwt from 'jsonwebtoken';
import { signSession, USERS_FILE } from '../src/auth/session.js';
import { REPO_ROOT } from '../lib/env.js';
import { userApi } from '../../admin/server/auth/index.js';
import { executeSql, getDbPool } from '../lib/dbpool.js';

const BASE = (process.argv[2] || 'http://localhost:4360').replace(/\/$/, '');
const host = process.env.DB_HOST || '';
if (!['127.0.0.1', 'localhost'].includes(host)) {
  console.error('refusing: this test writes to the DB; point it at the local mirror');
  process.exit(1);
}
if (!process.env.ALLEGRO_USERS_FILE || path.resolve(USERS_FILE) === path.join(REPO_ROOT, 'users.json')) {
  console.error('refusing: set ALLEGRO_USERS_FILE to a test file (the same one the test server reads), never the real users.json');
  process.exit(1);
}
const sql = async (s, p = {}) => (await executeSql(s, p))[0];
const sign = (sub) => `joya_session=${signSession(sub, '15m')}`;
const ADMIN = 'joya-smoke-admin';
const MGR = 'joya-smoke-mgr';
const RM = 'joya-smoke-rm'; // Allegro restMngr of the demo Haifa branch, no joya_user_access row
const PASSWORD = 'smoke-pass-1';
const testUser = (email, role, extra = {}) => ({ user_id: email, id: email, email, authKey: userApi.getUserKey(email, PASSWORD), role, status: 'active', ...extra });
writeFileSync(USERS_FILE, JSON.stringify([testUser(ADMIN, 'admin'), testUser(MGR, 'restMngr', { restaurants: [] }), testUser(RM, 'restMngr', { restaurants: ['demo-hfa'] })]));
const cookies = {
  admin: sign(ADMIN),
  mgr: sign(MGR),
  rm: sign(RM),
  // a cookie with the right secret but another audience (e.g. a trading-app token) must not pass
  foreign: `joya_session=${jwt.sign({ sub: ADMIN }, process.env.JOYA_SESSION_SECRET, { expiresIn: '15m' })}`,
};
const machine = process.env.JOYA_API_KEY ? { 'x-joya-key': process.env.JOYA_API_KEY } : {};

let pass = 0;
let fail = 0;
const check = (cond, msg, extra) => {
  if (cond) {
    pass++;
    console.log(`  ok   ${msg}`);
  } else {
    fail++;
    console.log(`  FAIL ${msg}`, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : '');
  }
};
async function call(who, method, path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(who ? { cookie: cookies[who] } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

const tlv = (await sql(`SELECT id FROM joya_locations WHERE code='DEMO-TLV'`))[0]?.id;
const hfa = (await sql(`SELECT id FROM joya_locations WHERE code='DEMO-HFA'`))[0]?.id;
if (!tlv || !hfa) {
  console.error('no demo data — run scripts/joya-seed-demo.mjs first');
  process.exit(1);
}
// Everything the test users created goes away again, so the next run starts from the same state.
async function cleanup() {
  const p = { a: ADMIN, m: MGR };
  await sql(`DELETE e FROM joya_order_edits e JOIN joya_order_lists l ON l.id = e.list_id WHERE l.created_by IN (:a, :m)`, p);
  await sql(`DELETE x FROM joya_order_list_lines x JOIN joya_order_lists l ON l.id = x.list_id WHERE l.created_by IN (:a, :m)`, p);
  await sql(`DELETE x FROM joya_order_recommendation_lines x JOIN joya_order_lists l ON l.id = x.list_id WHERE l.created_by IN (:a, :m)`, p);
  await sql(`DELETE FROM joya_order_lists WHERE created_by IN (:a, :m)`, p);
  await sql(`DELETE e FROM joya_staffing_edits e JOIN joya_staffing_plans x ON x.id = e.plan_id WHERE x.created_by IN (:a, :m)`, p);
  await sql(`DELETE l FROM joya_staffing_plan_lines l JOIN joya_staffing_plans x ON x.id = l.plan_id WHERE x.created_by IN (:a, :m)`, p);
  await sql(`DELETE l FROM joya_staffing_proposal_lines l JOIN joya_staffing_plans x ON x.id = l.plan_id WHERE x.created_by IN (:a, :m)`, p);
  await sql(`DELETE FROM joya_staffing_plans WHERE created_by IN (:a, :m)`, p);
  await sql(`DELETE FROM joya_attendance_corrections WHERE created_by IN (:a, :m)`, p);
  await sql(`DELETE FROM joya_payroll_issues WHERE location_id IN (:t, :h)`, { t: tlv, h: hfa });
  await sql(`DELETE FROM joya_ai_requests WHERE username IN (:a, :m)`, p);
  await sql(`DELETE FROM joya_audit_log WHERE username IN (:a, :m)`, p);
}
await cleanup();
await sql(`REPLACE INTO joya_user_access (username, role, location_ids, payroll_access, updated_by) VALUES (:a, 'CHAIN_ADMIN', '[]', 1, 'smoke'), (:m, 'LOCATION_MANAGER', :l, 0, 'smoke')`, { a: ADMIN, m: MGR, l: JSON.stringify([hfa]) });

try {
  console.log('permissions');
  let r = await call('admin', 'GET', '/api/joya/me');
  check(r.status === 200 && r.data.locations.length >= 2 && r.data.isAdmin, 'admin sees every location', r.data);
  const today = r.data.today;
  r = await call('mgr', 'GET', '/api/joya/me');
  check(r.status === 200 && r.data.locations.length === 1 && r.data.locations[0].id === hfa, 'location manager sees only their location');
  check(r.data.demo?.[hfa] === true, 'demo location is flagged as demonstration data');
  r = await call('mgr', 'POST', '/api/joya/orders/generate', { locationId: tlv });
  check(r.status === 403, 'manager cannot make a list for another location', r.status);
  r = await call('mgr', 'GET', `/api/joya/sales/summary?locationIds=${tlv}`);
  check(r.status === 200 && r.data.locations.length === 0, 'a location outside the scope is filtered out of reports');
  r = await call(null, 'GET', '/api/joya/me');
  check(r.status === 401, 'no cookie: 401', r.status);
  r = await call('foreign', 'GET', '/api/joya/me');
  check(r.status === 401, 'a token signed for another app is refused', r.status);
  r = await call('mgr', 'GET', '/api/session');
  check(r.data.authenticated === true && r.data.username === MGR, '/api/session knows the login');
  r = await call(null, 'POST', '/api/login', { username: MGR, password: 'wrong' });
  check(r.status === 401, 'a wrong password is refused', r.status);
  r = await call(null, 'POST', '/api/login', { username: MGR.toUpperCase(), password: PASSWORD });
  check(r.status === 200 && r.data.username === MGR, 'an Allegro user logs in with the admin password (e-mail in any case)', r.status);
  r = await call('rm', 'GET', '/api/joya/me');
  check(r.status === 200 && !r.data.isAdmin && r.data.locations.length === 1 && r.data.locations[0].id === hfa && r.data.payroll === true, 'an Allegro restMngr with no row manages their own branches', r.data);
  r = await call('mgr', 'GET', `/api/joya/payroll/lines?locationId=${hfa}&period=${today.slice(0, 7)}`);
  check(r.status === 403, 'no payroll lines without payroll access');
  r = await call('mgr', 'GET', `/api/joya/labor/summary?locationIds=${hfa}`);
  check(r.status === 200 && r.data.locations[0].estimate === undefined && r.data.payrollVisible === false, 'labor summary shows hours but no money without payroll access');
  r = await call('mgr', 'GET', `/api/joya/employees?locationIds=${hfa}`);
  check(r.status === 200 && r.data.employees.every((e) => e.hourlyWage === undefined), 'wages are hidden without payroll access');
  r = await call('mgr', 'PUT', '/api/joya/settings/staffing', { value: { historyWeeks: 2 } });
  check(r.status === 403, 'only the chain admin changes settings');

  console.log('replenishment');
  r = await call('admin', 'POST', '/api/joya/orders/generate', { locationId: tlv, date: today, force: true });
  check(r.status === 200 && r.data.listId, 'generate a recommendation', r.data);
  const listId = r.data.listId;
  r = await call('admin', 'GET', `/api/joya/orders/${listId}`);
  const L = r.data;
  const sugg = L.recommendation.filter((x) => x.section === 'SUGGESTED');
  check(sugg.length > 0 && sugg.every((x) => x.qty > 0 && x.basis?.examples?.length >= 2), 'suggested lines have a quantity and the past lists behind it', sugg.slice(0, 2));
  check(L.recommendation.some((x) => ['SALES_RATIO', 'HISTORY_MEDIAN'].includes(x.method)), 'quantities come from learned methods');
  const feta = L.recommendation.find((x) => x.name === 'גבינת פטה');
  check(feta && feta.basis.reasons.some((x) => x.code === 'SHORTAGE'), 'the reported shortage is in the reason', feta?.basis?.reasons);
  const checkLines = L.lines.filter((x) => x.qty == null && !x.removed);
  check(L.recommendation.filter((x) => x.qty == null).every((x) => x.method === 'NONE' && x.confidence === 'NONE'), 'no quantity is invented: unknown = null');
  // a kept line with no quantity blocks approval (add one if the recommendation has none)
  if (!checkLines.length) {
    const added = await call('admin', 'POST', `/api/joya/orders/${listId}/ops`, { ops: [{ op: 'add', name: 'פריט בלי כמות (בדיקה)' }] });
    checkLines.push(added.data.lines.find((x) => x.qty == null && !x.removed));
  }
  r = await call('admin', 'POST', `/api/joya/orders/${listId}/approve`, {});
  check(r.status === 400 && r.data.details?.lineIds?.length > 0, 'approval refused while a line has no quantity', r.data);
  const tom = L.lines.find((x) => !x.removed && x.qty != null && x.recommended?.section === 'SUGGESTED');
  const ops = [...checkLines.map((x) => ({ op: 'remove', lineId: x.id })), { op: 'set_qty', lineId: tom.id, qty: 99 }, { op: 'add', name: 'שמפו לכלים (פריט חופשי)', qty: 2, unit: 'יח׳' }];
  r = await call('admin', 'POST', `/api/joya/orders/${listId}/check-ops`, { ops });
  check(r.status === 200 && r.data.preview.length === ops.length, 'changes can be previewed before saving', r.data);
  r = await call('admin', 'POST', `/api/joya/orders/${listId}/ops`, { ops });
  check(r.status === 200 && r.data.lines.find((x) => x.id === tom.id).qty === 99, 'manager edits are saved');
  check(r.data.recommendation.find((x) => x.ingredientId === tom.ingredientId).qty !== 99, 'the original recommendation is unchanged');
  check(r.data.edits.length >= ops.length && r.data.edits.every((e) => e.by === ADMIN), 'every edit is logged with who made it');
  r = await call('admin', 'POST', `/api/joya/orders/${listId}/approve`, { note: 'smoke' });
  check(r.status === 200 && r.data.list.status === 'APPROVED' && r.data.list.approvedBy === ADMIN && r.data.list.final.length > 0, 'approve freezes the final list', r.data);
  r = await call('admin', 'POST', `/api/joya/orders/${listId}/ops`, { ops: [{ op: 'set_qty', lineId: tom.id, qty: 1 }] });
  check(r.status === 409, 'an approved list cannot be edited');
  r = await call('admin', 'POST', `/api/joya/orders/${listId}/ordered`, {});
  check(r.status === 200 && r.data.list.status === 'ORDERED' && r.data.list.orderedBy === ADMIN, 'marked as actually ordered (separate from approved)');
  r = await call('admin', 'POST', '/api/joya/orders/generate', { locationId: tlv, date: addDays(today, 4), force: true });
  const next = (await call('admin', 'GET', `/api/joya/orders/${r.data.listId}`)).data;
  const tom2 = next.recommendation.find((x) => x.ingredientId === tom.ingredientId);
  check(tom2?.basis.examples[0]?.listId === listId && tom2.basis.examples[0].qty === 99, 'the new final list is the newest learning example of the next recommendation', tom2?.basis?.examples?.[0]);
  check(tom2.qty > tom.recommended.qty, `the raised quantity moves the next recommendation (${tom.recommended.qty} → ${tom2.qty})`);
  await call('admin', 'POST', `/api/joya/orders/${r.data.listId}/reject`, { note: 'smoke cleanup' });
  r = await call('admin', 'GET', `/api/joya/patterns?locationId=${tlv}`);
  check(r.status === 200 && r.data.patterns.length > 0, 'learned patterns are stored per location');

  console.log('staffing');
  const nextSunday = addDays(today, 7 - new Date(today + 'T00:00:00Z').getUTCDay());
  r = await call('admin', 'POST', '/api/joya/staffing/plans/propose', { locationId: tlv, weekStart: nextSunday, force: true });
  check(r.status === 200 && r.data.planId, 'weekly proposal created', r.data);
  const planId = r.data.planId;
  r = await call('admin', 'GET', `/api/joya/staffing/plans/${planId}`);
  const P = r.data;
  const thu = addDays(nextSunday, 4);
  const thuMorning = P.lines.filter((l) => l.date === thu && l.shiftCode === 'morning');
  check(thuMorning.some((l) => l.roleCode === 'checker' && l.headcount === 1) && thuMorning.some((l) => l.roleCode === 'barista' && l.headcount === 1), 'fixed roles: 1 checker + 1 barista on Thursday morning');
  const cook = thuMorning.find((l) => l.roleCode === 'cook');
  check(cook && cook.explain.demand?.unit === 'ORDERS_PEAK_HOUR' && cook.explain.calc.length > 0, `cooks explained by orders in the peak hour: ${cook?.explain?.calc?.join(' ; ')}`);
  const waiter = thuMorning.find((l) => l.roleCode === 'waiter' && !l.isPeakExtra);
  check(waiter && waiter.minRequired === 2, 'waiter line carries its mandatory minimum');
  const again = (await call('admin', 'POST', '/api/joya/staffing/plans/propose', { locationId: tlv, weekStart: nextSunday, force: true })).data.planId;
  const P2 = (await call('admin', 'GET', `/api/joya/staffing/plans/${again}`)).data;
  check(JSON.stringify(P2.lines.map((l) => [l.date, l.shiftCode, l.roleCode, l.headcount, l.start, l.end])) === JSON.stringify(P.lines.map((l) => [l.date, l.shiftCode, l.roleCode, l.headcount, l.start, l.end])), 'same rules + same data → the same proposal');
  await call('admin', 'POST', `/api/joya/staffing/plans/${again}/reject`, { note: 'smoke duplicate' });
  r = await call('admin', 'POST', `/api/joya/staffing/plans/${planId}/ops`, { ops: [{ op: 'set', lineId: waiter.id, headcount: 1 }] });
  check(r.status === 422 && r.data.code === 'MANDATORY_MIN', 'an edit under the mandatory minimum is refused', r.data);
  r = await call('admin', 'POST', `/api/joya/staffing/plans/${planId}/ops`, { ops: [{ op: 'add', date: thu, shiftCode: 'morning', roleCode: 'waiter', headcount: 1, start: '12:00' }] });
  check(r.status === 200 && r.data.lines.some((l) => l.origin === 'ADDED' && l.start === '12:00:00'), 'add a waiter starting at noon');
  r = await call('admin', 'POST', `/api/joya/staffing/plans/${planId}/approve`, {});
  check(r.status === 200 && r.data.plan.status === 'APPROVED' && r.data.plan.final.length === r.data.lines.length && r.data.proposal.length === P.proposal.length, 'approved; original proposal kept beside the final plan');
  r = await fetch(`${BASE}/api/joya/staffing/plans/${planId}/export.csv`, { headers: { cookie: cookies.admin } });
  const bytes = new Uint8Array(await r.arrayBuffer());
  const csv = new TextDecoder().decode(bytes);
  check(r.status === 200 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf && csv.includes('מספר עובדים'), 'Tabit transfer CSV (Hebrew, with a BOM for Excel)');

  console.log('missing data');
  r = await call('admin', 'GET', `/api/joya/quality?locationIds=${tlv}`);
  const issues = r.data.locations[0].issues.map((i) => i.code);
  check(issues.includes('MISSING_SALES_DAYS') && issues.includes('UNMATCHED_ITEM_CODES') && issues.includes('UNMATCHED_EMPLOYEE_IDS'), 'quality report finds missing days, unknown POS codes and unknown employee ids', issues);
  check(r.data.integrations.find((i) => i.source === 'ALLEGRO')?.connected === true && r.data.integrations.filter((i) => i.source !== 'ALLEGRO').every((i) => i.connected === false), 'only the Allegro API is connected; Instagram and Google are not');
  const imp = await call('admin', 'POST', '/api/joya/import/preview', { kind: 'SALES_CHECKS', source: 'BIKUM_POS', csv: 'a\n1' });
  check(imp.status === 400 && /Allegro/.test(imp.data.error), 'sales cannot be imported: they come from the Allegro API', imp.data);
  const missDay = r.data.locations[0].issues.find((i) => i.code === 'MISSING_SALES_DAYS').dates[0];
  r = await call('admin', 'GET', `/api/joya/sales/daily?locationIds=${tlv}&from=${missDay}&to=${missDay}`);
  const day = r.data.series[0].days[0];
  check(day.missing === true && day.revenue === null, 'a missing day is shown as missing, not as zero sales', day);
  r = await call('admin', 'GET', `/api/joya/sales/summary?locationIds=${tlv}&from=${addDays(today, -7)}&to=${addDays(today, -1)}`);
  const ch = r.data.locations[0].change;
  check(ch && Math.abs(ch.volumeEffect + ch.spendEffect - ch.revenueChange) < 1, 'volume effect + spend effect = revenue change', ch);

  r = await call('admin', 'GET', `/api/joya/sales/dishes?locationIds=${tlv}`);
  check(r.status === 200 && r.data.dishes.length > 0 && r.data.dishes.some((d) => !d.onMenu), 'dishes report, unknown POS code marked not on the menu', r.data);
  for (const pth of ['shifts', 'anomalies']) {
    r = await call('admin', 'GET', `/api/joya/sales/${pth}?locationIds=${tlv}`);
    check(r.status === 200, `sales/${pth} answers`);
  }
  r = await call('admin', 'GET', `/api/joya/labor/planned-vs-actual?locationIds=${tlv}`);
  check(r.status === 200, 'labor planned vs actual answers');

  console.log('payroll checks');
  const lastMonth = addDays(today.slice(0, 7) + '-01', -1).slice(0, 7);
  const attRows = (await call('admin', 'GET', `/api/joya/payroll/attendance?locationId=${tlv}&from=${lastMonth}-01&to=${addDays(today, -1)}`)).data.rows || [];
  const missRow = attRows.find((a) => a.clockIn && !a.clockOut);
  const period = missRow ? missRow.date.slice(0, 7) : lastMonth;
  r = await call('admin', 'POST', '/api/joya/payroll/checks', { locationId: tlv, period });
  check(r.status === 200, 'checks run', r.data);
  await call('admin', 'POST', '/api/joya/payroll/checks', { locationId: tlv, period: addDays(today, -3).slice(0, 7) });
  r = await call('admin', 'GET', `/api/joya/payroll/issues?locationIds=${tlv}`);
  const kinds = new Set(r.data.issues.map((i) => i.kind));
  check(kinds.has('UNMATCHED_EMPLOYEE'), 'unknown employee id found', [...kinds]);
  check(kinds.has('HOURS_MISMATCH') && kinds.has('DUPLICATE'), 'payroll hours above the clock and a duplicate row are found', [...kinds]);
  const miss = r.data.issues.find((i) => i.kind === 'MISSING_CLOCK_OUT' && i.status === 'OPEN');
  if (miss) {
    const at = { attendanceId: miss.detail.attendanceIds[0], locationId: tlv, date: miss.detail.rows[0].date };
    r = await call('admin', 'POST', '/api/joya/payroll/corrections', { ...at, action: 'SET_TIMES', clockOut: `${at.date} 16:05`, note: '' });
    check(r.status === 400, 'a correction without a note is refused');
    r = await call('admin', 'POST', '/api/joya/payroll/corrections', { ...at, issueId: miss.id, action: 'SET_TIMES', clockOut: `${at.date} 16:05`, note: 'confirmed with the shift manager' });
    check(r.status === 200, 'documented correction saved');
    const row = (await call('admin', 'GET', `/api/joya/payroll/attendance?locationId=${tlv}&from=${at.date}&to=${at.date}`)).data.rows.find((a) => a.id === at.attendanceId);
    check(row?.rawClockOut === null && row?.clockOut?.startsWith(`${at.date} 16:05`) && row.corrected, 'the raw clock row (in Allegro) is unchanged; the correction is applied on top', row);
  } else check(false, 'expected a missing clock-out in the demo data');

  console.log('AI requests (fake runner)');
  const aiPlan = (await call('admin', 'POST', '/api/joya/staffing/plans/propose', { locationId: tlv, weekStart: addDays(nextSunday, 7), force: true })).data.planId;
  r = await call('admin', 'POST', '/api/joya/ai/ask', { question: 'Recalculate using two runners', contextKind: 'STAFFING_PLAN', contextId: aiPlan, locationId: tlv });
  check(r.status === 200 && r.data.request.status === 'THINKING', 'question stored');
  const aid = r.data.request.id;
  r = await call(null, 'GET', '/api/joya/ai/runner/pending', null, machine);
  check(r.status === 200 && r.data.ids.includes(aid), 'runner sees the request');
  r = await call(null, 'POST', `/api/joya/ai/runner/${aid}/claim`, {}, machine);
  r = await call(null, 'GET', `/api/joya/ai/runner/${aid}/context`, null, machine);
  check(r.status === 200 && r.data.object?.kind === 'STAFFING_PLAN' && r.data.calculations.length > 5, 'runner gets context and the calculation list');
  r = await call(null, 'POST', `/api/joya/ai/runner/${aid}/compute`, { calcs: [{ calc: 'shift_demand_recent', params: { locationId: tlv, weekday: 4, shiftCode: 'morning', weeks: 4 } }, { calc: 'sales_summary', params: { locationIds: [tlv], from: addDays(today, -7), to: addDays(today, -1) } }], whatIf: [{ role_code: 'runner', rule_type: 'STEPS', demand_unit: 'DINERS_PEAK_HOUR', params: { steps: [{ above: 0, count: 2 }] } }] }, machine);
  check(r.status === 200 && r.data.results.every((x) => !x.error && x.result), 'the hub computes the numbers', r.data.results?.map((x) => x.error));
  check(r.data.results[0].result.source && r.data.results[0].result.period, 'every result carries its period and source');
  check(r.data.proposal?.type === 'STAFFING_OPS', 'what-if becomes a proposal (rules unchanged)', r.data.proposalError);
  const rulesBefore = (await sql(`SELECT COUNT(*) AS n FROM joya_staffing_rules`))[0].n;
  r = await call(null, 'POST', `/api/joya/ai/runner/${aid}/answer`, { answer: 'test answer', meta: { unverifiedNumbers: [] } }, machine);
  r = await call('mgr', 'GET', `/api/joya/ai/requests/${aid}`);
  check(r.status === 404, "another user cannot read someone's question");
  r = await call('admin', 'POST', `/api/joya/ai/requests/${aid}/apply`, {});
  check(r.status === 200 && r.data.request.proposalStatus === 'APPLIED', 'applied after the user confirms', r.data);
  const rulesAfter = (await sql(`SELECT COUNT(*) AS n FROM joya_staffing_rules`))[0].n;
  check(rulesBefore === rulesAfter, 'a chat recalculation never changes the stored rules');
  const viaChat = (await sql(`SELECT COUNT(*) AS n FROM joya_staffing_edits WHERE plan_id=:p AND via='CHAT'`, { p: aiPlan }))[0].n;
  check(viaChat > 0, 'chat edits are logged as via CHAT');
  const runners = (await call('admin', 'GET', `/api/joya/staffing/plans/${aiPlan}`)).data.lines.filter((l) => l.roleCode === 'runner');
  check(runners.length > 0 && runners.every((l) => l.headcount === 2), 'what-if result applied to the plan: 2 runners in every shift');
  await call('admin', 'POST', `/api/joya/staffing/plans/${aiPlan}/reject`, { note: 'smoke cleanup' });

  console.log('inquiries');
  r = await call('mgr', 'POST', '/api/joya/inquiries', { source: 'GOOGLE', kind: 'REVIEW', locationId: hfa, author: 'smoke', content: 'שירות מעולה!', rating: 5 });
  check(r.status === 200 && r.data.inquiry.enteredVia === 'MANUAL', 'manual entry of a review');
  const inq = r.data.inquiry.id;
  r = await call('mgr', 'POST', `/api/joya/inquiries/${inq}/action`, { action: 'approve' });
  check(r.status === 400, 'cannot approve a reply that does not exist');
  r = await call('mgr', 'POST', `/api/joya/inquiries/${inq}/action`, { action: 'draft', draft: 'תודה רבה!' });
  r = await call('mgr', 'POST', `/api/joya/inquiries/${inq}/action`, { action: 'approve' });
  r = await call('mgr', 'POST', `/api/joya/inquiries/${inq}/action`, { action: 'responded' });
  check(r.data.inquiry.status === 'RESPONDED' && r.data.inquiry.respondedBy === MGR && r.data.inquiry.responseApprovedBy === MGR, 'draft → approved → marked responded by a person (nothing sent)');
  await sql(`DELETE FROM joya_inquiries WHERE id=:id`, { id: inq });

  console.log('tasks + overview');
  r = await call('admin', 'POST', '/api/joya/tasks', { locationId: tlv, title: 'smoke task', dueDate: addDays(today, -1), sourceKind: 'DATA_QUALITY', sourceRef: 'MISSING_SALES_DAYS' });
  check(r.status === 200 && r.data.task.status === 'OPEN', 'task from a finding');
  r = await call('admin', 'GET', `/api/joya/tasks?overdue=1&locationIds=${tlv}`);
  check(r.data.tasks.some((t) => t.title === 'smoke task'), 'overdue tasks listed');
  await sql(`DELETE FROM joya_tasks WHERE title='smoke task'`);
  r = await call('admin', 'GET', '/api/joya/overview');
  check(r.status === 200 && r.data.pending.length >= 2 && r.data.sales.locations.length >= 2, 'chain overview');
} finally {
  await cleanup();
  await sql(`DELETE FROM joya_user_access WHERE username IN (:a, :m)`, { a: ADMIN, m: MGR });
  await sql(`DELETE FROM joya_ai_requests WHERE username=:u`, { u: RM });
  rmSync(USERS_FILE, { force: true });
  await getDbPool().end();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
