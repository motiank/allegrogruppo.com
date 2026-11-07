import express from "express";
import { createRequire } from "module";
import { financeSql } from "../sources/financePool.js";
import { executeSql } from "../sources/dbpool.js";
import { localOnly, ApiError, badRequest, isIsoDate, laborDays, loadBranches } from "./localApi.js";
import { buildBankReconReport, renderBankReconXlsx, listBankReportAccounts } from "./bankRecon.js";
import { renderBankReconHtml } from "../../../shared/bankReconHtml.js";
import { addChequePayees } from "./chequePayees.js";

// Finance API: read-only, localhost-only JSON API over allegro_finance (the Hashavshevet copy made by hash-sync),
// for Joya HQ. Mounted at /local-api/v1/finance by server.js; documented in finance_api_readme.md.
// Rules per company live in shared/finance_map.json (section 5 of the readme).

const require = createRequire(import.meta.url);
const RESTAURANTS = require("../../../shared/restaurants.json");
const FINANCE_MAP = require("../../../shared/finance_map.json");

const MAX_RANGE_DAYS = 800; // as the Local Data API
const MAX_MIXED_DAYS = 400; // /branch-costs and /sales-vs-books also read payroll and Tabit data per branch-month
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5000;
const CACHE_MS = 5 * 60 * 1000; // the data changes once a night
const STALE_SYNC_HOURS = 36;
const NO_CERTIFICATE_BEFORE = "2000-01-01"; // a deduction_valid_to before this is Hashavshevet's empty default
const EPS = 0.005;

const DEFAULT_RULES = {
  vatRate: 0.18,
  reportLines: { income: [700], purchases: [800], salaries: [720], general: [900] },
  balanceGroups: { cash: [100, 110, 130], customers: [200, 210], registerCustomers: [210], suppliers: [500], vat: [400],
    payrollAndTax: [410, 420, 450, 510], fixedAssets: [300], shareholders: [490] },
  groupLabels: {},
  foodCostAccounts: null,
  invoiceTypes: { supplier: ["ח18", "תצ", "ת23", "חק"], customer: ["ע"], customerCredit: ["חז"], withholdingPayment: ["0"] },
  vatAccounts: { sales: "400001", input: "400002", assets: "400003", settlement: "400004" },
  withholdingAccounts: ["410001"],
  branches: [],
  intercompany: [],
  allocationNumber: { thresholds: [] },
  validated: [],
};

// ── small helpers ────────────────────────────────────────────────────────

const num = (v) => (v == null || v === "" ? 0 : Number(v) || 0);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const pct = (part, whole) => (Math.abs(whole) < EPS ? null : round2((part / whole) * 100));
const day = (v) => (v == null ? null : String(v).slice(0, 10)); // dateStrings pool: 'YYYY-MM-DD HH:MM:SS.sss'
const monthOf = (d) => (d ? String(d).slice(0, 7) : null);
const parseJson = (v, fallback) => {
  if (v == null) return fallback;
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return fallback; }
};

// Today in Israel. FINANCE_TODAY=YYYY-MM-DD fixes it (tests).
export function today() {
  if (process.env.FINANCE_TODAY && isIsoDate(process.env.FINANCE_TODAY)) return process.env.FINANCE_TODAY;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
export const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const addMonths = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  const dayNo = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(dayNo, last));
  return d.toISOString().slice(0, 10);
};
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const monthStart = (m) => `${m}-01`;
const monthEnd = (m) => addDays(addMonths(`${m}-01`, 1), -1);
const monthsOf = (from, to) => {
  const out = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = addMonths(`${m}-01`, 1).slice(0, 7)) out.push(m);
  return out;
};

// `col IN (:p0, :p1, ...)` for execute(); an empty list gives a never-true clause.
function inList(column, values, params, prefix) {
  if (!values.length) return `${column} IN (NULL)`;
  values.forEach((v, i) => (params[`${prefix}${i}`] = v));
  return `${column} IN (${values.map((_, i) => `:${prefix}${i}`).join(",")})`;
}

const csv = (v) => String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

// ── parameters ───────────────────────────────────────────────────────────

function optionalDate(req, name, fallback = null) {
  const raw = String(req.query[name] ?? "").trim();
  if (!raw) return fallback;
  if (!isIsoDate(raw)) throw badRequest(`${name} must be YYYY-MM-DD`);
  return raw;
}

// from/to: inclusive; `to` defaults to today. required: `from` must be given.
function dateRange(req, { required = false, maxDays = MAX_RANGE_DAYS, defaultFrom = null } = {}) {
  const to = optionalDate(req, "to", today());
  let from = optionalDate(req, "from", null);
  if (!from) {
    if (required && !defaultFrom) throw badRequest("from must be YYYY-MM-DD");
    from = defaultFrom;
  }
  if (!from) return { from: null, to };
  if (from > to) throw badRequest("to must not be before from");
  const days = daysBetween(from, to) + 1;
  if (maxDays && days > maxDays) throw badRequest(`date range is limited to ${maxDays} days`);
  return { from, to };
}

const asOfOf = (req) => optionalDate(req, "asOf", today());

function requireMonth(req) {
  const month = String(req.query.month || "").trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw badRequest("month must be YYYY-MM");
  return month;
}

function paging(req) {
  const limit = req.query.limit == null || req.query.limit === "" ? DEFAULT_LIMIT : Number(req.query.limit);
  const offset = req.query.offset == null || req.query.offset === "" ? 0 : Number(req.query.offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw badRequest(`limit must be 1-${MAX_LIMIT}`);
  if (!Number.isInteger(offset) || offset < 0) throw badRequest("offset must be 0 or more");
  return { limit, offset };
}

const flag = (req, name) => ["1", "true", "yes"].includes(String(req.query[name] ?? "").toLowerCase());

function oneOf(req, name, allowed, fallback) {
  const v = String(req.query[name] ?? "").trim();
  if (!v) return fallback;
  if (!allowed.includes(v)) throw badRequest(`${name} must be one of ${allowed.join(", ")}`);
  return v;
}

function positiveInt(req, name, fallback) {
  if (req.query[name] == null || req.query[name] === "") return fallback;
  const n = Number(req.query[name]);
  if (!Number.isInteger(n) || n < 0) throw badRequest(`${name} must be a whole number`);
  return n;
}

function optionalNumber(req, name, fallback) {
  if (req.query[name] == null || req.query[name] === "") return fallback;
  const n = Number(req.query[name]);
  if (!Number.isFinite(n) || n < 0) throw badRequest(`${name} must be a number`);
  return n;
}

// ── company context (cached master data) ────────────────────────────────

const cache = new Map();
async function cached(key, loader) {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = await loader();
  cache.set(key, { value, until: Date.now() + CACHE_MS });
  return value;
}
export const clearFinanceCache = () => cache.clear();

async function loadCompanies() {
  return cached("companies", async () => {
    const rows = await financeSql(
      `SELECT c.company_id, c.code, c.name, c.tax_id, GROUP_CONCAT(DISTINCT y.fiscal_year ORDER BY y.fiscal_year) AS years
         FROM companies c LEFT JOIN fiscal_years y ON y.company_id = c.company_id
        GROUP BY c.company_id, c.code, c.name, c.tax_id ORDER BY c.company_id`,
    );
    return rows.map((r) => ({
      companyId: r.company_id,
      code: r.code,
      name: r.name,
      taxId: r.tax_id,
      years: csv(r.years).map(Number),
    }));
  });
}

// Branch rules (readme → Branch rules). accounts = [{ accountKey, name, costCode }].
export function makeBranchResolver(branches, accounts) {
  const list = (branches || []).map((b) => ({ ...b, words: b.words || [], accounts: b.accounts || [] }));
  const byCost = new Map(list.map((b) => [String(b.costCode).trim(), b]));
  const byAccount = new Map();
  for (const a of accounts || []) {
    const key = a.accountKey;
    const b =
      list.find((x) => x.accounts.includes(key)) ||
      (a.costCode && byCost.get(String(a.costCode).trim())) ||
      list.find((x) => x.words.some((w) => String(a.name || "").includes(w)));
    if (b) byAccount.set(key, b);
  }
  const resolve = (costCode, accountKey, description) => {
    const cc = String(costCode ?? "").trim();
    if (cc && byCost.has(cc)) return { branch: byCost.get(cc), source: "cost" };
    if (byAccount.has(accountKey)) return { branch: byAccount.get(accountKey), source: "account" };
    const d = String(description ?? "");
    const b = d && list.find((x) => x.words.some((w) => d.includes(w)));
    if (b) return { branch: b, source: "description" };
    return { branch: null, source: "none" };
  };
  resolve.accountsOf = (b) => [...byAccount.entries()].filter(([, x]) => x === b).map(([k]) => k);
  resolve.branches = list;
  return resolve;
}

async function companyContext(req) {
  const code = String(req.query.company || "").trim();
  if (!code) throw badRequest("missing company (company code, see /finance/companies)");
  const company = (await loadCompanies()).find((c) => c.code === code);
  if (!company) throw new ApiError(404, "not_found", `unknown company ${code}`);
  return cached(`ctx:${code}`, async () => {
    const rules = { ...DEFAULT_RULES, ...(FINANCE_MAP.companies?.[code] || {}) };
    const params = { companyId: company.companyId };
    const yrs = await financeSql(`SELECT MAX(fiscal_year) AS y FROM accounts WHERE company_id = :companyId AND deleted_at IS NULL`, params);
    const masterYear = yrs[0]?.y || Math.max(...company.years, 0);
    const accRows = await financeSql(
      `SELECT a.account_key, a.name, a.group_code, a.cost_code, a.tax_file_num, a.bank_code, a.bank_branch, a.bank_account,
              a.deduction_pct, a.deduction_valid_to, g.name AS group_name
         FROM accounts a
         LEFT JOIN account_groups g ON g.company_id = a.company_id AND g.fiscal_year = a.fiscal_year AND g.group_code = a.group_code AND g.deleted_at IS NULL
        WHERE a.company_id = :companyId AND a.fiscal_year = :year AND a.deleted_at IS NULL AND a.account_key IS NOT NULL
        ORDER BY a.account_key`,
      { ...params, year: masterYear },
    );
    const accounts = new Map();
    for (const r of accRows) {
      accounts.set(r.account_key, {
        accountKey: r.account_key,
        name: r.name,
        group: r.group_code == null ? null : Number(r.group_code),
        groupName: r.group_name || rules.groupLabels?.[String(r.group_code)] || null,
        costCode: r.cost_code ? String(r.cost_code).trim() : null,
        taxFileNum: r.tax_file_num || null,
        bank: { code: r.bank_code || null, branch: r.bank_branch || null, account: r.bank_account || null },
        deductionPct: r.deduction_pct == null ? null : Number(r.deduction_pct),
        deductionValidTo: day(r.deduction_valid_to),
      });
    }
    const bankRows = await financeSql(`SELECT DISTINCT account_key FROM bank_lines WHERE company_id = :companyId AND deleted_at IS NULL`, params);
    const bankAccounts = bankRows.map((r) => r.account_key).filter(Boolean);
    const restaurant = (RESTAURANTS.restaurants || []).find((g) => g.key === rules.allegroKey) || null;
    const branchResolver = makeBranchResolver(rules.branches, [...accounts.values()]);
    const groupsOf = (names) => names.flatMap((n) => rules.reportLines[n] || rules.balanceGroups[n] || []);
    const lineOf = (group) => Object.keys(rules.reportLines).find((k) => rules.reportLines[k].includes(group)) || null;
    return {
      code, company, companyId: company.companyId, years: company.years, masterYear, rules, accounts, bankAccounts,
      restaurant, branchResolver, groupsOf, lineOf,
      account: (key) => accounts.get(key) || { accountKey: key, name: null, group: null, groupName: null, costCode: null },
      keysOfGroups: (groups) => [...accounts.values()].filter((a) => groups.includes(a.group)).map((a) => a.accountKey),
      vatRate: Number(rules.vatRate) || 0.18,
      isGroupCompany: (key) => (rules.intercompany || []).some((x) => x.accountKey === key),
    };
  });
}

// Allegro branches (restaurants.json) of the company; branchParam = comma-separated ids or "none".
function companyBranches(ctx) {
  return (ctx.restaurant?.branches || []).map((b) => ({ id: b.id, name: b.name }));
}
function optionalFinanceBranches(req, ctx) {
  const ids = csv(req.query.branch);
  if (!ids.length) return [];
  const known = new Set([...companyBranches(ctx).map((b) => b.id), ...(ctx.rules.branches || []).map((b) => b.branch), "none"]);
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length) throw new ApiError(404, "not_found", `unknown branch ${unknown.join(",")}`);
  return ids;
}
const branchName = (ctx, id) =>
  (ctx.rules.branches || []).find((b) => b.branch === id)?.name || companyBranches(ctx).find((b) => b.id === id)?.name || null;

// Account parameters. `account` = comma list of keys (404 when unknown); `q` = search in names.
function optionalAccounts(req, ctx) {
  const keys = csv(req.query.account);
  const unknown = keys.filter((k) => !ctx.accounts.has(k));
  if (unknown.length) throw new ApiError(404, "not_found", `unknown account ${unknown.join(",")}`);
  return keys;
}
function searchAccounts(req, ctx) {
  const q = String(req.query.q ?? "").trim();
  if (!q) return null;
  return [...ctx.accounts.values()].filter((a) => String(a.name || "").includes(q) || a.accountKey === q);
}
const accountRef = (a) => ({ accountKey: a.accountKey, name: a.name, group: a.group, groupName: a.groupName });

// ── company facts for the warnings (cached) ──────────────────────────────

const JOURNAL = `FROM journal_lines l
       JOIN journal_entries e ON e.company_id = l.company_id AND e.fiscal_year = l.fiscal_year AND e.trans_id = l.trans_id`;
const LIVE = `l.company_id = :companyId AND l.deleted_at IS NULL AND e.deleted_at IS NULL`;
const postedSql = (includeUnposted) => (includeUnposted ? "" : "AND e.status = 1");
const rangeSql = (col, from, to, params) => {
  const parts = [];
  if (from) { params.from = from; parts.push(`${col} >= :from`); }
  if (to) { params.toNext = addDays(to, 1); parts.push(`${col} < :toNext`); }
  return parts.length ? `AND ${parts.join(" AND ")}` : "";
};

async function companyFacts(ctx) {
  return cached(`facts:${ctx.code}`, async () => {
    const params = { companyId: ctx.companyId };
    const months = new Map();
    const month = (m) => {
      if (!months.has(m)) months.set(m, { month: m, income: 0, purchases: 0, salaries: 0, general: 0, unposted: 0, entries: 0 });
      return months.get(m);
    };
    const rows = await financeSql(
      `SELECT DATE_FORMAT(e.value_date, '%Y-%m') AS m, l.account_key, SUM(l.signed_amount) AS amt
         ${JOURNAL} WHERE ${LIVE} AND e.status = 1 GROUP BY 1, 2`,
      params,
    );
    for (const r of rows) {
      const line = ctx.lineOf(ctx.account(r.account_key).group);
      if (!line) continue;
      month(r.m)[line] += line === "income" ? -num(r.amt) : num(r.amt);
    }
    const unposted = await financeSql(
      `SELECT DATE_FORMAT(value_date, '%Y-%m') AS m, SUM(status = 0) AS unposted, COUNT(*) AS entries
         FROM journal_entries WHERE company_id = :companyId AND deleted_at IS NULL GROUP BY 1`,
      params,
    );
    for (const r of unposted) { const x = month(r.m); x.unposted = num(r.unposted); x.entries = num(r.entries); }
    const list = [...months.values()].sort((a, b) => a.month.localeCompare(b.month)).map((x) => ({
      ...x, income: round2(x.income), purchases: round2(x.purchases), salaries: round2(x.salaries), general: round2(x.general),
    }));
    const dataStart = list.find((x) => x.income > 0)?.month || list[0]?.month || null;
    const firstEntry = list[0]?.month || null;

    const [sync] = await financeSql(
      `SELECT sync_run_id, started_at, finished_at, status, error_text FROM sync_runs
        WHERE company_id = :companyId ORDER BY sync_run_id DESC LIMIT 1`,
      params,
    );
    const [lastDone] = await financeSql(
      `SELECT sync_run_id, finished_at FROM sync_runs WHERE company_id = :companyId AND status = 'done' ORDER BY sync_run_id DESC LIMIT 1`,
      params,
    );
    const changed = lastDone
      ? await financeSql(`SELECT COALESCE(SUM(inserted_rows + updated_rows), 0) AS n FROM sync_table_audit WHERE sync_run_id = :id`, { id: lastDone.sync_run_id })
      : [{ n: 0 }];
    const [bankMax] = await financeSql(`SELECT MAX(line_date) AS d FROM bank_lines WHERE company_id = :companyId AND deleted_at IS NULL`, params);

    const bank = await financeSql(
      `SELECT b.account_key, SUM(b.signed_amount) AS balance, SUM(IF(b.is_matched = 0, b.signed_amount, 0)) AS open_amount,
              SUM(b.is_matched = 0) AS open_lines, SUM(b.amount) AS turnover, MAX(b.line_date) AS last_date,
              (SELECT x.running_balance FROM bank_lines x WHERE x.company_id = b.company_id AND x.account_key = b.account_key AND x.deleted_at IS NULL
                ORDER BY x.line_date DESC, x.bank_line_id DESC LIMIT 1) AS last_running
         FROM bank_lines b WHERE b.company_id = :companyId AND b.deleted_at IS NULL GROUP BY b.company_id, b.account_key`,
      params,
    );
    const book = ctx.bankAccounts.length
      ? await financeSql(
          `SELECT l.account_key, SUM(l.signed_amount) AS balance,
                  SUM(IF(m.linked_id IS NULL, l.signed_amount, 0)) AS open_amount, SUM(m.linked_id IS NULL) AS open_lines
             ${JOURNAL}
             LEFT JOIN (SELECT DISTINCT company_id, linked_id FROM bank_matches WHERE side = 'book' AND deleted_at IS NULL) m
               ON m.company_id = l.company_id AND m.linked_id = l.line_id
            WHERE ${LIVE} AND e.status = 1 AND ${inList("l.account_key", ctx.bankAccounts, params, "ba")}
            GROUP BY l.account_key`,
          params,
        )
      : [];
    const bankByKey = new Map(bank.map((r) => [r.account_key, r]));
    const bookByKey = new Map(book.map((r) => [r.account_key, r]));
    const banks = ctx.bankAccounts.map((key) => {
      const b = bankByKey.get(key) || {}, k = bookByKey.get(key) || {};
      return {
        accountKey: key, name: ctx.account(key).name,
        bankBalance: round2(b.balance), lastRunningBalance: b.last_running == null ? null : round2(b.last_running), lastLineDate: day(b.last_date), bookBalance: round2(k.balance),
        bankOpen: round2(b.open_amount), bookOpen: round2(k.open_amount),
        openBankLines: num(b.open_lines), openBookLines: num(k.open_lines), turnover: round2(b.turnover),
      };
    });

    const supplierKeys = ctx.keysOfGroups(ctx.rules.balanceGroups.suppliers || []);
    const sp = { companyId: ctx.companyId };
    const sup = supplierKeys.length
      ? await financeSql(
          `SELECT SUM(IF(t.bal > ${EPS}, 1, 0)) AS debit_count, SUM(IF(t.bal > ${EPS}, t.bal, 0)) AS debit_total,
                  SUM(IF(t.bal < -${EPS}, 1, 0)) AS credit_count, SUM(IF(t.bal < -${EPS}, -t.bal, 0)) AS credit_total
             FROM (SELECT l.account_key, SUM(l.signed_amount) AS bal ${JOURNAL}
                    WHERE ${LIVE} AND e.status = 1 AND ${inList("l.account_key", supplierKeys, sp, "s")} GROUP BY l.account_key) t`,
          sp,
        )
      : [{}];
    return {
      months: list, dataStart, firstEntry,
      lastRun: sync ? { id: sync.sync_run_id, at: sync.finished_at || sync.started_at, status: sync.status, error: sync.error_text || null } : null,
      lastDone: lastDone ? { id: lastDone.sync_run_id, at: lastDone.finished_at, changedRows: num(changed[0]?.n) } : null,
      dataUpTo: day(bankMax?.d),
      banks,
      suppliers: {
        debitCount: num(sup[0]?.debit_count), debitTotal: round2(sup[0]?.debit_total),
        creditCount: num(sup[0]?.credit_count), creditTotal: round2(sup[0]?.credit_total),
      },
    };
  });
}

// Times of sync_runs are the MySQL server's own time (CURRENT_TIMESTAMP), so they are returned as stored, without a zone.
const syncMeta = (facts) => ({
  lastRunAt: facts.lastRun?.at ? String(facts.lastRun.at).slice(0, 19) : null,
  status: facts.lastRun?.status || null,
  dataUpTo: facts.dataUpTo,
});

// ── warnings (readme section 3) ──────────────────────────────────────────

const monthLabel = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const listMonths = (ms) => (ms.length <= 3 ? ms.map(monthLabel).join(", ") : `${monthLabel(ms[0])} to ${monthLabel(ms[ms.length - 1])}`);

// Pure rules over the month profile, so they can be tested without a database.
export const warningRules = {
  no_salary_expense(months, from, to, now = today()) {
    const inRange = months.filter((x) => x.month >= from.slice(0, 7) && x.month <= to.slice(0, 7) && x.month <= now.slice(0, 7));
    const affects = inRange
      .filter((x) => x.salaries === 0 && (x.income > 0 || x.purchases > 0) && months.some((y) => y.month < x.month && y.salaries > 0))
      .map((x) => x.month);
    return affects.length
      ? { code: "no_salary_expense", severity: "high", message: `${listMonths(affects)} ha${affects.length > 1 ? "ve" : "s"} no salary expense in the books (group 720)`, affects }
      : null;
  },
  income_not_posted(months, from, to, now = today()) {
    const byMonth = new Map(months.map((x) => [x.month, x]));
    const dataStart = months.find((x) => x.income > 0)?.month;
    if (!dataStart) return null;
    const affects = [];
    for (const m of monthsOf(from, to)) {
      if (m >= now.slice(0, 7) || m <= dataStart) continue;
      const prev = [];
      for (let i = 1; i <= 6; i++) {
        const pm = addMonths(`${m}-01`, -i).slice(0, 7);
        if (pm < dataStart) break;
        prev.push(byMonth.get(pm)?.income || 0);
      }
      if (prev.length < 2) continue;
      const avg = prev.reduce((a, b) => a + b, 0) / prev.length;
      if (avg > 0 && (byMonth.get(m)?.income || 0) < 0.2 * avg) affects.push(m);
    }
    return affects.length
      ? { code: "income_not_posted", severity: "high", message: `${listMonths(affects)} ha${affects.length > 1 ? "ve" : "s"} almost no income in the books (under 20% of the months before)`, affects }
      : null;
  },
  before_data_start(months, from) {
    const dataStart = months.find((x) => x.income > 0)?.month;
    if (!dataStart || !from || from.slice(0, 7) >= dataStart) return null;
    return { code: "before_data_start", severity: "info", message: `the books have income from ${monthLabel(dataStart)}; earlier months are empty or partial`, affects: [from.slice(0, 7), dataStart] };
  },
  unposted_entries(months, from, to) {
    const affects = months.filter((x) => x.unposted > 0 && (!from || x.month >= from.slice(0, 7)) && (!to || x.month <= to.slice(0, 7)));
    if (!affects.length) return null;
    const n = affects.reduce((a, x) => a + x.unposted, 0);
    return { code: "unposted_entries", severity: "info", message: `${n} unposted entr${n > 1 ? "ies" : "y"} in the range (not counted; includeUnposted=1 counts them)`, affects: affects.map((x) => x.month) };
  },
  bank_gap(banks) {
    const bad = banks.filter((b) => {
      const open = Math.abs(b.bankOpen) + Math.abs(b.bookOpen);
      return b.turnover > 0 && open > 0.05 * b.turnover;
    });
    if (!bad.length) return null;
    const b = bad[0];
    return {
      code: "bank_gap", severity: "high",
      message: `bank ${b.accountKey}: the statement shows ${b.bankBalance.toLocaleString("en-US")} and the books ${b.bookBalance.toLocaleString("en-US")}; unmatched items are over 5% of the bank movement`,
      affects: bad.map((x) => x.accountKey),
    };
  },
  bank_running_balance_differs(banks) {
    const bad = banks.filter((b) => b.lastRunningBalance != null && Math.abs(b.lastRunningBalance - b.bankBalance) > 0.01);
    if (!bad.length) return null;
    const b = bad[0];
    return {
      code: "bank_running_balance_differs", severity: "info",
      message: `bank ${b.accountKey}: the bank lines add up to ${b.bankBalance.toLocaleString("en-US")}, but Hashavshevet's running balance on the last line is ${b.lastRunningBalance.toLocaleString("en-US")}`,
      affects: bad.map((x) => x.accountKey),
    };
  },
  supplier_balances_suspect(s) {
    if (!s || s.debitTotal <= s.creditTotal) return null;
    return {
      code: "supplier_balances_suspect", severity: "high",
      message: `${s.debitCount} suppliers show a debit balance of ${s.debitTotal.toLocaleString("en-US")} in total and ${s.creditCount} a credit balance of ${s.creditTotal.toLocaleString("en-US")}; normally the company owes its suppliers`,
      affects: [],
    };
  },
  stale_sync(lastRun, now = new Date()) {
    if (!lastRun) return { code: "stale_sync", severity: "high", message: "no sync run found for this company", affects: [] };
    if (lastRun.status === "failed") return { code: "stale_sync", severity: "high", message: `the last sync run failed: ${lastRun.error || "no details"}`, affects: [] };
    if (lastRun.status === "running") return null;
    const hours = (now - new Date(String(lastRun.at).slice(0, 19).replace(" ", "T"))) / 3600000;
    return hours > STALE_SYNC_HOURS
      ? { code: "stale_sync", severity: "info", message: `the last finished sync is ${Math.floor(hours)} hours old`, affects: [] }
      : null;
  },
  other_company_missing(loaded) {
    return { code: "other_company_missing", severity: "info", message: `only ${loaded.join(", ")} is loaded; the other side of these balances is in another company's books`, affects: [] };
  },
  not_validated(path) {
    return { code: "not_validated", severity: "info", message: `the numbers of ${path} were not yet checked by the accountant against Hashavshevet`, affects: [] };
  },
  branch_partial(noBranch, total, what = "amount") {
    if (Math.abs(noBranch) < EPS || Math.abs(total) < EPS) return null;
    const share = Math.abs(noBranch) / Math.abs(total);
    return {
      code: "branch_partial", severity: share > 0.1 ? "high" : "info",
      message: `${round2(share * 100)}% of the ${what} (${round2(noBranch).toLocaleString("en-US")}) has no branch and is shown as "No branch"`,
      affects: [],
    };
  },
};

// Warnings of one answer. `codes` lists the data checks that matter for the endpoint.
function buildWarnings(ctx, facts, path, codes, { from = null, to = null } = {}) {
  const out = [];
  const push = (w) => w && out.push(w);
  const f = from || facts.firstEntry || today();
  const t = to || today();
  for (const code of codes) {
    if (code === "no_salary_expense") push(warningRules.no_salary_expense(facts.months, f, t));
    else if (code === "income_not_posted") push(warningRules.income_not_posted(facts.months, f, t));
    else if (code === "before_data_start") push(warningRules.before_data_start(facts.months, from));
    else if (code === "unposted_entries") push(warningRules.unposted_entries(facts.months, from, to));
    else if (code === "bank_gap") { push(warningRules.bank_gap(facts.banks)); push(warningRules.bank_running_balance_differs(facts.banks)); }
    else if (code === "supplier_balances_suspect") push(warningRules.supplier_balances_suspect(facts.suppliers));
    else if (code === "other_company_missing") push(warningRules.other_company_missing([ctx.company.name]));
  }
  push(warningRules.stale_sync(facts.lastRun));
  if (!(ctx.rules.validated || []).includes(path)) push(warningRules.not_validated(path));
  return out;
}

// ── open items and age of debt (readme section 5) ────────────────────────

export const AGE_BUCKETS = ["current", "1-30", "31-60", "61-90", "90+"];
export function ageBucket(ageDays) {
  if (ageDays <= 0) return "current";
  if (ageDays <= 30) return "1-30";
  if (ageDays <= 60) return "31-60";
  if (ageDays <= 90) return "61-90";
  return "90+";
}
const emptyBuckets = () => Object.fromEntries(AGE_BUCKETS.map((b) => [b, 0]));

// lines of one account: [{ lineId, year, transId, date, dueDate, signed, matched, ... }], oldest first.
// side: 'customers' (an invoice is a debit) or 'suppliers' (an invoice is a credit). Returns the open items in the
// natural sign of the side (plus = owed), with the method used.
export function openItems(lines, side) {
  const sign = side === "suppliers" ? -1 : 1;
  const sorted = [...lines].sort((a, b) => a.date.localeCompare(b.date) || a.lineId - b.lineId);
  if (sorted.some((l) => l.matched)) {
    const items = sorted.filter((l) => !l.matched).map((l) => ({ ...l, open: round2(sign * l.signed) }));
    // partial matches: when the matched lines do not net to zero, the remainder is shown as one open item
    const matched = sorted.filter((l) => l.matched);
    const rest = round2(sign * matched.reduce((a, l) => a + l.signed, 0));
    if (Math.abs(rest) > EPS) items.push({ ...matched[matched.length - 1], open: rest, residual: true });
    return { method: "matched", items };
  }
  let payments = 0;
  let lastPayment = null;
  const invoices = [];
  for (const l of sorted) {
    const amt = sign * l.signed;
    if (amt > 0) invoices.push({ ...l, amount: amt });
    else if (amt < 0) { payments += -amt; lastPayment = l; }
  }
  const items = [];
  for (const inv of invoices) {
    const used = Math.min(inv.amount, payments);
    payments = round2(payments - used);
    const open = round2(inv.amount - used);
    if (open > EPS) items.push({ ...inv, open });
  }
  if (payments > EPS && lastPayment) items.push({ ...lastPayment, open: round2(-payments), unapplied: true });
  return { method: "oldest_first", items };
}

export function bucketItems(items, asOf) {
  const buckets = emptyBuckets();
  for (const it of items) {
    const ref = it.dueDate || it.date;
    buckets[ageBucket(daysBetween(ref, asOf))] = round2(buckets[ageBucket(daysBetween(ref, asOf))] + it.open);
  }
  return buckets;
}

// All posted lines of the accounts (up to asOf) with their ledger match flag. A line counts as matched as of asOf only
// when the match was made by then and every line of that match is dated up to asOf (else the partner is missing).
async function accountLines(ctx, keys, { asOf, from = null, includeUnposted = false }) {
  if (!keys.length) return [];
  const params = { companyId: ctx.companyId, asOf };
  const rows = await financeSql(
    `SELECT l.account_key, l.line_id, l.fiscal_year, l.trans_id, DATE_FORMAT(e.value_date, '%Y-%m-%d') AS d,
            DATE_FORMAT(e.due_date, '%Y-%m-%d') AS due, l.signed_amount AS s, e.trans_type, e.reference, e.description,
            e.status, e.debit_account, e.credit_account,
            EXISTS(SELECT 1 FROM ledger_matches m WHERE m.company_id = l.company_id AND m.journal_line_id = l.line_id
                      AND m.deleted_at IS NULL AND (m.matched_on IS NULL OR m.matched_on < DATE_ADD(:asOf, INTERVAL 1 DAY))
                      AND NOT EXISTS (SELECT 1 FROM ledger_matches m2
                                        JOIN journal_lines l2 ON l2.company_id = m2.company_id AND l2.line_id = m2.journal_line_id
                                        JOIN journal_entries e2 ON e2.company_id = l2.company_id AND e2.fiscal_year = l2.fiscal_year AND e2.trans_id = l2.trans_id
                                       WHERE m2.company_id = m.company_id AND m2.match_num = m.match_num AND m2.deleted_at IS NULL
                                         AND e2.value_date >= DATE_ADD(:asOf, INTERVAL 1 DAY))) AS matched
       ${JOURNAL}
      WHERE ${LIVE} ${postedSql(includeUnposted)} AND ${inList("l.account_key", keys, params, "k")}
        AND e.value_date < DATE_ADD(:asOf, INTERVAL 1 DAY) ${from ? "AND e.value_date >= :from" : ""}
      ORDER BY e.value_date, l.line_id`,
    from ? { ...params, from } : params,
  );
  return rows.map((r) => ({
    accountKey: r.account_key, lineId: r.line_id, year: r.fiscal_year, transId: r.trans_id, date: r.d, dueDate: r.due,
    signed: num(r.s), type: r.trans_type, reference: r.reference, description: r.description, posted: r.status === 1,
    matched: Boolean(num(r.matched)), counterAccount: null,
    debitAccount: r.debit_account, creditAccount: r.credit_account,
  }));
}

function agingRows(ctx, lines, side, asOf) {
  const byAccount = new Map();
  for (const l of lines) {
    if (!byAccount.has(l.accountKey)) byAccount.set(l.accountKey, []);
    byAccount.get(l.accountKey).push(l);
  }
  const sign = side === "suppliers" ? -1 : 1;
  const rows = [];
  for (const [key, ls] of byAccount) {
    const balance = round2(sign * ls.reduce((a, l) => a + l.signed, 0));
    const { method, items } = openItems(ls, side);
    const buckets = bucketItems(items, asOf);
    const openTotal = round2(items.reduce((a, i) => a + i.open, 0));
    if (Math.abs(balance) < EPS && Math.abs(openTotal) < EPS) continue;
    const a = ctx.account(key);
    rows.push({
      accountKey: key, name: a.name, group: a.group, isGroupCompany: ctx.isGroupCompany(key), balance, openTotal,
      openCount: items.length, oldest: items[0]?.date || null, buckets, method,
      tie: Math.abs(balance - openTotal) < 0.01,
    });
  }
  return rows.sort((x, y) => y.balance - x.balance);
}

// ── cheques (readme → /cheques) ──────────────────────────────────────────

export function chequeState(c, now) {
  if (c.dueDate && c.dueDate > now) return "future";
  return c.cleared ? "cleared" : "not_cleared";
}

async function chequeRows(ctx, { accounts = [], from = null, to = null } = {}) {
  const params = { companyId: ctx.companyId };
  const bankKeys = ctx.bankAccounts;
  const rows = await financeSql(
    `SELECT c.cheque_id, c.fiscal_year, c.account_key, c.payee_name, c.amount_to_pay, c.paid, c.deducted,
            DATE_FORMAT(c.due_date, '%Y-%m-%d') AS due, DATE_FORMAT(c.issue_date, '%Y-%m-%d') AS issued,
            DATE_FORMAT(c.original_date, '%Y-%m-%d') AS original, c.reference, c.bank_key, c.status,
            MAX(e.fiscal_year) AS entry_year, MAX(e.trans_id) AS trans_id,
            MAX(IF(bm.linked_id IS NOT NULL, 1, 0)) AS cleared
       FROM cheques c
       LEFT JOIN journal_entries e ON e.company_id = c.company_id AND e.cheque_id = c.cheque_id AND e.cheque_id <> 0 AND e.deleted_at IS NULL
       LEFT JOIN journal_lines l ON l.company_id = e.company_id AND l.fiscal_year = e.fiscal_year AND l.trans_id = e.trans_id
            AND l.deleted_at IS NULL AND ${bankKeys.length ? inList("l.account_key", bankKeys, params, "bk") : "1 = 0"}
       LEFT JOIN bank_matches bm ON bm.company_id = l.company_id AND bm.side = 'book' AND bm.linked_id = l.line_id AND bm.deleted_at IS NULL
      WHERE c.company_id = :companyId AND c.deleted_at IS NULL
        ${accounts.length ? `AND ${inList("c.account_key", accounts, params, "a")}` : ""}
        ${rangeSql("c.due_date", from, to, params)}
      GROUP BY c.cheque_id, c.fiscal_year, c.account_key, c.payee_name, c.amount_to_pay, c.paid, c.deducted, c.due_date,
               c.issue_date, c.original_date, c.reference, c.bank_key, c.status
      ORDER BY c.due_date, c.cheque_id`,
    params,
  );
  const now = today();
  return rows.map((r) => {
    const c = {
      chequeId: r.cheque_id, year: r.fiscal_year, account: r.account_key, accountName: ctx.account(r.account_key).name,
      payee: r.payee_name, amount: round2(r.amount_to_pay), paid: round2(r.paid), deducted: round2(r.deducted),
      dueDate: r.due, issueDate: r.issued, originalDate: r.original, reference: r.reference, bankAccount: r.bank_key,
      entry: r.trans_id ? { year: r.entry_year, transId: r.trans_id } : null, cleared: Boolean(num(r.cleared)),
    };
    return { ...c, state: chequeState(c, now) };
  });
}

// ── profit and loss data (readme → /pnl) ─────────────────────────────────

// Lines of the report groups in a range, grouped by account × month × cost code × description, with the branch.
async function pnlLines(ctx, { from, to, includeUnposted = false }) {
  const keys = ctx.keysOfGroups(ctx.groupsOf(Object.keys(ctx.rules.reportLines)));
  if (!keys.length) return [];
  const params = { companyId: ctx.companyId };
  const rows = await financeSql(
    `SELECT l.account_key, DATE_FORMAT(e.value_date, '%Y-%m') AS m, TRIM(COALESCE(e.cost_code, '')) AS cc, e.description,
            SUM(l.signed_amount) AS amt, COUNT(*) AS n
       ${JOURNAL}
      WHERE ${LIVE} ${postedSql(includeUnposted)} AND ${inList("l.account_key", keys, params, "k")} ${rangeSql("e.value_date", from, to, params)}
      GROUP BY 1, 2, 3, 4`,
    params,
  );
  return rows.map((r) => {
    const a = ctx.account(r.account_key);
    const line = ctx.lineOf(a.group);
    const { branch, source } = ctx.branchResolver(r.cc, r.account_key, r.description);
    return {
      accountKey: r.account_key, name: a.name, group: a.group, line, month: r.m,
      amount: line === "income" ? -num(r.amt) : num(r.amt), lines: num(r.n),
      branch: branch ? branch.branch : null, branchName: branch ? branch.name : null, costCode: branch ? branch.costCode : null, branchSource: source,
    };
  });
}

const emptyPnl = () => ({ income: 0, purchases: 0, salaries: 0, general: 0 });
const finishPnl = (p) => ({
  income: round2(p.income), purchases: round2(p.purchases), salaries: round2(p.salaries), general: round2(p.general),
  profit: round2(p.income - p.purchases - p.salaries - p.general),
});

function pnlRows(rows, { by, from, to }) {
  const groups = new Map();
  const add = (key, make, r) => {
    if (!groups.has(key)) groups.set(key, { ...make(), ...emptyPnl(), _sources: { cost: 0, account: 0, description: 0, none: 0 } });
    const g = groups.get(key);
    g[r.line] += r.amount;
    g._sources[r.branchSource] += Math.abs(r.amount);
  };
  for (const r of rows) {
    if (by === "month") add(r.month, () => ({ period: r.month }), r);
    else if (by === "year") add(r.month.slice(0, 4), () => ({ period: r.month.slice(0, 4) }), r);
    else if (by === "branch") add(r.branch || "none", () => ({ branch: r.branch, branchName: r.branch ? r.branchName : "No branch", costCode: r.costCode }), r);
    else if (by === "account") add(r.accountKey, () => ({ accountKey: r.accountKey, name: r.name, group: r.group, line: r.line }), r);
  }
  if (by === "month") for (const m of monthsOf(from, to)) if (!groups.has(m)) groups.set(m, { period: m, ...emptyPnl(), _sources: null });
  const out = [...groups.values()].map(({ _sources, ...g }) => {
    const row = { ...g, ...finishPnl(g) };
    if (by === "branch") row.branchSource = { cost: round2(_sources.cost), account: round2(_sources.account), description: round2(_sources.description) };
    if (by === "account") { row.amount = round2(g[g.line]); for (const k of ["income", "purchases", "salaries", "general", "profit"]) delete row[k]; }
    return row;
  });
  const sortKey = (r) => (by === "branch" ? (r.branch ? r.branchName : "￿") : by === "account" ? `${r.group}-${r.accountKey}` : r.period);
  out.sort((a, b) => String(sortKey(a)).localeCompare(String(sortKey(b))));
  const totals = finishPnl(rows.reduce((t, r) => ((t[r.line] += r.amount), t), emptyPnl()));
  const noBranch = rows.filter((r) => !r.branch).reduce((a, r) => a + Math.abs(r.amount), 0);
  const all = rows.reduce((a, r) => a + Math.abs(r.amount), 0);
  return { rows: out, totals, noBranch, all };
}

// The compare range: the same length before `from`, or the same dates one year earlier.
export function compareRange(from, to, mode) {
  if (mode === "prev_year") return { from: addMonths(from, -12), to: addMonths(to, -12) };
  const wholeMonths = from.endsWith("-01") && to === monthEnd(to.slice(0, 7));
  if (wholeMonths) {
    const n = monthsOf(from, to).length;
    const f = addMonths(from, -n);
    return { from: f, to: monthEnd(addMonths(from, -1).slice(0, 7)) };
  }
  const len = daysBetween(from, to) + 1;
  return { from: addDays(from, -len), to: addDays(from, -1) };
}

const withChange = (row, prev) => {
  const change = prev == null ? null : round2(row - prev);
  return { previous: prev == null ? null : round2(prev), change, changePct: prev == null || Math.abs(prev) < EPS ? null : round2((change / Math.abs(prev)) * 100) };
};

// ── endpoints: reference ─────────────────────────────────────────────────

// Every handler gets (req, ctx, facts) and returns { data, meta, codes? }. codes = the data checks of this answer.
const routes = [];
const route = (path, handler, { company = true } = {}) => routes.push({ path, handler, company });

route("/companies", async () => {
  const companies = await loadCompanies();
  return {
    data: companies.map((c) => {
      const rules = FINANCE_MAP.companies?.[c.code] || {};
      const g = (RESTAURANTS.restaurants || []).find((x) => x.key === rules.allegroKey);
      return { code: c.code, name: c.name, taxId: c.taxId, allegroKey: rules.allegroKey || null, allegroLabel: g?.label || null, years: c.years, rules: Boolean(FINANCE_MAP.companies?.[c.code]) };
    }),
    meta: {},
  };
}, { company: false });

route("/status", async (req, ctx, facts) => {
  const nowMonth = today().slice(0, 7);
  const months = facts.months
    .filter((m) => m.month <= nowMonth)
    .map((m) => {
      const codes = [];
      const f = monthStart(m.month), t = monthEnd(m.month);
      if (warningRules.no_salary_expense(facts.months, f, t)) codes.push("no_salary_expense");
      if (warningRules.income_not_posted(facts.months, f, t)) codes.push("income_not_posted");
      if (m.unposted > 0) codes.push("unposted_entries");
      return { ...m, warnings: codes, complete: !codes.includes("no_salary_expense") && !codes.includes("income_not_posted") };
    });
  return {
    data: {
      lastRun: facts.lastRun ? { at: syncMeta(facts).lastRunAt, status: facts.lastRun.status, changedRows: facts.lastDone?.changedRows ?? null, error: facts.lastRun.error } : null,
      dataUpTo: facts.dataUpTo, dataStart: facts.dataStart, firstEntry: facts.firstEntry, years: ctx.years, masterYear: ctx.masterYear,
      banks: facts.banks.map(({ turnover, ...b }) => b), suppliers: facts.suppliers, months,
    },
    meta: {}, codes: ["bank_gap", "supplier_balances_suspect"],
  };
});

route("/accounts", async (req, ctx) => {
  const groups = csv(req.query.group).map(Number);
  if (groups.some((g) => !Number.isInteger(g))) throw badRequest("group must be a comma-separated list of numbers");
  const q = String(req.query.q ?? "").trim();
  const includeBank = flag(req, "includeBank");
  const asOf = asOfOf(req);
  const params = { companyId: ctx.companyId, asOf };
  const bal = await financeSql(
    `SELECT l.account_key, SUM(IF(l.side = 'debit', l.amount, 0)) AS debit, SUM(IF(l.side = 'credit', l.amount, 0)) AS credit, SUM(l.signed_amount) AS balance
       ${JOURNAL} WHERE ${LIVE} AND e.status = 1 AND e.value_date < DATE_ADD(:asOf, INTERVAL 1 DAY) GROUP BY l.account_key`,
    params,
  );
  const byKey = new Map(bal.map((r) => [r.account_key, r]));
  const data = [...ctx.accounts.values()]
    .filter((a) => (!groups.length || groups.includes(a.group)) && (!q || String(a.name || "").includes(q) || a.accountKey === q))
    .map((a) => {
      const b = byKey.get(a.accountKey);
      const { branch, source } = ctx.branchResolver(null, a.accountKey, null);
      const row = {
        accountKey: a.accountKey, name: a.name, group: a.group, groupName: a.groupName, line: ctx.lineOf(a.group),
        branch: branch ? branch.branch : null, branchName: branch ? branch.name : null, branchSource: source === "none" ? null : source,
        costCode: a.costCode, taxFileNum: a.taxFileNum, isGroupCompany: ctx.isGroupCompany(a.accountKey),
        debit: round2(b?.debit), credit: round2(b?.credit), balance: round2(b?.balance),
      };
      if (includeBank) row.bank = a.bank;
      return row;
    });
  return { data, meta: { asOf, group: groups.length ? groups : "all", q: q || null, includeBank, masterYear: ctx.masterYear } };
});

route("/branches", async (req, ctx) => {
  const r = ctx.branchResolver;
  return {
    data: r.branches.map((b) => ({
      costCode: b.costCode, hashName: b.hashName, branch: b.branch, name: b.name, confirmed: b.confirmed !== false, words: b.words,
      accounts: r.accountsOf(b).map((k) => ({ accountKey: k, name: ctx.account(k).name, group: ctx.account(k).group })),
    })),
    meta: { allegroKey: ctx.rules.allegroKey || null, allegroBranches: companyBranches(ctx), rules: ["cost", "account", "description", "none"] },
  };
});

// ── endpoints: management ────────────────────────────────────────────────

route("/pnl", async (req, ctx) => {
  const { from, to } = dateRange(req, { required: true });
  const by = oneOf(req, "by", ["month", "year", "branch", "account"], "month");
  const compare = oneOf(req, "compare", ["prev_period", "prev_year"], null);
  const branches = optionalFinanceBranches(req, ctx);
  const includeUnposted = flag(req, "includeUnposted");
  const filterBranches = (rows) => (branches.length ? rows.filter((r) => branches.includes(r.branch || "none")) : rows);
  const main = pnlRows(filterBranches(await pnlLines(ctx, { from, to, includeUnposted })), { by, from, to });
  const meta = { from, to, by, branches: branches.length ? branches : "all", includeUnposted, totals: main.totals };
  const warnings = [];
  if (by === "branch" || branches.length) { const w = warningRules.branch_partial(main.noBranch, main.all, "income and expenses"); if (w) warnings.push(w); }
  let data = main.rows;
  if (compare) {
    const cr = compareRange(from, to, compare);
    const prev = pnlRows(filterBranches(await pnlLines(ctx, { from: cr.from, to: cr.to, includeUnposted })), { by, from: cr.from, to: cr.to });
    const keyOf = (r) => (by === "branch" ? r.branch || "none" : by === "account" ? r.accountKey : null);
    const prevByKey = new Map(prev.rows.map((r) => [keyOf(r), r]));
    data = main.rows.map((r, i) => {
      const p = by === "month" || by === "year" ? prev.rows[i] : prevByKey.get(keyOf(r));
      if (!p) return { ...r, compare: null };
      if (by === "account") return { ...r, compare: { period: `${cr.from}..${cr.to}`, ...withChange(r.amount, p.amount) } };
      const { income, purchases, salaries, general, profit } = p;
      return { ...r, compare: { period: p.period, income, purchases, salaries, general, profit, change: withChange(r.profit, p.profit) } };
    });
    meta.compare = { mode: compare, ...cr, totals: prev.totals };
  }
  return { data, meta, warnings, codes: ["no_salary_expense", "income_not_posted", "before_data_start", "unposted_entries"], range: { from, to } };
});

route("/cash", async (req, ctx, facts) => {
  const asOf = asOfOf(req);
  const params = { companyId: ctx.companyId, asOf };
  const bank = await financeSql(
    `SELECT account_key, SUM(signed_amount) AS balance, MAX(line_date) AS last_date FROM bank_lines
      WHERE company_id = :companyId AND deleted_at IS NULL AND line_date < DATE_ADD(:asOf, INTERVAL 1 DAY) GROUP BY account_key`,
    params,
  );
  const bankBalance = round2(bank.reduce((a, r) => a + num(r.balance), 0));
  const bankBalanceDate = bank.map((r) => day(r.last_date)).sort().pop() || null;
  const lastRunning = facts.banks.every((b) => b.lastRunningBalance != null) ? round2(facts.banks.reduce((a, b) => a + b.lastRunningBalance, 0)) : null;
  const cheques = (await chequeRows(ctx)).filter((c) => c.dueDate && !(c.cleared && c.dueDate <= asOf));
  const bucket = (c) => {
    const d = daysBetween(asOf, c.dueDate);
    if (d <= 0) return "due";
    if (d <= 30) return "next30";
    if (d <= 60) return "days31to60";
    if (d <= 90) return "days61to90";
    return "later";
  };
  const out = { next30: { count: 0, amount: 0 }, days31to60: { count: 0, amount: 0 }, days61to90: { count: 0, amount: 0 }, later: { count: 0, amount: 0 } };
  const due = { count: 0, amount: 0 };
  for (const c of cheques) {
    const b = bucket(c);
    const t = b === "due" ? due : out[b];
    t.count += 1; t.amount = round2(t.amount + c.amount);
  }
  // open customer invoices by due date (credit card money is left out: 100020 is not reliable yet)
  const register = ctx.rules.balanceGroups.registerCustomers || [];
  const custKeys = ctx.keysOfGroups((ctx.rules.balanceGroups.customers || []).filter((g) => !register.includes(g)));
  const lines = await accountLines(ctx, custKeys, { asOf });
  const byAcc = new Map();
  for (const l of lines) { if (!byAcc.has(l.accountKey)) byAcc.set(l.accountKey, []); byAcc.get(l.accountKey).push(l); }
  const expectedIn = { overdue: 0, next30: 0, days31to60: 0, days61to90: 0, later: 0 };
  for (const [, ls] of byAcc) {
    for (const it of openItems(ls, "customers").items) {
      if (it.open <= 0) continue;
      const d = daysBetween(asOf, it.dueDate || it.date);
      const k = d <= 0 ? "overdue" : d <= 30 ? "next30" : d <= 60 ? "days31to60" : d <= 90 ? "days61to90" : "later";
      expectedIn[k] = round2(expectedIn[k] + it.open);
    }
  }
  const day30 = round2(bankBalance + expectedIn.next30 - due.amount - out.next30.amount);
  const day60 = round2(day30 + expectedIn.days31to60 - out.days31to60.amount);
  const day90 = round2(day60 + expectedIn.days61to90 - out.days61to90.amount);
  return {
    data: {
      bankBalance, bankBalanceDate, lastRunningBalance: asOf >= (facts.dataUpTo || "") ? lastRunning : null, bookBankBalance: round2(facts.banks.reduce((a, b) => a + b.bookBalance, 0)),
      banks: bank.map((r) => ({ accountKey: r.account_key, name: ctx.account(r.account_key).name, balance: round2(r.balance), date: day(r.last_date) })),
      chequesOut: out, chequesDueNotCleared: due, expectedIn, projected: { day30, day60, day90 },
    },
    meta: { asOf, note: "bankBalance = the bank lines added up; expectedIn = open invoices of real customers (not the register accounts) by due date, without credit card money; overdue money is shown but not in projected" },
    codes: ["bank_gap", "supplier_balances_suspect"],
  };
});

// Beecomm daily totals (allegro DB, bcom_cash) per branch per month, with VAT.
async function beecommMonths(branchIds, from, to) {
  if (!branchIds.length) return new Map();
  const params = { from, to };
  branchIds.forEach((id, i) => (params[`b${i}`] = id));
  const [rows] = await executeSql(
    `SELECT branchId, DATE_FORMAT(ts, '%Y-%m') AS m, SUM(COALESCE(total, 0)) AS total, COUNT(*) AS days
       FROM bcom_cash WHERE DATE(ts) BETWEEN :from AND :to AND branchId IN (${branchIds.map((_, i) => `:b${i}`).join(",")})
      GROUP BY branchId, DATE_FORMAT(ts, '%Y-%m')`,
    params,
  );
  return new Map((rows || []).map((r) => [`${r.branchId}|${r.m}`, { total: num(r.total), days: num(r.days) }]));
}

// Payroll per branch per month from the admin's labor data (saved payroll, else Tabit). Heavy: one call per branch-month.
async function laborMonths(branchIds, from, to) {
  if (!branchIds.length) return new Map();
  const rows = await laborDays(branchIds, from, to);
  const out = new Map();
  for (const r of rows) {
    const key = `${r.branch}|${r.date.slice(0, 7)}`;
    if (!out.has(key)) out.set(key, { laborCost: 0, gross: 0, wageCost: 0, hours: 0, employees: new Set(), sources: new Set() });
    const m = out.get(key);
    m.laborCost += num(r.laborCost); m.gross += num(r.gross?.total); m.wageCost += num(r.wageCost);
    m.hours += num(r.h100) + num(r.h125) + num(r.h150);
    m.employees.add(r.employeeId ?? r.name); m.sources.add(r.payrollSource);
  }
  for (const m of out.values()) {
    m.laborCost = round2(m.laborCost); m.gross = round2(m.gross); m.wageCost = round2(m.wageCost); m.hours = round2(m.hours);
    m.employees = m.employees.size; m.source = m.sources.has("saved") ? "saved" : "tabit"; delete m.sources;
  }
  return out;
}

const booksByBranchMonth = (rows, line) => {
  const out = new Map();
  for (const r of rows) {
    if (r.line !== line) continue;
    const key = `${r.branch || "none"}|${r.month}`;
    out.set(key, round2((out.get(key) || 0) + r.amount));
  }
  return out;
};

route("/branch-costs", async (req, ctx) => {
  const { from, to } = dateRange(req, { required: true, maxDays: MAX_MIXED_DAYS });
  const wanted = optionalFinanceBranches(req, ctx);
  const branches = companyBranches(ctx).filter((b) => !wanted.length || wanted.includes(b.id));
  const ids = branches.map((b) => b.id);
  const lines = await pnlLines(ctx, { from, to });
  const food = ctx.rules.foodCostAccounts;
  const income = booksByBranchMonth(lines, "income");
  const purchases = booksByBranchMonth(lines.filter((r) => !food || food.includes(r.accountKey)), "purchases");
  const salaries = booksByBranchMonth(lines, "salaries");
  const [bcom, labor] = await Promise.all([beecommMonths(ids, from, to), laborMonths(ids, from, to)]);
  const data = [];
  for (const b of branches) {
    for (const m of monthsOf(from, to)) {
      const key = `${b.id}|${m}`;
      const books = income.get(key) || 0;
      const bc = bcom.get(key);
      const revenueSource = books > EPS ? "books" : bc ? "beecomm" : "none";
      const revenue = revenueSource === "books" ? books : bc ? round2(bc.total / (1 + ctx.vatRate)) : 0;
      const lab = labor.get(key);
      const foodCost = purchases.get(key) || 0;
      const laborCost = lab ? lab.laborCost : 0;
      data.push({
        branch: b.id, branchName: b.name, month: m, revenue: round2(revenue), revenueSource,
        beecommNet: bc ? round2(bc.total / (1 + ctx.vatRate)) : null, booksIncome: round2(books),
        foodCost: round2(foodCost), foodPct: pct(foodCost, revenue),
        laborCost: round2(laborCost), laborPct: pct(laborCost, revenue), laborSource: lab ? lab.source : "none",
        payrollGross: lab ? lab.gross : null, salariesBooks: round2(salaries.get(key) || 0), employees: lab ? lab.employees : 0,
      });
    }
  }
  const noBranch = monthsOf(from, to).map((m) => ({ month: m, income: income.get(`none|${m}`) || 0, purchases: purchases.get(`none|${m}`) || 0, salaries: salaries.get(`none|${m}`) || 0 })).filter((x) => x.income || x.purchases || x.salaries);
  const warnings = [];
  const all = lines.reduce((a, r) => a + Math.abs(r.amount), 0);
  const w = warningRules.branch_partial(lines.filter((r) => !r.branch).reduce((a, r) => a + Math.abs(r.amount), 0), all, "income and expenses");
  if (w) warnings.push(w);
  return {
    data, warnings,
    meta: { from, to, branches: ids, vatRate: ctx.vatRate, foodCostAccounts: food || "all of group 800", noBranch },
    codes: ["no_salary_expense", "income_not_posted", "before_data_start"], range: { from, to },
  };
});

route("/sales-vs-books", async (req, ctx) => {
  const { from, to } = dateRange(req, { required: true, maxDays: MAX_MIXED_DAYS });
  const wanted = optionalFinanceBranches(req, ctx);
  const branches = companyBranches(ctx).filter((b) => !wanted.length || wanted.includes(b.id));
  const ids = branches.map((b) => b.id);
  const lines = await pnlLines(ctx, { from, to });
  const income = booksByBranchMonth(lines, "income");
  const bcom = await beecommMonths(ids, from, to);
  const data = [];
  for (const m of monthsOf(from, to)) {
    let salesAll = 0, booksAll = 0;
    for (const b of branches) {
      const bc = bcom.get(`${b.id}|${m}`);
      const sales = bc ? round2(bc.total / (1 + ctx.vatRate)) : null;
      const books = round2(income.get(`${b.id}|${m}`) || 0);
      salesAll += sales || 0; booksAll += books;
      data.push({ month: m, branch: b.id, branchName: b.name, salesSystem: sales, salesDays: bc?.days || 0, books, difference: sales == null ? null : round2(books - sales), differencePct: sales == null ? null : pct(books - sales, sales) });
    }
    const noBranch = round2(income.get(`none|${m}`) || 0);
    booksAll = round2(booksAll + noBranch);
    salesAll = round2(salesAll);
    data.push({ month: m, branch: null, branchName: "Company total", salesSystem: salesAll, books: booksAll, booksNoBranch: noBranch, difference: round2(booksAll - salesAll), differencePct: pct(booksAll - salesAll, salesAll) });
  }
  return {
    data, meta: { from, to, branches: ids, vatRate: ctx.vatRate, salesSource: "beecomm", note: "salesSystem is Beecomm's daily total without VAT; the company total row also counts income without a branch" },
    codes: ["income_not_posted", "before_data_start"], range: { from, to },
  };
});

route("/spending", async (req, ctx) => {
  const { from, to } = dateRange(req, { required: true });
  const by = oneOf(req, "by", ["supplier", "account", "group"], "supplier");
  const compare = oneOf(req, "compare", ["prev_period", "prev_year"], null);
  const top = positiveInt(req, "top", 20);
  const branches = optionalFinanceBranches(req, ctx);
  const supplierKeys = ctx.keysOfGroups(ctx.rules.balanceGroups.suppliers || []);
  const expenseGroups = ctx.groupsOf(["purchases", "salaries", "general"]);
  const invoiceTypes = ctx.rules.invoiceTypes.supplier || [];
  const load = async (f, t) => {
    const params = { companyId: ctx.companyId };
    let sql;
    if (by === "supplier") {
      sql = `SELECT l.account_key, TRIM(COALESCE(e.cost_code, '')) AS cc, e.description, SUM(l.amount) AS amt, COUNT(*) AS n
               ${JOURNAL} WHERE ${LIVE} AND e.status = 1 AND l.side = 'credit' AND ${inList("l.account_key", supplierKeys, params, "k")}
                AND ${inList("e.trans_type", invoiceTypes, params, "t")} ${rangeSql("e.value_date", f, t, params)} GROUP BY 1, 2, 3`;
    } else {
      const keys = ctx.keysOfGroups(expenseGroups);
      sql = `SELECT l.account_key, TRIM(COALESCE(e.cost_code, '')) AS cc, e.description, SUM(l.signed_amount) AS amt, COUNT(*) AS n
               ${JOURNAL} WHERE ${LIVE} AND e.status = 1 AND ${inList("l.account_key", keys, params, "k")} ${rangeSql("e.value_date", f, t, params)} GROUP BY 1, 2, 3`;
    }
    const rows = await financeSql(sql, params);
    const agg = new Map();
    for (const r of rows) {
      const { branch } = ctx.branchResolver(r.cc, r.account_key, r.description);
      if (branches.length && !branches.includes(branch?.branch || "none")) continue;
      const a = ctx.account(r.account_key);
      const key = by === "group" ? String(a.group) : r.account_key;
      if (!agg.has(key)) agg.set(key, by === "group" ? { group: a.group, groupName: a.groupName, amount: 0, entries: 0 } : { accountKey: r.account_key, name: a.name, group: a.group, groupName: a.groupName, amount: 0, entries: 0 });
      const g = agg.get(key); g.amount += num(r.amt); g.entries += num(r.n);
    }
    return agg;
  };
  const main = await load(from, to);
  let rows = [...main.entries()].map(([key, v]) => ({ key, ...v, amount: round2(v.amount) })).sort((a, b) => b.amount - a.amount);
  const total = round2(rows.reduce((a, r) => a + r.amount, 0));
  const meta = { from, to, by, top, branches: branches.length ? branches : "all", total, rows: rows.length, invoiceTypes: by === "supplier" ? invoiceTypes : undefined, withVat: by === "supplier" };
  if (compare) {
    const cr = compareRange(from, to, compare);
    const prev = await load(cr.from, cr.to);
    rows = rows.map((r) => ({ ...r, ...withChange(r.amount, prev.has(r.key) ? prev.get(r.key).amount : null) }));
    meta.compare = { mode: compare, ...cr, total: round2([...prev.values()].reduce((a, v) => a + v.amount, 0)) };
  }
  if (top) rows = rows.slice(0, top);
  return { data: rows.map(({ key, ...r }) => r), meta, codes: ["before_data_start", "unposted_entries"], range: { from, to } };
});

route("/aging", async (req, ctx) => {
  const side = oneOf(req, "side", ["customers", "suppliers"], null);
  if (!side) throw badRequest("side must be customers or suppliers");
  const asOf = asOfOf(req);
  const excludeGroup = flag(req, "excludeGroupCompanies");
  const wanted = optionalAccounts(req, ctx);
  let keys = ctx.keysOfGroups(ctx.rules.balanceGroups[side] || []);
  if (wanted.length) keys = wanted;
  const lines = await accountLines(ctx, keys, { asOf });
  let rows = agingRows(ctx, lines, side, asOf);
  if (excludeGroup) rows = rows.filter((r) => !r.isGroupCompany);
  const totals = { balance: 0, openTotal: 0, buckets: emptyBuckets() };
  for (const r of rows) { totals.balance = round2(totals.balance + r.balance); totals.openTotal = round2(totals.openTotal + r.openTotal); for (const b of AGE_BUCKETS) totals.buckets[b] = round2(totals.buckets[b] + r.buckets[b]); }
  const methods = { matched: rows.filter((r) => r.method === "matched").length, oldest_first: rows.filter((r) => r.method === "oldest_first").length };
  return {
    data: rows, meta: { side, asOf, excludeGroupCompanies: excludeGroup, totals, methods, untied: rows.filter((r) => !r.tie).map((r) => r.accountKey), sign: side === "suppliers" ? "plus = the company owes the supplier" : "plus = the customer owes the company" },
    codes: side === "suppliers" ? ["supplier_balances_suspect"] : [],
  };
});

route("/intercompany", async (req, ctx) => {
  const asOf = asOfOf(req);
  const { from } = dateRange(req, { required: false, defaultFrom: null });
  const list = ctx.rules.intercompany || [];
  const keys = list.map((x) => x.accountKey).filter((k) => ctx.accounts.has(k));
  const params = { companyId: ctx.companyId, asOf };
  const rows = keys.length
    ? await financeSql(
        `SELECT l.account_key, SUM(l.signed_amount) AS balance,
                SUM(IF(${from ? "e.value_date >= :from" : "1 = 1"} AND l.side = 'debit', l.amount, 0)) AS debit,
                SUM(IF(${from ? "e.value_date >= :from" : "1 = 1"} AND l.side = 'credit', l.amount, 0)) AS credit,
                MIN(e.value_date) AS first_date, MAX(e.value_date) AS last_date, COUNT(*) AS n
           ${JOURNAL} WHERE ${LIVE} AND e.status = 1 AND ${inList("l.account_key", keys, params, "k")} AND e.value_date < DATE_ADD(:asOf, INTERVAL 1 DAY)
          GROUP BY l.account_key`,
        from ? { ...params, from } : params,
      )
    : [];
  const byKey = new Map(rows.map((r) => [r.account_key, r]));
  const data = list.map((x) => {
    const a = ctx.account(x.accountKey), r = byKey.get(x.accountKey);
    return {
      accountKey: x.accountKey, name: a.name, group: a.group, groupName: a.groupName, kind: x.kind, confirmed: x.confirmed !== false,
      balance: round2(r?.balance), balanceSide: !r || Math.abs(num(r.balance)) < EPS ? "zero" : num(r.balance) > 0 ? "debit" : "credit",
      movement: { from: from || "start", debit: round2(r?.debit), credit: round2(r?.credit), lines: num(r?.n) },
      firstDate: day(r?.first_date), lastDate: day(r?.last_date), loaded: ctx.accounts.has(x.accountKey),
    };
  });
  return {
    data, meta: { asOf, from: from || null, sign: "plus = debit (they owe the company), minus = credit (the company owes them)", totals: { debit: round2(data.filter((d) => d.balance > 0).reduce((a, d) => a + d.balance, 0)), credit: round2(-data.filter((d) => d.balance < 0).reduce((a, d) => a + d.balance, 0)) } },
    codes: ["other_company_missing"],
  };
});

// ── endpoints: accountant ────────────────────────────────────────────────

route("/trial-balance", async (req, ctx) => {
  const asOf = asOfOf(req);
  const from = optionalDate(req, "from", null);
  if (from && from > asOf) throw badRequest("from must not be after asOf");
  const groups = csv(req.query.group).map(Number);
  if (groups.some((g) => !Number.isInteger(g))) throw badRequest("group must be a comma-separated list of numbers");
  const includeUnposted = flag(req, "includeUnposted");
  const params = { companyId: ctx.companyId, asOf };
  if (from) params.from = from;
  const rows = await financeSql(
    `SELECT l.account_key,
            SUM(IF(${from ? "e.value_date >= :from" : "1 = 1"} AND l.side = 'debit', l.amount, 0)) AS debit,
            SUM(IF(${from ? "e.value_date >= :from" : "1 = 1"} AND l.side = 'credit', l.amount, 0)) AS credit,
            SUM(IF(${from ? "e.value_date < :from" : "1 = 0"}, l.signed_amount, 0)) AS opening,
            SUM(l.signed_amount) AS balance, COUNT(*) AS n
       ${JOURNAL} WHERE ${LIVE} ${postedSql(includeUnposted)} AND e.value_date < DATE_ADD(:asOf, INTERVAL 1 DAY)
      GROUP BY l.account_key ORDER BY l.account_key`,
    params,
  );
  const data = rows
    .map((r) => {
      const a = ctx.account(r.account_key);
      const row = { accountKey: r.account_key, name: a.name, group: a.group, groupName: a.groupName, debit: round2(r.debit), credit: round2(r.credit), balance: round2(r.balance), lines: num(r.n) };
      if (from) row.opening = round2(r.opening);
      return row;
    })
    .filter((r) => !groups.length || groups.includes(r.group));
  const totals = data.reduce((t, r) => ({ debit: round2(t.debit + r.debit), credit: round2(t.credit + r.credit), balance: round2(t.balance + r.balance) }), { debit: 0, credit: 0, balance: 0 });
  const warnings = [];
  if (!groups.length && Math.abs(totals.debit - totals.credit) > 0.01)
    warnings.push({ code: "trial_balance_unbalanced", severity: "high", message: `debit ${totals.debit} and credit ${totals.credit} differ by ${round2(totals.debit - totals.credit)}`, affects: [] });
  return { data, meta: { asOf, from: from || null, group: groups.length ? groups : "all", includeUnposted, totals, balanced: Math.abs(totals.debit - totals.credit) <= 0.01 }, warnings, codes: ["unposted_entries"], range: { from, to: asOf } };
});

// `account` or `q` → one account. Several matches → { ambiguous } for the caller to list.
function resolveOneAccount(req, ctx) {
  const keys = optionalAccounts(req, ctx);
  if (keys.length > 1) throw badRequest("one account only");
  if (keys.length === 1) return { account: ctx.account(keys[0]) };
  const found = searchAccounts(req, ctx);
  if (!found) throw badRequest("missing account (account key) or q (name)");
  if (!found.length) throw new ApiError(404, "not_found", `no account matches ${req.query.q}`);
  if (found.length > 1) return { ambiguous: found.map(accountRef) };
  return { account: found[0] };
}

route("/ledger", async (req, ctx) => {
  const one = resolveOneAccount(req, ctx);
  if (one.ambiguous) return { data: null, meta: { ambiguous: true, accounts: one.ambiguous } };
  const { account } = one;
  const { from, to } = dateRange(req, { required: true });
  const includeUnposted = flag(req, "includeUnposted");
  const { limit, offset } = paging(req);
  const params = { companyId: ctx.companyId, key: account.accountKey, from, toNext: addDays(to, 1) };
  const [open] = await financeSql(
    `SELECT SUM(l.signed_amount) AS opening ${JOURNAL} WHERE ${LIVE} ${postedSql(includeUnposted)} AND l.account_key = :key AND e.value_date < :from`,
    params,
  );
  const rows = await financeSql(
    `SELECT l.line_id, l.fiscal_year, l.trans_id, e.batch_no, e.status, e.trans_type, e.reference, e.description, e.details, e.cost_code,
            DATE_FORMAT(e.value_date, '%Y-%m-%d') AS d, DATE_FORMAT(e.due_date, '%Y-%m-%d') AS due, l.side, l.amount, l.signed_amount,
            e.debit_account, e.credit_account, e.cheque_id, e.document_id,
            EXISTS(SELECT 1 FROM ledger_matches m WHERE m.company_id = l.company_id AND m.journal_line_id = l.line_id AND m.deleted_at IS NULL) AS lmatched,
            EXISTS(SELECT 1 FROM bank_matches b WHERE b.company_id = l.company_id AND b.side = 'book' AND b.linked_id = l.line_id AND b.deleted_at IS NULL) AS bmatched
       ${JOURNAL} WHERE ${LIVE} ${postedSql(includeUnposted)} AND l.account_key = :key AND e.value_date >= :from AND e.value_date < :toNext
      ORDER BY e.value_date, l.trans_id, l.line_id`,
    params,
  );
  let running = round2(open?.opening);
  const openingBalance = running;
  const all = rows.map((r) => {
    running = round2(running + num(r.signed_amount));
    const counter = r.debit_account === account.accountKey ? r.credit_account : r.credit_account === account.accountKey ? r.debit_account : null;
    return {
      date: r.d, dueDate: r.due, year: r.fiscal_year, transId: r.trans_id, lineId: r.line_id, batch: r.batch_no, type: r.trans_type, reference: r.reference,
      description: r.description, details: r.details || null, costCode: r.cost_code ? String(r.cost_code).trim() || null : null,
      counterAccount: counter, counterName: counter ? ctx.account(counter).name : null,
      debit: r.side === "debit" ? round2(r.amount) : 0, credit: r.side === "credit" ? round2(r.amount) : 0, runningBalance: running,
      posted: r.status === 1, matched: Boolean(num(r.lmatched)) || Boolean(num(r.bmatched)), matchKind: num(r.lmatched) ? "ledger" : num(r.bmatched) ? "bank" : null,
      chequeId: r.cheque_id || null, documentId: r.document_id || null,
    };
  });
  const data = all.slice(offset, offset + limit);
  const debit = round2(all.reduce((a, r) => a + r.debit, 0)), credit = round2(all.reduce((a, r) => a + r.credit, 0));
  return {
    data,
    meta: { account: accountRef(account), from, to, includeUnposted, limit, offset, total: all.length, openingBalance, closingBalance: running, debit, credit, sign: "balance: debit is plus" },
    codes: ["unposted_entries"], range: { from, to },
  };
});

const entryRow = (ctx, r) => ({
  year: r.fiscal_year, transId: r.trans_id, date: day(r.value_date), dueDate: day(r.due_date), batch: r.batch_no, posted: r.status === 1, type: r.trans_type,
  reference: r.reference, reference2: r.reference2 || null, description: r.description, details: r.details || null, amount: round2(r.amount),
  debitAccount: r.debit_account, debitName: r.debit_account ? ctx.account(r.debit_account).name || r.debit_name : null,
  creditAccount: r.credit_account, creditName: r.credit_account ? ctx.account(r.credit_account).name || r.credit_name : null,
  costCode: r.cost_code ? String(r.cost_code).trim() || null : null, branch: ctx.branchResolver(r.cost_code, r.debit_account, r.description).branch?.branch || null,
  chequeId: r.cheque_id || null, documentId: r.document_id || null, allocationNumber: r.tax_alloc_number || null, lineCount: num(r.line_count),
});

route("/journal", async (req, ctx) => {
  const { from, to } = dateRange(req, { required: false });
  const { limit, offset } = paging(req);
  const batch = positiveInt(req, "batch", null);
  const reference = positiveInt(req, "reference", null);
  const type = String(req.query.type ?? "").trim() || null;
  const q = String(req.query.q ?? "").trim() || null;
  const posted = oneOf(req, "posted", ["0", "1"], null);
  const accounts = optionalAccounts(req, ctx);
  const params = { companyId: ctx.companyId };
  const where = [`e.company_id = :companyId`, `e.deleted_at IS NULL`];
  if (from) { params.from = from; where.push("e.value_date >= :from"); }
  if (to && (from || req.query.to)) { params.toNext = addDays(to, 1); where.push("e.value_date < :toNext"); }
  if (batch != null) { params.batch = batch; where.push("e.batch_no = :batch"); }
  if (reference != null) { params.reference = reference; where.push("(e.reference = :reference OR e.reference2 = :reference OR e.reference3 = :reference)"); }
  if (type) { params.type = type; where.push("e.trans_type = :type"); }
  if (posted) { params.posted = Number(posted); where.push("e.status = :posted"); }
  if (q) { params.q = `%${q}%`; where.push("(e.description LIKE :q OR e.details LIKE :q OR e.debit_name LIKE :q OR e.credit_name LIKE :q)"); }
  if (accounts.length) where.push(`EXISTS (SELECT 1 FROM journal_lines x WHERE x.company_id = e.company_id AND x.fiscal_year = e.fiscal_year AND x.trans_id = e.trans_id AND x.deleted_at IS NULL AND ${inList("x.account_key", accounts, params, "a")})`);
  const [cnt] = await financeSql(`SELECT COUNT(*) AS n, SUM(e.amount) AS amount FROM journal_entries e WHERE ${where.join(" AND ")}`, params);
  const rows = await financeSql(
    `SELECT e.*, (SELECT COUNT(*) FROM journal_lines x WHERE x.company_id = e.company_id AND x.fiscal_year = e.fiscal_year AND x.trans_id = e.trans_id AND x.deleted_at IS NULL) AS line_count
       FROM journal_entries e WHERE ${where.join(" AND ")} ORDER BY e.value_date, e.trans_id LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return {
    data: rows.map((r) => entryRow(ctx, r)),
    meta: { from: from || null, to: from || req.query.to ? to : null, batch, reference, type, q, posted: posted == null ? "all" : posted === "1", accounts: accounts.length ? accounts : "all", limit, offset, total: num(cnt?.n), amount: round2(cnt?.amount) },
    codes: ["unposted_entries"], range: { from, to: from || req.query.to ? to : null },
  };
});

route("/journal/:year/:transId", async (req, ctx) => {
  const year = Number(req.params.year), transId = Number(req.params.transId);
  if (!Number.isInteger(year) || !Number.isInteger(transId)) throw badRequest("year and transId must be numbers");
  const params = { companyId: ctx.companyId, year, transId };
  const [e] = await financeSql(
    `SELECT e.*, (SELECT COUNT(*) FROM journal_lines x WHERE x.company_id = e.company_id AND x.fiscal_year = e.fiscal_year AND x.trans_id = e.trans_id AND x.deleted_at IS NULL) AS line_count
       FROM journal_entries e WHERE e.company_id = :companyId AND e.fiscal_year = :year AND e.trans_id = :transId AND e.deleted_at IS NULL`,
    params,
  );
  if (!e) throw new ApiError(404, "not_found", `no entry ${year}/${transId}`);
  const lines = await financeSql(
    `SELECT l.line_id, l.account_key, l.side, l.amount, l.signed_amount, l.extra,
            EXISTS(SELECT 1 FROM ledger_matches m WHERE m.company_id = l.company_id AND m.journal_line_id = l.line_id AND m.deleted_at IS NULL) AS lmatched,
            EXISTS(SELECT 1 FROM bank_matches b WHERE b.company_id = l.company_id AND b.side = 'book' AND b.linked_id = l.line_id AND b.deleted_at IS NULL) AS bmatched
       FROM journal_lines l WHERE l.company_id = :companyId AND l.fiscal_year = :year AND l.trans_id = :transId AND l.deleted_at IS NULL ORDER BY l.line_id`,
    params,
  );
  let document = null;
  if (e.document_id) {
    const [d] = await financeSql(`SELECT * FROM documents WHERE company_id = :companyId AND document_id = :id AND deleted_at IS NULL ORDER BY fiscal_year DESC LIMIT 1`, { companyId: ctx.companyId, id: e.document_id });
    if (d) {
      const dl = await financeSql(`SELECT * FROM document_lines WHERE company_id = :companyId AND fiscal_year = :y AND document_id = :id AND deleted_at IS NULL ORDER BY line_num, document_line_id`, { companyId: ctx.companyId, y: d.fiscal_year, id: d.document_id });
      document = {
        documentId: d.document_id, year: d.fiscal_year, type: d.document_type, number: d.doc_number, status: d.status, account: d.account_key, accountName: d.account_name,
        date: day(d.value_date), dueDate: day(d.due_date), total: round2(d.total), totalVat: round2(d.total_vat), totalVatFree: round2(d.total_vat_free), vatPct: d.vat_pct, allocationNumber: d.tax_alloc_number || null,
        lines: dl.map((x) => ({ line: x.line_num, item: x.item_key, name: x.item_name, quantity: x.quantity, price: round2(x.price), total: round2(x.total), vatPct: x.vat_pct, account: x.journal_account })),
      };
    }
  }
  let cheque = null;
  if (e.cheque_id) {
    const [c] = await financeSql(`SELECT * FROM cheques WHERE company_id = :companyId AND cheque_id = :id AND deleted_at IS NULL ORDER BY fiscal_year DESC LIMIT 1`, { companyId: ctx.companyId, id: e.cheque_id });
    if (c) cheque = { chequeId: c.cheque_id, account: c.account_key, payee: c.payee_name, amount: round2(c.amount_to_pay), dueDate: day(c.due_date), issueDate: day(c.issue_date), reference: c.reference, bankAccount: c.bank_key };
  }
  const debit = round2(lines.filter((l) => l.side === "debit").reduce((a, l) => a + num(l.amount), 0));
  const credit = round2(lines.filter((l) => l.side === "credit").reduce((a, l) => a + num(l.amount), 0));
  return {
    data: {
      ...entryRow(ctx, e),
      lines: lines.map((l) => ({ lineId: l.line_id, accountKey: l.account_key, name: ctx.account(l.account_key).name, group: ctx.account(l.account_key).group, side: l.side, amount: round2(l.amount), matched: Boolean(num(l.lmatched)) || Boolean(num(l.bmatched)), matchKind: num(l.lmatched) ? "ledger" : num(l.bmatched) ? "bank" : null, percent: parseJson(l.extra, {})?.PercenF ?? null })),
      balanced: Math.abs(debit - credit) <= 0.01, document, cheque,
    },
    meta: { year, transId, debit, credit },
    codes: [],
  };
});

route("/bank/reconciliation", async (req, ctx, facts) => {
  const wanted = optionalAccounts(req, ctx);
  const keys = wanted.length ? wanted : ctx.bankAccounts;
  const unknown = keys.filter((k) => !ctx.bankAccounts.includes(k));
  if (unknown.length) throw badRequest(`${unknown.join(",")} is not a bank account (bank accounts: ${ctx.bankAccounts.join(", ") || "none"})`);
  const params = { companyId: ctx.companyId };
  const bankAge = await financeSql(
    `SELECT account_key, DATEDIFF(CURRENT_DATE, line_date) AS age, COUNT(*) AS n, SUM(signed_amount) AS amt FROM bank_lines
      WHERE company_id = :companyId AND deleted_at IS NULL AND is_matched = 0 AND ${inList("account_key", keys, params, "k")} GROUP BY 1, 2`,
    params,
  );
  const bookAge = await financeSql(
    `SELECT l.account_key, DATEDIFF(CURRENT_DATE, e.value_date) AS age, COUNT(*) AS n, SUM(l.signed_amount) AS amt
       ${JOURNAL} WHERE ${LIVE} AND e.status = 1 AND ${inList("l.account_key", keys, params, "k")}
        AND NOT EXISTS (SELECT 1 FROM bank_matches m WHERE m.company_id = l.company_id AND m.side = 'book' AND m.linked_id = l.line_id AND m.deleted_at IS NULL)
      GROUP BY 1, 2`,
    params,
  );
  const ageKey = (a) => (a <= 30 ? "0-30" : a <= 90 ? "31-90" : "91+");
  const agesOf = (rows, key) => {
    const out = { "0-30": { count: 0, amount: 0 }, "31-90": { count: 0, amount: 0 }, "91+": { count: 0, amount: 0 } };
    for (const r of rows.filter((x) => x.account_key === key)) { const b = out[ageKey(num(r.age))]; b.count += num(r.n); b.amount = round2(b.amount + num(r.amt)); }
    return out;
  };
  const warnings = [];
  const data = facts.banks.filter((b) => keys.includes(b.accountKey)).map(({ turnover, ...b }) => {
    const bankMatched = round2(b.bankBalance - b.bankOpen), bookMatched = round2(b.bookBalance - b.bookOpen);
    if (Math.abs(bankMatched - bookMatched) > 0.01)
      warnings.push({ code: "bank_matched_differs", severity: "high", message: `bank ${b.accountKey}: matched bank lines add up to ${bankMatched} and matched book lines to ${bookMatched}`, affects: [b.accountKey] });
    return { ...b, bankMatched, bookMatched, gap: round2(b.bankBalance - b.bookBalance), openAge: { bank: agesOf(bankAge, b.accountKey), book: agesOf(bookAge, b.accountKey) } };
  });
  return { data, meta: { accounts: keys, sign: "bank: money in is plus; book: debit is plus" }, warnings, codes: ["bank_gap"] };
});

route("/bank/open", async (req, ctx) => {
  const side = oneOf(req, "side", ["bank", "book"], null);
  if (!side) throw badRequest("side must be bank or book");
  const wanted = optionalAccounts(req, ctx);
  const keys = wanted.length ? wanted : ctx.bankAccounts;
  const minAge = positiveInt(req, "minAge", 0);
  const { from, to } = dateRange(req, { required: false });
  const { limit, offset } = paging(req);
  const includeUnposted = flag(req, "includeUnposted");
  const params = { companyId: ctx.companyId };
  if (minAge > 0) params.minAge = minAge;
  const hasRange = Boolean(from || req.query.to);
  let countSql, sql;
  if (side === "bank") {
    const where = `company_id = :companyId AND deleted_at IS NULL AND is_matched = 0 AND ${inList("account_key", keys, params, "k")}
                   ${minAge > 0 ? "AND DATEDIFF(CURRENT_DATE, line_date) >= :minAge" : ""} ${hasRange ? rangeSql("line_date", from, to, params) : ""}`;
    countSql = `SELECT COUNT(*) AS n, SUM(signed_amount) AS amt FROM bank_lines WHERE ${where}`;
    sql = `SELECT bank_line_id, fiscal_year, account_key, DATE_FORMAT(line_date, '%Y-%m-%d') AS d, reference, details, direction, amount, signed_amount,
                  DATEDIFF(CURRENT_DATE, line_date) AS age FROM bank_lines WHERE ${where} ORDER BY line_date, bank_line_id LIMIT ${limit} OFFSET ${offset}`;
  } else {
    const where = `${LIVE} ${postedSql(includeUnposted)} AND ${inList("l.account_key", keys, params, "k")}
                   AND NOT EXISTS (SELECT 1 FROM bank_matches m WHERE m.company_id = l.company_id AND m.side = 'book' AND m.linked_id = l.line_id AND m.deleted_at IS NULL)
                   ${minAge > 0 ? "AND DATEDIFF(CURRENT_DATE, e.value_date) >= :minAge" : ""} ${hasRange ? rangeSql("e.value_date", from, to, params) : ""}`;
    countSql = `SELECT COUNT(*) AS n, SUM(l.signed_amount) AS amt ${JOURNAL} WHERE ${where}`;
    sql = `SELECT l.line_id, l.fiscal_year, l.trans_id, l.account_key, DATE_FORMAT(e.value_date, '%Y-%m-%d') AS d, e.reference, e.description, e.trans_type, e.status,
                  e.debit_account, e.credit_account, e.cheque_id, l.side, l.amount, l.signed_amount, DATEDIFF(CURRENT_DATE, e.value_date) AS age
             ${JOURNAL} WHERE ${where} ORDER BY e.value_date, l.line_id LIMIT ${limit} OFFSET ${offset}`;
  }
  const [cnt] = await financeSql(countSql, params);
  const rows = await financeSql(sql, params);
  const data = rows.map((r) =>
    side === "bank"
      ? { bankLineId: r.bank_line_id, year: r.fiscal_year, account: r.account_key, date: r.d, reference: r.reference, details: r.details, direction: r.direction, amount: round2(r.amount), signedAmount: round2(r.signed_amount), ageDays: num(r.age) }
      : { lineId: r.line_id, year: r.fiscal_year, transId: r.trans_id, account: r.account_key, date: r.d, reference: r.reference, description: r.description, type: r.trans_type, posted: r.status === 1,
          counterAccount: r.debit_account === r.account_key ? r.credit_account : r.debit_account, side: r.side, amount: round2(r.amount), signedAmount: round2(r.signed_amount), chequeId: r.cheque_id || null, ageDays: num(r.age) },
  );
  // cheque lines of the bank get the beneficiary from Hashavshevet (payee / payeeSource: cheques, journal, missing)
  const payees = side === "bank" ? await addChequePayees(data, { company: ctx.companyId, bankAccounts: ctx.bankAccounts }) : undefined;
  return { data, meta: { side, accounts: keys, minAge, from: from || null, to: hasRange ? to : null, includeUnposted, limit, offset, total: num(cnt?.n), amount: round2(cnt?.amount ?? cnt?.amt), ...(payees ? { payees } : {}) }, codes: ["bank_gap"] };
});

route("/bank/suggestions", async (req, ctx) => {
  const wanted = optionalAccounts(req, ctx);
  const keys = wanted.length ? wanted : ctx.bankAccounts;
  const days = positiveInt(req, "days", 30);
  const minAmount = optionalNumber(req, "minAmount", 0);
  const { limit, offset } = paging(req);
  const params = { companyId: ctx.companyId, minAmount };
  const bank = await financeSql(
    `SELECT bank_line_id, account_key, DATE_FORMAT(line_date, '%Y-%m-%d') AS d, reference, details, direction, amount FROM bank_lines
      WHERE company_id = :companyId AND deleted_at IS NULL AND is_matched = 0 AND amount >= :minAmount AND ${inList("account_key", keys, params, "k")} ORDER BY line_date, bank_line_id`,
    params,
  );
  const book = await financeSql(
    `SELECT l.line_id, l.fiscal_year, l.trans_id, l.account_key, DATE_FORMAT(e.value_date, '%Y-%m-%d') AS d, e.reference, e.description, l.side, l.amount
       ${JOURNAL} WHERE ${LIVE} AND e.status = 1 AND l.amount >= :minAmount AND ${inList("l.account_key", keys, params, "k")}
        AND NOT EXISTS (SELECT 1 FROM bank_matches m WHERE m.company_id = l.company_id AND m.side = 'book' AND m.linked_id = l.line_id AND m.deleted_at IS NULL)`,
    params,
  );
  // money in at the bank = a debit on the bank account in the books
  const byKey = new Map();
  for (const b of book) {
    const k = `${b.account_key}|${b.side === "debit" ? "in" : "out"}|${round2(b.amount)}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(b);
  }
  const all = [];
  for (const b of bank) {
    const cands = (byKey.get(`${b.account_key}|${b.direction}|${round2(b.amount)}`) || [])
      .map((c) => ({ lineId: c.line_id, year: c.fiscal_year, transId: c.trans_id, date: c.d, reference: c.reference, description: c.description, amount: round2(c.amount), daysApart: Math.abs(daysBetween(c.d, b.d)) }))
      .filter((c) => c.daysApart <= days)
      .sort((x, y) => x.daysApart - y.daysApart);
    if (!cands.length) continue;
    all.push({ bankLineId: b.bank_line_id, account: b.account_key, bankDate: b.d, reference: b.reference, details: b.details, direction: b.direction, amount: round2(b.amount), candidates: cands, confidence: cands.length === 1 ? "single" : "many" });
  }
  const page = all.slice(offset, offset + limit);
  const payees = await addChequePayees(page, { company: ctx.companyId, bankAccounts: ctx.bankAccounts });
  return {
    data: page,
    meta: { accounts: keys, days, minAmount, limit, offset, total: all.length, openBankLines: bank.length, openBookLines: book.length, payees, single: all.filter((x) => x.confidence === "single").length, many: all.filter((x) => x.confidence === "many").length, matching: "one bank line to one book line, same amount and direction", note: "suggestions only; the accountant matches in Hashavshevet" },
    codes: ["bank_gap"],
  };
});

route("/invoices", async (req, ctx) => {
  const { from, to } = dateRange(req, { required: true });
  const type = oneOf(req, "type", ["invoice", "credit"], null);
  const accounts = optionalAccounts(req, ctx);
  const q = String(req.query.q ?? "").trim() || null;
  const { limit, offset } = paging(req);
  const includeUnposted = flag(req, "includeUnposted");
  const inv = ctx.rules.invoiceTypes.customer || [], cr = ctx.rules.invoiceTypes.customerCredit || [];
  const types = type === "invoice" ? inv : type === "credit" ? cr : [...inv, ...cr];
  const params = { companyId: ctx.companyId };
  const where = [`e.company_id = :companyId`, `e.deleted_at IS NULL`, inList("e.trans_type", types, params, "t"), rangeSql("e.value_date", from, to, params).replace(/^AND /, "")];
  if (!includeUnposted) where.push("e.status = 1");
  const accExpr = `IF(${inList("e.trans_type", cr, params, "c")}, e.credit_account, e.debit_account)`;
  if (accounts.length) where.push(inList(accExpr, accounts, params, "a"));
  if (q) { params.q = `%${q}%`; where.push(`(e.debit_name LIKE :q OR e.credit_name LIKE :q OR e.description LIKE :q)`); }
  const [cnt] = await financeSql(`SELECT COUNT(*) AS n FROM journal_entries e WHERE ${where.join(" AND ")}`, params);
  const rows = await financeSql(
    `SELECT e.fiscal_year, e.trans_id, e.trans_type, e.reference, DATE_FORMAT(e.value_date, '%Y-%m-%d') AS d, DATE_FORMAT(e.due_date, '%Y-%m-%d') AS due, e.amount, e.status, e.description, e.document_id, e.tax_alloc_number,
            ${accExpr} AS acc
       FROM journal_entries e WHERE ${where.join(" AND ")} ORDER BY e.value_date, e.trans_id LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const register = ctx.rules.balanceGroups.registerCustomers || [];
  const data = rows.map((r) => {
    const a = ctx.account(r.acc);
    const credit = cr.includes(r.trans_type);
    return { year: r.fiscal_year, transId: r.trans_id, docNumber: r.reference, date: r.d, dueDate: r.due, kind: register.includes(a.group) ? "register" : "customer", accountKey: r.acc, customerName: a.name, type: credit ? "credit" : "invoice", typeCode: r.trans_type, amount: round2(credit ? -num(r.amount) : num(r.amount)), posted: r.status === 1, description: r.description, documentId: r.document_id || null, allocationNumber: r.tax_alloc_number || null };
  });
  const [tot] = await financeSql(`SELECT SUM(IF(${inList("e.trans_type", cr, params, "c")}, -e.amount, e.amount)) AS amount FROM journal_entries e WHERE ${where.join(" AND ")}`, params);
  return { data, meta: { from, to, type: type || "all", accounts: accounts.length ? accounts : "all", q, includeUnposted, limit, offset, total: num(cnt?.n), amount: round2(tot?.amount), withVat: true }, codes: ["income_not_posted", "before_data_start", "unposted_entries"], range: { from, to } };
});

route("/statement", async (req, ctx) => {
  const one = resolveOneAccount(req, ctx);
  if (one.ambiguous) return { data: null, meta: { ambiguous: true, accounts: one.ambiguous } };
  const { account } = one;
  const { from, to } = dateRange(req, { required: false });
  const asOf = to;
  const g = account.group;
  const side = (ctx.rules.balanceGroups.suppliers || []).includes(g) ? "suppliers" : (ctx.rules.balanceGroups.customers || []).includes(g) ? "customers" : null;
  const all = await accountLines(ctx, [account.accountKey], { asOf });
  const inRange = all.filter((l) => !from || l.date >= from);
  const it = ctx.rules.invoiceTypes;
  const invoiceTypes = side === "suppliers" ? it.supplier : side === "customers" ? it.customer : [];
  const creditTypes = side === "customers" ? it.customerCredit : [];
  const sign = side === "suppliers" ? -1 : 1;
  const invoiceSide = side === "suppliers" ? -1 : 1; // the sign of an invoice line for this side
  const classify = (l) => (invoiceTypes.includes(l.type) ? "invoice" : creditTypes.includes(l.type) ? "credit" : side && l.signed * invoiceSide > 0 ? "other" : "payment");
  const row = (l) => ({ date: l.date, dueDate: l.dueDate, year: l.year, transId: l.transId, lineId: l.lineId, type: l.type, reference: l.reference, description: l.description, debit: l.signed > 0 ? round2(l.signed) : 0, credit: l.signed < 0 ? round2(-l.signed) : 0, amount: round2(sign * l.signed), matched: l.matched, kind: classify(l) });
  const movements = inRange.map(row);
  const { method, items } = side ? openItems(all, side) : { method: "none", items: [] };
  const balance = round2(sign * all.reduce((a, l) => a + l.signed, 0));
  const opening = round2(sign * all.filter((l) => from && l.date < from).reduce((a, l) => a + l.signed, 0));
  const sum = (k) => round2(movements.filter((m) => m.kind === k).reduce((a, m) => a + m.amount, 0));
  return {
    data: {
      account: { ...accountRef(account), side: side || "other", isGroupCompany: ctx.isGroupCompany(account.accountKey), taxFileNum: account.taxFileNum },
      invoices: movements.filter((m) => m.kind === "invoice"), credits: movements.filter((m) => m.kind === "credit"), payments: movements.filter((m) => m.kind === "payment"), others: movements.filter((m) => m.kind === "other"),
      openItems: items.map((i) => ({ ...row(i), open: i.open, ageDays: daysBetween(i.dueDate || i.date, asOf), bucket: ageBucket(daysBetween(i.dueDate || i.date, asOf)), unapplied: Boolean(i.unapplied) })),
      balance, openingBalance: from ? opening : null, totals: { invoices: sum("invoice"), credits: sum("credit"), payments: sum("payment"), others: sum("other"), open: round2(items.reduce((a, i) => a + i.open, 0)) }, buckets: bucketItems(items, asOf),
    },
    meta: { account: accountRef(account), from: from || null, to, asOf, method, invoiceTypes, kinds: { invoice: "an entry type of the invoice list", credit: "a credit note type", other: "a line on the invoice side without an invoice type", payment: "every other line" }, sign: side === "suppliers" ? "plus = the company owes the supplier" : side === "customers" ? "plus = the customer owes the company" : "plus = debit" },
    codes: side === "suppliers" ? ["supplier_balances_suspect"] : [],
  };
});

route("/cheques", async (req, ctx) => {
  const state = oneOf(req, "state", ["future", "due", "cleared", "not_cleared", "returned"], null);
  const accounts = optionalAccounts(req, ctx);
  const { from, to } = dateRange(req, { required: false });
  const hasRange = Boolean(from || req.query.to);
  const { limit, offset } = paging(req);
  const all = await chequeRows(ctx, { accounts, from, to: hasRange ? to : null });
  const totals = {};
  for (const c of all) { totals[c.state] = totals[c.state] || { count: 0, amount: 0 }; totals[c.state].count += 1; totals[c.state].amount = round2(totals[c.state].amount + c.amount); }
  const now = today();
  const filtered = state == null ? all : state === "due" ? all.filter((c) => c.dueDate && c.dueDate <= now) : state === "returned" ? [] : all.filter((c) => c.state === state);
  return {
    data: filtered.slice(offset, offset + limit).map(({ cleared, ...c }) => c),
    meta: { state: state || "all", accounts: accounts.length ? accounts : "all", from: from || null, to: hasRange ? to : null, limit, offset, total: filtered.length, totals, notAvailable: ["returned"], note: "returned cheques cannot be found yet; the accountant must say how they are recorded" },
    codes: ["bank_gap"],
  };
});

route("/vat", async (req, ctx) => {
  const { from, to } = dateRange(req, { required: true });
  const includeUnposted = flag(req, "includeUnposted");
  const v = ctx.rules.vatAccounts;
  const keys = [v.sales, v.input, v.assets, v.settlement].filter(Boolean);
  const params = { companyId: ctx.companyId };
  const rows = await financeSql(
    `SELECT DATE_FORMAT(e.value_date, '%Y-%m') AS m, l.account_key, SUM(IF(l.side = 'debit', l.amount, 0)) AS debit, SUM(IF(l.side = 'credit', l.amount, 0)) AS credit
       ${JOURNAL} WHERE ${LIVE} ${postedSql(includeUnposted)} AND ${inList("l.account_key", keys, params, "k")} ${rangeSql("e.value_date", from, to, params)} GROUP BY 1, 2`,
    params,
  );
  const bal = await financeSql(
    `SELECT l.account_key, SUM(l.signed_amount) AS balance ${JOURNAL} WHERE ${LIVE} ${postedSql(includeUnposted)} AND ${inList("l.account_key", keys, params, "k")} AND e.value_date < :toNext GROUP BY 1`,
    params,
  );
  const months = new Map(monthsOf(from, to).map((m) => [m, { month: m, salesVat: 0, inputVat: 0, assetVat: 0, settlement: { debit: 0, credit: 0 } }]));
  for (const r of rows) {
    const x = months.get(r.m);
    if (!x) continue;
    if (r.account_key === v.sales) x.salesVat = round2(num(r.credit) - num(r.debit));
    else if (r.account_key === v.input) x.inputVat = round2(num(r.debit) - num(r.credit));
    else if (r.account_key === v.assets) x.assetVat = round2(num(r.debit) - num(r.credit));
    else if (r.account_key === v.settlement) x.settlement = { debit: round2(r.debit), credit: round2(r.credit) };
  }
  const data = [...months.values()].map((x) => ({ ...x, toPay: round2(x.salesVat - x.inputVat - x.assetVat) }));
  const totals = data.reduce((t, x) => ({ salesVat: round2(t.salesVat + x.salesVat), inputVat: round2(t.inputVat + x.inputVat), assetVat: round2(t.assetVat + x.assetVat), toPay: round2(t.toPay + x.toPay) }), { salesVat: 0, inputVat: 0, assetVat: 0, toPay: 0 });
  return {
    data,
    meta: { from, to, includeUnposted, accounts: Object.fromEntries(Object.entries(v).map(([k, key]) => [k, { accountKey: key, name: ctx.account(key).name }])), totals, balancesAtTo: Object.fromEntries(bal.map((b) => [b.account_key, round2(b.balance)])), source: "books", note: "book totals only; the 874 report runs are in /vat/issues" },
    codes: ["income_not_posted", "before_data_start", "unposted_entries"], range: { from, to },
  };
});

route("/vat/issues", async (req, ctx) => {
  const { from, to } = dateRange(req, { required: false });
  const hasRange = Boolean(from || req.query.to);
  const params = { companyId: ctx.companyId };
  const rows = await financeSql(
    `SELECT issue_id, record_type, COUNT(*) AS n, SUM(amount) AS amount, SUM(base_amount) AS base, DATE_FORMAT(MIN(value_date), '%Y-%m-%d') AS d0, DATE_FORMAT(MAX(value_date), '%Y-%m-%d') AS d1
       FROM vat_lines WHERE company_id = :companyId AND deleted_at IS NULL GROUP BY issue_id, record_type ORDER BY issue_id`,
    params,
  );
  const runs = new Map();
  for (const r of rows) {
    if (!runs.has(r.issue_id)) runs.set(r.issue_id, { issueId: r.issue_id, from: r.d0, to: r.d1, lines: 0, amount: 0, byType: {} });
    const x = runs.get(r.issue_id);
    x.from = [x.from, r.d0].filter(Boolean).sort()[0]; x.to = [x.to, r.d1].filter(Boolean).sort().pop();
    x.lines += num(r.n); x.amount = round2(x.amount + num(r.amount));
    x.byType[r.record_type || "?"] = { count: num(r.n), amount: round2(r.amount), base: round2(r.base) };
  }
  let data = [...runs.values()];
  if (hasRange) data = data.filter((x) => (!from || !x.to || x.to >= from) && (!to || !x.from || x.from <= to));
  return { data, meta: { from: from || null, to: hasRange ? to : null, runs: data.length, recordTypes: [...new Set(rows.map((r) => r.record_type))].sort(), note: "the same period can have several runs; which run counts and what the record types mean must be confirmed" }, codes: [] };
});

route("/withholding", async (req, ctx) => {
  const { from, to } = dateRange(req, { required: false });
  const hasRange = Boolean(from || req.query.to);
  const expiring = positiveInt(req, "expiring", 60);
  const accounts = optionalAccounts(req, ctx);
  const types = ctx.rules.invoiceTypes.withholdingPayment || [];
  const wh = ctx.rules.withholdingAccounts || [];
  const supplierKeys = ctx.keysOfGroups(ctx.rules.balanceGroups.suppliers || []);
  const params = { companyId: ctx.companyId };
  const rows = await financeSql(
    `SELECT e.debit_account AS acc, COUNT(DISTINCT e.trans_id, e.fiscal_year) AS n, SUM(IF(l.account_key = e.debit_account AND l.side = 'debit', l.amount, 0)) AS paid,
            SUM(IF(${inList("l.account_key", wh, params, "w")} AND l.side = 'credit', l.amount, 0)) AS deducted, DATE_FORMAT(MAX(e.value_date), '%Y-%m-%d') AS last_date
       ${JOURNAL} WHERE ${LIVE} AND e.status = 1 AND ${inList("e.trans_type", types, params, "t")} ${hasRange ? rangeSql("e.value_date", from, to, params) : ""}
        ${accounts.length ? `AND ${inList("e.debit_account", accounts, params, "a")}` : ""} GROUP BY e.debit_account ORDER BY deducted DESC, paid DESC`,
    params,
  );
  const supplierSet = new Set(supplierKeys);
  const deductions = rows.filter((r) => supplierSet.has(r.acc)).map((r) => ({ accountKey: r.acc, name: ctx.account(r.acc).name, payments: num(r.n), paid: round2(r.paid), deducted: round2(r.deducted), deductedPct: pct(num(r.deducted), num(r.paid)), lastPayment: r.last_date }));
  const others = rows.filter((r) => !supplierSet.has(r.acc));
  const otherPayments = { accounts: others.length, payments: others.reduce((a, r) => a + num(r.n), 0), paid: round2(others.reduce((a, r) => a + num(r.paid), 0)), deducted: round2(others.reduce((a, r) => a + num(r.deducted), 0)) };
  const now = today(), soon = addDays(now, expiring);
  const certificates = supplierKeys.filter((k) => !accounts.length || accounts.includes(k)).map((k) => {
    const a = ctx.account(k);
    const validTo = a.deductionValidTo && a.deductionValidTo >= NO_CERTIFICATE_BEFORE ? a.deductionValidTo : null;
    const certificate = !validTo ? "none" : validTo < now ? "expired" : validTo <= soon ? "expiring" : "valid";
    return { accountKey: k, name: a.name, deductionPct: a.deductionPct, validTo, certificate, taxFileNum: a.taxFileNum };
  });
  const counts = certificates.reduce((c, x) => ((c[x.certificate] = (c[x.certificate] || 0) + 1), c), {});
  return {
    data: { deductions, certificates: certificates.filter((c) => c.certificate !== "none" || accounts.length), noCertificate: counts.none || 0 },
    meta: { from: from || null, to: hasRange ? to : null, expiring, paymentTypes: types, withholdingAccounts: wh, totals: { paid: round2(deductions.reduce((a, d) => a + d.paid, 0)), deducted: round2(deductions.reduce((a, d) => a + d.deducted, 0)) }, otherPayments, certificates: counts, note: "deductions: payments of the withholding entry type to supplier accounts; otherPayments = the same entry type to other accounts (employees)" },
    codes: [],
  };
});

export function allocationThreshold(thresholds, date) {
  let min = null;
  for (const t of (thresholds || []).slice().sort((a, b) => a.from.localeCompare(b.from))) if (t.from <= date) min = t.minAmount;
  return min;
}
export const allocationStatus = (value) => (!value || /^0+$/.test(String(value).trim()) ? "missing" : /^\d{5,}$/.test(String(value).trim()) ? "ok" : "suspect");

route("/allocation-numbers", async (req, ctx) => {
  const { from, to } = dateRange(req, { required: true });
  const minAmount = optionalNumber(req, "minAmount", null);
  const missingOnly = flag(req, "missingOnly");
  const accounts = optionalAccounts(req, ctx);
  const { limit, offset } = paging(req);
  const types = ctx.rules.invoiceTypes.supplier || [];
  const params = { companyId: ctx.companyId };
  const rows = await financeSql(
    `SELECT e.fiscal_year, e.trans_id, e.trans_type, DATE_FORMAT(e.value_date, '%Y-%m-%d') AS d, e.reference, e.amount, e.credit_account, e.debit_account, e.description, e.tax_alloc_number, e.document_id
       FROM journal_entries e WHERE e.company_id = :companyId AND e.deleted_at IS NULL AND e.status = 1 AND ${inList("e.trans_type", types, params, "t")} ${rangeSql("e.value_date", from, to, params)}
        ${accounts.length ? `AND ${inList("e.credit_account", accounts, params, "a")}` : ""} ORDER BY e.value_date, e.trans_id`,
    params,
  );
  const thresholds = ctx.rules.allocationNumber?.thresholds || [];
  let data = rows.map((r) => {
    const th = minAmount ?? allocationThreshold(thresholds, r.d);
    const status = allocationStatus(r.tax_alloc_number);
    return { year: r.fiscal_year, transId: r.trans_id, date: r.d, type: r.trans_type, reference: r.reference, supplier: r.credit_account, supplierName: ctx.account(r.credit_account).name, expenseAccount: r.debit_account, description: r.description, amount: round2(r.amount), allocationNumber: r.tax_alloc_number || null, status, threshold: th, required: th != null && num(r.amount) >= th, documentId: r.document_id || null };
  });
  const counts = { all: data.length, required: data.filter((x) => x.required).length, ok: data.filter((x) => x.status === "ok").length, missing: data.filter((x) => x.status === "missing").length, suspect: data.filter((x) => x.status === "suspect").length, requiredMissing: data.filter((x) => x.required && x.status !== "ok").length };
  data = data.filter((x) => (minAmount == null ? x.required || x.allocationNumber : num(x.amount) >= minAmount));
  if (missingOnly) data = data.filter((x) => x.status !== "ok");
  return { data: data.slice(offset, offset + limit), meta: { from, to, minAmount: minAmount ?? "by date (finance_map allocationNumber)", thresholds, thresholdsConfirmed: ctx.rules.allocationNumber?.confirmed === true, missingOnly, accounts: accounts.length ? accounts : "all", limit, offset, total: data.length, counts, invoiceTypes: types, note: "a value of 5 digits or more counts as a real number; the accountant must say what the others are" }, codes: ["unposted_entries"], range: { from, to } };
});

route("/payroll-check", async (req, ctx) => {
  const month = requireMonth(req);
  const wanted = optionalFinanceBranches(req, ctx);
  const branches = companyBranches(ctx).filter((b) => !wanted.length || wanted.includes(b.id));
  const from = monthStart(month), to = monthEnd(month);
  const lines = await pnlLines(ctx, { from, to });
  const books = booksByBranchMonth(lines, "salaries");
  const labor = await laborMonths(branches.map((b) => b.id), from, to);
  const data = branches.map((b) => {
    const lab = labor.get(`${b.id}|${month}`);
    const bk = round2(books.get(`${b.id}|${month}`) || 0);
    return { month, branch: b.id, branchName: b.name, books: bk, payroll: lab ? lab.gross : null, laborCost: lab ? lab.laborCost : null, employees: lab ? lab.employees : 0, difference: lab ? round2(bk - lab.gross) : null, differencePct: lab ? pct(bk - lab.gross, lab.gross) : null, payrollSource: lab ? lab.source : "none" };
  });
  const noBranch = round2(books.get(`none|${month}`) || 0);
  const accountsBooks = lines.filter((r) => r.line === "salaries").reduce((m, r) => ((m[r.accountKey] = round2((m[r.accountKey] || 0) + r.amount)), m), {});
  return {
    data: [...data, { month, branch: null, branchName: "No branch", books: noBranch, payroll: null, difference: null, payrollSource: "none" }],
    meta: { month, branches: branches.map((b) => b.id), totals: { books: round2(data.reduce((a, d) => a + d.books, 0) + noBranch), payroll: round2(data.reduce((a, d) => a + (d.payroll || 0), 0)) }, booksByAccount: Object.entries(accountsBooks).map(([k, v]) => ({ accountKey: k, name: ctx.account(k).name, amount: v })), note: "payroll = the payslip gross of the admin's labor data (saved payroll, else Tabit); books = group 720 of the month" },
    codes: ["no_salary_expense"], range: { from, to },
  };
});

route("/exceptions", async (req, ctx) => {
  const type = oneOf(req, "type", ["unposted", "future_dated", "possible_duplicate", "missing_branch", "wrong_account"], null);
  const types = type ? [type] : ["unposted", "future_dated", "possible_duplicate", "missing_branch"];
  const year = today().slice(0, 4);
  const { from, to } = dateRange(req, { required: false, defaultFrom: `${year}-01-01` });
  const { limit, offset } = paging(req);
  const params = { companyId: ctx.companyId, today: today() };
  const data = [];
  const counts = {};
  if (types.includes("unposted")) {
    const rows = await financeSql(`SELECT e.*, 0 AS line_count FROM journal_entries e WHERE e.company_id = :companyId AND e.deleted_at IS NULL AND e.status = 0 ORDER BY e.value_date, e.trans_id`, params);
    counts.unposted = rows.length;
    for (const r of rows) { const { type: entryType, lineCount, ...e } = entryRow(ctx, r); data.push({ type: "unposted", ...e, entryType }); }
  }
  if (types.includes("future_dated")) {
    const rows = await financeSql(`SELECT e.*, 0 AS line_count FROM journal_entries e WHERE e.company_id = :companyId AND e.deleted_at IS NULL AND e.status = 1 AND e.value_date > :today ORDER BY e.value_date, e.trans_id`, params);
    counts.future_dated = rows.length;
    for (const r of rows) { const { type: entryType, lineCount, ...e } = entryRow(ctx, r); data.push({ type: "future_dated", ...e, entryType }); }
  }
  if (types.includes("possible_duplicate")) {
    const p = { ...params };
    const rows = await financeSql(
      `SELECT e.debit_account, e.credit_account, e.amount, e.reference, COUNT(*) AS n, GROUP_CONCAT(CONCAT(e.fiscal_year, '/', e.trans_id) ORDER BY e.trans_id) AS entries,
              DATE_FORMAT(MIN(e.value_date), '%Y-%m-%d') AS d0, DATE_FORMAT(MAX(e.value_date), '%Y-%m-%d') AS d1, MAX(e.description) AS description
         FROM journal_entries e WHERE e.company_id = :companyId AND e.deleted_at IS NULL AND e.status = 1 AND e.amount <> 0 ${rangeSql("e.value_date", from, to, p)}
        GROUP BY e.debit_account, e.credit_account, e.amount, e.reference HAVING COUNT(*) > 1 ORDER BY e.amount DESC`,
      p,
    );
    counts.possible_duplicate = rows.length;
    for (const r of rows) data.push({ type: "possible_duplicate", debitAccount: r.debit_account, debitName: r.debit_account ? ctx.account(r.debit_account).name : null, creditAccount: r.credit_account, creditName: r.credit_account ? ctx.account(r.credit_account).name : null, amount: round2(r.amount), reference: r.reference, description: r.description, count: num(r.n), entries: csv(r.entries).map((s) => { const [y, t] = s.split("/"); return { year: Number(y), transId: Number(t) }; }), firstDate: r.d0, lastDate: r.d1 });
  }
  if (types.includes("missing_branch")) {
    const keys = ctx.keysOfGroups(ctx.groupsOf(["purchases", "salaries", "general"]));
    const p = { ...params };
    const rows = await financeSql(
      `SELECT e.fiscal_year, e.trans_id, DATE_FORMAT(e.value_date, '%Y-%m-%d') AS d, e.trans_type, e.reference, e.description, TRIM(COALESCE(e.cost_code, '')) AS cc, l.account_key, l.signed_amount
         ${JOURNAL} WHERE ${LIVE} AND e.status = 1 AND ${inList("l.account_key", keys, p, "k")} ${rangeSql("e.value_date", from, to, p)} ORDER BY e.value_date, e.trans_id`,
      p,
    );
    let n = 0;
    for (const r of rows) {
      if (ctx.branchResolver(r.cc, r.account_key, r.description).branch) continue;
      n += 1;
      const a = ctx.account(r.account_key);
      data.push({ type: "missing_branch", year: r.fiscal_year, transId: r.trans_id, date: r.d, entryType: r.trans_type, reference: r.reference, description: r.description, accountKey: r.account_key, name: a.name, group: a.group, amount: round2(r.signed_amount) });
    }
    counts.missing_branch = n;
  }
  if (types.includes("wrong_account")) counts.wrong_account = null;
  return { data: data.slice(offset, offset + limit), meta: { type: type || "all", from, to, limit, offset, total: data.length, counts, notAvailable: ["wrong_account"], note: "unposted and future_dated ignore the date range; possible_duplicate is a wide rule (same accounts, amount and reference) and gives false alarms" }, codes: ["unposted_entries"] };
});

const minutesToTime = (v) => (v == null || v === "" ? null : `${String(Math.floor(num(v) / 60)).padStart(2, "0")}:${String(num(v) % 60).padStart(2, "0")}`);

route("/changes", async (req, ctx) => {
  const { from, to } = dateRange(req, { required: true });
  const kind = oneOf(req, "kind", ["account", "login", "sync", "vat_run"], null);
  const kinds = kind ? [kind] : ["account", "login", "sync", "vat_run"];
  const accounts = optionalAccounts(req, ctx);
  const { limit, offset } = paging(req);
  const params = { companyId: ctx.companyId, from, toNext: addDays(to, 1) };
  const users = new Map();
  for (const r of await financeSql(`SELECT data FROM source_rows WHERE company_id = :companyId AND source_table = 'Users'`, { companyId: ctx.companyId })) {
    const d = parseJson(r.data, {});
    if (d.UseFID != null) users.set(Number(d.UseFID), d.UseFName || d.LoginName || null);
  }
  const userName = (id) => (id == null ? null : users.get(Number(id)) ?? null);
  const data = [];
  const counts = {};
  const srcRows = async (table, dateField) =>
    financeSql(
      `SELECT fiscal_year, row_key, data FROM source_rows WHERE company_id = :companyId AND source_table = :table AND deleted_at IS NULL
          AND JSON_UNQUOTE(JSON_EXTRACT(data, '$.${dateField}')) >= :from AND JSON_UNQUOTE(JSON_EXTRACT(data, '$.${dateField}')) < :toNext
        ORDER BY JSON_UNQUOTE(JSON_EXTRACT(data, '$.${dateField}')), row_key`,
      { ...params, table },
    );
  if (kinds.includes("account")) {
    const rows = (await srcRows("AccItemsUpdateLog", "DatUpdate")).map((r) => parseJson(r.data, {})).filter((d) => !accounts.length || accounts.includes(String(d.Kef)));
    counts.account = rows.length;
    for (const d of rows) data.push({ kind: "account", date: day(d.DatUpdate), time: minutesToTime(d.TimeUpdate), accountKey: d.Kef == null ? null : String(d.Kef), name: ctx.account(String(d.Kef)).name, table: d.UpdateType, field: d.FieldName, oldValue: d.FieldValue, newValue: d.NewFieldValue, userId: d.UseFid ?? null, userName: userName(d.UseFid), station: d.StationId || null });
  }
  if (kinds.includes("login") && !accounts.length) {
    const rows = (await srcRows("UsersLogDetails", "PDate")).map((r) => parseJson(r.data, {}));
    counts.login = rows.length;
    for (const d of rows) data.push({ kind: "login", date: day(d.PDate), time: minutesToTime(d.PTime), loginName: d.LoginName, result: d.PResult, station: d.StationID || null });
  }
  if (kinds.includes("vat_run") && !accounts.length) {
    const rows = (await srcRows("IssueLog", "IssueDate")).map((r) => parseJson(r.data, {}));
    counts.vat_run = rows.length;
    for (const d of rows) data.push({ kind: "vat_run", date: day(d.IssueDate), at: d.IssueDate || null, text: d.ExtText1 || null, documentId: d.StockId ?? null });
  }
  if (kinds.includes("sync")) {
    const rows = await financeSql(
      `SELECT row_history_id, fiscal_year, source_table, row_key, sync_run_id, change_type, old_row, changed_at FROM row_history
        WHERE company_id = :companyId AND changed_at >= :from AND changed_at < :toNext ORDER BY changed_at, row_history_id`,
      params,
    );
    let n = 0;
    for (const r of rows) {
      const o = parseJson(r.old_row, {});
      const acct = o.AccountKey ?? o.TransDebID ?? o.TransCredID ?? null;
      if (accounts.length && ![o.AccountKey, o.TransDebID, o.TransCredID].some((k) => accounts.includes(String(k)))) continue;
      n += 1;
      data.push({ kind: "sync", date: day(r.changed_at), at: r.changed_at, syncRunId: r.sync_run_id, sourceTable: r.source_table, rowKey: r.row_key, year: r.fiscal_year, change: r.change_type, accountKey: acct == null ? null : String(acct), oldRow: { amount: o.suF ?? o.SuF ?? null, date: day(o.ValueDate || o.DatF || null), description: o.Description ?? o.Details ?? null, debitAccount: o.TransDebID ?? null, creditAccount: o.TransCredID ?? null, status: o.Status ?? null } });
    }
    counts.sync = n;
  }
  data.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return { data: data.slice(offset, offset + limit), meta: { from, to, kind: kind || "all", accounts: accounts.length ? accounts : "all", limit, offset, total: data.length, counts, sources: { account: "AccItemsUpdateLog", login: "UsersLogDetails", vat_run: "IssueLog", sync: "row_history" }, note: "Hashavshevet does not log journal edits; sync shows them from 6 November 2026 on, one change per day per row. time is the raw value read as minutes after midnight (not confirmed)." }, codes: [], range: { from, to } };
});

// ── router ───────────────────────────────────────────────────────────────

const DB_DOWN_CODES = new Set(["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "ECONNRESET", "EHOSTUNREACH", "PROTOCOL_CONNECTION_LOST",
  "ER_ACCESS_DENIED_ERROR", "ER_DBACCESS_DENIED_ERROR", "ER_BAD_DB_ERROR", "ER_NO_SUCH_TABLE", "ER_TABLEACCESS_DENIED_ERROR", "HANDSHAKE_SSL_ERROR"]);

export function financeErrorResponse(err) {
  if (err instanceof ApiError) return { status: err.status, body: { error: { code: err.code, message: err.message } } };
  if (err && DB_DOWN_CODES.has(err.code))
    return { status: 503, body: { error: { code: "finance_db_unavailable", message: `allegro_finance can't be reached: ${err.code}${err.code === "ER_NO_SUCH_TABLE" ? ` (${err.message})` : ""}` } } };
  return null;
}

const Router = () => {
  const router = express.Router();
  router.use(localOnly);

  // The detailed bank reconciliation report (bankRecon.js, the admin menu's report) for Joya HQ: the same JSON,
  // or the Hebrew HTML / Excel file. Not a `route()`: html and xlsx are not JSON envelopes.
  const sendError = (res, err) => {
    const known = financeErrorResponse(err);
    if (known) return res.status(known.status).json(known.body);
    console.error("finance-api /bank/report error:", err);
    return res.status(500).json({ error: { code: "internal_error", message: err.message || "internal error" } });
  };
  router.get("/bank/report/accounts", async (req, res) => {
    try { res.json({ data: await listBankReportAccounts(), meta: { today: today() } }); } catch (err) { sendError(res, err); }
  });
  router.get("/bank/report", async (req, res) => {
    try {
      const format = String(req.query.format || "json").toLowerCase();
      if (!["json", "html", "xlsx"].includes(format)) throw badRequest("format must be json, html or xlsx");
      const report = await buildBankReconReport(req.query);
      if (format === "json") return res.json({ data: report, meta: { company: report.company.code, account: report.account.key, from: report.from, to: report.to } });
      const stem = `bank_recon_${report.account.key}_${report.from}_${report.to}`;
      if (format === "html") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Content-Disposition", `inline; filename="${stem}.html"`);
        return res.send(renderBankReconHtml(report));
      }
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${stem}.xlsx"; filename*=UTF-8''${stem}.xlsx`);
      return res.send(await renderBankReconXlsx(report));
    } catch (err) { sendError(res, err); }
  });

  for (const { path, handler, company } of routes) {
    router.get(path, async (req, res) => {
      try {
        if (!company) {
          const { data, meta = {} } = await handler(req);
          return res.json({ data, meta: { ...meta, count: Array.isArray(data) ? data.length : undefined } });
        }
        const ctx = await companyContext(req);
        const facts = await companyFacts(ctx);
        const { data, meta = {}, warnings = [], codes = [], range = {} } = await handler(req, ctx, facts);
        const all = [...warnings, ...buildWarnings(ctx, facts, path.replace(/\/:.*$/, ""), codes, range)];
        all.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1));
        res.json({
          data,
          meta: { company: ctx.code, ...meta, count: Array.isArray(data) ? data.length : undefined, sync: syncMeta(facts), warnings: all },
        });
      } catch (err) {
        const known = financeErrorResponse(err);
        if (known) {
          if (known.status === 503) console.error(`finance-api ${req.path}: ${err.message}`);
          return res.status(known.status).json(known.body);
        }
        console.error(`finance-api ${req.path} error:`, err);
        res.status(500).json({ error: { code: "internal_error", message: err.message || "internal error" } });
      }
    });
  }

  router.use((req, res) => res.status(404).json({ error: { code: "not_found", message: `no endpoint ${req.method} /finance${req.path}` } }));
  return router;
};

export const financeRoutes = () => routes.map((r) => r.path);
export { Router };
