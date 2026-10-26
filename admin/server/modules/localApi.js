import express from "express";
import { createRequire } from "module";
import { executeSql } from "../sources/dbpool.js";
import { normalizeRoles, effectiveHourlyRate } from "../../../shared/wage.js";
import { norm, nameKey } from "../uploads/workbook.js";
import {
  bcomGetOrders,
  bcomGetExceptions,
  bcomGetOrdersWithExceptions,
  bcomGetZReports,
  bcomGetItems,
  bcomGetItemsByDay,
} from "../../../scripts/server/analoader/bcom_api_loader.js";

// Read-only, localhost-only API over shifts, salaries and Beecomm data.
// Mounted at /local-api/v1 by server.js; documented in local_api_readme.md.

const require = createRequire(import.meta.url);
const RESTAURANTS = require("../../../shared/restaurants.json");

// Beecomm live queries are slow (one request per restaurant) — cap the range.
const MAX_BEECOMM_DAYS = 93;
// Stored (DB) date ranges — generous, but stops accidental full-table dumps.
const MAX_STORED_DAYS = 800;
// /beecomm/items?byDay=1 makes one Beecomm call per day per restaurant.
const MAX_ITEMS_DAYS_BY_DAY = 31;
// /shifts/by-shift reads every clock pair in range — a bit over a year is enough to learn from.
const MAX_BY_SHIFT_DAYS = 400;

const LOOPBACK_ADDRS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// Only direct loopback connections. A request relayed by a reverse proxy on
// the same machine also arrives from 127.0.0.1, so any forwarding header is
// rejected too; the Host check blocks DNS-rebinding from a browser.
const localOnly = (req, res, next) => {
  const proxied =
    req.headers["x-forwarded-for"] ||
    req.headers["x-real-ip"] ||
    req.headers["forwarded"];
  const host = String(req.headers.host || "").replace(/:\d+$/, "");
  if (
    !LOOPBACK_ADDRS.has(req.socket.remoteAddress) ||
    proxied ||
    !LOOPBACK_HOSTS.has(host)
  ) {
    return res.status(403).json({
      error: {
        code: "forbidden",
        message: "local-api is only reachable from localhost",
      },
    });
  }
  next();
};

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const badRequest = (message) => new ApiError(400, "bad_request", message);

// Tables created by a migration that may not have been run yet on this DB.
const TABLE_MIGRATIONS = {
  tabit_shifts: "scripts/utils/create_file_upload_tables.sql",
  file_uploads: "scripts/utils/create_file_upload_tables.sql",
  bcom_z_reports: "scripts/utils/create_file_upload_tables.sql",
  bcom_orders: "scripts/utils/create_bcom_orders_table.sql",
  bcom_items_daily: "scripts/utils/create_bcom_items_table.sql",
  bcom_payments_daily: "scripts/utils/create_bcom_payments_table.sql",
  bank_transactions: "scripts/utils/create_file_upload_tables.sql",
};

const missingTable = (err) => {
  if (!err || err.code !== "ER_NO_SUCH_TABLE") return null;
  const m = /Table '[^.']*\.?([^']+)' doesn't exist/.exec(err.message || "");
  return m ? m[1] : "unknown";
};

// ── reference data ───────────────────────────────────────────────────────

// Flat branch list from shared/restaurants.json, with the Beecomm
// restaurantId each branch belongs to (branches.groupId).
let branchCache = null;
async function loadBranches() {
  if (branchCache) return branchCache;
  const [rows] = await executeSql(
    "SELECT branchId, groupId FROM branches",
    {},
  );
  const bcomRestaurantId = Object.fromEntries(
    (rows || []).map((r) => [r.branchId, r.groupId]),
  );
  branchCache = [];
  for (const g of RESTAURANTS.restaurants || []) {
    for (const b of g.branches || []) {
      branchCache.push({
        id: b.id,
        name: b.name,
        company: {
          key: g.key,
          label: g.label,
          companyId: g.companyId,
          payrollSoft: g.payroll_soft || null,
        },
        bcomRestaurantId: bcomRestaurantId[b.id] || null,
      });
    }
  }
  return branchCache;
}

// ── param parsing ────────────────────────────────────────────────────────

async function requireBranch(req) {
  const branch = String(req.query.branch || "").trim();
  if (!branch) throw badRequest("missing branch (branch id, see /branches)");
  const branches = await loadBranches();
  if (!branches.some((b) => b.id === branch))
    throw new ApiError(404, "not_found", `unknown branch ${branch}`);
  return branch;
}

// Optional comma-separated branch list; empty means all branches.
async function optionalBranches(req) {
  const ids = String(req.query.branch || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) return [];
  const branches = await loadBranches();
  const unknown = ids.filter((id) => !branches.some((b) => b.id === id));
  if (unknown.length)
    throw new ApiError(404, "not_found", `unknown branch ${unknown.join(",")}`);
  return ids;
}

const branchesMeta = (ids) => (ids.length ? ids : "all");

// Bank accounts per company (shared/restaurants.json bank_accounts): [{ company, bank, account }].
const BANK_ACCOUNTS = (RESTAURANTS.restaurants || []).flatMap((g) =>
  (g.bank_accounts || []).map((a) => ({ company: g.key, companyLabel: g.label, bank: a.bank, account: a.account })),
);
const bankCompany = (account) => BANK_ACCOUNTS.find((a) => a.account === account)?.company ?? null;

// Optional comma-separated company keys (see /branches company.key) → their bank accounts; [] = all accounts.
function optionalBankAccounts(req) {
  const keys = String(req.query.company || "").split(",").map((s) => s.trim()).filter(Boolean);
  const account = String(req.query.account || "").trim();
  let list = BANK_ACCOUNTS;
  if (keys.length) {
    const unknown = keys.filter((k) => !(RESTAURANTS.restaurants || []).some((g) => g.key === k));
    if (unknown.length) throw new ApiError(404, "not_found", `unknown company ${unknown.join(",")}`);
    list = list.filter((a) => keys.includes(a.company));
  }
  if (account) list = list.filter((a) => a.account === account);
  if ((keys.length || account) && !list.length) return null; // asked for something with no bank account
  return keys.length || account ? list.map((a) => a.account) : [];
}

// SQL fragment + params for `column IN (:b0, :b1, ...)`; empty list = no filter.
function inBranches(column, ids, params) {
  if (!ids.length) return "";
  ids.forEach((id, i) => (params[`b${i}`] = id));
  return `AND ${column} IN (${ids.map((_, i) => `:b${i}`).join(",")})`;
}

function optionalMonth(req) {
  if (req.query.month == null || req.query.month === "") return null;
  const month = String(req.query.month).trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw badRequest("month must be YYYY-MM");
  return month;
}

function requireMonth(req) {
  const month = optionalMonth(req);
  if (!month) throw badRequest("month must be YYYY-MM");
  return month;
}

// A real calendar day: Date.parse accepts e.g. 2026-09-31, so round-trip it.
const isIsoDate = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
};

function optionalDateRange(req, maxDays) {
  if (!req.query.from && !req.query.to) return null;
  const from = String(req.query.from || "").trim();
  const to = String(req.query.to || from).trim();
  if (!isIsoDate(from)) throw badRequest("from must be YYYY-MM-DD");
  if (!isIsoDate(to)) throw badRequest("to must be YYYY-MM-DD");
  const days = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
  if (days < 1) throw badRequest("to must not be before from");
  if (maxDays && days > maxDays)
    throw badRequest(`date range is limited to ${maxDays} days`);
  return { from, to };
}

function requireDateRange(req, maxDays) {
  const range = optionalDateRange(req, maxDays);
  if (!range) throw badRequest("from must be YYYY-MM-DD");
  return range;
}

// updatedSince: ISO date or date-time (UTC unless it carries an offset).
// Returned as a UTC 'YYYY-MM-DD HH:MM:SS' for comparing with DB timestamps.
function optionalUpdatedSince(req) {
  const raw = String(req.query.updatedSince || "").trim();
  if (!raw) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw;
  const t = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`);
  if (Number.isNaN(t))
    throw badRequest("updatedSince must be an ISO date or date-time");
  return new Date(t).toISOString().slice(0, 19).replace("T", " ");
}

// The Beecomm cube API takes DD/MM/YYYY.
const toBcomDates = ({ from, to }) => {
  const dmy = (iso) => iso.split("-").reverse().join("/");
  return { startDate: dmy(from), endDate: dmy(to) };
};

function optionalEmployeeId(req) {
  if (req.query.employeeId == null || req.query.employeeId === "") return null;
  const id = Number(req.query.employeeId);
  if (!Number.isInteger(id) || id <= 0)
    throw badRequest("employeeId must be a positive integer");
  return id;
}

const parseJson = (v, fallback) => {
  if (v == null) return fallback;
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
};

const isoDay = (d) =>
  d instanceof Date ? d.toISOString().slice(0, 10) : String(d);

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// DATETIME columns that hold Israel local time are formatted in SQL, so they
// are never re-read as UTC by the driver.
const localCol = (col, as) => `DATE_FORMAT(${col}, '%Y-%m-%d %H:%i:%s') AS ${as}`;
const dayCol = (col, as) => `DATE_FORMAT(${col}, '%Y-%m-%d') AS ${as}`;

// ── employees ────────────────────────────────────────────────────────────

const toEmployee = (r) => ({
  employeeId: r.employee_id,
  branch: r.rest,
  company: r.company,
  name: r.name,
  idNumber: r.ID_nmbr,
  employeeNumber: r.mic_nmbr,
  phone: r.phone,
  active: !!r.active,
  contractor: !!r.contractor,
  duplicateOf: r.duplicate,
  wageType: r.new_wage_type,
  wage: r.wage,
  hourlyWage: r.hourly_wage,
  travel: r.travel,
  maxTravel: r.maxTravel,
  roles: normalizeRoles(parseJson(r.roles, [])),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const EMPLOYEE_COLUMNS = `employee_id, rest, company, name, ID_nmbr, mic_nmbr, phone,
  active, contractor, duplicate, new_wage_type, wage, hourly_wage, travel,
  maxTravel, roles, created_at, updated_at`;

// ── payroll rows (shifts + salaries share the stored payroll JSON) ───────

// payroll.payroll_data is either the bare per-role map (older rows) or a
// wrapper { payroll_data, role_extras, workdays, daily_breakdown, ... }.
function unwrapPayroll(raw) {
  const data = parseJson(raw, {}) || {};
  if (!("payroll_data" in data)) return { payroll_data: data };
  return data;
}

// Payroll endpoints need a month or updatedSince (or both).
function payrollFilter(req) {
  const month = optionalMonth(req);
  const updatedSince = optionalUpdatedSince(req);
  if (!month && !updatedSince)
    throw badRequest("month (YYYY-MM) or updatedSince is required");
  return { month, updatedSince, employeeId: optionalEmployeeId(req) };
}

async function loadPayrollRows(branchIds, { month, updatedSince, employeeId }) {
  const params = { month, updatedSince, employeeId };
  const [rows] = await executeSql(
    `SELECT p.rest, p.month, p.employee_id, p.payroll_data, p.tlush, p.updated_at,
            e.name, e.ID_nmbr
       FROM payroll p
       JOIN employees e ON e.employee_id = p.employee_id
      WHERE 1 = 1
        ${inBranches("p.rest", branchIds, params)}
        ${month ? "AND p.month = :month" : ""}
        ${updatedSince ? "AND p.updated_at >= :updatedSince" : ""}
        ${employeeId ? "AND p.employee_id = :employeeId" : ""}
      ORDER BY p.rest, p.month, e.name`,
    params,
  );
  return (rows || []).map((r) => ({ ...r, wrapped: unwrapPayroll(r.payroll_data) }));
}

const payrollMeta = (branchIds, f, asOf) => ({
  branches: branchesMeta(branchIds),
  month: f.month,
  updatedSince: f.updatedSince,
  asOf,
});

// ── raw Tabit shifts → employees ─────────────────────────────────────────

const phoneKey = (p) => {
  const d = String(p || "").replace(/\D/g, "");
  return d.length >= 9 ? d.slice(-9) : "";
};
const exactName = (s) => norm(s).replace(/^\*+\s*/, "");

// tabit_shifts holds only the name Tabit writes and the clock id. Resolve
// each (branch, name, clock id) to employees.employee_id, most reliable first:
//   clock_id → Tabit roster (shift_employees) phone → employees.phone
//   exact name (Tabit "*" removed)
//   base name (" - role" suffix removed), only when one employee has it
// Unresolved rows keep employeeId null; matchedBy tells how a row was matched.
async function employeeResolver(branchIds) {
  const params = {};
  const [emps] = await executeSql(
    `SELECT employee_id, rest, name, phone FROM employees
      WHERE duplicate IS NULL ${inBranches("rest", branchIds, params)}`,
    params,
  );
  const params2 = {};
  const [roster] = await executeSql(
    `SELECT rest, clock_id, phone, first_name, family_name FROM shift_employees
      WHERE clock_id IS NOT NULL ${inBranches("rest", branchIds, params2)}`,
    params2,
  );
  const byRest = new Map();
  const restOf = (rest) => {
    if (!byRest.has(rest))
      byRest.set(rest, { byPhone: new Map(), byExact: new Map(), byBase: new Map(), clock: new Map() });
    return byRest.get(rest);
  };
  const add = (map, key, id) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(id);
  };
  for (const e of emps) {
    const r = restOf(e.rest);
    add(r.byPhone, phoneKey(e.phone), e.employee_id);
    add(r.byExact, exactName(e.name), e.employee_id);
    add(r.byBase, nameKey(e.name), e.employee_id);
  }
  for (const s of roster) restOf(s.rest).clock.set(String(s.clock_id).trim(), s);

  const unique = (set) => (set && set.size === 1 ? [...set][0] : null);
  const cache = new Map();
  return (rest, name, clockId) => {
    const key = `${rest}|${name}|${clockId || ""}`;
    if (cache.has(key)) return cache.get(key);
    const r = byRest.get(rest);
    let out = { employeeId: null, matchedBy: null };
    if (r) {
      const s = clockId ? r.clock.get(String(clockId).trim()) : null;
      const viaClock =
        s &&
        (unique(r.byPhone.get(phoneKey(s.phone))) ||
          unique(r.byBase.get(nameKey(`${s.first_name || ""} ${s.family_name || ""}`))));
      if (viaClock) out = { employeeId: viaClock, matchedBy: "clock_id" };
      else if (unique(r.byExact.get(exactName(name))))
        out = { employeeId: unique(r.byExact.get(exactName(name))), matchedBy: "name" };
      else if (unique(r.byBase.get(nameKey(name))))
        out = { employeeId: unique(r.byBase.get(nameKey(name))), matchedBy: "base_name" };
    }
    cache.set(key, out);
    return out;
  };
}

const hoursBetween = (a, b) =>
  a && b
    ? round2((Date.parse(`${b.replace(" ", "T")}Z`) - Date.parse(`${a.replace(" ", "T")}Z`)) / 3600000)
    : null;

// ── people per shift ─────────────────────────────────────────────────────

const SHIFTS = ["morning", "evening"];
// Work after midnight belongs to the evening of the work date, up to this hour (as in Beecomm).
const BUSINESS_DAY_END = "06:00";

const localMs = (s) => Date.parse(`${s.replace(" ", "T")}Z`);
const localStr = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
const nextDay = (date) => localStr(localMs(`${date} 00:00:00`) + 86400000).slice(0, 10);

// The two shift windows of a work date: morning [00:00, split), evening [split, next day 06:00).
function shiftWindows(date, split) {
  const start = localMs(`${date} 00:00:00`);
  const cut = localMs(`${date} ${split}:00`);
  const end = localMs(`${nextDay(date)} ${BUSINESS_DAY_END}:00`);
  return { morning: [start, cut], evening: [cut, end] };
}

// Clock pairs (tabit_shifts rows) → one row per branch × date × shift × role: distinct people
// with ≥ minHours inside the shift window, and the raw clock hours inside it. A person is the
// matched employeeId, else the Tabit name without "*". Pairs without a clock-out are skipped.
function shiftsByShift(rows, resolve, { split, minHours }) {
  const groups = new Map();
  let missingClockOut = 0;
  let unmatched = 0;
  for (const r of rows) {
    if (!r.clock_in) continue;
    if (!r.clock_out) {
      missingClockOut += 1;
      continue;
    }
    const who = resolve(r.rest, r.employee_name, r.clock_id);
    if (!who.employeeId) unmatched += 1;
    const person = who.employeeId ? `id:${who.employeeId}` : `name:${exactName(r.employee_name)}`;
    const inMs = localMs(r.clock_in);
    const outMs = localMs(r.clock_out);
    const windows = shiftWindows(r.work_date, split);
    for (const shift of SHIFTS) {
      const [ws, we] = windows[shift];
      const ms = Math.min(outMs, we) - Math.max(inMs, ws);
      if (ms <= 0) continue;
      const key = `${r.rest}|${r.work_date}|${shift}|${r.role}`;
      if (!groups.has(key))
        groups.set(key, {
          branch: r.rest, date: r.work_date, shift, role: r.role,
          start: localStr(ws), end: localStr(we), people: new Map(),
        });
      const g = groups.get(key);
      g.people.set(person, (g.people.get(person) || 0) + ms / 3600000);
    }
  }
  const data = [...groups.values()]
    .map((g) => {
      const hours = [...g.people.values()];
      return {
        branch: g.branch,
        date: g.date,
        shift: g.shift,
        role: g.role,
        people: hours.filter((h) => h >= minHours).length,
        hours: round2(hours.reduce((s, h) => s + h, 0)),
        start: g.start,
        end: g.end,
      };
    })
    .sort(
      (a, b) =>
        a.branch.localeCompare(b.branch) ||
        a.date.localeCompare(b.date) ||
        SHIFTS.indexOf(a.shift) - SHIFTS.indexOf(b.shift) ||
        String(a.role).localeCompare(String(b.role)),
    );
  return { data, missingClockOut, unmatched };
}

// ── router ───────────────────────────────────────────────────────────────

const ENDPOINTS = [
  "GET /health",
  "GET /status[?branch=a,b]",
  "GET /branches",
  "GET /employees[?branch=a,b][&active=1|0|all][&updatedSince=]",
  "GET /employees/:employeeId",
  "GET /shifts?month=YYYY-MM|updatedSince=[&branch=a,b][&employeeId=]",
  "GET /shifts/summary?month=YYYY-MM|updatedSince=[&branch=a,b][&employeeId=]",
  "GET /shifts/raw?from=&to=|updatedSince=[&branch=a,b][&employeeId=]",
  "GET /shifts/by-shift?from=&to=[&branch=a,b][&split=HH:MM][&minHours=]",
  "GET /payroll/months?branch=",
  "GET /payroll?month=YYYY-MM|updatedSince=[&branch=a,b][&employeeId=]",
  "GET /payroll/labor-cost?branch=&month=YYYY-MM",
  "GET /labor/daily?from=&to=[&branch=a,b]",
  "GET /labor/daily/employees?from=&to=[&branch=a,b][&employeeId=]",
  "GET /beecomm/daily?from=&to=[&branch=a,b]",
  "GET /beecomm/z-reports?from=&to=[&branch=a,b]",
  "GET /beecomm/z-reports/stored?from=&to=[&branch=a,b]",
  "GET /beecomm/orders?from=&to=[&branch=a,b][&exceptions=1]",
  "GET /beecomm/orders/stored?from=&to=[&branch=a,b]",
  "GET /beecomm/exceptions?from=&to=[&branch=a,b]",
  "GET /beecomm/exceptions/summary?from=&to=[&branch=a,b]",
  "GET /beecomm/items?from=&to=[&branch=a,b][&hours=1|&byDay=1]",
  "GET /beecomm/items/stored?from=&to=[&branch=a,b][&group=day|dish]",
  "GET /beecomm/payments/stored?from=&to=[&branch=a,b][&group=day|type|brand]",
  "GET /bank/transactions/stored?from=&to=[&company=a,b][&account=][&q=][&side=credit|debit][&group=none|day|action|details]",
];

// ── daily labor cost ─────────────────────────────────────────────────────

const MIN_HOURLY_WAGE = Number(process.env.MIN_HOURLY_WAGE) || 35.4;
// Weighted hours: 125% and 150% hours cost more per hour.
const weighted = (e) => (Number(e.h100) || 0) + (Number(e.h125) || 0) * 1.25 + (Number(e.h150) || 0) * 1.5;
const sumHours = (e) => (Number(e.h100) || 0) + (Number(e.h125) || 0) + (Number(e.h150) || 0);

// Hourly rate for an employee's role, the same chain as the admin Shifts page
// (resolveHourlyWage): role-level wage type, then employee-level, then legacy hourly_wage (-1 = minimum).
function hourlyRate(emp, role) {
  const opts = { minHourlyWage: MIN_HOURLY_WAGE };
  const roleEntry = emp && emp.roles[role];
  if (roleEntry) {
    const rate = effectiveHourlyRate(roleEntry, opts);
    if (rate != null) return rate;
  }
  if (emp && emp.new_wage_type) {
    const rate = effectiveHourlyRate({ new_wage_type: emp.new_wage_type, wage: emp.wage }, opts);
    if (rate != null) return rate;
  }
  if (!emp || emp.hourly_wage == null) return null;
  return Number(emp.hourly_wage) === -1 ? MIN_HOURLY_WAGE : Number(emp.hourly_wage);
}

// Monthly pay from a saved tlush, by kind. amount = quantity × wage per component.
// Skipped: Shiklulit record types 3 (מפרעה מטיפים, a deduction) and 4 (attendance counts).
// Net-paid wage lines (netGross "net") are kept apart: their gross is higher and only the
// payroll software knows it.
function tlushPay(tlush) {
  const pay = { wages: 0, netWages: 0, travel: 0, bonus: 0, meals: 0 };
  for (const c of (tlush && tlush.components) || []) {
    const rt = Number(c.recordType);
    if (rt === 3 || rt === 4) continue;
    const amount = (Number(c.quantity) || 0) * (Number(c.wage) || 0);
    if (!amount) continue;
    if (c.code === 21) pay.meals += amount;
    else if (c.code === 3) pay.travel += amount;
    else if (c.code === 32) pay.bonus += amount;
    else if (c.netGross === "net") pay.netWages += amount;
    else pay.wages += amount;
  }
  return pay;
}

// Split amount over days by weight; equal shares when every weight is 0.
function allocate(amount, days) {
  if (!amount || !days.length) return days.map(() => 0);
  const total = days.reduce((s, d) => s + d.weight, 0);
  return days.map((d) => (total > 0 ? (amount * d.weight) / total : amount / days.length));
}

// One row per employee per worked day in [from, to], from the saved payroll months.
async function laborDays(branchIds, from, to, employeeId) {
  const params = { fromMonth: from.slice(0, 7), toMonth: to.slice(0, 7), employeeId };
  const [rows] = await executeSql(
    `SELECT p.rest, p.month, p.employee_id, p.payroll_data, p.tlush, p.updated_at,
            e.name, e.roles, e.\`global\` AS global_amount, e.hourly_wage, e.new_wage_type, e.wage
       FROM payroll p
       JOIN employees e ON e.employee_id = p.employee_id
      WHERE p.month BETWEEN :fromMonth AND :toMonth
        ${inBranches("p.rest", branchIds, params)}
        ${employeeId ? "AND p.employee_id = :employeeId" : ""}`,
    params,
  );
  const out = [];
  for (const r of rows || []) {
    const w = unwrapPayroll(r.payroll_data);
    const emp = {
      roles: Object.fromEntries(normalizeRoles(parseJson(r.roles, [])).filter((x) => x && x.role).map((x) => [x.role, x])),
      new_wage_type: r.new_wage_type || null,
      wage: r.wage == null || r.wage === "" ? null : Number(r.wage),
      hourly_wage: r.hourly_wage == null ? null : Number(r.hourly_wage),
    };
    const globalAmount = Number(r.global_amount) > 0 ? Number(r.global_amount) : null;
    const breakdown = w.daily_breakdown && typeof w.daily_breakdown === "object" ? w.daily_breakdown : {};
    const dailyHours = w.daily_hours && typeof w.daily_hours === "object" ? w.daily_hours : {};

    // Worked days of the month with their entries; older payrolls without a breakdown
    // fall back to daily_hours, then work_dates (no per-role hours then).
    let days = Object.keys(breakdown).sort().map((date) => ({ date, entries: breakdown[date] || [] }));
    if (!days.length) {
      const dates = Object.keys(dailyHours).length
        ? Object.keys(dailyHours)
        : Array.isArray(w.work_dates) ? w.work_dates : [];
      days = dates.sort().map((date) => ({ date, entries: [], rawHours: Number(dailyHours[date]) || 0 }));
    }
    if (!days.length) continue;

    // Per-day hours, hours × wage, and the admin page's own rule (tip + completion when present).
    let monthlyAdmin = 0;
    for (const d of days) {
      d.h100 = d.h125 = d.h150 = d.tip = d.completion = d.wageCost = d.adminCost = 0;
      d.unpricedHours = 0;
      for (const e of d.entries) {
        d.h100 += Number(e.h100) || 0;
        d.h125 += Number(e.h125) || 0;
        d.h150 += Number(e.h150) || 0;
        const tip = Number(e.tip) || 0;
        const completion = Number(e.completion) || 0;
        d.tip += tip;
        d.completion += completion;
        const rate = hourlyRate(emp, e.role);
        if (rate == null) d.unpricedHours += sumHours(e);
        const cost = rate == null ? 0 : weighted(e) * rate;
        d.wageCost += cost;
        d.adminCost += tip || completion ? tip + completion : cost;
      }
      d.weight = d.entries.length ? weighted(d) : d.rawHours || 0;
      monthlyAdmin += d.adminCost;
    }
    // Global (monthly salary) employees: the salary split evenly over worked days.
    if (globalAmount != null) {
      for (const d of days) d.wageCost = d.adminCost = globalAmount / days.length;
    } else if (!days.some((d) => d.entries.length)) {
      // No per-role hours at all: monthly hours × wage from payroll_data, spread by daily hours.
      let monthly = 0;
      for (const [role, v] of Object.entries(w.payroll_data || {})) {
        const [h100 = 0, h125 = 0, h150 = 0] = (v && v.hours) || [];
        const tip = Number(v && v.tip) || 0;
        const completion = Number(v && v.completion) || 0;
        const rate = hourlyRate(emp, role);
        monthly += tip || completion ? tip + completion : rate == null ? 0 : weighted({ h100, h125, h150 }) * rate;
      }
      allocate(monthly, days).forEach((v, i) => (days[i].wageCost = days[i].adminCost = v));
    }

    // Payslip gross: the saved tlush, spread over the days by weighted hours.
    const tlush = parseJson(r.tlush, null);
    const pay = tlush ? tlushPay(tlush) : null;
    const share = {};
    if (pay) for (const k of Object.keys(pay)) share[k] = allocate(pay[k], days);

    days.forEach((d, i) => {
      if (d.date < from || d.date > to) return;
      const gross = pay
        ? {
            source: "tlush",
            wages: share.wages[i],
            travel: share.travel[i],
            bonus: share.bonus[i],
            total: share.wages[i] + share.travel[i] + share.bonus[i],
            netWages: share.netWages[i],
            meals: share.meals[i],
          }
        : { source: "estimate", wages: d.wageCost, travel: 0, bonus: 0, total: d.wageCost, netWages: 0, meals: 0 };
      out.push({
        branch: r.rest,
        month: r.month,
        date: d.date,
        employeeId: r.employee_id,
        name: r.name,
        globalSalary: globalAmount != null,
        h100: d.h100,
        h125: d.h125,
        h150: d.h150,
        tip: d.tip,
        completion: d.completion,
        unpricedHours: d.unpricedHours,
        wageCost: d.wageCost,
        adminCost: d.adminCost,
        gross,
        payrollUpdatedAt: r.updated_at,
      });
    });
  }
  return out;
}

const hoursOut = (x) => ({
  h100: round2(x.h100),
  h125: round2(x.h125),
  h150: round2(x.h150),
  total: round2(x.h100 + x.h125 + x.h150),
});
const grossOut = (g) => ({
  total: round2(g.total),
  wages: round2(g.wages),
  travel: round2(g.travel),
  bonus: round2(g.bonus),
  netWages: round2(g.netWages),
  meals: round2(g.meals),
});
const pctOf = (cost, revenue) =>
  cost != null && revenue > 0 ? Math.round((cost / revenue) * 10000) / 100 : null;

const Router = () => {
  const router = express.Router();
  router.use(localOnly);

  // Wrap a handler returning { data, meta } into the standard JSON envelope.
  const get = (path, handler) =>
    router.get(path, async (req, res) => {
      try {
        const { data, meta = {} } = await handler(req);
        res.json({
          data,
          meta: { ...meta, count: Array.isArray(data) ? data.length : undefined },
        });
      } catch (err) {
        if (err instanceof ApiError)
          return res
            .status(err.status)
            .json({ error: { code: err.code, message: err.message } });
        const table = missingTable(err);
        if (table) {
          const sql = TABLE_MIGRATIONS[table];
          return res.status(503).json({
            error: {
              code: "not_loaded",
              message: `table ${table} does not exist yet${sql ? ` (create it with ${sql})` : ""}`,
            },
          });
        }
        // Beecomm (axios) failures carry an upstream response
        if (err.response || err.isAxiosError) {
          console.error(`local-api ${req.path} upstream error:`, err.response?.data || err.message);
          return res.status(502).json({
            error: { code: "upstream_error", message: `beecomm: ${err.message}` },
          });
        }
        console.error(`local-api ${req.path} error:`, err);
        res
          .status(500)
          .json({ error: { code: "internal_error", message: err.message } });
      }
    });

  get("/", async () => ({ data: ENDPOINTS, meta: { version: "v1" } }));

  get("/health", async () => {
    await executeSql("SELECT 1", {});
    return { data: { status: "ok", db: "ok", time: new Date().toISOString() } };
  });

  get("/branches", async () => ({ data: await loadBranches() }));

  // ── status / data freshness ──

  // Per branch: what is loaded and how recent it is. A source whose table is
  // not created yet is reported as { available: false } instead of failing.
  get("/status", async (req) => {
    const branchIds = await optionalBranches(req);
    const branches = (await loadBranches()).filter(
      (b) => !branchIds.length || branchIds.includes(b.id),
    );
    const ids = branches.map((b) => b.id);

    // Run one grouped query; a missing table becomes a per-source note.
    const notes = {};
    const grouped = async (source, sql) => {
      const params = {};
      try {
        const [rows] = await executeSql(sql(inBranches.bind(null), params), params);
        return rows;
      } catch (err) {
        const table = missingTable(err);
        if (!table) throw err;
        notes[source] = { available: false, reason: `table ${table} does not exist yet` };
        return [];
      }
    };
    const byBranch = (rows, key = "branch") => {
      const m = new Map();
      for (const r of rows) {
        if (!m.has(r[key])) m.set(r[key], []);
        m.get(r[key]).push(r);
      }
      return m;
    };

    const [cash, z, orders, items, payments, tabit, uploads, payroll, emps] = (
      await Promise.all([
        grouped("beecommDaily", (f, p) =>
          `SELECT branchId AS branch, DATE_FORMAT(MAX(ts), '%Y-%m-%d') AS lastDate, COUNT(*) AS days
             FROM bcom_cash WHERE 1 = 1 ${f("branchId", ids, p)} GROUP BY branchId`),
        grouped("beecommZReports", (f, p) =>
          `SELECT branchId AS branch, DATE_FORMAT(MAX(business_date), '%Y-%m-%d') AS lastDate,
                  MAX(updated_at) AS lastLoadAt, COUNT(*) AS rowsCount
             FROM bcom_z_reports WHERE 1 = 1 ${f("branchId", ids, p)} GROUP BY branchId`),
        grouped("beecommOrders", (f, p) =>
          `SELECT branchId AS branch, DATE_FORMAT(MIN(business_date), '%Y-%m-%d') AS firstDate,
                  DATE_FORMAT(MAX(business_date), '%Y-%m-%d') AS lastDate,
                  MAX(updated_at) AS lastLoadAt, COUNT(*) AS rowsCount
             FROM bcom_orders WHERE 1 = 1 ${f("branchId", ids, p)} GROUP BY branchId`),
        grouped("beecommItems", (f, p) =>
          `SELECT branchId AS branch, DATE_FORMAT(MIN(business_date), '%Y-%m-%d') AS firstDate,
                  DATE_FORMAT(MAX(business_date), '%Y-%m-%d') AS lastDate,
                  MAX(updated_at) AS lastLoadAt, COUNT(*) AS rowsCount
             FROM bcom_items_daily WHERE 1 = 1 ${f("branchId", ids, p)} GROUP BY branchId`),
        grouped("beecommPayments", (f, p) =>
          `SELECT branchId AS branch, DATE_FORMAT(MIN(business_date), '%Y-%m-%d') AS firstDate,
                  DATE_FORMAT(MAX(business_date), '%Y-%m-%d') AS lastDate,
                  MAX(updated_at) AS lastLoadAt, COUNT(*) AS rowsCount
             FROM bcom_payments_daily WHERE 1 = 1 ${f("branchId", ids, p)} GROUP BY branchId`),
        grouped("tabitShifts", (f, p) =>
          `SELECT rest AS branch, month, COUNT(*) AS shifts, COUNT(DISTINCT employee_name) AS employees,
                  SUM(clock_in IS NOT NULL AND clock_out IS NULL) AS missingClockOut,
                  MAX(created_at) AS lastUploadAt
             FROM tabit_shifts WHERE 1 = 1 ${f("rest", ids, p)} GROUP BY rest, month ORDER BY month DESC`),
        grouped("uploads", (f, p) =>
          `SELECT rest AS branch, kind, MAX(created_at) AS lastUploadAt, COUNT(*) AS files
             FROM file_uploads WHERE status <> 'FAILED' ${f("rest", ids, p)} GROUP BY rest, kind`),
        grouped("payroll", (f, p) =>
          `SELECT rest AS branch, month, COUNT(*) AS employees, SUM(tlush IS NOT NULL) AS withTlush,
                  MAX(updated_at) AS updatedAt
             FROM payroll WHERE 1 = 1 ${f("rest", ids, p)} GROUP BY rest, month ORDER BY month DESC`),
        grouped("employees", (f, p) =>
          `SELECT rest AS branch, SUM(active = 1) AS active, COUNT(*) AS total, MAX(updated_at) AS lastUpdatedAt
             FROM employees WHERE duplicate IS NULL ${f("rest", ids, p)} GROUP BY rest`),
      ])
    ).map((rows) => byBranch(rows));

    const first = (m, id) => (m.get(id) || [])[0] || null;
    const data = branches.map((b) => {
      const c = first(cash, b.id);
      const zz = first(z, b.id);
      const o = first(orders, b.id);
      const it = first(items, b.id);
      const pay = first(payments, b.id);
      const e = first(emps, b.id);
      return {
        branch: b.id,
        name: b.name,
        beecomm: {
          daily: c && { lastDate: c.lastDate, days: Number(c.days) },
          zReports: zz && { lastDate: zz.lastDate, lastLoadAt: zz.lastLoadAt, rows: Number(zz.rowsCount) },
          orders: o && { firstDate: o.firstDate, lastDate: o.lastDate, lastLoadAt: o.lastLoadAt, rows: Number(o.rowsCount) },
          items: it && { firstDate: it.firstDate, lastDate: it.lastDate, lastLoadAt: it.lastLoadAt, rows: Number(it.rowsCount) },
          payments: pay && { firstDate: pay.firstDate, lastDate: pay.lastDate, lastLoadAt: pay.lastLoadAt, rows: Number(pay.rowsCount) },
        },
        tabitShifts: (tabit.get(b.id) || []).map((t) => ({
          month: t.month,
          shifts: Number(t.shifts),
          employees: Number(t.employees),
          missingClockOut: Number(t.missingClockOut),
          lastUploadAt: t.lastUploadAt,
        })),
        uploads: (uploads.get(b.id) || []).map((u) => ({
          kind: u.kind,
          files: Number(u.files),
          lastUploadAt: u.lastUploadAt,
        })),
        payrollMonths: (payroll.get(b.id) || []).map((p) => ({
          month: p.month,
          employees: Number(p.employees),
          withTlush: Number(p.withTlush),
          updatedAt: p.updatedAt,
        })),
        employees: e && { active: Number(e.active), total: Number(e.total), lastUpdatedAt: e.lastUpdatedAt },
      };
    });
    // bank accounts are per company, not per branch: one line per account
    const bankRows = await grouped("bank", () =>
      `SELECT bank, account, DATE_FORMAT(MIN(tx_date), '%Y-%m-%d') AS firstDate, DATE_FORMAT(MAX(tx_date), '%Y-%m-%d') AS lastDate,
              MAX(created_at) AS lastLoadAt, COUNT(*) AS rowsCount
         FROM bank_transactions GROUP BY bank, account`);
    const bank = bankRows.map((r) => ({
      company: bankCompany(r.account),
      bank: r.bank,
      account: r.account,
      firstDate: r.firstDate,
      lastDate: r.lastDate,
      lastLoadAt: r.lastLoadAt,
      rows: Number(r.rowsCount),
    }));
    return { data, meta: { branches: branchesMeta(branchIds), asOf: new Date().toISOString(), sources: notes, bank } };
  });

  // ── employees ──

  get("/employees", async (req) => {
    const branchIds = await optionalBranches(req);
    const active = String(req.query.active ?? "1");
    if (!["1", "0", "all"].includes(active))
      throw badRequest("active must be 1, 0 or all");
    const updatedSince = optionalUpdatedSince(req);
    const asOf = new Date().toISOString();
    const params = { active: Number(active), updatedSince };
    const [rows] = await executeSql(
      `SELECT ${EMPLOYEE_COLUMNS} FROM employees
        WHERE 1 = 1
          ${inBranches("rest", branchIds, params)}
          ${active === "all" ? "" : "AND active = :active AND duplicate IS NULL"}
          ${updatedSince ? "AND updated_at >= :updatedSince" : ""}
        ORDER BY rest, name`,
      params,
    );
    return {
      data: rows.map(toEmployee),
      meta: { branches: branchesMeta(branchIds), active, updatedSince, asOf },
    };
  });

  get("/employees/:employeeId", async (req) => {
    const id = Number(req.params.employeeId);
    if (!Number.isInteger(id) || id <= 0)
      throw badRequest("employeeId must be a positive integer");
    const [rows] = await executeSql(
      `SELECT ${EMPLOYEE_COLUMNS} FROM employees WHERE employee_id = :id`,
      { id },
    );
    if (!rows.length) throw new ApiError(404, "not_found", `employee ${id} not found`);
    return { data: toEmployee(rows[0]) };
  });

  // ── shifts ──

  // One row per employee per worked day per role, from the saved payroll.
  get("/shifts", async (req) => {
    const branchIds = await optionalBranches(req);
    const f = payrollFilter(req);
    const asOf = new Date().toISOString();
    const rows = await loadPayrollRows(branchIds, f);
    const data = [];
    for (const r of rows) {
      const w = r.wrapped;
      const notesByDate = {};
      for (const n of Array.isArray(w.notes) ? w.notes : []) {
        if (n && n.date) (notesByDate[n.date] ||= []).push(n.note);
      }
      const breakdown = w.daily_breakdown || {};
      for (const date of Object.keys(breakdown).sort()) {
        for (const s of breakdown[date] || []) {
          const h100 = Number(s.h100) || 0;
          const h125 = Number(s.h125) || 0;
          const h150 = Number(s.h150) || 0;
          data.push({
            branch: r.rest,
            month: r.month,
            date,
            employeeId: r.employee_id,
            name: r.name,
            role: s.role,
            hours: {
              h100: round2(h100),
              h125: round2(h125),
              h150: round2(h150),
              total: round2(h100 + h125 + h150),
            },
            tip: round2(s.tip),
            completion: round2(s.completion),
            notes: notesByDate[date] || [],
          });
        }
      }
    }
    data.sort(
      (a, b) =>
        a.branch.localeCompare(b.branch) ||
        a.date.localeCompare(b.date) ||
        String(a.name).localeCompare(String(b.name)),
    );
    return { data, meta: { ...payrollMeta(branchIds, f, asOf), employees: rows.length } };
  });

  // Monthly totals per employee and role.
  get("/shifts/summary", async (req) => {
    const branchIds = await optionalBranches(req);
    const f = payrollFilter(req);
    const asOf = new Date().toISOString();
    const rows = await loadPayrollRows(branchIds, f);
    const data = rows.map((r) => {
      const w = r.wrapped;
      const roles = Object.entries(w.payroll_data || {}).map(([role, v]) => {
        const [h100 = 0, h125 = 0, h150 = 0] = (v && v.hours) || [];
        return {
          role,
          hours: {
            h100: round2(h100),
            h125: round2(h125),
            h150: round2(h150),
            total: round2(Number(h100) + Number(h125) + Number(h150)),
          },
          tip: round2(v && v.tip),
          completion: round2(v && v.completion),
        };
      });
      return {
        branch: r.rest,
        month: r.month,
        employeeId: r.employee_id,
        name: r.name,
        workdays: w.workdays ?? null,
        workDates: Array.isArray(w.work_dates) ? w.work_dates : [],
        totalHours: round2(roles.reduce((s, x) => s + x.hours.total, 0)),
        roles,
        updatedAt: r.updated_at,
      };
    });
    return { data, meta: payrollMeta(branchIds, f, asOf) };
  });

  // Raw clock-in/out pairs from the uploaded Tabit detailed report.
  get("/shifts/raw", async (req) => {
    const branchIds = await optionalBranches(req);
    const range = optionalDateRange(req, MAX_STORED_DAYS);
    const updatedSince = optionalUpdatedSince(req);
    const employeeId = optionalEmployeeId(req);
    if (!range && !updatedSince)
      throw badRequest("from/to (YYYY-MM-DD) or updatedSince is required");
    const asOf = new Date().toISOString();
    const params = { ...(range || {}), updatedSince };
    const [rows] = await executeSql(
      `SELECT id, rest, month, employee_name, clock_id, ${dayCol("work_date", "work_date")}, block_no, role,
              ${localCol("clock_in", "clock_in")}, ${localCol("clock_out", "clock_out")}, note, upload_id, created_at
         FROM tabit_shifts
        WHERE 1 = 1
          ${inBranches("rest", branchIds, params)}
          ${range ? "AND work_date BETWEEN :from AND :to" : ""}
          ${updatedSince ? "AND created_at >= :updatedSince" : ""}
        ORDER BY rest, work_date, employee_name, block_no`,
      params,
    );
    const resolve = await employeeResolver(branchIds);
    let data = rows.map((r) => {
      const who = resolve(r.rest, r.employee_name, r.clock_id);
      return {
        id: r.id,
        branch: r.rest,
        month: r.month,
        date: r.work_date,
        block: r.block_no,
        employeeId: who.employeeId,
        matchedBy: who.matchedBy,
        employeeName: r.employee_name,
        clockId: r.clock_id,
        role: r.role,
        clockIn: r.clock_in,
        clockOut: r.clock_out,
        hours: hoursBetween(r.clock_in, r.clock_out),
        note: r.note,
        uploadId: r.upload_id,
        loadedAt: r.created_at,
      };
    });
    if (employeeId) data = data.filter((d) => d.employeeId === employeeId);
    return {
      data,
      meta: {
        branches: branchesMeta(branchIds),
        ...(range || {}),
        updatedSince,
        asOf,
        unmatched: data.filter((d) => !d.employeeId).length,
        missingClockOut: data.filter((d) => d.clockIn && !d.clockOut).length,
      },
    };
  });

  // People and clock hours per branch × date × shift × role, from the raw Tabit clock pairs.
  get("/shifts/by-shift", async (req) => {
    const branchIds = await optionalBranches(req);
    if (!req.query.to) throw badRequest("to must be YYYY-MM-DD");
    const { from, to } = requireDateRange(req, MAX_BY_SHIFT_DAYS);
    const split = String(req.query.split || "17:00").trim();
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(split)) throw badRequest("split must be HH:MM");
    const minHours = req.query.minHours == null || req.query.minHours === "" ? 1 : Number(req.query.minHours);
    if (!Number.isFinite(minHours) || minHours < 0)
      throw badRequest("minHours must be a number ≥ 0");
    const asOf = new Date().toISOString();
    const params = { from, to };
    const [rows] = await executeSql(
      `SELECT rest, employee_name, clock_id, ${dayCol("work_date", "work_date")}, role,
              ${localCol("clock_in", "clock_in")}, ${localCol("clock_out", "clock_out")}
         FROM tabit_shifts
        WHERE work_date BETWEEN :from AND :to ${inBranches("rest", branchIds, params)}`,
      params,
    );
    const resolve = await employeeResolver(branchIds);
    const { data, missingClockOut, unmatched } = shiftsByShift(rows, resolve, { split, minHours });
    return {
      data,
      meta: { branches: branchesMeta(branchIds), from, to, split, minHours, asOf, missingClockOut, unmatched },
    };
  });

  // ── payroll / salaries ──

  get("/payroll/months", async (req) => {
    const branch = await requireBranch(req);
    const [rows] = await executeSql(
      `SELECT month, COUNT(*) AS employees, SUM(tlush IS NOT NULL) AS withTlush,
              MAX(updated_at) AS updatedAt
         FROM payroll WHERE rest = :branch
        GROUP BY month ORDER BY month DESC`,
      { branch },
    );
    return {
      data: rows.map((r) => ({
        month: r.month,
        employees: Number(r.employees),
        withTlush: Number(r.withTlush),
        updatedAt: r.updatedAt,
      })),
      meta: { branch },
    };
  });

  // Saved payroll per employee: work summary + the tlush (payslip components
  // as exported to the payroll software). tlush is null until the month is
  // saved+exported, or when the employee was not exportable.
  get("/payroll", async (req) => {
    const branchIds = await optionalBranches(req);
    const f = payrollFilter(req);
    const asOf = new Date().toISOString();
    const rows = await loadPayrollRows(branchIds, f);
    const data = rows.map((r) => {
      const w = r.wrapped;
      const t = parseJson(r.tlush, null);
      return {
        branch: r.rest,
        month: r.month,
        employeeId: r.employee_id,
        name: r.name,
        idNumber: r.ID_nmbr,
        workdays: w.workdays ?? null,
        isGlobal: w.global ?? null,
        netGross: w.netGross ?? null,
        inAdvance: w.in_advance ?? null,
        roleExtras: w.role_extras || {},
        tlush: t && {
          payrollSoft: t.payrollSoft,
          employeeNumber: t.employeeNumber ?? null,
          components: t.components || [],
          hourlyMinGross: t.hourlyMinGross || 0,
          mixedRates: !!t.mixedRates,
          excludedRateGroups: t.excludedRateGroups || [],
        },
        updatedAt: r.updated_at,
      };
    });
    return { data, meta: payrollMeta(branchIds, f, asOf) };
  });

  // Daily revenue vs. labor cost (labor_cost is entered from the payroll screen).
  get("/payroll/labor-cost", async (req) => {
    const branch = await requireBranch(req);
    const month = requireMonth(req);
    const [y, m] = month.split("-").map(Number);
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    const [rows] = await executeSql(
      `SELECT DATE(ts) AS date, SUM(COALESCE(total, 0)) AS total, MAX(labor_cost) AS labor_cost
         FROM bcom_cash
        WHERE branchId = :branch AND ts >= :start AND ts < :next
        GROUP BY DATE(ts) ORDER BY DATE(ts)`,
      { branch, start: `${month}-01`, next },
    );
    const pct = (cost, total) =>
      cost != null && total > 0 ? Math.round((cost / total) * 10000) / 100 : null;
    const data = rows.map((r) => {
      const total = Number(r.total) || 0;
      const laborCost = r.labor_cost == null ? null : Number(r.labor_cost);
      return { date: isoDay(r.date), revenue: total, laborCost, laborPct: pct(laborCost, total) };
    });
    const revenue = data.reduce((s, d) => s + d.revenue, 0);
    const laborCost = data.reduce((s, d) => s + (d.laborCost || 0), 0);
    return {
      data,
      meta: { branch, month, totals: { revenue: round2(revenue), laborCost: round2(laborCost), laborPct: pct(laborCost, revenue) } },
    };
  });

  // ── daily labor cost ──

  // Per branch per day: revenue, hours and labor cost, three ways:
  //   gross       payslip gross from the saved tlush (spread by weighted hours); hours × current
  //               wage for months without a tlush (counted in coverage.estimated)
  //   adminCost   the admin Shifts page's formula (tip + completion, else hours × wage)
  //   storedCost  bcom_cash.labor_cost, the adminCost saved when the month was extracted
  get("/labor/daily", async (req) => {
    const branchIds = await optionalBranches(req);
    const { from, to } = requireDateRange(req, MAX_STORED_DAYS);
    const rows = await laborDays(branchIds, from, to);
    const params = { from, to };
    const [cash] = await executeSql(
      `SELECT branchId, DATE_FORMAT(ts, '%Y-%m-%d') AS date, SUM(COALESCE(total, 0)) AS revenue,
              MAX(labor_cost) AS labor_cost
         FROM bcom_cash
        WHERE DATE(ts) BETWEEN :from AND :to AND branchId <> '900' ${inBranches("branchId", branchIds, params)}
        GROUP BY branchId, DATE_FORMAT(ts, '%Y-%m-%d')`,
      params,
    );
    const days = new Map();
    const day = (branch, date) => {
      const key = `${branch}|${date}`;
      if (!days.has(key))
        days.set(key, {
          branch, date, revenue: null, storedCost: null,
          h100: 0, h125: 0, h150: 0, tip: 0, completion: 0, wageCost: 0, adminCost: 0, unpricedHours: 0,
          gross: { total: 0, wages: 0, travel: 0, bonus: 0, netWages: 0, meals: 0 },
          employees: 0, estimated: 0, globalSalary: 0,
        });
      return days.get(key);
    };
    for (const c of cash) {
      const d = day(c.branchId, c.date);
      d.revenue = Number(c.revenue) || 0;
      d.storedCost = c.labor_cost == null ? null : Number(c.labor_cost);
    }
    for (const r of rows) {
      const d = day(r.branch, r.date);
      for (const k of ["h100", "h125", "h150", "tip", "completion", "wageCost", "adminCost", "unpricedHours"]) d[k] += r[k];
      for (const k of Object.keys(d.gross)) d.gross[k] += r.gross[k];
      d.employees += 1;
      if (r.gross.source === "estimate") d.estimated += 1;
      if (r.globalSalary) d.globalSalary += 1;
    }
    const data = [...days.values()]
      .sort((a, b) => a.branch.localeCompare(b.branch) || a.date.localeCompare(b.date))
      .map((d) => ({
        branch: d.branch,
        date: d.date,
        revenue: d.revenue == null ? null : round2(d.revenue),
        hours: hoursOut(d),
        gross: grossOut(d.gross),
        wageCost: round2(d.wageCost),
        tip: round2(d.tip),
        completion: round2(d.completion),
        adminCost: round2(d.adminCost),
        storedCost: d.storedCost == null ? null : round2(d.storedCost),
        // No payroll rows for the day (payroll not managed in the admin, or not saved yet): no %.
        laborPct: d.employees
          ? {
              gross: pctOf(d.gross.total, d.revenue),
              adminCost: pctOf(d.adminCost, d.revenue),
              storedCost: pctOf(d.storedCost, d.revenue),
            }
          : null,
        coverage: {
          employees: d.employees,
          estimated: d.estimated,
          globalSalary: d.globalSalary,
          unpricedHours: round2(d.unpricedHours),
        },
      }));
    // Totals over the days with payroll only, so branches without payroll in the admin don't
    // dilute the percentages.
    const covered = data.filter((d) => d.coverage.employees > 0);
    const sum = (f) => covered.reduce((s, d) => s + (f(d) || 0), 0);
    const revenue = sum((d) => d.revenue);
    const totals = {
      revenue: round2(revenue),
      gross: round2(sum((d) => d.gross.total)),
      adminCost: round2(sum((d) => d.adminCost)),
      storedCost: round2(sum((d) => d.storedCost)),
      days: covered.length,
      daysWithoutRevenue: covered.filter((d) => d.revenue == null).length,
    };
    totals.laborPct = {
      gross: pctOf(totals.gross, revenue),
      adminCost: pctOf(totals.adminCost, revenue),
      storedCost: pctOf(totals.storedCost, revenue),
    };
    return { data, meta: { from, to, branches: branchesMeta(branchIds), minHourlyWage: MIN_HOURLY_WAGE, totals } };
  });

  // The same, one row per employee per worked day, to see what a day's cost is made of.
  get("/labor/daily/employees", async (req) => {
    const branchIds = await optionalBranches(req);
    const { from, to } = requireDateRange(req, MAX_STORED_DAYS);
    const employeeId = optionalEmployeeId(req);
    const rows = await laborDays(branchIds, from, to, employeeId);
    const data = rows
      .sort((a, b) => a.branch.localeCompare(b.branch) || a.date.localeCompare(b.date) || String(a.name).localeCompare(String(b.name)))
      .map((r) => ({
        branch: r.branch,
        month: r.month,
        date: r.date,
        employeeId: r.employeeId,
        name: r.name,
        globalSalary: r.globalSalary,
        hours: hoursOut(r),
        gross: { source: r.gross.source, ...grossOut(r.gross) },
        wageCost: round2(r.wageCost),
        tip: round2(r.tip),
        completion: round2(r.completion),
        adminCost: round2(r.adminCost),
        unpricedHours: round2(r.unpricedHours),
        payrollUpdatedAt: r.payrollUpdatedAt,
      }));
    return { data, meta: { from, to, branches: branchesMeta(branchIds), employeeId, minHourlyWage: MIN_HOURLY_WAGE } };
  });

  // ── beecomm ──

  // Daily totals already loaded into the DB by the 6:00 analoader job.
  get("/beecomm/daily", async (req) => {
    const branchIds = await optionalBranches(req);
    const { from, to } = requireDateRange(req);
    const params = { from, to };
    const branchFilter = branchIds.length
      ? inBranches("branchId", branchIds, params)
      : "AND branchId <> '900'";
    const [rows] = await executeSql(
      `SELECT branchId, DATE(ts) AS date, total, service, discount, diners, labor_cost
         FROM bcom_cash
        WHERE DATE(ts) BETWEEN :from AND :to ${branchFilter}
        ORDER BY ts, branchId`,
      params,
    );
    return {
      data: rows.map((r) => ({
        branch: r.branchId,
        date: isoDay(r.date),
        total: r.total,
        service: r.service,
        discount: r.discount,
        diners: r.diners,
        laborCost: r.labor_cost,
      })),
      meta: { from, to, branches: branchesMeta(branchIds) },
    };
  });

  get("/beecomm/z-reports", async (req) => {
    const branchIds = await optionalBranches(req);
    const range = requireDateRange(req, MAX_BEECOMM_DAYS);
    const data = await bcomGetZReports(toBcomDates(range), { branchIds });
    return { data, meta: { ...range, branches: branchesMeta(branchIds), source: "beecomm-live" } };
  });

  // Z reports saved daily by the loader (bcom_z_reports), by business day.
  get("/beecomm/z-reports/stored", async (req) => {
    const branchIds = await optionalBranches(req);
    const { from, to } = requireDateRange(req, MAX_STORED_DAYS);
    const params = { from, to };
    const [rows] = await executeSql(
      `SELECT z_id, restaurantId, branchId, z_no, ${dayCol("business_date", "business_date")},
              ${localCol("opened_at", "opened_at")}, ${localCol("closed_at", "closed_at")},
              net_income, vat, service, total_income, bruto_income, discounts, refunds, item_cancels,
              cancelled_orders, cancelled_items, diners, cancelled_diners, orders, payments_json, updated_at
         FROM bcom_z_reports
        WHERE business_date BETWEEN :from AND :to ${inBranches("branchId", branchIds, params)}
        ORDER BY business_date, branchId`,
      params,
    );
    return {
      data: rows.map((r) => ({
        zId: r.z_id,
        restaurantId: r.restaurantId,
        branch: r.branchId,
        zNumber: r.z_no,
        businessDate: r.business_date,
        openedAt: r.opened_at,
        closedAt: r.closed_at,
        netIncome: r.net_income,
        vat: r.vat,
        service: r.service,
        totalIncome: r.total_income,
        brutoIncome: r.bruto_income,
        discounts: r.discounts,
        refunds: r.refunds,
        itemCancels: r.item_cancels,
        cancelledOrders: r.cancelled_orders,
        cancelledItems: r.cancelled_items,
        diners: r.diners,
        cancelledDiners: r.cancelled_diners,
        orders: r.orders,
        payments: parseJson(r.payments_json, []),
        loadedAt: r.updated_at,
      })),
      meta: { from, to, branches: branchesMeta(branchIds), source: "db" },
    };
  });

  get("/beecomm/orders", async (req) => {
    const branchIds = await optionalBranches(req);
    const range = requireDateRange(req, MAX_BEECOMM_DAYS);
    const withExceptions = ["1", "true"].includes(String(req.query.exceptions || ""));
    const fetch = withExceptions ? bcomGetOrdersWithExceptions : bcomGetOrders;
    const data = await fetch(toBcomDates(range), { branchIds });
    return {
      data,
      meta: { ...range, branches: branchesMeta(branchIds), exceptions: withExceptions, source: "beecomm-live" },
    };
  });

  // Order headers saved daily by the loader (bcom_orders), by business day.
  get("/beecomm/orders/stored", async (req) => {
    const branchIds = await optionalBranches(req);
    const { from, to } = requireDateRange(req, MAX_STORED_DAYS);
    const params = { from, to };
    const [rows] = await executeSql(
      `SELECT order_id, restaurantId, branchId, order_no, daily_no, ${dayCol("business_date", "business_date")}, z_id,
              ${localCol("opened_at", "opened_at")}, ${localCol("closed_at", "closed_at")}, order_type, status, table_no,
              diners, total, net_total, discount_rate, discount_amount, service_rate, service_amount, total_items,
              total_canceled, exceptions_count, source, external_order_id, creator, updated_at
         FROM bcom_orders
        WHERE business_date BETWEEN :from AND :to ${inBranches("branchId", branchIds, params)}
        ORDER BY business_date, branchId, order_no`,
      params,
    );
    return {
      data: rows.map((r) => ({
        orderId: r.order_id,
        restaurantId: r.restaurantId,
        branch: r.branchId,
        orderNumber: r.order_no,
        dailyNumber: r.daily_no,
        businessDate: r.business_date,
        zId: r.z_id,
        openedAt: r.opened_at,
        closedAt: r.closed_at,
        orderType: r.order_type,
        status: r.status,
        tableNumber: r.table_no,
        diners: r.diners,
        total: r.total,
        netTotal: r.net_total,
        discountRate: r.discount_rate,
        discountAmount: r.discount_amount,
        serviceRate: r.service_rate,
        serviceAmount: r.service_amount,
        totalItems: r.total_items,
        totalCanceled: r.total_canceled,
        exceptionsCount: r.exceptions_count,
        source: r.source,
        externalOrderId: r.external_order_id,
        creator: r.creator,
        loadedAt: r.updated_at,
      })),
      meta: { from, to, branches: branchesMeta(branchIds), source: "db" },
    };
  });

  get("/beecomm/exceptions", async (req) => {
    const branchIds = await optionalBranches(req);
    const range = requireDateRange(req, MAX_BEECOMM_DAYS);
    const data = await bcomGetExceptions(toBcomDates(range), { branchIds });
    return { data, meta: { ...range, branches: branchesMeta(branchIds), source: "beecomm-live" } };
  });

  // Exceptions per branch per business day (one Z), counted and summed by action.
  get("/beecomm/exceptions/summary", async (req) => {
    const branchIds = await optionalBranches(req);
    const range = requireDateRange(req, MAX_BEECOMM_DAYS);
    const rows = await bcomGetExceptions(toBcomDates(range), { branchIds });
    const israelDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" });
    const groups = new Map();
    for (const e of rows) {
      const key = `${e.branchId}|${e.zNumber}`;
      if (!groups.has(key))
        groups.set(key, { branch: e.branchId, branchName: e.branchName, zNumber: e.zNumber, date: null, actions: {}, total: { count: 0, amount: 0 } });
      const g = groups.get(key);
      const day = e.eventTimeStamp ? israelDay.format(new Date(e.eventTimeStamp)) : null;
      if (day && (!g.date || day < g.date)) g.date = day;
      const a = (g.actions[e.action] ||= { count: 0, amount: 0 });
      a.count += 1;
      a.amount = round2(a.amount + (Number(e.amount) || 0));
      g.total.count += 1;
      g.total.amount = round2(g.total.amount + (Number(e.amount) || 0));
    }
    const data = [...groups.values()].sort(
      (a, b) => String(a.date).localeCompare(String(b.date)) || a.branch.localeCompare(b.branch),
    );
    return { data, meta: { ...range, branches: branchesMeta(branchIds), source: "beecomm-live" } };
  });

  // Dish sales (no per-order lines: Beecomm only reports dish totals). Summed over the range per
  // branch + dish; hours=1 splits by hour, byDay=1 makes one call per business day and adds businessDate.
  get("/beecomm/items", async (req) => {
    const branchIds = await optionalBranches(req);
    const flag = (k) => ["1", "true"].includes(String(req.query[k] || ""));
    const byDay = flag("byDay");
    const splitHours = flag("hours");
    const range = requireDateRange(req, byDay ? MAX_ITEMS_DAYS_BY_DAY : MAX_BEECOMM_DAYS);
    const fetch = byDay ? bcomGetItemsByDay : bcomGetItems;
    const data = await fetch(toBcomDates(range), { branchIds, splitHours });
    return { data, meta: { ...range, branches: branchesMeta(branchIds), byDay, hours: splitHours, source: "beecomm-live" } };
  });

  // Dish sales saved daily by the loader (bcom_items_daily). group=day (default): one row per
  // branch + business day + dish. group=dish: summed over the range per branch + dish, with the
  // first/last day sold and the average price (a "sold menu").
  get("/beecomm/items/stored", async (req) => {
    const branchIds = await optionalBranches(req);
    const { from, to } = requireDateRange(req, MAX_STORED_DAYS);
    const group = String(req.query.group || "day");
    if (!["day", "dish"].includes(group)) throw badRequest("group must be day or dish");
    const params = { from, to };
    const where = `WHERE business_date BETWEEN :from AND :to ${inBranches("branchId", branchIds, params)}`;
    const amount = (r) => ({
      quantity: r.quantity,
      totalSales: r.total_sales,
      soldInCombo: r.sold_in_combo,
      cancelsCount: r.cancels_count,
      cancelsSum: r.cancels_sum,
      orderDiscountSum: r.order_discount_sum,
      discountSum: r.discount_sum,
      memberBenefits: r.member_benefits,
    });
    const dish = (r) => ({
      branch: r.branchId,
      dishId: r.dish_id,
      dishName: r.dish_name,
      isCombo: !!r.is_combo,
      category0: r.category0,
      category1: r.category1,
      category2: r.category2,
    });
    if (group === "dish") {
      const [rows] = await executeSql(
        `SELECT branchId, dish_id, MAX(dish_name) AS dish_name, MAX(is_combo) AS is_combo, MAX(category0) AS category0,
                MAX(category1) AS category1, MAX(category2) AS category2, COUNT(*) AS days,
                ${dayCol("MIN(business_date)", "first_sold")}, ${dayCol("MAX(business_date)", "last_sold")},
                SUM(quantity) AS quantity, SUM(total_sales) AS total_sales, SUM(sold_in_combo) AS sold_in_combo,
                SUM(cancels_count) AS cancels_count, SUM(cancels_sum) AS cancels_sum,
                SUM(order_discount_sum) AS order_discount_sum, SUM(discount_sum) AS discount_sum,
                SUM(member_benefits) AS member_benefits
           FROM bcom_items_daily ${where}
          GROUP BY branchId, dish_id
          ORDER BY branchId, total_sales DESC`,
        params,
      );
      return {
        data: rows.map((r) => ({
          ...dish(r),
          days: Number(r.days),
          firstSold: r.first_sold,
          lastSold: r.last_sold,
          ...amount(r),
          avgPrice: Number(r.quantity) ? round2(r.total_sales / r.quantity) : null,
        })),
        meta: { from, to, branches: branchesMeta(branchIds), group, source: "db" },
      };
    }
    const [rows] = await executeSql(
      `SELECT ${dayCol("business_date", "business_date")}, branchId, dish_id, dish_name, is_combo, category0, category1,
              category2, quantity, total_sales, sold_in_combo, cancels_count, cancels_sum, order_discount_sum,
              discount_sum, member_benefits, updated_at
         FROM bcom_items_daily ${where}
        ORDER BY business_date, branchId, total_sales DESC`,
      params,
    );
    return {
      data: rows.map((r) => ({ businessDate: r.business_date, ...dish(r), ...amount(r), loadedAt: r.updated_at })),
      meta: { from, to, branches: branchesMeta(branchIds), group, source: "db" },
    };
  });

  // The payments report (דוח תשלומים) saved daily by the loader (bcom_payments_daily). group=day (default):
  // the stored rows, one per branch + business day + payment type (cardBrand null = the type's total) and
  // its card brands. group=type: the type totals summed over the range per branch. group=brand: the card
  // brands summed over the range per branch + type.
  get("/beecomm/payments/stored", async (req) => {
    const branchIds = await optionalBranches(req);
    const { from, to } = requireDateRange(req, MAX_STORED_DAYS);
    const group = String(req.query.group || "day");
    if (!["day", "type", "brand"].includes(group)) throw badRequest("group must be day, type or brand");
    const params = { from, to };
    const where = `WHERE business_date BETWEEN :from AND :to ${inBranches("branchId", branchIds, params)}`;
    const amount = (r) => ({
      totalCharges: r.total_charges,
      totalRefunded: r.total_refunded,
      transactions: r.transactions == null ? null : Number(r.transactions),
      refundTransactions: r.refund_transactions == null ? null : Number(r.refund_transactions),
      hakafaReturns: r.hakafa_returns,
      service: r.service,
      serviceOnly: r.service_only,
      taxAmount: r.tax_amount,
      noTips: r.no_tips,
      noTipsNoTax: r.no_tips_no_tax,
    });
    const type = (r) => ({ branch: r.branchId, paymentType: Number(r.payment_type), paymentTypeName: r.payment_type_name, inZ: r.in_z == null ? null : !!r.in_z });
    if (group !== "day") {
      const [rows] = await executeSql(
        `SELECT branchId, payment_type, ${group === "brand" ? "card_brand," : ""} MAX(payment_type_name) AS payment_type_name,
                MAX(in_z) AS in_z, COUNT(*) AS days, SUM(total_charges) AS total_charges, SUM(total_refunded) AS total_refunded,
                SUM(transactions) AS transactions, SUM(refund_transactions) AS refund_transactions,
                SUM(hakafa_returns) AS hakafa_returns, SUM(service) AS service, SUM(service_only) AS service_only,
                SUM(tax_amount) AS tax_amount, SUM(no_tips) AS no_tips, SUM(no_tips_no_tax) AS no_tips_no_tax
           FROM bcom_payments_daily ${where} AND card_brand ${group === "brand" ? "<>" : "="} ''
          GROUP BY branchId, payment_type${group === "brand" ? ", card_brand" : ""}
          ORDER BY branchId, total_charges DESC`,
        params,
      );
      return {
        data: rows.map((r) => ({ ...type(r), ...(group === "brand" ? { cardBrand: r.card_brand } : {}), days: Number(r.days), ...amount(r) })),
        meta: { from, to, branches: branchesMeta(branchIds), group, source: "db" },
      };
    }
    const [rows] = await executeSql(
      `SELECT ${dayCol("business_date", "business_date")}, branchId, payment_type, card_brand, payment_type_name, in_z,
              total_charges, total_refunded, transactions, refund_transactions, hakafa_returns, service, service_only,
              tax_amount, no_tips, no_tips_no_tax, updated_at
         FROM bcom_payments_daily ${where}
        ORDER BY business_date, branchId, payment_type, card_brand`,
      params,
    );
    return {
      data: rows.map((r) => ({ businessDate: r.business_date, ...type(r), cardBrand: r.card_brand || null, ...amount(r), loadedAt: r.updated_at })),
      meta: { from, to, branches: branchesMeta(branchIds), group, source: "db" },
    };
  });

  // Bank transactions uploaded on the Upload files page (bank_transactions, today Bank Hapoalim "תנועות בחשבון").
  // company = the accounts of these companies (restaurants.json bank_accounts). q = text in the action or details;
  // side = credit (money in) or debit (money out). group=none (default): the rows, newest first; day: per account
  // and date the money in/out and the closing balance; action: per account and action; details: per account,
  // action and details. The bank file lists the newest row first, so a day's closing balance is the balance of
  // its first row (lowest id) in the latest upload that has that day.
  get("/bank/transactions/stored", async (req) => {
    const accounts = optionalBankAccounts(req);
    const { from, to } = requireDateRange(req, MAX_STORED_DAYS);
    const group = String(req.query.group || "none");
    if (!["none", "day", "action", "details"].includes(group)) throw badRequest("group must be none, day, action or details");
    const side = String(req.query.side || "");
    if (side && !["credit", "debit"].includes(side)) throw badRequest("side must be credit or debit");
    const meta = { from, to, companies: String(req.query.company || "") || "all", accounts: accounts == null ? [] : accounts.length ? accounts : "all", group, side: side || "all", source: "db" };
    if (accounts == null) return { data: [], meta };
    const params = { from, to };
    let where = `WHERE tx_date BETWEEN :from AND :to`;
    if (accounts.length) {
      accounts.forEach((a, i) => (params[`a${i}`] = a));
      where += ` AND account IN (${accounts.map((_, i) => `:a${i}`).join(",")})`;
    }
    const q = String(req.query.q || "").trim();
    if (q) {
      params.q = `%${q}%`;
      where += ` AND (action LIKE :q OR details LIKE :q)`;
    }
    if (side) where += side === "credit" ? ` AND credit IS NOT NULL` : ` AND debit IS NOT NULL`;
    const num = (v) => (v == null ? null : Number(v));
    if (group === "day") {
      const [rows] = await executeSql(
        `SELECT account, MAX(bank) AS bank, ${dayCol("tx_date", "tx_date")}, SUM(credit) AS credit, SUM(debit) AS debit,
                SUM(credit IS NOT NULL) AS credits, SUM(debit IS NOT NULL) AS debits,
                (SELECT b.balance FROM bank_transactions b WHERE b.account = t.account AND b.tx_date = t.tx_date
                  ORDER BY b.upload_id DESC, b.id ASC LIMIT 1) AS closing_balance
           FROM bank_transactions t ${where}
          GROUP BY account, tx_date ORDER BY account, tx_date`,
        params,
      );
      return {
        data: rows.map((r) => ({ company: bankCompany(r.account), bank: r.bank, account: r.account, date: r.tx_date, credit: num(r.credit), debit: num(r.debit), credits: Number(r.credits), debits: Number(r.debits), closingBalance: q || side ? null : num(r.closing_balance) })),
        meta,
      };
    }
    if (group !== "none") {
      const cols = group === "action" ? "action_code, action" : "action_code, action, details";
      const [rows] = await executeSql(
        `SELECT account, MAX(bank) AS bank, ${cols}, COUNT(*) AS n, SUM(credit) AS credit, SUM(debit) AS debit,
                ${dayCol("MIN(tx_date)", "first_date")}, ${dayCol("MAX(tx_date)", "last_date")}
           FROM bank_transactions ${where}
          GROUP BY account, ${cols} ORDER BY account, COALESCE(SUM(credit), 0) + COALESCE(SUM(debit), 0) DESC`,
        params,
      );
      return {
        data: rows.map((r) => ({ company: bankCompany(r.account), bank: r.bank, account: r.account, actionCode: r.action_code, action: r.action, ...(group === "details" ? { details: r.details } : {}), transactions: Number(r.n), credit: num(r.credit), debit: num(r.debit), firstDate: r.first_date, lastDate: r.last_date })),
        meta,
      };
    }
    const [rows] = await executeSql(
      `SELECT id, bank, account, ${dayCol("tx_date", "tx_date")}, action_code, action, details, reference, bundle, debit, credit, balance, note, created_at
         FROM bank_transactions ${where}
        ORDER BY tx_date DESC, upload_id DESC, id ASC`,
      params,
    );
    return {
      data: rows.map((r) => ({ id: r.id, company: bankCompany(r.account), bank: r.bank, account: r.account, date: r.tx_date, actionCode: r.action_code, action: r.action, details: r.details, reference: r.reference, bundle: r.bundle, debit: num(r.debit), credit: num(r.credit), balance: num(r.balance), note: r.note, loadedAt: r.created_at })),
      meta,
    };
  });

  router.use((req, res) =>
    res.status(404).json({
      error: { code: "not_found", message: `no endpoint ${req.method} ${req.path}` },
    }),
  );

  return router;
};

export { Router, employeeResolver, shiftsByShift };
