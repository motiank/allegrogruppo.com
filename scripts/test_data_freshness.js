// Tests of the data-freshness rules (admin/server/modules/dataFreshness.js) — the state of a source and the Hebrew notes
// that compare the sources. No database: node --test scripts/test_data_freshness.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { freshnessState, decorateItems, freshnessNotes, daysBetween, GROUPS } from "../admin/server/modules/dataFreshness.js";

const TODAY = "2026-11-18";

test("freshnessState: ok within the expected days, late up to twice, stale after; fixed, missing, error", () => {
  assert.equal(freshnessState({ lastDate: "2026-11-17", expectedDays: 1 }, TODAY), "ok");
  assert.equal(freshnessState({ lastDate: "2026-11-16", expectedDays: 1 }, TODAY), "late");
  assert.equal(freshnessState({ lastDate: "2026-11-15", expectedDays: 1 }, TODAY), "stale");
  assert.equal(freshnessState({ lastDate: "2026-11-05", expectedDays: 7 }, TODAY), "late", "13 days for a weekly source");
  assert.equal(freshnessState({ lastUpdate: "2026-11-17 23:26:42", expectedDays: 1 }, TODAY), "ok", "no business date: the load time counts");
  assert.equal(freshnessState({ expectedDays: 7 }, TODAY), "missing");
  assert.equal(freshnessState({ lastDate: "2029-11-05", expectedDays: null }, TODAY), "fixed");
  assert.equal(freshnessState({ lastDate: "2026-11-17", expectedDays: 1, error: "boom" }, TODAY), "error");
  assert.equal(daysBetween("2026-11-05", "2026-11-16"), 11);
  assert.equal(daysBetween(null, TODAY), null);
  assert.ok(GROUPS.map((g) => g.key).includes("hashavshevet"));
});

test("decorateItems + freshnessNotes: the bank page behind the bank file, the archive, the status file, Beecomm, errors", () => {
  const items = decorateItems([
    { key: "hash.sync", group: "hashavshevet", label: "סנכרון", lastUpdate: "2026-11-17 23:26:00", expectedDays: 1, detail: "done" },
    { key: "hash.bank.pastalina.110011", group: "hashavshevet", label: "דף הבנק", lastDate: "2026-11-05", expectedDays: 7 },
    { key: "bank.file.12-584", group: "bank", label: "קובץ הבנק", lastDate: "2026-11-16", lastUpdate: "2026-11-16 12:27:00", expectedDays: 7 },
    { key: "bank.events", group: "bank", label: "סטטוס", lastDate: "2026-11-12", expectedDays: 7 },
    { key: "drive.chequeArchive", group: "drive", label: "ארכיון", lastDate: "2026-11-02", lastUpdate: "2026-11-16 10:46:00", expectedDays: 14 },
    { key: "beecomm.orders", group: "beecomm", label: "ביקום", lastDate: "2026-11-15", expectedDays: 2 },
    { key: "tabit.shifts", group: "tabit", label: "טאביט", lastDate: "2026-11-17", expectedDays: 1 },
    { key: "drive.invoices", group: "drive", label: "חשבוניות", expectedDays: 2, error: "token expired" },
  ], TODAY);
  assert.deepEqual(items.map((x) => x.state), ["ok", "late", "ok", "ok", "late", "late", "ok", "error"]);
  assert.deepEqual(items.map((x) => x.ageDays), [1, 13, 2, 6, 16, 3, 1, null]);
  const notes = freshnessNotes(items, TODAY);
  assert.equal(notes.length, 5, notes.join("\n"));
  assert.match(notes[0], /דף הבנק בחשבשבת נגמר ב-05\/11\/2026.*16\/11\/2026 \(11 ימים\)/);
  assert.match(notes[1], /ארכיון הצ'קים.*02\/11\/2026/);
  assert.match(notes[2], /סטטוס העסקאות מעודכן עד 12\/11\/2026/);
  assert.match(notes[3], /ביקום נעצרים ב-15\/11\/2026 \(לפני 3 ימים\)/);
  assert.match(notes[4], /1 מקורות לא נקראו הפעם: חשבוניות/);
  // all fresh: no notes
  const fine = decorateItems([
    { key: "hash.bank.x.1", group: "hashavshevet", label: "a", lastDate: "2026-11-17", expectedDays: 7 },
    { key: "bank.file.1", group: "bank", label: "b", lastDate: "2026-11-17", expectedDays: 7 },
    { key: "beecomm.orders", group: "beecomm", label: "c", lastDate: "2026-11-17", expectedDays: 2 },
  ], TODAY);
  assert.deepEqual(freshnessNotes(fine, TODAY), []);
  // a failed sync is named
  const failed = decorateItems([{ key: "hash.sync", group: "hashavshevet", label: "סנכרון", lastUpdate: "2026-11-15 00:05:00", expectedDays: 1, detail: "failed: timeout" }], TODAY);
  const n2 = freshnessNotes(failed, TODAY);
  assert.ok(n2.some((n) => /לא רץ מאז 15\/11\/2026/.test(n)) && n2.some((n) => /נכשל/.test(n)));
});
