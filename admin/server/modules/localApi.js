import express from "express";
import { createRequire } from "module";
import { executeSql } from "../sources/dbpool.js";
import { normalizeRoles } from "../../../shared/wage.js";
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

const isIsoDate = (s) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

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
  "GET /payroll/months?branch=",
  "GET /payroll?month=YYYY-MM|updatedSince=[&branch=a,b][&employeeId=]",
  "GET /payroll/labor-cost?branch=&month=YYYY-MM",
  "GET /beecomm/daily?from=&to=[&branch=a,b]",
  "GET /beecomm/z-reports?from=&to=[&branch=a,b]",
  "GET /beecomm/z-reports/stored?from=&to=[&branch=a,b]",
  "GET /beecomm/orders?from=&to=[&branch=a,b][&exceptions=1]",
  "GET /beecomm/orders/stored?from=&to=[&branch=a,b]",
  "GET /beecomm/exceptions?from=&to=[&branch=a,b]",
  "GET /beecomm/exceptions/summary?from=&to=[&branch=a,b]",
  "GET /beecomm/items?from=&to=[&branch=a,b][&hours=1|&byDay=1]",
  "GET /beecomm/items/stored?from=&to=[&branch=a,b][&group=day|dish]",
];

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

    const [cash, z, orders, items, tabit, uploads, payroll, emps] = (
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
      const e = first(emps, b.id);
      return {
        branch: b.id,
        name: b.name,
        beecomm: {
          daily: c && { lastDate: c.lastDate, days: Number(c.days) },
          zReports: zz && { lastDate: zz.lastDate, lastLoadAt: zz.lastLoadAt, rows: Number(zz.rowsCount) },
          orders: o && { firstDate: o.firstDate, lastDate: o.lastDate, lastLoadAt: o.lastLoadAt, rows: Number(o.rowsCount) },
          items: it && { firstDate: it.firstDate, lastDate: it.lastDate, lastLoadAt: it.lastLoadAt, rows: Number(it.rowsCount) },
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
    return { data, meta: { branches: branchesMeta(branchIds), asOf: new Date().toISOString(), sources: notes } };
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

  router.use((req, res) =>
    res.status(404).json({
      error: { code: "not_found", message: `no endpoint ${req.method} ${req.path}` },
    }),
  );

  return router;
};

export { Router, employeeResolver };
