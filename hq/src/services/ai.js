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
import { q, one, err, audit, parseJson, todayLocal, getConfig, updateConfig } from '../db.js';
import { assertLocation, canLocation, loadAccess } from '../access.js';
import * as analytics from './analytics.js';
import * as quality from './quality.js';
import * as payroll from './payroll.js';
import * as repl from './replenishment.js';
import * as staffing from './staffing.js';
import * as work from './work.js';
import * as shiftModel from './shiftModel.js';
import * as bank from './bank.js';
import * as fin from './finance.js';
import { createSheet, sheetsUnavailable } from './sheets.js';
import * as payments from './payments.js';
import * as source from './source.js';
import { attendanceReport, clockRows } from './attendance.js';
import { recentSameWeekday } from './demand.js';
import { addDays } from '../lib/recommend.js';
import { listRoles, listShifts, listLocations } from './master.js';

const THINKING_TIMEOUT_MS = Number(process.env.JOYA_AI_TIMEOUT_MS ?? 6 * 60_000);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// Most calculations one request may run. Sent to the model in the context (limits.maxCalcs).
export const MAX_CALCS = 6;
// The chat's memory: the earlier questions of the same user in the same chat, so a short follow-up ("and last year?",
// "only Raanana") keeps its period, restaurants and topic. Only recent answered ones; their answers are cut.
export const HISTORY_MAX = 3;
export const HISTORY_HOURS = 3;
export const HISTORY_ANSWER_CHARS = 1200;
// A chat keeps its newest CHAT_KEEP questions (owner, 2026-11-04: "keep up to 100"); the client loads CHAT_PAGE at a time.
export const CHAT_KEEP = 100;

function locs(access, p) {
  const ids = p.locationIds ?? (p.locationId != null ? [p.locationId] : null);
  // no location given → the picker choice the question was asked with (access.scopeIds, see compute), else all
  if (!ids) return access.scopeIds ?? access.locationIds;
  const asked = (Array.isArray(ids) ? ids : [ids]).map(String);
  const allowed = asked.filter((id) => canLocation(access, id));
  if (!allowed.length) throw err('FORBIDDEN', 'no access to the requested location(s)');
  return allowed;
}
// The payroll files of a saved month per location (owner 2026-11-04: "payslip excel download", "export to Micpal"):
// the month (asked, else the last saved one) and links to /api/joya/payroll/files/… — the files are made by the
// Allegro admin from the saved payroll (Local API /payroll/tlush.xlsx, /payroll/import.xlsx), nothing is kept here.
async function payrollFiles(access, p) {
  if (!access.payroll) throw err('FORBIDDEN', 'payroll files need payroll access');
  if (p.month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(p.month))) throw err('BAD_REQUEST', 'month must be YYYY-MM');
  const names = new Map((await listLocations(access)).map((l) => [String(l.id), l.name]));
  const files = [];
  for (const id of locs(access, p)) {
    const months = await source.payrollMonths(id);
    const m = p.month ? months.find((x) => x.month === String(p.month)) : months.find((x) => x.withTlush > 0);
    const link = (kind) => `/api/joya/payroll/files/${kind}.xlsx?locationId=${encodeURIComponent(id)}&month=${m.month}`;
    files.push({
      locationId: id,
      location: names.get(String(id)) ?? id,
      month: m?.month ?? null,
      saved: !!m,
      employees: m ? m.employees : 0,
      withPayslip: m ? m.withTlush : 0,
      savedAt: m?.updatedAt ?? null,
      downloads: m ? { tlush: link('tlush'), import: link('import') } : null,
      savedMonths: months.slice(0, 6).map((x) => x.month),
    });
  }
  return { source: 'Allegro admin, saved payroll (Local API /payroll/months, /payroll/tlush.xlsx, /payroll/import.xlsx)', period: p.month ? { month: p.month } : undefined, files };
}

/** One payroll file for the download route: { buffer, fileName }. */
export async function payrollFile(access, locationId, month, kind) {
  if (!access.payroll) throw err('FORBIDDEN', 'payroll files need payroll access');
  if (!['tlush', 'import'].includes(kind)) throw err('NOT_FOUND', 'unknown file');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ''))) throw err('BAD_REQUEST', 'month must be YYYY-MM');
  assertLocation(access, String(locationId));
  const f = await source.payrollFile(locationId, month, kind);
  await audit(access.username, 'PAYROLL_FILE_DOWNLOADED', 'payroll_file', null, String(locationId), { month, kind });
  return f;
}

// Employees with their wages (Allegro /employees), for users with payroll access. No national ids or phones.
async function employeeList(access, p) {
  if (!access.payroll) throw err('FORBIDDEN', 'wages need payroll access');
  const ids = locs(access, p);
  const names = new Map((await listLocations(access)).map((l) => [String(l.id), l.name]));
  const want = p.active === 'all' ? null : p.active === false || p.active === 'false' ? false : true;
  const text = p.q ? String(p.q).trim().toLowerCase() : null;
  const role = p.role ? String(p.role).trim() : null;
  // with a period: the clock times (Tabit via Allegro /shifts/raw, linked to the employee by Allegro) per person
  const period = p.from && p.to ? range(p) : null;
  const worked = new Map();
  const unlinked = new Map();
  let missingClockOut = 0;
  if (period) {
    for (const loc of ids) {
      for (const r of await source.rawShifts(loc, ...period)) {
        if (!r.clockIn || !r.clockOut) {
          missingClockOut++;
          continue;
        }
        const h = (Date.parse(r.clockOut.replace(' ', 'T')) - Date.parse(r.clockIn.replace(' ', 'T'))) / 3.6e6;
        if (!(h > 0)) continue;
        if (r.employeeId == null) {
          const u = unlinked.get(r.employeeName) || { name: r.employeeName, hours: 0, days: new Set() };
          u.hours += h;
          u.days.add(r.date);
          unlinked.set(r.employeeName, u);
          continue;
        }
        const w = worked.get(String(r.employeeId)) || { hours: 0, days: new Set(), byRole: new Map() };
        w.hours += h;
        w.days.add(r.date);
        const role = r.roleName || '—';
        w.byRole.set(role, (w.byRole.get(role) || 0) + h);
        worked.set(String(r.employeeId), w);
      }
    }
  }
  const workedOnly = period && p.workedOnly !== false;
  const rows = (await source.employees(ids)).filter(
    (e) =>
      (!workedOnly || worked.has(String(e.id))) &&
      (want == null || e.active === want) &&
      (!text || String(e.name || '').toLowerCase().includes(text)) &&
      (!role || e.roles.some((r) => r.role.includes(role)) || e.roleNames.some((r) => r.includes(role))),
  );
  const max = Math.min(Math.max(Number(p.limit) || 150, 1), 300);
  // owner's rule (2026-10-29): a new employee = worked in the period and has no employee number in the payroll software
  // (Micpal) = has not handed in form 101 yet. A location where no one has a number is not linked (e.g. no ID numbers in
  // the admin): there nobody is called new. A contractor (קבלן, not in the payroll) is never new (owner 2026-10-29).
  const all = period ? await source.employees(ids) : [];
  const linkedLocs = new Set(all.filter((e) => e.hasPayrollNumber).map((e) => e.locationId));
  const isNew = (e) => (e.contractor ? false : linkedLocs.has(e.locationId) ? worked.has(String(e.id)) && !e.hasPayrollNumber : null);
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
      hasPayrollNumber: e.hasPayrollNumber,
      ...(period ? { ...workedOut(worked.get(String(e.id)), e), newEmployee: isNew(e) } : {}),
    })),
    ...(period
      ? {
          period: { from: period[0], to: period[1] },
          workedOnly: !!workedOnly,
          clockSource: 'Tabit clock times via Allegro (/shifts/raw), linked to the employee by Allegro (clock id → phone → name); raw clock hours, before the payroll rules',
          unlinkedClockNames: [...unlinked.values()].map((u) => ({ name: u.name, hours: Math.round(u.hours * 100) / 100, days: u.days.size })),
          missingClockOut,
          // a clock name with no employee record has no number either → new too
          newEmployees: {
            rule: 'worked in the period, is not a contractor (קבלן) and has no employee number in Micpal (form 101 not handed in yet)',
            count: rows.filter((e) => isNew(e)).length + unlinked.size,
            names: [...rows.filter((e) => isNew(e)).map((e) => e.name), ...[...unlinked.keys()].map((n) => `${n} (not in the employees list)`)],
            notLinkedLocations: ids.filter((id) => !linkedLocs.has(String(id))).map((id) => names.get(String(id)) ?? id),
          },
        }
      : {}),
  };
}
// hours and days worked in the period, per role of the clock rows, with the wage of that role
function workedOut(w, e) {
  if (!w) return { hoursWorked: 0, daysWorked: 0, workedByRole: [] };
  const r2 = (x) => Math.round(x * 100) / 100;
  return {
    hoursWorked: r2(w.hours),
    daysWorked: w.days.size,
    workedByRole: [...w.byRole.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([role, h]) => {
        const rr = e.roles.find((x) => x.role === role);
        return { role, hours: r2(h), hourlyRate: rr ? rr.hourlyRate : e.hourlyRate, wageType: rr?.wageType ?? e.wageType };
      }),
  };
}
// Bank data is per company and for the chain admin only. companyKeys (keys or names) → those companies; else the
// companies of the locations in scope (the picker choice, see locs).
async function bankCompanies(access, p) {
  if (!access.accounting) throw err('FORBIDDEN', 'bank data is for the chain admin and the accountant only');
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

// The books (the Finance API) are per company and for the chain admin only (owner 2026-11-07, decision 1). The
// same company choice as the bank; the accountant does not get them yet.
async function financeCompanies(access, p) {
  if (!access.isAdmin) throw err('FORBIDDEN', 'the books (finance data) are for the chain admin only');
  return bankCompanies(access, p);
}
const finCalc = (fn) => async (a, p) => {
  const cos = await financeCompanies(a, p || {});
  cos.asked = Boolean(p?.companyKeys || p?.companyKey); // named companies get an answer each, even without books
  return fn(cos, p || {});
};
const FIN_PERIOD = 'from: "YYYY-MM-DD", to?: "YYYY-MM-DD" (default today)';

// The locations in scope (see locs) and their names; without locationIds the closed restaurants are left out.
async function activeScope(access, p) {
  const all = await listLocations(access);
  const info = new Map(all.map((l) => [String(l.id), l]));
  const ids = locs(access, p).filter((id) => p.locationIds?.length || info.get(String(id))?.active !== false);
  return { ids, names: new Map(all.map((l) => [String(l.id), l.name])) };
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
      'payments by type (credit, cash, Wolt, 10bis, Sodexo, Multipass, hakafa…) and card brand: charges = paid − refunded (Beecomm "סה״כ"; their total = income WITHOUT tips: card rows include the card tips, the cash row is lower by them because the workers got them in cash), share of all payments, refunds, number and average payment, service (tips); vs the same-length period before. Always: creditCards (= "credit card": VISA + MASTERCARD + AMEX + DINERS + ISRACARD + DISCOVER + MAESTRO only) and membersClub (every other brand of the credit type: the club card…, NOT Mishloha) and mishloha ("אשראי - MISHLOHA", its own group), per location (day by day up to 62 days) and in total. brands: also the sum of only these card brands (selected; selectedTotal). group: also the sums per Sunday–Saturday week or per month (byPeriod per location, byPeriodTotal over all)',
    run: (a, p) => analytics.paymentsSummary(locs(a, p), ...range(p), p.brands, p.group),
  },
  vat_report: {
    params: '{ locationIds?, from, to }  (whole months: from = the 1st, to = the last day or today)',
    about:
      'the monthly VAT report (דוח מע"מ): per month, per restaurant, per company and in total — the income from Beecomm (all payments in the Z, without tips), the הקפה payments (hakafa, taken out: they are invoiced to the customer), the payments of חבר (hever, both PRIVATE LABEL BRAND brands) and the 20% deducted from them (only חבר, not מולטיפס), the income for VAT (income − hakafa − deduction), the VAT inside it (18/118) and the income before VAT; daysWithData per restaurant and month',
    run: async (a, p) => {
      const info = new Map((await listLocations(a)).map((l) => [String(l.id), { name: l.name, company: l.company?.label ?? null, active: l.active }]));
      return analytics.vatReport(locs(a, p), ...range(p), info);
    },
  },
  month_vs_last_year: {
    params: '{ locationIds?, month?: "YYYY-MM" (default this month) }',
    about:
      'the weekly performance report (owner): per restaurant and for the chain, the average income per day of the month (up to yesterday) vs the average income per day of the same month last year, the change in %, and the income of both months (last year: the whole month); days with income only (closed days not counted); income = the Z total, without tips; data since 2024',
    run: async (a, p) => {
      const { ids, names } = await activeScope(a, p);
      return analytics.monthVsLastYear(ids, p.month, todayLocal(), names);
    },
  },
  waiter_performance: {
    params: '{ locationIds?, from, to }',
    about:
      'per waiter (who opened the order in Beecomm) per restaurant: orders, income (no tips), tips and tips % of income, average order, days worked; orders without a waiter (Wolt, online) apart',
    run: async (a, p) => {
      const { ids, names } = await activeScope(a, p);
      return analytics.waiterPerformance(ids, ...range(p), names);
    },
  },
  daily_dashboard: {
    params: '{ locationIds?, date?: "YYYY-MM-DD" (default today) }',
    about:
      'the daily dashboard (owner): per restaurant and in total the income, number of diners, income per diner and refunds (זיכויים) of one business day; today live from Beecomm (the day so far, with open orders), or — when live is not available — the last stored day (date says which day); a past date from the stored data',
    run: async (a, p) => {
      const { ids, names } = await activeScope(a, p);
      return analytics.dailyDashboard(ids, p.date, todayLocal(), names);
    },
  },
  bank_summary: {
    params: '{ companyKeys?: string[], from, to, group?: "week" | "month" }',
    about:
      "the company's bank account(s): money in and out, net, the balance at the start and end and the lowest, the biggest sources and uses (action + details), day by day up to 62 days; group: per Sunday–Saturday week or per month (byPeriod) instead of day by day; vs the same-length period before. Chain admin only",
    run: async (a, p) => bank.bankSummary(await bankCompanies(a, p), ...range(p), p.group),
  },
  card_income_week: {
    params: '{ locationIds?, weekStart?: "YYYY-MM-DD" (any day of the week; default this week) }',
    about:
      'the card money expected to come in during a Sunday–Saturday week, from Beecomm and the card companies\' pay rules: creditCards (VISA + MASTERCARD + DINERS of the week before, paid by Max on Wednesday) and amex (American Express: sales of the 1st–15th paid on the 2nd of the next month, of the 16th–end on the 8th) apart, and the total; amounts without tips, the card tips apart (tips)',
    run: (a, p) => analytics.cardIncomeWeek(locs(a, p), p.weekStart, todayLocal()),
  },
  cards_vs_bank: {
    params: '{ companyKeys?, from, to }',
    about:
      'card sales in Beecomm vs the card companies\' payouts in the bank, the way they pay: per Sunday–Saturday week VISA + MASTERCARD vs Max\'s payout the next Wednesday (fee ≈ 1.6%), and per month AMEX vs American Express\'s payouts in the next month; with the difference in %. Chain admin only',
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
    about: 'worked hours, sales per labor hour; with payroll access also the labor cost and the payslip gross as the Allegro admin computes them (its payroll rules; months without a saved payroll built from the Tabit reports), labor % of sales, and the hours with no wage (people named)',
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
  clock_rows: {
    params: '{ locationIds?, from, to, q?: "part of a name", role?: "role name, e.g. מלצר", shift?: "morning" | "evening" }',
    about:
      'the shifts themselves from the Tabit Shift clock report: one row per entry and exit (date, weekday, name, role, morning / evening, clock in, clock out, hours, open = a time is missing), up to 400 rows, plus a line per person (days, hours). For "the shifts of <person>" or "who worked on <date> (evening)"',
    run: async (a, p) => {
      const names = new Map((await listLocations(a)).map((l) => [String(l.id), l.name]));
      return clockRows(locs(a, p), ...range(p), { q: p.q, role: p.role, shift: p.shift }, names);
    },
  },
  attendance_report: {
    params: '{ locationIds?, from, to }',
    about:
      'דיווחי נוכחות: the Tabit Shift clock report only, and its problems per location: open shifts (an entry without an exit, an exit without an entry; no exit today = still at work), no-shows (in the Tabit work plan that day but no clock times) and people who clocked in on a day they were not in the plan; each with the date, name, role and times',
    run: async (a, p) => {
      const names = new Map((await listLocations(a)).map((l) => [String(l.id), l.name]));
      return attendanceReport(locs(a, p), ...range(p), todayLocal(), names);
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
    params: '{ locationIds?, q?: "part of a name", role?: "role name, e.g. מלצר", active?: true | false | "all" (default true), from?, to?, workedOnly?: true (default with a period) | false, limit? }',
    about:
      'the employees from Allegro: name, location, roles, wage type and wage (hourly rate, or a monthly amount for a global wage), the hourly rate per role, contractor, active; with a count and the average hourly rate per role. With from/to: only the people who worked in the period (workedOnly), each with hours and days worked and the hours per role from the Tabit clock times, plus clock names not linked to an employee, and newEmployees (worked in the period with no Micpal employee number = no form 101 yet). Users with payroll access only',
    run: (a, p) => employeeList(a, p),
  },
  payroll_files: {
    params: '{ locationIds?, month?: "YYYY-MM" (default: the last saved payroll month of each location) }',
    about:
      'the payroll files to download, per location: the payslip Excel (tlush, the Shifts page export) and the Micpal / Shiklulit import file, of a SAVED payroll month (as of its last save), with the month, the employees saved and the saved months. The chat shows the download buttons under the answer. Users with payroll access only',
    run: (a, p) => payrollFiles(a, p),
  },
  payroll_issues: { params: '{ locationIds?, period?: "YYYY-MM", status? }', about: 'payroll preparation issues', run: async (a, p) => ({ source: 'joya_payroll_issues', issues: await payroll.listIssues(a, { locationIds: locs(a, p), period: p.period, status: p.status }) }) },
  // ── the books (Hashavshevet, allegro_finance) — chain admin only; every result carries the admin's data warnings
  finance_status: {
    params: '{ companyKeys?: string[], months?: number }',
    about: 'how complete and fresh the books are: the last sync and its data date, per month the income, purchases, salaries, general expenses, unposted entries and whether the month is complete (no high warning), the bank account(s) and the supplier balances. Read it before a finance answer, or when asked "is the bookkeeping up to date"',
    run: finCalc(fin.financeStatus),
  },
  pnl: {
    params: `{ companyKeys?, ${FIN_PERIOD}, by?: "month" | "year" | "branch" | "account" (default month), compare?: "prev_period" | "prev_year", locationIds?: string[] (branches), includeUnposted?: boolean }`,
    about: 'profit and loss from the books (דוח רווח והפסד): income, purchases (food cost), salaries, general expenses and profit per month / year / branch / account, without VAT; compare = the same rows for the period before or the same period last year, with the change. by branch also gives "No branch" (the part the books do not split) and branch_partial',
    run: finCalc(fin.pnl),
  },
  cash_position: {
    params: '{ companyKeys?, asOf?: "YYYY-MM-DD" }',
    about: 'cash today and in 30, 60 and 90 days: the bank balance (statement lines, and the running balance Hashavshevet shows), cheques out by due date (next 30 / 31–60 / 61–90 / later), cheques due and not cleared, open customer invoices by due date, and the projected balance',
    run: finCalc(fin.cashPosition),
  },
  branch_costs: {
    params: `{ companyKeys?, ${FIN_PERIOD} (up to 400 days), locationIds? }`,
    about: 'food cost % and labor cost % per branch per month: revenue (the books, or Beecomm without VAT when the books have no branch), food cost (purchases of the branch in the books), the admin labor cost and payslip gross (saved payroll or Tabit), and their % of revenue',
    run: finCalc(fin.branchCosts),
  },
  sales_vs_books: {
    params: `{ companyKeys?, ${FIN_PERIOD} (up to 400 days), locationIds? }`,
    about: 'the sales system (Beecomm, without VAT) compared with the income posted in the books, per month and branch, with a company total row and the difference in ₪ and %',
    run: finCalc(fin.salesVsBooks),
  },
  spending: {
    params: `{ companyKeys?, ${FIN_PERIOD}, by?: "supplier" (default) | "account" | "group", top?: number (default 20, 0 = all), compare?: "prev_period" | "prev_year", locationIds? }`,
    about: 'top suppliers (supplier invoices with VAT) or spending by expense account / group (without VAT), biggest first, with the total; compare = each row vs the period before or last year (previous, change, changePct)',
    run: finCalc(fin.spending),
  },
  aging: {
    params: '{ companyKeys?, side: "suppliers" | "customers", asOf?, excludeGroupCompanies?: boolean, q?: "part of a name", account?: "account key", limit? }',
    about: 'debts with age (גיול חובות): per supplier (what the company owes) or per customer (what they owe), the balance and the open items in buckets current / 1-30 / 31-60 / 61-90 / 90+ days by due date, the biggest first, with totals; the supplier side carries supplier_balances_suspect when the balances look wrong',
    run: finCalc(fin.aging),
  },
  intercompany: {
    params: '{ companyKeys?, asOf?, from? }',
    about: 'loans and money between group companies, shareholders and related parties: the balance of each listed account (plus = they owe the company) and its movement; one side only, the other company is not loaded',
    run: finCalc(fin.intercompany),
  },
  trial_balance: {
    params: '{ companyKeys?, asOf?: "YYYY-MM-DD" (default today), from?: "YYYY-MM-DD" (then the movement of from..asOf and the opening balance), group?: "500,700" (account groups), q?: "part of a name", limit? }',
    about: 'trial balance (מאזן בוחן): debit, credit and balance per account up to a date, with totals (debit = credit) and whether it balances; a group or a name narrows the list',
    run: finCalc(fin.trialBalance),
  },
  account_card: {
    params: `{ companyKeys?, account?: "account key, e.g. 500059", q?: "part of the account name" (one of the two), ${FIN_PERIOD}, includeUnposted?, limit?, offset? }`,
    about: 'the account card (כרטסת) of one account: every line of the period with date, entry, counter account, debit, credit and running balance, the opening and closing balance; several accounts match a name → ambiguous with the matches (ask which one)',
    run: finCalc(fin.accountCard),
  },
  journal_search: {
    params: '{ companyKeys?, from?, to?, batch?: number, reference?: number, account?: "account key", type?: "entry type, e.g. ח18", q?: "text in the description or names", posted?: "0" | "1", limit? }  |  { companyKeys?, year: number, transId: number }  (one entry)',
    about: 'journal entries (פקודות יומן) by batch, reference, date, account, type or text, with amount and accounts; or one entry (year + transId) with its lines, document and cheque',
    run: finCalc(fin.journalSearch),
  },
  bank_reconciliation: {
    params: '{ companyKeys?, account?: "bank account key" }',
    about: 'bank reconciliation (התאמת בנקים) from the books: the bank statement balance vs the book balance per bank account, the open (unmatched) amounts and lines on both sides with their age, the matched amounts that should be equal, and the gap',
    run: finCalc(fin.bankReconciliation),
  },
  bank_recon_report: {
    params: `{ companyKeys?, account?: "bank account key", from?: "YYYY-MM-DD" (default 1 January of to's year), to?: "YYYY-MM-DD" (default today) }`,
    about: 'the detailed bank reconciliation report (דוח התאמת בנק מפורט) for one bank account and a period, as of its end: the summary that ties the bank balance to the book balance (open bank lines, open book lines, cheques not cleared, unexplained difference), the first rows of each section (bank without books, books without bank, cheques cleared in the period, cheques not cleared with their status) and the buttons for the full Hebrew page and the Excel file. Ask it for "דוח התאמת בנק", the three-section report, or when the user wants the report / Excel',
    run: finCalc(fin.bankReconReport),
  },
  bank_open_items: {
    params: '{ companyKeys?, side: "bank" | "book", minAge?: number (days), from?, to?, account?, limit? }',
    about: 'the open items of the bank reconciliation, oldest first: bank statement lines not matched to the books (side bank), or book lines of the bank account not matched to the statement (side book: cheques, transfers…)',
    run: finCalc(fin.bankOpenItems),
  },
  bank_match_suggestions: {
    params: '{ companyKeys?, days?: number (default 30), minAmount?, account?, limit? }',
    about: 'suggested matches for open bank lines: the open book lines with the same amount and direction within N days (confidence single / many); suggestions only, nothing is matched',
    run: finCalc(fin.bankMatchSuggestions),
  },
  customer_invoices: {
    params: `{ companyKeys?, ${FIN_PERIOD}, q?: "part of the customer name", account?, type?: "invoice" | "credit", limit? }`,
    about: 'customer invoices and credit notes from the books (with VAT): date, number, customer, amount, kind customer / register (the monthly register entries are not real customers); the total of the selection',
    run: finCalc(fin.customerInvoices),
  },
  supplier_invoices: {
    params: `{ companyKeys?, ${FIN_PERIOD}, q?: "part of the supplier name", account?, type?: "invoice" | "credit", includeUnposted?, limit? }`,
    about: 'supplier (expense) invoices and credit notes (minus) as the BOOKS hold them, with VAT: the invoice date, the day it was entered in Hashavshevet (entryDate), number, supplier, amount, the expense account and group, batch, description; the count and total of the selection. The books only — not Drive, not the mailbox',
    run: finCalc(fin.supplierInvoices),
  },
  statement_compare: {
    params: '{ companyKeys?, account? | q: "part of the party name" (one of the two), from, to (the statement period), theirs: { perspective: "supplier" | "customer", party?, openingBalance?, closingBalance?, rows: [{ date: "YYYY-MM-DD", reference, description, debit, credit }] }, days?: 45, tolerance?: 0.05 }',
    about: "השוואת כרטסת: a supplier's or customer's statement of us (the rows you extract from context.attachment) against our account card in the books — only the differences: onlyTheirs (in their statement, missing in our books), onlyOurs (in our books, missing in theirs), amountDiffers, matched counts, and the balance gap (theirs − ours, explained by the differences). perspective supplier = their statement of us as their customer (we owe them); customer = their statement of us as their supplier",
    run: finCalc(fin.statementCompare),
  },
  account_statement: {
    params: '{ companyKeys?, account?: "account key", q?: "part of the name" (one of the two), from?, to? }',
    about: 'the card of one supplier or customer (כרטיס ספק / לקוח): invoices, credit notes, payments and other lines of the period, the open items with their age, the balance (plus = owed) and totals; several accounts match → ambiguous (ask which one)',
    run: finCalc(fin.accountStatement),
  },
  cheques: {
    params: '{ companyKeys?, state?: "future" | "due" | "cleared" | "not_cleared", from?, to? (due dates), account?, q?: "part of the payee", number?: "a cheque number, or several comma-separated", limit? }',
    about: 'issued cheques (שיקים) from the books (Hashavshevet, since October 2025): payee, amount, due date, state (future = due after today = שיקים לפרעון = שקלפ; cleared = matched to the bank; not_cleared = due and not matched), with totals per state and byDay = the cheques grouped by due date with each day\'s count and sum; number = one cheque by its number; returned cheques are not available yet',
    run: finCalc(fin.cheques),
  },
  priority_cheques: {
    params: '{ companyKeys?, cheque?: "a cheque number, or several comma-separated", q?: "part of the supplier name, the details or an invoice number", amount?: number, supplierAccount?, from?, to?, dateField?: "chequeDate" (default, the date on the cheque) | "payDate", limit? }',
    about: 'the cheques Pasta Lina wrote in Priority BEFORE Hashavshevet (history, April 2025 – March 2026, cheque dates up to 2029; a constant file): cheque number, supplier, the date on the cheque, the payment date, amount before withholding tax, withholding, net = the amount on the cheque, and the invoices it paid. For a cheque the books do not know (a bank line "לא נמצא בחשבשבת" / payeeSource missing or priority), "what was cheque N for", old cheques of a supplier, or a question that says Priority / פריוריטי; cheques written in Hashavshevet are in cheques',
    run: finCalc(fin.priorityCheques),
  },
  vat_summary: {
    params: `{ companyKeys?, ${FIN_PERIOD} (whole months), issues?: boolean (also the 874 report runs), includeUnposted? }`,
    about: 'VAT from the BOOKS per month: sales VAT, input VAT, VAT on fixed assets, to pay (sales − input − assets), the VAT accounts and their balances; issues = also the 874 report runs with their totals by record type (not checked yet). For the Beecomm-based VAT report use vat_report instead',
    run: finCalc(fin.vatSummary),
  },
  withholding: {
    params: '{ companyKeys?, from?, to?, expiring?: number (days, default 60), q?: "part of a supplier name", account? }',
    about: 'tax deducted at source (ניכוי במקור): per supplier the payments, the amount deducted and its %; the suppliers\' withholding certificates with their end date and state (valid / expiring / expired) and how many have none',
    run: finCalc(fin.withholding),
  },
  allocation_numbers: {
    params: `{ companyKeys?, ${FIN_PERIOD}, missingOnly?: boolean, minAmount?: number, account?, limit? }`,
    about: 'allocation numbers (מספרי הקצאה) on supplier invoices: which invoices are over the legal limit of their date and need one (required), which have a real number (ok), which are missing or suspect; counts for the period',
    run: finCalc(fin.allocationNumbers),
  },
  missing_invoices: {
    params: '{ companyKeys?, from?, to? (invoice dates; default this year to today), direction?: "expense" | "income", status?: "not_booked" | "pending" | "amount_differs" | "no_account" | "booked" | "all" (default all; several: "not_booked,amount_differs"), q?: "part of a supplier / customer name or an invoice number", channels?: ["drive"] (default every channel), limit? }',
    about: "invoices that are NOT booked yet in Hashavshevet (and the ones that are), checked channel by channel — the answer is one part per channel. Channels today: drive = every invoice that reached the accountant's mailbox (filed in Drive by the invoice agent), matched with the books and flagged there; more channels later (bank debits without an invoice…). Per channel: counts and totals per status (booked / pending / not_booked / amount_differs / no_account), the rows asked for, and how many book entries of the period have no document in that channel",
    run: finCalc(fin.missingInvoices),
  },
  payroll_check: {
    params: '{ companyKeys?, month: "YYYY-MM", locationIds? }',
    about: 'the salary expense posted in the books (group 720) against the payslip gross of the admin payroll (saved, or built from Tabit), per branch for one month, with the difference; the books have no 2026 salaries (no_salary_expense)',
    run: finCalc(fin.payrollCheck),
  },
  exceptions: {
    params: '{ companyKeys?, type?: "unposted" | "future_dated" | "possible_duplicate" | "missing_branch", from?, to? (default this year), limit? }',
    about: 'exceptions in the books (חריגים): entries not posted, entries dated in the future, possible duplicate entries (same accounts, amount and reference), expense lines without a branch; counts per type. "Wrong account" has no rule yet',
    run: finCalc(fin.exceptions),
  },
  change_history: {
    params: `{ companyKeys?, ${FIN_PERIOD}, kind?: "account" | "login" | "sync" | "vat_run", account?, limit? }`,
    about: 'change history in Hashavshevet (מי שינה מה): changes of account details (user, date, field, old and new value), logins, 874 report runs, and what the nightly sync found changed; journal edits are not logged by Hashavshevet',
    run: finCalc(fin.changeHistory),
  },
  payments_due: {
    params: '{ companyKeys?, from?: "YYYY-MM-DD" (default today), to?: "YYYY-MM-DD" (default today + 30 days), status?: "PLANNED" | "PAID" | "CANCELLED" | "all" (default PLANNED) }',
    about: 'the planned bank transfers (תשלומים) the owner entered in the Payments chat, per company: overdue, today, thisWeek (Sunday–Saturday), upcoming and their totals; a payment is PAID only when a line of the bank file paid it (paidDate, bank); candidates = bank lines of its amount that may have paid it, to confirm on the Payments page. Not the Beecomm payments report (payments_summary), not cheques, not the bank lines themselves',
    run: async (a, p) => {
      if (!a.isAdmin) throw err('FORBIDDEN', 'payments are for the chain admin only');
      return payments.listForCalc(await bankCompanies(a, p || {}), p || {}, todayLocal());
    },
  },
  team_rules: { params: '{ area?: "STOCK|MANPOWER|PERFORMANCE|BANK|ACCOUNTING|PAYMENTS" }', about: 'the team rules the chain admin added from the chat (id, text, area; area null = all areas)', run: async (a, p) => ({ source: 'teamRules (joya_settings)', rules: await teamRules(p.area || null) }) },
  pending_decisions: { params: '{ locationIds? }', about: 'drafts waiting for approval, open payroll issues, recent shortages per location', run: async (a, p) => ({ source: 'joya_* status columns', pending: await work.pending(a, locs(a, p)) }) },
};

export function catalogue() {
  return Object.entries(CALCS).map(([name, c]) => ({ name, params: c.params, about: c.about }));
}

// ---------------------------------------------------------------- requests (user side)

// the attachment's text stays on the server (it can be 150k characters); the client gets what it is
const metaForClient = (m) => (m?.attachment ? { ...m, attachment: { ...m.attachment, text: undefined } } : m);

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
  meta: metaForClient(parseJson(r.meta_json)),
  lang: r.lang,
  createdAt: r.created_at,
  answeredAt: r.answered_at,
});

// the main-menu areas; a question asked in one is context AREA + the area's number
export const AREAS = { 1: 'STOCK', 2: 'MANPOWER', 3: 'PERFORMANCE', 4: 'BANK', 5: 'ACCOUNTING', 6: 'PAYMENTS' };
// the calculations of the accounting area — the only ones the accountant may run (supplier invoices: later, from an
// uploaded Excel file — owner 2026-10-31)
const ACCOUNTANT_CALCS = new Set(['team_rules', 'vat_report', 'cards_vs_bank', 'bank_summary', 'bank_transactions', 'payments_summary', 'card_income_week', 'sales_summary', 'sales_daily']);
// the books (the Finance API): chain admin only (owner 2026-11-07); the accountant may get them later by adding them to ACCOUNTANT_CALCS
export const FINANCE_CALCS = new Set(['finance_status', 'pnl', 'cash_position', 'branch_costs', 'sales_vs_books', 'spending', 'aging', 'intercompany', 'trial_balance', 'account_card', 'journal_search', 'bank_reconciliation', 'bank_recon_report', 'bank_open_items', 'bank_match_suggestions', 'customer_invoices', 'supplier_invoices', 'statement_compare', 'account_statement', 'cheques', 'priority_cheques', 'vat_summary', 'withholding', 'allocation_numbers', 'missing_invoices', 'payroll_check', 'exceptions', 'change_history', 'payments_due']);
export const mayRun = (access, name) => (FINANCE_CALCS.has(name) ? !!access.isAdmin : access.role !== 'ACCOUNTANT' || ACCOUNTANT_CALCS.has(name));

// ---------------------------------------------------------------- team rules
// Lasting rules for the AI team, given in the chat by the chain admin ("from now on…", "כלל חדש: …"). The planner
// proposes the rule (proposal TEAM_RULE), it is saved only on Apply, and every later request of its area gets it
// (context.teamRules → the runner puts it in <team_rules>). A JSON document in joya_settings: [{ id, text, area, by, at }].
const TEAM_RULES = 'teamRules';
const MAX_RULES = 60;
const MAX_RULE_CHARS = 600;
const RULE_AREAS = new Set(Object.values(AREAS));

/** The rules for an area: those of the area and those for all areas (area null). No area given = all the rules. */
export async function teamRules(area = null) {
  const all = await getConfig(TEAM_RULES, []);
  return (Array.isArray(all) ? all : []).filter((r) => !area || !r.area || r.area === area).map((r) => ({ id: r.id, text: r.text, area: r.area ?? null, by: r.by ?? null, at: r.at ?? null }));
}

/** The planner's rule change → a checked proposal. Only the chain admin may change the team's rules. */
async function checkRule(access, rule, requestArea) {
  if (!access.isAdmin) throw err('FORBIDDEN', 'only the chain admin can add or change the team rules');
  const op = rule?.op;
  if (!['add', 'edit', 'remove'].includes(op)) throw err('BAD_REQUEST', 'unknown rule change');
  const all = await teamRules();
  const area = rule.area === undefined ? requestArea ?? null : rule.area || null;
  if (area && !RULE_AREAS.has(area)) throw err('BAD_REQUEST', `unknown area ${area}`);
  const text = String(rule.text ?? '').trim();
  if (op !== 'remove' && !text) throw err('BAD_REQUEST', 'the rule has no text');
  if (text.length > MAX_RULE_CHARS) throw err('BAD_REQUEST', `a rule may have at most ${MAX_RULE_CHARS} characters`);
  if (op === 'add') {
    if (all.length >= MAX_RULES) throw err('CONFLICT', `there are already ${MAX_RULES} rules: remove one first`);
    return { type: 'TEAM_RULE', op, rule: { text, area } };
  }
  const before = all.find((r) => Number(r.id) === Number(rule.id));
  if (!before) throw err('NOT_FOUND', `there is no rule ${rule.id}`);
  if (op === 'remove') return { type: 'TEAM_RULE', op, rule: before, before };
  return { type: 'TEAM_RULE', op, rule: { id: before.id, text, area: rule.area === undefined ? before.area : area }, before };
}

/** The rule list after one approved change (pure): { rules, saved }. */
export function changeRules(list, p, by, at = new Date().toISOString()) {
  const rules = Array.isArray(list) ? list : [];
  if (p.op === 'add') {
    if (rules.length >= MAX_RULES) throw err('CONFLICT', `there are already ${MAX_RULES} rules: remove one first`);
    const saved = { id: rules.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1, text: p.rule.text, area: p.rule.area ?? null, by, at };
    return { rules: [...rules, saved], saved };
  }
  const i = rules.findIndex((r) => Number(r.id) === Number(p.rule.id));
  if (i < 0) throw err('CONFLICT', `rule ${p.rule.id} was already removed`);
  if (p.op === 'remove') return { rules: rules.filter((_, k) => k !== i), saved: null };
  const saved = { ...rules[i], text: p.rule.text, area: p.rule.area ?? null, by, at };
  return { rules: rules.map((r, k) => (k === i ? saved : r)), saved };
}

async function applyRule(access, p) {
  if (!access.isAdmin) throw err('FORBIDDEN', 'only the chain admin can add or change the team rules');
  let saved = null;
  await updateConfig(TEAM_RULES, [], access.username, (list) => {
    const out = changeRules(list, p, access.username);
    saved = out.saved;
    return out.rules;
  });
  await audit(access.username, 'TEAM_RULE_CHANGED', 'team_rule', saved?.id ?? p.rule.id, null, { op: p.op, text: (saved ?? p.rule).text?.slice(0, 300), area: (saved ?? p.rule).area ?? null });
  return { op: p.op, rule: saved ?? p.rule };
}

async function contextAllowed(access, kind, id) {
  if (kind === 'AREA') {
    if (!AREAS[id]) throw err('BAD_REQUEST', 'unknown area');
    if (AREAS[id] === 'BANK' && !access.isAdmin) throw err('FORBIDDEN', 'the bank area is for the chain admin only');
    if (AREAS[id] === 'PAYMENTS' && !access.isAdmin) throw err('FORBIDDEN', 'the payments area is for the chain admin only');
    if (AREAS[id] === 'ACCOUNTING' && !access.accounting) throw err('FORBIDDEN', 'the accounting area is for the chain admin and the accountant only');
    if (access.role === 'ACCOUNTANT' && AREAS[id] !== 'ACCOUNTING') throw err('FORBIDDEN', 'the accountant sees the accounting area only');
    return null;
  }
  if (kind === 'ORDER_LIST') return repl.getList(access, id);
  if (kind === 'STAFFING_PLAN') return staffing.getPlan(access, id);
  return null;
}

export async function ask(access, { question, locationId = null, companyKey = null, contextKind = 'GENERAL', contextId = null, lang = 'he', attachment = null }) {
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
  // a file turned into text by services/attachments.js (the chat's paperclip, POST /ai/ask-file): the planner reads it from context.attachment
  if (attachment && typeof attachment === 'object' && attachment.text) meta = { ...(meta || {}), attachment };
  if (access.role === 'ACCOUNTANT' && contextKind !== 'AREA') throw err('FORBIDDEN', 'the accountant sees the accounting area only');
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
  await pruneChat(access.username, contextKind, contextId);
  return getRequest(access, id);
}

// Delete the questions of a chat beyond its newest CHAT_KEEP; one still being answered or with a change waiting for
// Apply is kept.
async function pruneChat(username, kind, contextId) {
  const ctx = contextId != null ? 'context_id=:c' : 'context_id IS NULL';
  const edge = await one(
    `SELECT id FROM joya_ai_requests WHERE username=:u AND context_kind=:k AND ${ctx} ORDER BY id DESC LIMIT 1 OFFSET ${CHAT_KEEP - 1}`,
    { u: username, k: kind, c: contextId },
  );
  if (!edge) return;
  await q(
    `DELETE FROM joya_ai_requests WHERE username=:u AND context_kind=:k AND ${ctx} AND id < :id
        AND status <> 'THINKING' AND (proposal_status IS NULL OR proposal_status <> 'PENDING')`,
    { u: username, k: kind, c: contextId, id: edge.id },
  );
}

export async function getRequest(access, id) {
  await failStale();
  const r = await one(`SELECT * FROM joya_ai_requests WHERE id=:id`, { id });
  if (!r || r.username !== access.username) throw err('NOT_FOUND', 'not found');
  return shape(r);
}

// newest first; beforeId: the page of older questions (id < beforeId), for "scroll up to load more"
export async function listRequests(access, { contextKind, contextId, limit = 20, beforeId = null }) {
  await failStale();
  const before = parseInt(beforeId, 10) > 0 ? parseInt(beforeId, 10) : null;
  const rows = await q(
    `SELECT * FROM joya_ai_requests WHERE username=:u ${contextKind ? 'AND context_kind=:k' : ''} ${contextId ? 'AND context_id=:c' : ''} ${before ? 'AND id < :b' : ''} ORDER BY id DESC LIMIT ${Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100)}`,
    { u: access.username, k: contextKind, c: contextId, b: before },
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
  else if (p.type === 'TEAM_RULE') result = await applyRule(access, p);
  else if (p.type === 'PAYMENT_OPS') result = await payments.applyOps(access, p, { via: 'CHAT' });
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

// "Ask again" (↻): the same question is answered again in the same box — the row goes back to THINKING and its
// answer, calculations and change are cleared; the picker scope it was asked with stays.
export async function retryRequest(access, id) {
  const r = await getRequest(access, id);
  if (r.status === 'THINKING') throw err('CONFLICT', 'this question is still being answered');
  const raw = await one(`SELECT meta_json FROM joya_ai_requests WHERE id=:id`, { id });
  const scope = parseJson(raw?.meta_json)?.scope;
  await q(
    `UPDATE joya_ai_requests SET status='THINKING', answer_text=NULL, calcs_json=NULL, proposal_json=NULL, proposal_status=NULL,
            error=NULL, meta_json=:m, claimed_at=NULL, answered_at=NULL, created_at=NOW() WHERE id=:id`,
    { id, m: scope ? JSON.stringify({ scope }) : null },
  );
  return getRequest(access, id);
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
  if (r.location_id != null) {
    const loc = (await listLocations(access)).find((l) => String(l.id) === String(r.location_id));
    return { kind: 'LOCATION', locationIds: [String(r.location_id)], companyKey: loc?.company?.key ?? null };
  }
  const key = parseJson(r.meta_json)?.scope?.companyKey;
  if (key == null) return null;
  const inCo = (await listLocations(access)).filter((l) => (l.company?.key ?? '') === key && l.active);
  return { kind: 'COMPANY', company: inCo[0]?.company?.label ?? key, companyKey: key, locationIds: inCo.map((l) => String(l.id)) };
}

/** Everything the model needs to plan: who asks, what they may see, today, the calculations, the object in view. */
export async function contextFor(id) {
  const { r, access } = await requestAccess(id);
  return buildContext(access, r);
}

/** The answered questions just before request r, in the same chat of the same user, oldest first. */
async function chatHistory(access, r) {
  if (!r.id || !access.username) return [];
  const rows = await q(
    `SELECT question, calcs_json, answer_text, created_at FROM joya_ai_requests
      WHERE username=:u AND context_kind=:k AND id < :id AND status='ANSWERED'
        AND created_at >= NOW() - INTERVAL ${HISTORY_HOURS} HOUR
        ${r.context_id != null ? 'AND context_id=:c' : 'AND context_id IS NULL'}
        ${r.context_kind === 'GENERAL' ? (r.location_id != null ? 'AND location_id=:l' : 'AND location_id IS NULL') : ''}
      ORDER BY id DESC LIMIT ${HISTORY_MAX}`,
    { u: access.username, k: r.context_kind, id: r.id, c: r.context_id, l: r.location_id },
  );
  return rows.reverse().map((h) => {
    const text = String(h.answer_text || '');
    return {
      question: h.question,
      askedAt: h.created_at,
      calcs: (parseJson(h.calcs_json) || []).map((c) => ({ calc: c.calc, params: c.params ?? {} })),
      answer: text.length > HISTORY_ANSWER_CHARS ? `${text.slice(0, HISTORY_ANSWER_CHARS)} …` : text,
    };
  });
}

/**
 * The chat this request belongs to, for the runner's live session (runner/session.js): its key (same scope as
 * chatHistory) and the ids of its earlier answered questions, newest first — so the runner sees when a question was
 * deleted or asked again and starts a new session.
 */
async function chatOf(access, r) {
  if (!r.id || !access.username) return null;
  const rows = await q(
    `SELECT id FROM joya_ai_requests
      WHERE username=:u AND context_kind=:k AND id < :id AND status='ANSWERED'
        ${r.context_id != null ? 'AND context_id=:c' : 'AND context_id IS NULL'}
        ${r.context_kind === 'GENERAL' ? (r.location_id != null ? 'AND location_id=:l' : 'AND location_id IS NULL') : ''}
      ORDER BY id DESC LIMIT 50`,
    { u: access.username, k: r.context_kind, id: r.id, c: r.context_id, l: r.location_id },
  );
  const key = [access.username, r.context_kind, r.context_id ?? '-', r.context_kind === 'GENERAL' ? (r.location_id ?? '-') : '-'].join(':');
  return { key, priorIds: rows.map((x) => Number(x.id)) };
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
    calculations: catalogue().filter((c) => mayRun(access, c.name)),
    // the team's lasting rules for this area (the runner gives them to the model as instructions, apart from the data)
    teamRules: (await teamRules(r.context_kind === 'AREA' ? AREAS[r.context_id] : null)).map((x) => ({ id: x.id, text: x.text, area: x.area })),
    // the earlier questions of this chat (the runner gives them apart from the data, in <history>)
    history: await chatHistory(access, r),
    // the chat for the runner's live session (not given to the model)
    chat: await chatOf(access, r),
    // the payees of earlier payments (chain admin): the planner reuses their spelling in a payment op
    ...(access.isAdmin ? { payees: (await payments.payees(scope?.companyKey ?? null, 50).catch(() => [])).map((x) => x.name) } : {}),
    limits: { maxCalcs: MAX_CALCS },
    // the text of a file attached to the question (the chat's paperclip); without the text itself in the request list
    ...(parseJson(r.meta_json)?.attachment ? { attachment: parseJson(r.meta_json).attachment } : {}),
    // a file answer (plan.file): the rows of the results go into a Google Sheet in the owner's Drive folder
    files: sheetsUnavailable() ? { sheet: false, why: sheetsUnavailable() } : { sheet: true },
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
  // planned bank transfers (services/payments.js), in the plan's "payments" list — any chat, chain admin only
  PAYMENTS: [
    '{ "op": "add", "payee": string, "amount": number, "dueDate"?: "YYYY-MM-DD", "dueWeek"?: { "year": YYYY, "month": 1-12, "week": 1-4 }, "repeat"?: { "every": "month", "day"?: 1-31, "week"?: 1-4, "until"?: "YYYY-MM-DD", "count"?: number (how many payments in all, 2-60) }, "note"?: string, "companyKey"?: string (only when the question names the company) }',
    '{ "op": "move", "id": number, "dueDate"?: "YYYY-MM-DD", "dueWeek"?: { "year": YYYY, "month": 1-12, "week": 1-4 }, "scope"?: "one" | "series" }',
    '{ "op": "amount", "id": number, "amount": number, "scope"?: "one" | "series" }',
    '{ "op": "cancel", "id": number, "scope"?: "one" | "series" }',
  ],
};

/**
 * Run the model's plan: calculations with the user's access, and validation of the
 * proposed change. Errors are returned per calculation (the model can explain them).
 */
export async function compute(id, { calcs = [], ops = null, whatIf = null, rule = null, payments: paymentOps = null, file = null }) {
  const { r, access: user } = await requestAccess(id);
  const scope = await scopeOf(user, r);
  const access = scope?.locationIds.length ? { ...user, scopeIds: scope.locationIds } : user;
  if (r.status !== 'THINKING') throw err('CONFLICT', 'request is not open');
  const results = [];
  const list = Array.isArray(calcs) ? calcs : [];
  // a file answer (owner 2026-11-09): every row of the lists goes into a Google Sheet, so the calcs run in export mode
  const wantFile = file && typeof file === 'object' && !Array.isArray(file) ? { kind: 'sheet', title: typeof file.title === 'string' ? file.title.slice(0, 80) : null, show: file.show === true, columns: Array.isArray(file.columns) ? file.columns.filter((c) => typeof c === 'string').slice(0, 60) : null } : null;
  for (const [i, c] of list.entries()) {
    if (i >= MAX_CALCS) {
      results.push({ calc: c?.calc, params: c?.params, error: `not run: at most ${MAX_CALCS} calculations per request` });
      continue;
    }
    const def = CALCS[c?.calc];
    if (def && !mayRun(user, c.calc)) {
      results.push({ calc: c.calc, params: c.params, error: c.calc === 'payments_due' ? 'payments are for the chain admin only' : FINANCE_CALCS.has(c.calc) ? 'the books (finance data) are for the chain admin only' : 'not in the accounting area: the accountant may not run it' });
      continue;
    }
    if (!def) {
      results.push({ calc: c?.calc, params: c?.params, error: 'unknown calculation' });
      continue;
    }
    try {
      results.push({ calc: c.calc, params: c.params || {}, result: await def.run(access, wantFile ? { ...(c.params || {}), export: true } : c.params || {}) });
    } catch (e) {
      results.push({ calc: c.calc, params: c.params, error: e.message });
    }
  }
  let proposal = null;
  let proposalError = null;
  try {
    if (rule && typeof rule === 'object') {
      proposal = await checkRule(user, rule, r.context_kind === 'AREA' ? AREAS[r.context_id] : null);
    } else if (Array.isArray(paymentOps) && paymentOps.length) {
      // planned bank transfers: checked here, saved on Apply (payments.applyOps)
      proposal = await payments.checkOps(user, paymentOps, { companyKey: scope?.companyKey ?? null, today: todayLocal(), requestId: id });
    } else if (r.context_kind === 'ORDER_LIST' && Array.isArray(ops) && ops.length) {
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
  let made = null;
  let fileError = null;
  if (wantFile) {
    try {
      made = { ...(await createSheet({ title: wantFile.title, question: r.question, lang: r.lang, today: todayLocal(), calcs: results.map((x) => ({ calc: x.calc, params: x.params })), columns: wantFile.columns }, results)), show: wantFile.show };
    } catch (e) {
      fileError = { code: e.code || 'ERROR', message: e.message };
    }
  }
  // the file stays with the request (meta_json.file; answer() keeps it) — the chat shows the link under the answer
  const meta = parseJson(r.meta_json) || {};
  await q(`UPDATE joya_ai_requests SET calcs_json=:c, proposal_json=:p, proposal_status=:s, meta_json=:m WHERE id=:id`, {
    c: JSON.stringify(results),
    p: proposal ? JSON.stringify(proposal) : null,
    s: proposal ? 'PENDING' : null,
    m: JSON.stringify({ ...meta, ...(made ? { file: made } : {}), ...(fileError ? { fileError } : {}) }),
    id,
  });
  return { results, proposal, proposalError, file: made, fileError };
}

const toOrderOp = (o) => (o.op === 'add' ? { op: 'add', ingredientId: o.ingredientId, name: o.name, qty: o.qty, unit: o.unit, note: o.note } : { op: o.op, lineId: o.lineId, qty: o.qty, note: o.note });
const toStaffingOp = (o) => (o.op === 'add' ? { op: 'add', date: o.date, shiftCode: o.shiftCode, roleCode: o.roleCode, headcount: o.headcount, start: o.start, end: o.end, note: o.note } : { op: o.op, lineId: o.lineId, headcount: o.headcount, start: o.start, end: o.end, note: o.note });

export async function answer(id, { answer: text, failed = false, error = null, meta = null }) {
  const r = await one(`SELECT * FROM joya_ai_requests WHERE id=:id`, { id });
  if (!r) throw err('NOT_FOUND', 'not found');
  if (r.status !== 'THINKING') throw err('CONFLICT', 'already answered');
  const kept = parseJson(r.meta_json) || {};
  if (kept.scope || kept.file || kept.fileError) meta = { ...(meta || {}), ...(kept.scope ? { scope: kept.scope } : {}), ...(kept.file ? { file: kept.file } : {}), ...(kept.fileError ? { fileError: kept.fileError } : {}) };
  await q(`UPDATE joya_ai_requests SET status=:s, answer_text=:a, error=:e, meta_json=:m, answered_at=NOW() WHERE id=:id`, {
    s: failed ? 'FAILED' : 'ANSWERED',
    a: failed ? null : String(text || '').slice(0, 20000),
    e: failed ? String(error || 'failed').slice(0, 2000) : null,
    m: meta ? JSON.stringify(meta) : null,
    id,
  });
}
