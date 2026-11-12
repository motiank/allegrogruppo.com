// Full test of the Finance API (admin/server/modules/financeApi.js, finance_api_readme.md).
//
//   $ node --test scripts/test_finance_api.js
//   $ node --test --experimental-test-coverage scripts/test_finance_api.js     # with a line-coverage report
//
// Part 1 tests the pure rules with made-up data (no database). Part 2 starts the finance router on a loopback port
// and calls every endpoint, every parameter and every error path against a copy of allegro_finance, checking the
// shapes and the accounting invariants (debit = credit, opening + movement = closing, open items = balance, ...).
//
// Databases: the finance DB is FINANCE_DB_* (default: the local hash-sync target, allegro_finance_dev, read from
// hash-sync/.env). The three mixed endpoints (/branch-costs, /sales-vs-books, /payroll-check) also read the admin DB
// of the root .env (read only); set FINANCE_TEST_SKIP_MIXED=1 to skip them. FINANCE_TODAY is fixed so the numbers
// that depend on "today" stay stable.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import http from "node:http";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TODAY = "2026-11-07";
process.env.FINANCE_TODAY = TODAY;
if (!process.env.FINANCE_DB_HOST) {
  // the local hash-sync target database
  const envFile = path.join(root, "hash-sync", ".env");
  const env = fs.existsSync(envFile) ? Object.fromEntries(fs.readFileSync(envFile, "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => l.split(/=(.*)/s).slice(0, 2))) : {};
  process.env.FINANCE_DB_HOST = env.TARGET_DB_HOST || "127.0.0.1";
  process.env.FINANCE_DB_PORT = env.TARGET_DB_PORT || "3306";
  process.env.FINANCE_DB_USER = env.TARGET_DB_USER || "root";
  process.env.FINANCE_DB_PASSWORD = env.TARGET_DB_PASSWORD || "";
  process.env.FINANCE_DB_NAME = env.TARGET_DB_NAME || "allegro_finance_dev";
}
const dotenv = await import("dotenv");
dotenv.config({ path: path.join(root, ".env") }); // the admin DB of the mixed endpoints (never overrides what is set above)

const api = await import("../admin/server/modules/financeApi.js");
const { closeFinancePool, financeDbConfig } = await import("../admin/server/sources/financePool.js");
const {
  Router, today, addDays, addMonths, daysBetween, makeBranchResolver, openItems, bucketItems, ageBucket, chequeState,
  compareRange, allocationThreshold, allocationStatus, warningRules, financeErrorResponse, financeRoutes, AGE_BUCKETS,
} = api;

const sum = (arr, f = (x) => x) => Math.round(arr.reduce((a, x) => a + (Number(f(x)) || 0), 0) * 100) / 100;
const close = (a, b, msg) => assert.ok(Math.abs(a - b) <= 0.011, `${msg || "numbers differ"}: ${a} vs ${b}`);

// ── Part 1: pure rules ───────────────────────────────────────────────────

describe("dates", () => {
  test("today is fixed by FINANCE_TODAY", () => assert.equal(today(), TODAY));
  test("addDays / addMonths / daysBetween", () => {
    assert.equal(addDays("2026-02-28", 1), "2026-03-01");
    assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
    assert.equal(addMonths("2026-03-15", -12), "2025-03-15");
    assert.equal(daysBetween("2026-01-01", "2026-01-31"), 30);
  });
  test("compareRange", () => {
    assert.deepEqual(compareRange("2026-08-01", "2026-08-31", "prev_year"), { from: "2025-08-01", to: "2025-08-31" });
    assert.deepEqual(compareRange("2026-07-01", "2026-08-31", "prev_period"), { from: "2026-05-01", to: "2026-06-30" });
    assert.deepEqual(compareRange("2026-08-10", "2026-08-19", "prev_period"), { from: "2026-07-31", to: "2026-08-09" });
  });
});

describe("branch rules", () => {
  const branches = [
    { costCode: "101", branch: "B1", name: "רמת החיל", words: ["רמת החייל", "רמת החיל"], accounts: [] },
    { costCode: "103", branch: "B3", name: "רעננה", words: ["רעננה"], accounts: ["999001"] },
  ];
  const accounts = [
    { accountKey: "722001", name: "שכר רמת החייל", costCode: "101" },
    { accountKey: "800003", name: "קניות - רעננה", costCode: null },
    { accountKey: "999001", name: "something", costCode: null },
    { accountKey: "900000", name: "הנהלת חשבונות", costCode: null },
  ];
  const resolve = makeBranchResolver(branches, accounts);
  test("rule 1: the entry's cost code wins, spaces are trimmed", () => {
    assert.deepEqual(resolve(" 103 ", "722001", null).branch.branch, "B3");
    assert.equal(resolve("103", "722001", null).source, "cost");
  });
  test("rule 2: the account's own cost code, the fixed list, or a word in its name", () => {
    assert.equal(resolve("", "722001", null).branch.branch, "B1");
    assert.equal(resolve(null, "800003", null).branch.branch, "B3");
    assert.equal(resolve(null, "999001", null).branch.branch, "B3");
    assert.equal(resolve(null, "999001", null).source, "account");
  });
  test("rule 3: a word in the description; rule 4: none", () => {
    assert.deepEqual([resolve(null, "900000", "רושמת רעננה 08-26").branch.branch, resolve(null, "900000", "רושמת רעננה 08-26").source], ["B3", "description"]);
    assert.deepEqual(resolve(null, "900000", "הוצ'"), { branch: null, source: "none" });
    assert.deepEqual(resolve("999", "900000", null), { branch: null, source: "none" }); // unknown cost code
  });
  test("accountsOf lists the accounts of rule 2", () => {
    assert.deepEqual(resolve.accountsOf(resolve.branches[1]).sort(), ["800003", "999001"]);
  });
});

describe("open items and age", () => {
  const L = (lineId, date, signed, extra = {}) => ({ lineId, date, dueDate: null, signed, matched: false, ...extra });
  test("age buckets", () => {
    assert.deepEqual([0, -5, 1, 30, 31, 60, 61, 90, 91].map(ageBucket), ["current", "current", "1-30", "1-30", "31-60", "31-60", "61-90", "61-90", "90+"]);
    assert.deepEqual(AGE_BUCKETS, ["current", "1-30", "31-60", "61-90", "90+"]);
  });
  test("matched method: the unmatched lines are the open items (supplier sign: credit = plus)", () => {
    const lines = [L(1, "2026-01-01", -100, { matched: true }), L(2, "2026-02-01", -250), L(3, "2026-02-15", 100, { matched: true }), L(4, "2026-03-01", 40)];
    const r = openItems(lines, "suppliers");
    assert.equal(r.method, "matched");
    assert.deepEqual(r.items.map((i) => [i.lineId, i.open]), [[2, 250], [4, -40]]);
  });
  test("oldest first: payments cover the oldest invoices, the rest stays open", () => {
    const lines = [L(3, "2026-03-01", 300), L(1, "2026-01-01", 100), L(2, "2026-02-01", 200), L(4, "2026-03-10", -250)];
    const r = openItems(lines, "customers");
    assert.equal(r.method, "oldest_first");
    assert.deepEqual(r.items.map((i) => [i.lineId, i.open]), [[2, 50], [3, 300]]);
    close(sum(r.items, (i) => i.open), 350, "open = balance");
  });
  test("oldest first: a payment larger than the invoices stays as an unapplied credit", () => {
    const r = openItems([L(1, "2026-01-01", 100), L(2, "2026-01-05", -130)], "customers");
    assert.deepEqual(r.items.map((i) => [i.lineId, i.open, Boolean(i.unapplied)]), [[2, -30, true]]);
  });
  test("buckets use the due date, else the value date, and add up to the open total", () => {
    const items = [{ date: "2026-10-01", dueDate: "2026-11-20", open: 10 }, { date: "2026-10-20", dueDate: null, open: 20 }, { date: "2026-06-01", dueDate: "2026-06-30", open: 30 }, { date: "2026-09-20", dueDate: null, open: -5 }];
    const b = bucketItems(items, TODAY);
    assert.deepEqual(b, { current: 10, "1-30": 20, "31-60": -5, "61-90": 0, "90+": 30 });
    close(sum(Object.values(b)), 55);
  });
});

describe("cheques, allocation numbers", () => {
  test("cheque state", () => {
    assert.equal(chequeState({ dueDate: "2026-12-01", cleared: false }, TODAY), "future");
    assert.equal(chequeState({ dueDate: "2026-11-07", cleared: false }, TODAY), "not_cleared");
    assert.equal(chequeState({ dueDate: "2026-10-01", cleared: true }, TODAY), "cleared");
    assert.equal(chequeState({ dueDate: null, cleared: false }, TODAY), "not_cleared");
  });
  test("allocation threshold by date and value status", () => {
    const th = [{ from: "2025-01-01", minAmount: 20000 }, { from: "2026-01-01", minAmount: 10000 }, { from: "2024-05-05", minAmount: 25000 }];
    assert.equal(allocationThreshold(th, "2024-01-01"), null);
    assert.equal(allocationThreshold(th, "2024-06-01"), 25000);
    assert.equal(allocationThreshold(th, "2025-12-31"), 20000);
    assert.equal(allocationThreshold(th, "2026-03-01"), 10000);
    assert.equal(allocationThreshold([], "2026-03-01"), null);
    assert.deepEqual([null, "", "0", "00", "8", "1234", "12345", "032024799", "12a45"].map(allocationStatus), ["missing", "missing", "missing", "missing", "suspect", "suspect", "ok", "ok", "suspect"]);
  });
});

describe("warning rules", () => {
  const M = (month, income, salaries, extra = {}) => ({ month, income, purchases: income ? 1000 : 0, salaries, general: 0, unposted: 0, ...extra });
  const months = [M("2025-03", 0, 0), M("2025-04", 1000, 300), M("2025-05", 1100, 320), M("2025-06", 1200, 330), M("2025-07", 1000, 0), M("2025-08", 100, 0, { unposted: 2 }), M("2025-09", 0, 0), M("2025-10", 0, 0)];
  test("no_salary_expense: months with activity and no salaries after months that had them", () => {
    const w = warningRules.no_salary_expense(months, "2025-01-01", "2025-12-31", "2025-11-15");
    assert.equal(w.severity, "high");
    assert.deepEqual(w.affects, ["2025-07", "2025-08"]);
    assert.equal(warningRules.no_salary_expense(months, "2025-04-01", "2025-06-30", "2025-11-15"), null);
    assert.equal(warningRules.no_salary_expense([M("2025-04", 1000, 0)], "2025-04-01", "2025-04-30", "2025-11-15"), null, "no earlier salaries → no rule");
  });
  test("income_not_posted: under 20% of the months before, never the current month", () => {
    const w = warningRules.income_not_posted(months, "2025-04-01", "2025-10-31", "2025-10-15");
    assert.deepEqual(w.affects, ["2025-08", "2025-09"]);
    assert.equal(w.severity, "high");
    assert.equal(warningRules.income_not_posted(months, "2025-04-01", "2025-07-31", "2025-10-15"), null);
    assert.equal(warningRules.income_not_posted([M("2025-04", 0, 0)], "2025-04-01", "2025-07-31"), null, "no income at all → no rule");
  });
  test("before_data_start / unposted_entries", () => {
    assert.equal(warningRules.before_data_start(months, "2025-01-01").severity, "info");
    assert.equal(warningRules.before_data_start(months, "2025-04-01"), null);
    assert.equal(warningRules.before_data_start(months, null), null);
    const u = warningRules.unposted_entries(months, "2025-01-01", "2025-12-31");
    assert.deepEqual(u.affects, ["2025-08"]);
    assert.match(u.message, /^2 unposted entries/);
    assert.equal(warningRules.unposted_entries(months, "2025-09-01", "2025-12-31"), null);
    assert.equal(warningRules.unposted_entries(months, null, null).affects.length, 1);
  });
  test("bank_gap / bank_running_balance_differs / supplier_balances_suspect", () => {
    const ok = { accountKey: "1", bankBalance: 100, bookBalance: 100, bankOpen: 1, bookOpen: 1, turnover: 1000, lastRunningBalance: 100 };
    assert.equal(warningRules.bank_gap([ok]), null);
    assert.equal(warningRules.bank_gap([{ ...ok, bankOpen: 30, bookOpen: 30 }]).severity, "high");
    assert.equal(warningRules.bank_running_balance_differs([ok]), null);
    assert.equal(warningRules.bank_running_balance_differs([{ ...ok, lastRunningBalance: 90 }]).severity, "info");
    assert.equal(warningRules.bank_running_balance_differs([{ ...ok, lastRunningBalance: null }]), null);
    assert.equal(warningRules.supplier_balances_suspect({ debitCount: 1, debitTotal: 10, creditCount: 9, creditTotal: 100 }), null);
    assert.equal(warningRules.supplier_balances_suspect({ debitCount: 9, debitTotal: 100, creditCount: 1, creditTotal: 10 }).severity, "high");
    assert.equal(warningRules.supplier_balances_suspect(null), null);
  });
  test("stale_sync", () => {
    const now = new Date("2026-11-07T12:00:00");
    assert.equal(warningRules.stale_sync({ status: "done", at: "2026-11-07 02:00:00.000" }, now), null);
    assert.equal(warningRules.stale_sync({ status: "done", at: "2026-11-05 02:00:00.000" }, now).severity, "info");
    assert.equal(warningRules.stale_sync({ status: "failed", at: "2026-11-07 02:00:00.000", error: "boom" }, now).severity, "high");
    assert.equal(warningRules.stale_sync({ status: "running", at: "2026-11-07 02:00:00.000" }, now), null);
    assert.equal(warningRules.stale_sync(null, now).severity, "high");
  });
  test("branch_partial / other_company_missing / not_validated", () => {
    assert.equal(warningRules.branch_partial(0, 100), null);
    assert.equal(warningRules.branch_partial(5, 100).severity, "info");
    assert.equal(warningRules.branch_partial(50, 100).severity, "high");
    assert.equal(warningRules.other_company_missing(["Pastalina"]).code, "other_company_missing");
    assert.match(warningRules.not_validated("/pnl").message, /\/pnl/);
  });
  test("error mapping", () => {
    assert.equal(financeErrorResponse({ code: "ECONNREFUSED" }).status, 503);
    assert.equal(financeErrorResponse({ code: "ER_NO_SUCH_TABLE", message: "Table 'x.journal_lines' doesn't exist" }).body.error.code, "finance_db_unavailable");
    assert.equal(financeErrorResponse(new Error("other")), null);
  });
  test("finance pool settings fall back to DB_* unless FINANCE_DB_HOST is set", () => {
    const a = financeDbConfig({ DB_HOST: "prod", DB_USER: "u", DB_PASSWORD: "p", DB_PORT: "25060", DB_SSL_CA: "ca.crt" });
    assert.deepEqual(a, { host: "prod", port: 25060, user: "u", password: "p", database: "allegro_finance", sslCa: "ca.crt" });
    const b = financeDbConfig({ DB_HOST: "prod", DB_SSL_CA: "ca.crt", FINANCE_DB_HOST: "127.0.0.1", FINANCE_DB_USER: "m", FINANCE_DB_NAME: "allegro_finance_dev" });
    assert.deepEqual(b, { host: "127.0.0.1", port: 3306, user: "m", password: undefined, database: "allegro_finance_dev", sslCa: undefined });
  });
});

// ── Part 2: every endpoint against the database ──────────────────────────

describe("endpoints", () => {
  let server, base;
  const COMPANY = "pastalina";
  const get = async (p, opts = {}) => {
    const res = await fetch(base + p, opts);
    const body = await res.json();
    return { status: res.status, body, data: body.data, meta: body.meta, warnings: body.meta?.warnings || [], codes: (body.meta?.warnings || []).map((w) => w.code) };
  };
  const ok = async (p) => {
    const r = await get(p);
    assert.equal(r.status, 200, `${p}: ${JSON.stringify(r.body).slice(0, 300)}`);
    assert.equal(r.meta.company, COMPANY);
    assert.ok(r.meta.sync && "dataUpTo" in r.meta.sync, "meta.sync");
    assert.ok(Array.isArray(r.meta.warnings), "meta.warnings");
    for (const w of r.meta.warnings) { assert.ok(w.code && ["high", "info"].includes(w.severity) && w.message && Array.isArray(w.affects), `warning shape ${JSON.stringify(w)}`); }
    if (Array.isArray(r.data)) assert.equal(r.meta.count, r.data.length);
    return r;
  };
  const fail = async (p, status, code) => {
    const r = await get(p);
    assert.equal(r.status, status, `${p}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.error.code, code, `${p}: ${JSON.stringify(r.body)}`);
    assert.ok(r.body.error.message);
    return r;
  };
  const B = { raanana: "5ff419934676f0fddabaef3a", ramat: "6012624f0d491ef6429e127c", rosh: "655ef6eb9df0c279bbfb7482", herzliya: "5fd7030f4f421bfe0e2e13bd" };
  const mixed = process.env.FINANCE_TEST_SKIP_MIXED ? test.skip : test;

  before(async () => {
    const app = express();
    app.use("/local-api/v1/finance", Router());
    server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${server.address().port}/local-api/v1/finance`;
  });
  after(async () => {
    server?.close();
    await closeFinancePool();
    try { const { getDbPool } = await import("../admin/server/sources/dbpool.js"); await getDbPool().end(); } catch {}
  });

  test("access: only loopback without proxy headers and with a loopback Host", async () => {
    const r1 = await fetch(`${base}/companies`, { headers: { "X-Forwarded-For": "1.2.3.4" } });
    assert.equal(r1.status, 403);
    // fetch() does not let a caller set Host, so the DNS-rebinding check is tried with http.request
    const r2 = await new Promise((resolve, reject) => {
      const u = new URL(`${base}/companies`);
      http.get({ host: u.hostname, port: u.port, path: u.pathname, headers: { Host: "admin.allegrogruppo.com" } }, (res) => {
        let body = ""; res.on("data", (c) => (body += c)); res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
      }).on("error", reject);
    });
    assert.equal(r2.status, 403);
    assert.equal(r2.body.error.code, "forbidden");
    const r3 = await fetch(`${base}/companies`, { headers: { "X-Real-IP": "127.0.0.1" } });
    assert.equal(r3.status, 403);
  });

  test("route list covers the readme", () => {
    const want = ["/companies", "/status", "/accounts", "/branches", "/pnl", "/cash", "/branch-costs", "/sales-vs-books", "/spending", "/aging", "/intercompany",
      "/trial-balance", "/ledger", "/journal", "/journal/:year/:transId", "/bank/reconciliation", "/bank/open", "/bank/balances", "/bank/suggestions", "/invoices", "/statement",
      "/cheques", "/cheques/priority", "/cheques/all", "/vat", "/vat/issues", "/withholding", "/allocation-numbers", "/invoices/drive-check", "/payroll-check", "/exceptions", "/changes"];
    assert.deepEqual(financeRoutes().sort(), want.sort());
  });

  test("GET /invoices/drive-check: without the agent's Google login it says so (503 drive_unavailable); bad parameters", async () => {
    const saved = process.env.INVOICE_DRIVE_TOKEN;
    process.env.INVOICE_DRIVE_TOKEN = path.join(root, "scripts", "no-such-token.json");
    try {
      await fail(`/invoices/drive-check?company=${COMPANY}&from=2026-01-01`, 503, "drive_unavailable");
      await fail(`/invoices/drive-check?company=${COMPANY}&from=2026-01-01&status=nope`, 400, "bad_request");
      await fail(`/invoices/drive-check?company=${COMPANY}&from=2026-01-01&direction=sideways`, 400, "bad_request");
    } finally {
      if (saved == null) delete process.env.INVOICE_DRIVE_TOKEN;
      else process.env.INVOICE_DRIVE_TOKEN = saved;
    }
  });

  test("errors: unknown endpoint, company, account, branch, bad parameters", async () => {
    await fail("/nothing", 404, "not_found");
    await fail("/status", 400, "bad_request");
    await fail("/status?company=nope", 404, "not_found");
    await fail(`/pnl?company=${COMPANY}`, 400, "bad_request");
    await fail(`/pnl?company=${COMPANY}&from=2026-02-30`, 400, "bad_request");
    await fail(`/pnl?company=${COMPANY}&from=2026-03-01&to=2026-02-01`, 400, "bad_request");
    await fail(`/pnl?company=${COMPANY}&from=2020-01-01&to=2026-01-01`, 400, "bad_request"); // > 800 days
    await fail(`/pnl?company=${COMPANY}&from=2026-01-01&by=week`, 400, "bad_request");
    await fail(`/pnl?company=${COMPANY}&from=2026-01-01&compare=last`, 400, "bad_request");
    await fail(`/pnl?company=${COMPANY}&from=2026-01-01&branch=abc`, 404, "not_found");
    await fail(`/ledger?company=${COMPANY}&account=000000&from=2026-01-01`, 404, "not_found");
    await fail(`/ledger?company=${COMPANY}&from=2026-01-01`, 400, "bad_request");
    await fail(`/ledger?company=${COMPANY}&account=500059,500060&from=2026-01-01`, 400, "bad_request");
    await fail(`/ledger?company=${COMPANY}&q=zzzzzz&from=2026-01-01`, 404, "not_found");
    await fail(`/ledger?company=${COMPANY}&account=500059&from=2026-01-01&limit=0`, 400, "bad_request");
    await fail(`/ledger?company=${COMPANY}&account=500059&from=2026-01-01&limit=5001`, 400, "bad_request");
    await fail(`/ledger?company=${COMPANY}&account=500059&from=2026-01-01&offset=-1`, 400, "bad_request");
    await fail(`/aging?company=${COMPANY}`, 400, "bad_request");
    await fail(`/aging?company=${COMPANY}&side=both`, 400, "bad_request");
    await fail(`/bank/open?company=${COMPANY}`, 400, "bad_request");
    await fail(`/bank/reconciliation?company=${COMPANY}&account=500059`, 400, "bad_request");
    await fail(`/journal/abc/1?company=${COMPANY}`, 400, "bad_request");
    await fail(`/journal/2026/999999999?company=${COMPANY}`, 404, "not_found");
    await fail(`/journal?company=${COMPANY}&batch=x`, 400, "bad_request");
    await fail(`/payroll-check?company=${COMPANY}&month=2026-13`, 400, "bad_request");
    await fail(`/trial-balance?company=${COMPANY}&asOf=2026-01-01&from=2026-02-01`, 400, "bad_request");
    await fail(`/trial-balance?company=${COMPANY}&group=abc`, 400, "bad_request");
    await fail(`/accounts?company=${COMPANY}&group=x`, 400, "bad_request");
    await fail(`/bank/suggestions?company=${COMPANY}&minAmount=-1`, 400, "bad_request");
    await fail(`/cheques?company=${COMPANY}&state=lost`, 400, "bad_request");
    await fail(`/changes?company=${COMPANY}`, 400, "bad_request");
    await fail(`/changes?company=${COMPANY}&from=2026-01-01&kind=x`, 400, "bad_request");
    await fail(`/exceptions?company=${COMPANY}&type=x`, 400, "bad_request");
    await fail(`/branch-costs?company=${COMPANY}&from=2025-01-01&to=2026-11-01`, 400, "bad_request"); // > 400 days
  });

  let status;
  test("GET /companies", async () => {
    const r = await get("/companies");
    assert.equal(r.status, 200);
    const c = r.data.find((x) => x.code === COMPANY);
    assert.ok(c, "pastalina is loaded");
    assert.equal(c.allegroKey, "pastaLina");
    assert.ok(c.years.includes(2026));
    assert.equal(r.meta.count, r.data.length);
  });

  test("GET /status", async () => {
    const r = await ok(`/status?company=${COMPANY}`);
    status = r.data;
    assert.equal(status.lastRun.status, "done");
    assert.match(status.lastRun.at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.match(status.dataUpTo, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(status.dataStart, "2025-04");
    assert.ok(status.months.length >= 20);
    const aug = status.months.find((m) => m.month === "2026-08");
    close(aug.income, 1740679.31, "August 2026 income (readme)");
    assert.equal(aug.salaries, 0);
    assert.deepEqual(aug.warnings, ["no_salary_expense"]);
    assert.equal(aug.complete, false);
    const may25 = status.months.find((m) => m.month === "2025-05");
    assert.equal(may25.complete, true);
    const sep = status.months.find((m) => m.month === "2026-09");
    assert.ok(sep.warnings.includes("income_not_posted") && sep.warnings.includes("no_salary_expense") && sep.warnings.includes("unposted_entries"));
    assert.ok(!status.months.some((m) => m.month > TODAY.slice(0, 7)), "no future months");
    assert.equal(status.banks[0].accountKey, "110011");
    assert.equal(status.suppliers.debitCount, 148);
    assert.ok(r.codes.includes("bank_gap") && r.codes.includes("supplier_balances_suspect") && r.codes.includes("not_validated"));
    assert.ok(!r.codes.includes("stale_sync") || r.warnings.find((w) => w.code === "stale_sync").severity === "info", "the local copy may be old, never failed");
  });

  test("GET /accounts: filters, balances, bank details only on request", async () => {
    const all = await ok(`/accounts?company=${COMPANY}`);
    assert.ok(all.data.length > 400);
    assert.ok(all.data.every((a) => !("bank" in a)));
    const g = await ok(`/accounts?company=${COMPANY}&group=500,700&q=וואלט&includeBank=1`);
    assert.equal(g.data.length, 1);
    const w = g.data[0];
    assert.equal(w.accountKey, "500059");
    assert.deepEqual([w.group, w.groupName, w.isGroupCompany], [500, "ספקים", false]);
    assert.ok("bank" in w && "code" in w.bank);
    close(w.balance, w.debit - w.credit, "balance = debit − credit");
    const old = await ok(`/accounts?company=${COMPANY}&account=500059&asOf=2025-06-30&q=500059`);
    assert.ok(Math.abs(old.data[0].balance) < Math.abs(w.balance), "an earlier asOf gives a smaller balance");
    const branchAcc = all.data.find((a) => a.accountKey === "723001");
    assert.deepEqual([branchAcc.branch, branchAcc.branchSource, branchAcc.line], [B.raanana, "account", "salaries"]);
    assert.equal(all.data.find((a) => a.accountKey === "700000").line, "income");
  });

  test("GET /branches", async () => {
    const r = await ok(`/branches?company=${COMPANY}`);
    assert.equal(r.data.length, 4);
    const ra = r.data.find((b) => b.costCode === "103");
    assert.equal(ra.branch, B.raanana);
    assert.ok(ra.accounts.some((a) => a.accountKey === "800003"), "קניות - רעננה belongs to Raanana");
    assert.equal(r.data.find((b) => b.costCode === "104").confirmed, false);
    assert.equal(r.meta.allegroBranches.length, 4);
  });

  describe("management", () => {
    test("GET /pnl by month with compare=prev_year (readme numbers)", async () => {
      const r = await ok(`/pnl?company=${COMPANY}&from=2026-08-01&to=2026-08-31&compare=prev_year`);
      assert.equal(r.data.length, 1);
      const row = r.data[0];
      assert.equal(row.period, "2026-08");
      close(row.income, 1740679.31); close(row.purchases, 499504.12); close(row.general, 400167.83); assert.equal(row.salaries, 0);
      close(row.profit, row.income - row.purchases - row.salaries - row.general, "profit formula");
      assert.equal(row.compare.period, "2025-08");
      close(row.compare.income, 1894955.08); close(row.compare.salaries, 654536.89); close(row.compare.profit, -542592.88);
      close(row.compare.change.change, row.profit - row.compare.profit);
      assert.deepEqual(r.meta.compare.from, "2025-08-01");
      const high = r.warnings.find((w) => w.code === "no_salary_expense");
      assert.ok(high && high.severity === "high" && high.affects.includes("2026-08"), "the readme's key warning");
      assert.deepEqual(r.meta.totals, { income: row.income, purchases: row.purchases, salaries: row.salaries, general: row.general, profit: row.profit });
    });
    test("GET /pnl: months add up to the year, empty months are kept, prev_period lines up", async () => {
      const months = await ok(`/pnl?company=${COMPANY}&from=2026-01-01&to=2026-10-31`);
      assert.equal(months.data.length, 10);
      assert.deepEqual(months.data.map((m) => m.period), ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
      const year = await ok(`/pnl?company=${COMPANY}&from=2026-01-01&to=2026-10-31&by=year`);
      assert.equal(year.data.length, 1);
      close(sum(months.data, (m) => m.income), year.data[0].income, "months = year");
      close(sum(months.data, (m) => m.profit), year.data[0].profit);
      assert.ok(months.codes.includes("income_not_posted"));
      const early = await ok(`/pnl?company=${COMPANY}&from=2025-01-01&to=2025-02-28`);
      assert.equal(early.data[0].income, 0);
      assert.ok(early.codes.includes("before_data_start"));
      const pp = await ok(`/pnl?company=${COMPANY}&from=2026-07-01&to=2026-08-31&compare=prev_period`);
      assert.deepEqual(pp.data.map((m) => m.compare.period), ["2026-05", "2026-06"]);
      const unposted = await ok(`/pnl?company=${COMPANY}&from=2026-09-01&to=2026-09-30&includeUnposted=1`);
      const posted = await ok(`/pnl?company=${COMPANY}&from=2026-09-01&to=2026-09-30`);
      assert.ok(unposted.data[0].purchases >= posted.data[0].purchases, "unposted entries add purchases");
      assert.ok(posted.codes.includes("unposted_entries") && !posted.warnings.find((w) => w.code === "unposted_entries").message.includes("0 unposted"));
    });
    test("GET /pnl by branch and by account", async () => {
      const br = await ok(`/pnl?company=${COMPANY}&from=2025-08-01&to=2025-08-31&by=branch`);
      const none = br.data.find((b) => b.branch === null);
      assert.ok(none && none.branchName === "No branch");
      assert.ok(br.data.length >= 4 && br.data.length <= 5, "the branches with amounts + No branch");
      for (const b of br.data) assert.ok(b.branchSource && ["cost", "account", "description"].every((k) => k in b.branchSource));
      const all = await ok(`/pnl?company=${COMPANY}&from=2025-08-01&to=2025-08-31`);
      close(sum(br.data, (b) => b.income), all.data[0].income, "branches + no branch = total income");
      close(sum(br.data, (b) => b.profit), all.data[0].profit);
      assert.ok(br.codes.includes("branch_partial"));
      const one = await ok(`/pnl?company=${COMPANY}&from=2025-08-01&to=2025-08-31&by=branch&branch=${B.raanana},none`);
      assert.deepEqual(one.data.map((b) => b.branch).sort(), [null, B.raanana].sort());
      const acc = await ok(`/pnl?company=${COMPANY}&from=2025-08-01&to=2025-08-31&by=account&compare=prev_period`);
      assert.ok(acc.data.length > 20);
      close(sum(acc.data.filter((a) => a.line === "income"), (a) => a.amount), all.data[0].income, "accounts = total");
      assert.ok(acc.data.every((a) => "accountKey" in a && "line" in a && "compare" in a && !("profit" in a)));
      const brCmp = await ok(`/pnl?company=${COMPANY}&from=2025-08-01&to=2025-08-31&by=branch&compare=prev_year`);
      assert.ok(brCmp.data.every((b) => "compare" in b));
    });
    test("GET /cash", async () => {
      const r = await ok(`/cash?company=${COMPANY}`);
      const d = r.data;
      close(d.bankBalance, 145338.11, "bank lines added up");
      close(d.lastRunningBalance, 121642.83, "Hashavshevet's running balance (readme)");
      assert.equal(d.bankBalanceDate, status.dataUpTo);
      close(d.bookBankBalance, -6036913.9);
      assert.equal(d.chequesOut.next30.count, 66);
      close(d.chequesOut.next30.amount, 677134.05);
      assert.ok(d.chequesOut.later.count > 100 && d.chequesDueNotCleared.count > 0);
      assert.ok(d.expectedIn.overdue > 0 && d.expectedIn.next30 === 0);
      close(d.projected.day30, d.bankBalance + d.expectedIn.next30 - d.chequesDueNotCleared.amount - d.chequesOut.next30.amount, "day30 formula");
      close(d.projected.day60, d.projected.day30 + d.expectedIn.days31to60 - d.chequesOut.days31to60.amount);
      assert.ok(["bank_gap", "supplier_balances_suspect", "bank_running_balance_differs"].every((c) => r.codes.includes(c)));
      const past = await ok(`/cash?company=${COMPANY}&asOf=2026-06-30`);
      assert.equal(past.data.bankBalanceDate <= "2026-06-30", true);
      assert.equal(past.data.lastRunningBalance, null, "the running balance is only known for the last line");
    });
    test("GET /spending by supplier, account, group, with compare, top, branch", async () => {
      const r = await ok(`/spending?company=${COMPANY}&from=2026-01-01&top=3&compare=prev_year`);
      assert.equal(r.data.length, 3);
      assert.equal(r.data[0].accountKey, "500059");
      close(r.data[0].amount, 894372.06, "Wolt 2026 (readme)");
      assert.ok(r.data[0].amount >= r.data[1].amount && r.data[1].amount >= r.data[2].amount);
      assert.ok(["previous", "change", "changePct"].every((k) => k in r.data[0]));
      close(r.data[0].change, r.data[0].amount - r.data[0].previous);
      assert.equal(r.meta.withVat, true);
      const acc = await ok(`/spending?company=${COMPANY}&from=2026-01-01&to=2026-10-31&by=account&top=0`);
      const grp = await ok(`/spending?company=${COMPANY}&from=2026-01-01&to=2026-10-31&by=group`);
      close(sum(acc.data, (a) => a.amount), sum(grp.data, (g) => g.amount), "accounts = groups");
      const pnl = await ok(`/pnl?company=${COMPANY}&from=2026-01-01&to=2026-10-31&by=year`);
      close(grp.data.find((g) => g.group === 800).amount, pnl.data[0].purchases, "group 800 = P&L purchases");
      const br = await ok(`/spending?company=${COMPANY}&from=2026-01-01&to=2026-10-31&by=account&branch=${B.raanana}&top=0`);
      assert.ok(sum(br.data, (a) => a.amount) < sum(acc.data, (a) => a.amount));
      assert.ok(br.data.some((a) => a.accountKey === "800003") && !br.data.some((a) => a.accountKey === "800002"));
    });
    test("GET /aging: open items tie to balances, buckets add up, methods, group companies", async () => {
      const s = await ok(`/aging?company=${COMPANY}&side=suppliers`);
      assert.ok(s.data.length > 200);
      for (const row of s.data) {
        close(sum(Object.values(row.buckets)), row.openTotal, `${row.accountKey} buckets = open`);
        assert.ok(["matched", "oldest_first"].includes(row.method));
        assert.deepEqual(Object.keys(row.buckets), AGE_BUCKETS);
      }
      assert.deepEqual(s.meta.untied, [], "every supplier's open items tie to its balance");
      close(s.meta.totals.balance, sum(s.data, (r) => r.balance));
      assert.ok(s.meta.methods.matched >= 60 && s.meta.methods.matched <= 75, "readme: 75 suppliers use matching; those with a zero balance are not listed");
      assert.ok(s.codes.includes("supplier_balances_suspect"));
      assert.ok(s.data.some((r) => r.isGroupCompany));
      const ex = await ok(`/aging?company=${COMPANY}&side=suppliers&excludeGroupCompanies=1`);
      assert.ok(ex.data.length < s.data.length && ex.data.every((r) => !r.isGroupCompany));
      const c = await ok(`/aging?company=${COMPANY}&side=customers&account=200010`);
      assert.equal(c.data.length, 1);
      assert.equal(c.data[0].accountKey, "200010");
      assert.ok(!c.codes.includes("supplier_balances_suspect"));
      const past = await ok(`/aging?company=${COMPANY}&side=customers&asOf=2025-06-30`);
      assert.ok(past.data.length < (await ok(`/aging?company=${COMPANY}&side=customers`)).data.length);
    });
    test("GET /intercompany", async () => {
      const r = await ok(`/intercompany?company=${COMPANY}&from=2026-01-01`);
      assert.equal(r.data.length, 8);
      const a = r.data.find((x) => x.accountKey === "500084");
      close(a.balance, 2027583.37, "readme table");
      assert.deepEqual([a.kind, a.balanceSide, a.confirmed], ["group_company", "debit", false]);
      assert.ok(a.movement.debit >= 0 && a.movement.from === "2026-01-01");
      assert.ok(r.codes.includes("other_company_missing"));
      assert.ok(r.meta.totals.debit > r.meta.totals.credit);
    });
  });

  describe("accountant", () => {
    let tb;
    test("GET /trial-balance: debit = credit, matches the stored balances, from gives opening + movement", async () => {
      tb = await ok(`/trial-balance?company=${COMPANY}`);
      assert.ok(tb.data.length > 400);
      assert.equal(tb.meta.balanced, true);
      close(tb.meta.totals.debit, tb.meta.totals.credit, "debit = credit");
      close(tb.meta.totals.balance, 0);
      const bank = tb.data.find((a) => a.accountKey === "110011");
      close(bank.balance, -6001226.2, "as of today: two future-dated entries are left out");
      const later = await ok(`/trial-balance?company=${COMPANY}&asOf=2026-12-31`);
      close(later.data.find((a) => a.accountKey === "110011").balance, -6036913.9, "readme: all entries");
      assert.equal(later.meta.balanced, true);
      for (const a of tb.data) close(a.balance, a.debit - a.credit, `${a.accountKey} balance = debit − credit`);
      const part = await ok(`/trial-balance?company=${COMPANY}&from=2026-01-01&asOf=2026-11-05&group=700,800`);
      assert.ok(part.data.every((a) => [700, 800].includes(a.group) && "opening" in a));
      for (const a of part.data) close(a.opening + a.debit - a.credit, a.balance, `${a.accountKey}: opening + movement = closing`);
      assert.equal(part.meta.balanced, false, "a part of the accounts does not balance; no warning for a filtered list");
      assert.ok(!part.codes.includes("trial_balance_unbalanced"));
      const un = await ok(`/trial-balance?company=${COMPANY}&includeUnposted=1`);
      assert.ok(un.meta.totals.debit > tb.meta.totals.debit);
    });
    test("GET /ledger: running balance, opening/closing, paging from the account start, q", async () => {
      const r = await ok(`/ledger?company=${COMPANY}&account=500059&from=2026-09-01&to=2026-10-31`);
      assert.equal(r.meta.total, 15);
      assert.equal(r.data.length, 15);
      let run = r.meta.openingBalance;
      for (const l of r.data) { run = Math.round((run + l.debit - l.credit) * 100) / 100; close(l.runningBalance, run, "running balance"); assert.ok(l.date >= "2026-09-01" && l.date <= "2026-10-31"); }
      close(run, r.meta.closingBalance);
      close(r.meta.closingBalance, tb.data.find((a) => a.accountKey === "500059").balance, "closing = trial balance");
      assert.ok(r.data.every((l) => l.posted && typeof l.matched === "boolean" && l.counterAccount));
      const page = await ok(`/ledger?company=${COMPANY}&account=500059&from=2026-09-01&to=2026-10-31&limit=3&offset=1`);
      assert.equal(page.data.length, 3);
      assert.deepEqual(page.data[0], r.data[1], "offset 1 = the second line, same running balance");
      const amb = await ok(`/ledger?company=${COMPANY}&q=10 ביס&from=2026-01-01`);
      assert.equal(amb.data, null);
      assert.equal(amb.meta.ambiguous, true);
      assert.deepEqual(amb.meta.accounts.map((a) => a.accountKey).sort(), ["200010", "500060"]);
      const byQ = await ok(`/ledger?company=${COMPANY}&q=וואלט אנטרפריזס&from=2026-09-01&to=2026-10-31`);
      assert.equal(byQ.meta.account.accountKey, "500059");
      const un = await ok(`/ledger?company=${COMPANY}&account=800002&from=2026-09-01&to=2026-09-30&includeUnposted=1`);
      assert.ok(un.data.some((l) => !l.posted), "September has an unposted purchase");
    });
    test("GET /journal: filters, paging, totals; GET /journal/:year/:transId", async () => {
      const batch = await ok(`/journal?company=${COMPANY}&batch=258`);
      assert.equal(batch.meta.total, 19);
      assert.ok(batch.data.every((e) => e.batch === 258 && e.posted === false && e.lineCount >= 1));
      const page = await ok(`/journal?company=${COMPANY}&batch=258&limit=5&offset=5`);
      assert.equal(page.data.length, 5);
      assert.deepEqual(page.data[0], batch.data[5]);
      const ref = await ok(`/journal?company=${COMPANY}&reference=50093`);
      assert.deepEqual(ref.data.map((e) => e.type), ["ע", "חז"]);
      const typed = await ok(`/journal?company=${COMPANY}&type=חז&from=2026-01-01&to=2026-10-31&posted=1`);
      assert.equal(typed.meta.total, 4);
      const acc = await ok(`/journal?company=${COMPANY}&account=400003&from=2025-01-01&to=2026-11-07&q=רכוש`);
      assert.ok(acc.data.length >= 1 && acc.data.every((e) => e.description?.includes("רכוש") || e.debitName?.includes("רכוש") || e.creditName?.includes("רכוש") || e.details?.includes("רכוש")));
      const range = await ok(`/journal?company=${COMPANY}&from=2026-11-01&limit=10`);
      assert.ok(range.data.every((e) => e.date >= "2026-11-01" && e.date <= TODAY));
      const toOnly = await ok(`/journal?company=${COMPANY}&to=2025-01-31&limit=3`);
      assert.ok(toOnly.data.every((e) => e.date <= "2025-01-31"));
      const all = await ok(`/journal?company=${COMPANY}&limit=1`);
      assert.ok(all.meta.total > 16000);
      const one = await ok(`/journal/2026/18140?company=${COMPANY}`);
      const e = one.data;
      assert.deepEqual([e.transId, e.year, e.date, e.lineCount, e.lines.length, e.balanced], [18140, 2026, "2026-11-03", 2, 2, true]);
      assert.equal(e.lines.find((l) => l.accountKey === "110011").matchKind, "bank");
      close(one.meta.debit, one.meta.credit);
      const withDoc = await ok(`/journal/2026/11792?company=${COMPANY}`);
      assert.ok(withDoc.data.document && withDoc.data.document.number === 50093 && Array.isArray(withDoc.data.document.lines));
      const withCheque = await ok(`/journal/2026/18056?company=${COMPANY}`);
      assert.ok(withCheque.data.cheque && withCheque.data.cheque.chequeId === 2078);
    });
    test("GET /bank/reconciliation, /bank/open, /bank/suggestions", async () => {
      const rec = await ok(`/bank/reconciliation?company=${COMPANY}`);
      assert.equal(rec.data.length, 1);
      const b = rec.data[0];
      assert.equal(b.accountKey, "110011");
      close(b.bankBalance, 145338.11); close(b.lastRunningBalance, 121642.83); close(b.bookBalance, -6036913.9);
      close(b.bankOpen, 17708.88); close(b.bookOpen, -6140847.85);
      assert.deepEqual([b.openBankLines, b.openBookLines], [758, 943]);
      close(b.bankMatched, b.bankBalance - b.bankOpen); close(b.bookMatched, b.bookBalance - b.bookOpen);
      close(b.bookMatched, 103933.95, "readme");
      assert.ok(rec.codes.includes("bank_matched_differs"), "matched sides differ by the 2024 line → high warning");
      assert.ok(rec.codes.includes("bank_gap"));
      const ages = (side) => sum(Object.values(b.openAge[side]), (x) => x.count);
      assert.equal(ages("bank"), 758); assert.equal(ages("book"), 943);
      close(sum(Object.values(b.openAge.bank), (x) => x.amount), b.bankOpen); close(sum(Object.values(b.openAge.book), (x) => x.amount), b.bookOpen);

      const bank = await ok(`/bank/open?company=${COMPANY}&side=bank&limit=5`);
      assert.equal(bank.meta.total, 758);
      close(bank.meta.amount, 17708.88);
      assert.ok(bank.data.every((l, i, a) => ["in", "out"].includes(l.direction) && (i === 0 || a[i - 1].date <= l.date)), "oldest first");
      const chq = await ok(`/bank/open?company=${COMPANY}&side=bank&from=2026-01-01&limit=1000`);
      const chequeLines = chq.data.filter((l) => /^שיק/.test(l.details));
      assert.ok(chequeLines.length > 0 && chequeLines.every((l) => ["cheques", "journal", "priority", "missing"].includes(l.payeeSource)), "cheque lines carry the beneficiary");
      assert.equal(chq.meta.payees.lines, chq.data.filter((l) => /^שיק|החזרת שיק|בטול שיק/.test(l.details)).length);
      const old = await ok(`/bank/open?company=${COMPANY}&side=bank&minAge=90&limit=5`);
      assert.ok(old.meta.total < bank.meta.total && old.data.every((l) => l.ageDays >= 90));
      const ranged = await ok(`/bank/open?company=${COMPANY}&side=bank&from=2026-10-01&to=2026-10-31&limit=1000`);
      assert.ok(ranged.data.every((l) => l.date >= "2026-10-01" && l.date <= "2026-10-31") && ranged.meta.total > 0);
      const book = await ok(`/bank/open?company=${COMPANY}&side=book&limit=5&account=110011`);
      assert.equal(book.meta.total, 943);
      close(book.meta.amount, -6140847.85);
      assert.ok(book.data.every((l) => l.counterAccount && typeof l.posted === "boolean"));

      const sug = await ok(`/bank/suggestions?company=${COMPANY}&days=30&limit=3`);
      assert.ok(sug.meta.total >= 40 && sug.meta.single + sug.meta.many === sug.meta.total);
      for (const s of sug.data) { assert.ok(s.candidates.length >= 1 && s.candidates.every((c) => c.amount === s.amount && c.daysApart <= 30)); assert.equal(s.confidence, s.candidates.length === 1 ? "single" : "many"); }
      const strict = await ok(`/bank/suggestions?company=${COMPANY}&days=0`);
      assert.ok(strict.meta.total <= sug.meta.total);
      const min = await ok(`/bank/suggestions?company=${COMPANY}&days=30&minAmount=5000`);
      assert.ok(min.data.every((s) => s.amount >= 5000));
    });
    test("GET /invoices: kinds, types, totals, q, account", async () => {
      const r = await ok(`/invoices?company=${COMPANY}&from=2026-01-01&to=2026-10-31&limit=1000`);
      assert.equal(r.meta.total, 129, "readme: 128 documents of fiscal year 2026, plus one dated 2026 but kept in year 2024");
      assert.ok(r.data.every((i) => ["invoice", "credit"].includes(i.type) && ["customer", "register"].includes(i.kind) && i.posted));
      close(r.meta.amount, sum(r.data, (i) => i.amount));
      const cr = await ok(`/invoices?company=${COMPANY}&from=2026-01-01&to=2026-10-31&type=credit`);
      assert.equal(cr.meta.total, 4);
      assert.ok(cr.data.every((i) => i.amount < 0 && i.typeCode === "חז"));
      const inv = await ok(`/invoices?company=${COMPANY}&from=2026-01-01&to=2026-10-31&type=invoice&limit=1`);
      assert.equal(inv.meta.total + cr.meta.total, r.meta.total);
      const q = await ok(`/invoices?company=${COMPANY}&from=2025-01-01&to=2026-11-07&q=פייזר`);
      assert.ok(q.data.length >= 2 && q.data.every((i) => i.customerName.includes("פייזר")));
      const acc = await ok(`/invoices?company=${COMPANY}&from=2025-01-01&to=2026-11-07&account=200033`);
      assert.deepEqual(acc.data.map((i) => i.accountKey), acc.data.map(() => "200033"));
      assert.ok(r.codes.includes("income_not_posted"));
    });
    test("GET /invoices?side=supplier: the books' supplier invoices with the entry date (owner 2026-11-09)", async () => {
      const r = await ok(`/invoices?company=${COMPANY}&from=2026-01-01&to=2026-11-07&side=supplier&limit=5000`);
      assert.equal(r.meta.side, "supplier");
      assert.ok(r.meta.total > 2000 && r.data.length === r.meta.total, `all rows in one page: ${r.data.length} of ${r.meta.total}`);
      assert.ok(r.data.every((i) => i.kind === "supplier" && i.posted && i.supplierName && i.expenseAccount));
      // a supplier credit note = a minus amount on the same entry types
      assert.ok(r.data.every((i) => (i.type === "credit") === i.amount < 0));
      const cr = await ok(`/invoices?company=${COMPANY}&from=2026-01-01&to=2026-11-07&side=supplier&type=credit`);
      assert.ok(cr.meta.total > 50 && cr.data.every((i) => i.type === "credit" && i.amount < 0));
      const inv = await ok(`/invoices?company=${COMPANY}&from=2026-01-01&to=2026-11-07&side=supplier&type=invoice&limit=1`);
      assert.equal(inv.meta.total + cr.meta.total, r.meta.total);
      assert.ok(r.data.every((i) => /^\d{4}-\d{2}-\d{2}$/.test(i.date) && (i.entryDate == null || /^\d{4}-\d{2}-\d{2}$/.test(i.entryDate))));
      assert.ok(r.data.filter((i) => i.entryDate && i.entryDate !== i.date).length > r.data.length / 2, "the entry date is a different day from the invoice date on most entries");
      close(r.meta.amount, sum(r.data, (i) => i.amount));
      assert.ok(r.data.every((i) => ["ח18", "תצ", "ת23", "חק", "ת"].includes(i.typeCode)));
      const q = await ok(`/invoices?company=${COMPANY}&from=2026-10-01&to=2026-10-31&side=supplier&q=מטאורי`);
      assert.ok(q.data.length > 0 && q.data.every((i) => i.supplierName.includes("מטאורי")));
      const acc = await ok(`/invoices?company=${COMPANY}&from=2026-01-01&to=2026-11-07&side=supplier&account=${q.data[0].accountKey}`);
      assert.ok(acc.data.every((i) => i.accountKey === q.data[0].accountKey));
      await fail(`/invoices?company=${COMPANY}&from=2026-01-01&side=sideways`, 400, "bad_request");
      // the customer side is unchanged, plus the entry date
      const c = await ok(`/invoices?company=${COMPANY}&from=2026-01-01&to=2026-10-31&limit=1`);
      assert.equal(c.meta.side, "customer");
      assert.ok(c.data[0].entryDate && c.data[0].customerName);
    });
    test("GET /statement: supplier and customer, open items tie to the balance, kinds", async () => {
      const s = await ok(`/statement?company=${COMPANY}&account=500059&from=2026-09-01`);
      const d = s.data;
      assert.equal(d.account.side, "suppliers");
      assert.ok(d.invoices.length > 0 && d.invoices.every((i) => i.kind === "invoice" && i.credit > 0));
      close(d.balance, 1421109.86);
      close(d.totals.open, d.balance, "open items = balance (matched)");
      assert.equal(s.meta.method, "matched");
      close(sum(Object.values(d.buckets)), d.totals.open);
      assert.ok(d.openingBalance != null && d.openItems.every((i) => AGE_BUCKETS.includes(i.bucket)));
      const c = await ok(`/statement?company=${COMPANY}&account=200010`);
      assert.equal(c.data.account.side, "customers");
      assert.equal(c.data.invoices.length, 3); assert.equal(c.data.credits.length, 3);
      assert.ok(c.data.others.length > 0, "register-like income lines are 'other'");
      assert.equal(c.data.openingBalance, null);
      close(c.data.totals.open, c.data.balance, "oldest_first ties too");
      const other = await ok(`/statement?company=${COMPANY}&account=950000`);
      assert.deepEqual([other.data.account.side, other.meta.method, other.data.openItems.length], ["other", "none", 0]);
      const amb = await ok(`/statement?company=${COMPANY}&q=10 ביס`);
      assert.equal(amb.meta.ambiguous, true);
    });
    test("GET /cheques: states, totals, filters", async () => {
      const all = await ok(`/cheques?company=${COMPANY}&limit=5000`);
      assert.equal(all.meta.total, 1665, "readme: 1,665 cheques");
      assert.equal(all.meta.totals.future.count, 297);
      close(all.meta.totals.future.amount, 2533338.65, "readme");
      assert.ok(all.data.every((c) => ["future", "cleared", "not_cleared"].includes(c.state) && !("cleared" in c)));
      assert.ok(all.data.filter((c) => c.state === "future").every((c) => c.dueDate > TODAY));
      assert.deepEqual(all.meta.notAvailable, ["returned"]);
      const nc = await ok(`/cheques?company=${COMPANY}&state=not_cleared`);
      assert.ok(nc.data.every((c) => c.state === "not_cleared" && c.dueDate <= TODAY));
      const due = await ok(`/cheques?company=${COMPANY}&state=due&limit=5000`);
      assert.equal(due.meta.total, all.meta.totals.cleared.count + all.meta.totals.not_cleared.count);
      const ret = await ok(`/cheques?company=${COMPANY}&state=returned`);
      assert.equal(ret.data.length, 0);
      const ranged = await ok(`/cheques?company=${COMPANY}&from=2026-12-01&to=2026-12-31&account=500084`);
      assert.ok(ranged.data.every((c) => c.dueDate >= "2026-12-01" && c.dueDate <= "2026-12-31" && c.account === "500084"));
      assert.ok(ranged.data.every((c) => c.entry && c.entry.transId));
    });
    test("GET /cheques?number= and GET /cheques/priority: the Priority history", async () => {
      const some = await ok(`/cheques?company=${COMPANY}&limit=3`);
      const no = some.data[0].reference;
      const byNo = await ok(`/cheques?company=${COMPANY}&number=${no},999999999`);
      assert.ok(byNo.data.length >= 1 && byNo.data.every((c) => Number(c.reference) === Number(no)));
      assert.deepEqual(byNo.meta.number, [Number(no), 999999999]);
      await fail(`/cheques?company=${COMPANY}&number=abc`, 400, "bad_request");

      const one = await ok(`/cheques/priority?company=${COMPANY}&cheque=10337`);
      assert.equal(one.meta.total, 1);
      assert.equal(one.data[0].supplier, 'שיווק א.א עפולה צ.א בע"מ');
      assert.equal(one.data[0].lines.length, 4);
      assert.equal(one.meta.source.company, "pastaLina");
      const name = await ok(`/cheques/priority?company=${COMPANY}&q=נסיפי&from=2025-06-01&to=2025-06-30`);
      assert.equal(name.meta.total, 4);
      assert.ok(name.data.every((c) => c.supplier.includes("נסיפי") && c.chequeDate >= "2025-06-01" && c.chequeDate <= "2025-06-30"));
      close(name.meta.totals.net, name.meta.totals.amount - name.meta.totals.withholding);
      const amt = await ok(`/cheques/priority?company=${COMPANY}&amount=16878`);
      assert.deepEqual(amt.data.map((c) => c.cheque), [10777]);
      const paged = await ok(`/cheques/priority?company=${COMPANY}&from=2025-05-01&to=2029-12-31&limit=2&offset=1`);
      assert.equal(paged.data.length, 2);
      assert.equal(paged.meta.total, 2678, "a range of years is allowed: the file is small");
      await fail(`/cheques/priority?company=${COMPANY}&cheque=x`, 400, "bad_request");
      await fail(`/cheques/priority?company=${COMPANY}&amount=abc`, 400, "bad_request");
    });
    test("GET /cheques/all: Hashavshevet + Priority in one table", async () => {
      const all = await ok(`/cheques/all?company=${COMPANY}&limit=5000`);
      const c = all.meta.counts;
      assert.equal(c.total, all.data.length);
      assert.equal(c.hashavshevet + c.priority + c.both, c.total);
      assert.equal(c.hashavshevet + c.both, 1665, "every Hashavshevet cheque is in the table once");
      assert.equal(c.priority + c.both, 2678, "every Priority cheque is in the table once");
      assert.equal(c.both, 0, "the two sources do not overlap on the local copy: Hashavshevet's numbers start at 15917");
      assert.ok(c.bankPaid > 2000, "most cheques were paid by the bank");
      assert.ok(all.data.every((x, i, a) => i === 0 || String(a[i - 1].dueDate || "9999") <= String(x.dueDate || "9999")), "by due date");
      const p = all.data.find((x) => x.cheque === 10337);
      assert.equal(p.invoices, "9473, 9100, 8528, 8156");
      assert.ok(["future", "cleared", "not_cleared"].includes(p.state));
      close(all.meta.totals.amount, all.data.reduce((s, x) => s + x.amount, 0));
      const fut = await ok(`/cheques/all?company=${COMPANY}&state=future&source=priority&limit=5000`);
      assert.ok(fut.data.every((x) => x.state === "future" && x.source === "priority" && x.dueDate > TODAY));
      const ranged = await ok(`/cheques/all?company=${COMPANY}&from=2025-06-01&to=2025-06-30&limit=5000`);
      assert.ok(ranged.data.length > 0 && ranged.data.every((x) => x.dueDate >= "2025-06-01" && x.dueDate <= "2025-06-30"));
      assert.equal(ranged.meta.counts.total, c.total, "counts cover everything");
      await fail(`/cheques/all?company=${COMPANY}&source=excel`, 400, "bad_request");
    });
    test("GET /bank/balances: the closing balance of each bank day (the bank file, else Hashavshevet)", async () => {
      const r = await ok(`/bank/balances?company=${COMPANY}&from=2026-10-19&to=2026-10-26`);
      assert.ok(r.data.length >= 5, "a bank day per working day");
      assert.ok(r.data.every((x, i, a) => i === 0 || a[i - 1].date < x.date), "one row per day, ascending");
      assert.ok(r.data.every((x) => ["bank_file", "hashavshevet"].includes(x.source) && typeof x.balance === "number" && x.lines > 0));
      // Hashavshevet's copy of the statement: 2026-10-20 closed at -256,610.28 (the file, when loaded, says the same → agree)
      const d = r.data.find((x) => x.date === "2026-10-20");
      close(d.balance, -256610.28, "closing of 2026-10-20");
      assert.equal(r.meta.last.date, r.data[r.data.length - 1].date);
      assert.equal(r.meta.sources.hashavshevet.accounts.length, 1);
      if (r.meta.sources.bankFile.days) assert.equal(r.meta.agree, true, "the two copies agree on their last common finished day");
      // 2026-10-26: the file was uploaded that morning (provisional, 10 returned cheques the final statement has not) → Hashavshevet's day wins
      const last = r.data.find((x) => x.date === "2026-10-26");
      if (r.meta.sources.bankFile.days) assert.equal(last.source, "hashavshevet");
      close(last.balance, -80063.45, "closing of 2026-10-26 = Hashavshevet's last line");
      // pure helpers: the sum of the accounts' last known balances, the file wins on a common day
      const { balanceSeries, mergeBalanceSeries } = api;
      const s = balanceSeries([{ account: "a", date: "2026-01-02", balance: 10, lines: 1 }, { account: "b", date: "2026-01-01", balance: 5, lines: 2 }, { account: "a", date: "2026-01-03", balance: null, lines: 1 }, { account: "b", date: "2026-01-03", balance: 7, lines: 1 }]);
      assert.deepEqual(s, [{ date: "2026-01-01", balance: 5, lines: 2, accounts: 1 }, { date: "2026-01-02", balance: 15, lines: 1, accounts: 2 }, { date: "2026-01-03", balance: 17, lines: 1, accounts: 2 }]);
      const m = mergeBalanceSeries([{ date: "2026-01-02", balance: 15, lines: 1 }, { date: "2026-01-03", balance: 99, lines: 1, provisional: true }, { date: "2026-01-04", balance: 20, lines: 1, provisional: true }], [{ date: "2026-01-01", balance: 5, lines: 2 }, { date: "2026-01-02", balance: 15.004, lines: 1 }, { date: "2026-01-03", balance: 17, lines: 1 }]);
      assert.deepEqual(m.data.map((x) => [x.date, x.source, x.balance]), [["2026-01-01", "hashavshevet", 5], ["2026-01-02", "bank_file", 15], ["2026-01-03", "hashavshevet", 17], ["2026-01-04", "bank_file", 20]], "a provisional file day loses to Hashavshevet's day, but stands alone");
      assert.deepEqual(m.last, { date: "2026-01-04", balance: 20, source: "bank_file", provisional: true });
      assert.equal(m.agree, true, "compared on 01-02, the last common finished day");
      assert.equal(balanceSeries([{ account: "a", date: "2026-01-02", balance: 1, lines: 1, provisional: true }])[0].provisional, true);
      assert.equal(mergeBalanceSeries([], []).last, null);
      await fail(`/bank/balances?company=${COMPANY}&from=2026-10-26&to=2026-10-19`, 400, "bad_request");
      await fail(`/bank/balances?company=${COMPANY}&account=no-such-account`, 404, "not_found");
    });
    test("GET /vat and /vat/issues", async () => {
      const r = await ok(`/vat?company=${COMPANY}&from=2026-07-01&to=2026-08-31`);
      assert.deepEqual(r.data.map((m) => m.month), ["2026-07", "2026-08"]);
      for (const m of r.data) close(m.toPay, m.salesVat - m.inputVat - m.assetVat, "toPay formula");
      close(r.meta.totals.toPay, sum(r.data, (m) => m.toPay));
      assert.equal(r.meta.accounts.sales.accountKey, "400001");
      const tbAug = await ok(`/trial-balance?company=${COMPANY}&asOf=2026-08-31`);
      close(r.meta.balancesAtTo["400001"], tbAug.data.find((a) => a.accountKey === "400001").balance, "balance at `to` = trial balance at that date");
      const aug = r.data[1];
      const income = (await ok(`/pnl?company=${COMPANY}&from=2026-08-01&to=2026-08-31`)).data[0].income;
      assert.ok(aug.salesVat / income > 0.15 && aug.salesVat / income < 0.2, "sales VAT about 18% of income");
      const issues = await ok(`/vat/issues?company=${COMPANY}&from=2026-01-01&to=2026-01-31`);
      assert.ok(issues.data.length >= 6, "January 2026 has several runs (readme)");
      assert.ok(issues.data.every((x) => x.lines === sum(Object.values(x.byType), (t) => t.count)));
      const allRuns = await ok(`/vat/issues?company=${COMPANY}`);
      assert.equal(allRuns.data.length, 34);
    });
    test("GET /withholding", async () => {
      const r = await ok(`/withholding?company=${COMPANY}&from=2026-01-01&expiring=200`);
      const d = r.data;
      assert.ok(d.deductions.length > 50 && d.deductions.every((x) => x.accountKey.startsWith("5") && x.paid >= x.deducted));
      assert.ok(d.deductions[0].deducted > 0 && d.deductions[0].deductedPct === 5);
      assert.ok(r.meta.otherPayments.paid > 0, "salary payments of the same type are counted apart");
      close(r.meta.totals.deducted, sum(d.deductions, (x) => x.deducted));
      assert.ok(d.certificates.every((c) => ["valid", "expiring", "expired"].includes(c.certificate) && c.validTo >= "2000-01-01"));
      assert.equal(d.noCertificate, 118, "readme: 118 empty dates");
      const cc = r.meta.certificates;
      assert.equal((cc.valid || 0) + (cc.expiring || 0) + (cc.expired || 0) + (cc.none || 0), 253, "every supplier account is counted once");
      assert.ok(r.meta.certificates.expiring >= 4, "readme: 4 end by January 2027");
      const one = await ok(`/withholding?company=${COMPANY}&account=500074`);
      assert.equal(one.data.certificates.length, 1);
      assert.equal(one.data.deductions.length, 1);
    });
    test("GET /allocation-numbers", async () => {
      const r = await ok(`/allocation-numbers?company=${COMPANY}&from=2025-01-01&to=2026-11-07&limit=5000`);
      assert.ok(r.meta.counts.ok >= 290 && r.meta.counts.ok <= 317, `readme: 317 real numbers on all entries; ${r.meta.counts.ok} on posted supplier invoices`);
      assert.equal(r.data.filter((x) => x.status === "ok").length, r.meta.counts.ok, "every real number is listed");
      assert.ok(r.data.every((x) => x.required || x.allocationNumber));
      assert.ok(r.data.every((x) => ["ok", "missing", "suspect"].includes(x.status) && (x.threshold == null || typeof x.threshold === "number")));
      assert.equal(r.data.filter((x) => x.date >= "2026-01-01").every((x) => x.threshold === 10000), true);
      const miss = await ok(`/allocation-numbers?company=${COMPANY}&from=2026-01-01&missingOnly=1&limit=5000`);
      assert.ok(miss.data.every((x) => x.status !== "ok" && (x.required || x.allocationNumber)));
      assert.ok(miss.meta.total >= miss.meta.counts.requiredMissing);
      const min = await ok(`/allocation-numbers?company=${COMPANY}&from=2026-01-01&minAmount=50000&limit=5000`);
      assert.ok(min.data.every((x) => x.amount >= 50000 && x.threshold === 50000));
      assert.equal(r.meta.thresholdsConfirmed, false);
    });
    test("GET /exceptions", async () => {
      const r = await ok(`/exceptions?company=${COMPANY}&limit=5000`);
      assert.deepEqual(r.meta.counts, { unposted: 20, future_dated: 2, possible_duplicate: r.meta.counts.possible_duplicate, missing_branch: r.meta.counts.missing_branch });
      assert.ok(r.meta.counts.possible_duplicate > 100 && r.meta.counts.missing_branch > 100);
      assert.equal(r.meta.total, sum(Object.values(r.meta.counts)));
      assert.deepEqual(r.meta.notAvailable, ["wrong_account"]);
      const types = new Set(r.data.map((x) => x.type));
      assert.deepEqual([...types].sort(), ["future_dated", "missing_branch", "possible_duplicate", "unposted"]);
      assert.ok(r.data.filter((x) => x.type === "unposted").every((x) => x.posted === false && "entryType" in x));
      assert.ok(r.data.filter((x) => x.type === "future_dated").every((x) => x.date > TODAY));
      assert.ok(r.data.filter((x) => x.type === "possible_duplicate").every((x) => x.count >= 2 && x.entries.length === x.count));
      const mb = await ok(`/exceptions?company=${COMPANY}&type=missing_branch&from=2026-08-01&to=2026-08-31&limit=5000`);
      assert.ok(mb.data.every((x) => x.type === "missing_branch" && x.date >= "2026-08-01" && x.date <= "2026-08-31" && [720, 800, 900].includes(x.group)));
      const wa = await ok(`/exceptions?company=${COMPANY}&type=wrong_account`);
      assert.deepEqual([wa.data.length, wa.meta.counts.wrong_account], [0, null]);
    });
    test("GET /changes", async () => {
      const r = await ok(`/changes?company=${COMPANY}&from=2025-09-01&to=2026-11-07&limit=5000`);
      assert.deepEqual(r.meta.counts, { account: 2775, login: 557, vat_run: 199, sync: 2 }, "readme row counts");
      assert.equal(r.meta.total, 3533);
      assert.ok(r.data.every((x) => x.date >= "2025-09-01" && x.date <= "2026-11-07"));
      const acc = r.data.find((x) => x.kind === "account");
      assert.ok(acc.accountKey && acc.field && "oldValue" in acc && "newValue" in acc && /^\d{2}:\d{2}$/.test(acc.time));
      const login = r.data.find((x) => x.kind === "login");
      assert.ok(login.loginName && "result" in login);
      const sync = r.data.find((x) => x.kind === "sync");
      assert.ok(sync.sourceTable && sync.change && sync.oldRow && sync.syncRunId);
      const only = await ok(`/changes?company=${COMPANY}&from=2025-09-01&to=2026-11-07&kind=account&account=110011`);
      assert.ok(only.data.length > 0 && only.data.every((x) => x.kind === "account" && x.accountKey === "110011"));
      const none = await ok(`/changes?company=${COMPANY}&from=2024-01-01&to=2024-12-31`);
      assert.equal(none.data.length, 0);
    });
  });

  describe("mixed data (finance + admin DB)", () => {
    mixed("GET /payroll-check", async () => {
      const r = await ok(`/payroll-check?company=${COMPANY}&month=2025-08`);
      assert.equal(r.data.length, 5, "4 branches + No branch");
      const none = r.data.find((x) => x.branch === null);
      assert.ok(none && none.payrollSource === "none");
      close(sum(r.data, (x) => x.books), r.meta.totals.books);
      const pnl = (await ok(`/pnl?company=${COMPANY}&from=2025-08-01&to=2025-08-31`)).data[0];
      close(r.meta.totals.books, pnl.salaries, "books = P&L salaries of the month");
      assert.ok(r.data.every((x) => ["saved", "tabit", "none"].includes(x.payrollSource) && (x.payroll == null || typeof x.difference === "number")));
      const aug26 = await ok(`/payroll-check?company=${COMPANY}&month=2026-08&branch=${B.raanana}`);
      assert.equal(aug26.data.length, 2);
      assert.equal(aug26.data[0].books, 0);
      assert.ok(aug26.data[0].payroll > 0 && aug26.data[0].payrollSource !== "none", "Raanana August 2026 has payroll data");
      assert.ok(aug26.codes.includes("no_salary_expense"));
    }, { timeout: 300000 });
    mixed("GET /branch-costs", async () => {
      const r = await ok(`/branch-costs?company=${COMPANY}&from=2026-07-01&to=2026-08-31&branch=${B.raanana}`);
      assert.equal(r.data.length, 2);
      for (const x of r.data) {
        assert.equal(x.branch, B.raanana);
        assert.ok(["books", "beecomm", "none"].includes(x.revenueSource) && x.revenue > 0);
        assert.ok(x.foodCost > 0 && x.foodPct > 0 && x.foodPct < 100);
        assert.ok(x.laborSource !== "none" && x.laborCost > 0 && x.laborPct > 0);
        close(x.foodPct, Math.round((x.foodCost / x.revenue) * 10000) / 100, "foodPct");
      }
      const aug = r.data.find((x) => x.month === "2026-08");
      assert.ok(Math.abs(aug.revenue - 672225) < 1, "readme: Raanana August 2026 revenue (books), rounded");
      assert.equal(aug.revenueSource, "books");
      const spring = await ok(`/branch-costs?company=${COMPANY}&from=2026-03-01&to=2026-03-31&branch=${B.rosh}`);
      assert.equal(spring.data[0].revenueSource, "beecomm", "February–May 2026 income has no branch → Beecomm");
      assert.ok(spring.data[0].beecommNet > 0);
      assert.ok(r.codes.includes("no_salary_expense"));
    }, { timeout: 300000 });
    mixed("GET /sales-vs-books", async () => {
      const r = await ok(`/sales-vs-books?company=${COMPANY}&from=2026-08-01&to=2026-09-30`);
      assert.equal(r.data.length, 10, "2 months × (4 branches + company total)");
      const totals = r.data.filter((x) => x.branch === null);
      assert.equal(totals.length, 2);
      for (const m of ["2026-08", "2026-09"]) {
        const rows = r.data.filter((x) => x.month === m && x.branch);
        const t = totals.find((x) => x.month === m);
        close(sum(rows, (x) => x.salesSystem), t.salesSystem, "branches add up to the company total");
        close(sum(rows, (x) => x.books) + t.booksNoBranch, t.books);
        close(t.difference, t.books - t.salesSystem);
      }
      const sep = totals.find((x) => x.month === "2026-09");
      assert.ok(sep.salesSystem > 1000000 && sep.books < 100000, "September 2026: sales exist, income not posted");
      assert.ok(r.codes.includes("income_not_posted"));
    }, { timeout: 300000 });
  });
});
