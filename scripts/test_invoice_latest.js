// node --test scripts/test_invoice_latest.js   (no Drive, no database)
import assert from "node:assert/strict";
import test from "node:test";
import { latestInvoices, latestRow } from "../shared/invoiceLatest.js";

const inv = (o) => ({ direction: "expense", from: "ספק א", to: "פסטה לינה בע\"מ", party_tax_id: "1", number: "10", total: 117, currency: "ILS", date: "2026-11-01", drive_file_id: "f1", filed_at: "2026-11-20T10:00:00.000Z", ...o });
const main = { name: "פסטה לינה בע״מ", target: "main" };
const rows = [
  latestRow(inv({ number: "1", date: "2026-11-19", filed_at: "2026-11-01T08:00:00Z" }), main),
  latestRow(inv({ number: "2", date: "2024-12-01", filed_at: "2026-11-21T08:00:00Z", gmail_account: "other@example.com" }), { name: "אן-קור שירותי תוכנה בע״מ", target: "owner" }),
  latestRow(inv({ number: "3", date: "2025-06-01", filed_at: "2026-11-20T09:00:00Z", books: { status: "booked" } }), main),
  latestRow(inv({ number: "4", direction: "income", from: "פסטה לינה", to: "Wolt", filed_at: "2026-11-20T07:00:00Z" }), main),
  latestRow(inv({ number: "5", filed_at: "2026-11-19T07:00:00Z" }), { name: "_unmatched", unmatched: true, target: "main" }),
  latestRow(inv({ number: "6", filed_at: undefined }), main),
];

test("newest FOUND first: by filed_at, not by the invoice date; a row with no found time is left out", () => {
  const r = latestInvoices(rows);
  assert.deepEqual(r.rows.map((x) => x.number), ["2", "3", "4", "5", "1"]);
  assert.equal(r.total, 5);
  assert.equal(r.lastFoundAt, "2026-11-21T08:00:00Z");
  assert.deepEqual(r.byDay.slice(0, 2), [{ day: "2026-11-21", count: 1 }, { day: "2026-11-20", count: 2 }]);
});

test("the row: the other side by direction, the mailbox, the books flag, the Drive link", () => {
  const [a, b, c, d, e] = latestInvoices(rows).rows;
  assert.equal(a.mailbox, "other@example.com");
  assert.equal(a.target, "owner");
  assert.equal(b.mailbox, "main");
  assert.equal(b.books, "booked");
  assert.equal(b.party, "ספק א");
  assert.equal(c.party, "Wolt");
  assert.equal(d.unmatched, true);
  assert.equal(d.company, null);
  assert.equal(a.foundLocal, "2026-11-21 10:00"); // Israel time, UTC+2 in November
  assert.equal(e.fileUrl, "https://drive.google.com/file/d/f1/view");
});

test("filters: found days, company, direction, mailbox, unmatched, text", () => {
  const n = (f) => latestInvoices(rows, f).rows.map((x) => x.number);
  assert.deepEqual(n({ since: "2026-11-20" }), ["2", "3", "4"]);
  assert.deepEqual(n({ since: "2026-11-20", until: "2026-11-20" }), ["3", "4"]);
  assert.deepEqual(n({ company: "אן קור" }), ["2"]);
  assert.deepEqual(n({ direction: "income" }), ["4"]);
  assert.deepEqual(n({ mailbox: "main" }), ["3", "4", "5", "1"]);
  assert.deepEqual(n({ unmatched: "only" }), ["5"]);
  assert.deepEqual(n({ unmatched: "hide" }), ["2", "3", "4", "1"]);
  assert.deepEqual(n({ q: "wolt" }), ["4"]);
  assert.deepEqual(n({ q: "3" }), ["3"]);
});

test("a found day is an Israel day: 23:30 UTC belongs to the next day", () => {
  const late = [latestRow(inv({ number: "9", filed_at: "2026-11-20T23:30:00Z" }), main)];
  assert.equal(late[0].foundLocal, "2026-11-21 01:30");
  assert.equal(latestInvoices(late, { since: "2026-11-21" }).total, 1);
  assert.equal(latestInvoices(late, { until: "2026-11-20" }).total, 0);
});
