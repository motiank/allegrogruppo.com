// Tests of the Beecomm update on demand (admin/server/modules/beecommSync.js): how the loader's output is read (it
// prints its errors and exits 0), and that a start without the back office login is refused before anything runs.
//   node --test scripts/test_beecomm_sync.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { verdict, configured, disabled, start, parsePlan, extAnswer, extFinish } from "../admin/server/modules/beecommSync.js";
import { cubeKey } from "../scripts/server/analoader/bcom_api_loader.js";

const GOOD = `dir name /x/sqldumper
Using dates: 16/11/2026 to 21/11/2026
120 3
bcom_orders: 3755 orders saved
bcom_payments_daily: 441 payment rows saved
dal flush!! after 41 sec. wait for 1 sec ...
FINAL DUMP IS DONE!!
Main is don 42 sec.
App is done `;

test("a good run: ok, the loaded days read from 'Using dates'", () => {
  assert.deepEqual(verdict(GOOD, 0), { ok: true, dates: { from: "2026-11-16", to: "2026-11-21" }, nothingToDo: false, error: null });
});

test("the missing login is a failure even with exit code 0", () => {
  const v = verdict("dir name /x\nError: BCOM_BO_API_KEY and BCOM_BO_REFRESH_TOKEN must be set in .env\nApp is done", 0);
  assert.equal(v.ok, false);
  assert.match(v.error, /BCOM_BO_API_KEY/);
  assert.equal(v.dates, null);
});

test("already up to date: 'Nothing to process' is ok with nothingToDo", () => {
  const v = verdict("Using dates: 21/11/2026 to 21/11/2026\nError: Start date (21/11/2026) is not before end date (21/11/2026). Nothing to process.\nScript will exit without processing data.\nApp is done", 0);
  assert.equal(v.ok, true);
  assert.equal(v.nothingToDo, true);
});

test("a global error, a partial save failure and a bad exit code are failures", () => {
  assert.match(verdict("Using dates: 01/11/2026 to 02/11/2026\nGlobal error TypeError: x is not a function\nApp is done", 0).error, /Global error/);
  assert.match(verdict(`${GOOD}\nbcom_z_reports save failed: ER_LOCK`, 0).error, /save failed/);
  assert.match(verdict(GOOD, 1).error, /exited with code 1/);
  assert.match(verdict("dir name /x", 0).error, /without finishing/);
});

test("configured() needs both settings; start() refuses without them, before spawning", () => {
  assert.equal(configured({}), false);
  assert.equal(configured({ BCOM_BO_API_KEY: "a" }), false);
  assert.equal(configured({ BCOM_BO_API_KEY: "a", BCOM_BO_REFRESH_TOKEN: "b" }), true);
  const saved = { k: process.env.BCOM_BO_API_KEY, t: process.env.BCOM_BO_REFRESH_TOKEN };
  delete process.env.BCOM_BO_API_KEY;
  delete process.env.BCOM_BO_REFRESH_TOKEN;
  try {
    assert.throws(() => start({ by: "test" }), (e) => e.status === 503 && e.code === "not_configured");
  } finally {
    if (saved.k != null) process.env.BCOM_BO_API_KEY = saved.k;
    if (saved.t != null) process.env.BCOM_BO_REFRESH_TOKEN = saved.t;
  }
});

test("BEECOMM_SYNC=off switches the load off: disabled(), start() refuses with 503 disabled", () => {
  assert.equal(disabled({}), false);
  assert.equal(disabled({ BEECOMM_SYNC: "on" }), false);
  for (const v of ["off", "0", "false", "no", " OFF "]) assert.equal(disabled({ BEECOMM_SYNC: v }), true, v);
  const saved = process.env.BEECOMM_SYNC;
  process.env.BEECOMM_SYNC = "off";
  try {
    assert.throws(() => start({ by: "test" }), (e) => e.status === 503 && e.code === "disabled" && /owner's machine/.test(e.message));
  } finally {
    if (saved == null) delete process.env.BEECOMM_SYNC;
    else process.env.BEECOMM_SYNC = saved;
  }
});

test("through the extension: the replay key ignores key order, the plan file is read once per key, unknown plans are refused", () => {
  const a = cubeKey("zReports/cube", { action: "createZPOSReport", filter: { startDate: "24/11/2026", branches: ["x"] } });
  const b = cubeKey("zReports/cube", { filter: { branches: ["x"], startDate: "24/11/2026" }, action: "createZPOSReport" });
  assert.equal(a, b, "the same request in another key order has the same key");
  assert.match(a, /^[0-9a-f]{24}$/);
  assert.notEqual(a, cubeKey("orders/cube", { action: "createZPOSReport", filter: { startDate: "24/11/2026", branches: ["x"] } }), "the path is part of the key");
  assert.notEqual(a, cubeKey("zReports/cube", { action: "createZPOSReport", filter: { startDate: "25/11/2026", branches: ["x"] } }));
  const plan = parsePlan(`{"key":"k1","path":"zReports/cube","payload":{"action":"a"}}
not json
{"key":"k1","path":"zReports/cube","payload":{"action":"a"}}
{"key":"k2","path":"orders/cube","payload":{"action":"b"}}
{"path":"orders/cube","payload":{}}
`);
  assert.deepEqual(plan.map((q) => q.key), ["k1", "k2"], "one request per key, bad lines dropped");
  assert.throws(() => extAnswer("nope", "k1", {}), (e) => e.status === 404 && e.code === "not_found");
  assert.throws(() => extFinish("nope"), (e) => e.status === 404);
});
