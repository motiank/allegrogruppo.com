// Rules of shared/invoiceMatch.js (Drive invoices against the books), with made-up data. No database, no Drive.
//   $ node --test scripts/test_invoice_match.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchInvoices, referenceFits, normDigits, booksFlag, flagChanged } from "../shared/invoiceMatch.js";

const accounts = new Map([
  ["512293200", { accountKey: "500040", name: "דורגז" }],
  ["515982296", { accountKey: "500003", name: "מטאורי" }],
]);
const entry = (o) => ({ year: 2026, type: "ח18", reference: 0, reference3: 0, allocationNumber: null, ...o });
const inv = (o) => ({ direction: "expense", currency: "ILS", ...o });
const statuses = (r) => r.results.map((x) => x.status);

test("digits: leading zeros and separators go; a book reference is the end of the invoice number", () => {
  assert.equal(normDigits("0512842162"), "512842162");
  assert.equal(normDigits("01-067138"), "1067138");
  assert.ok(referenceFits("94879045", 0, 9045, 0));
  assert.ok(referenceFits("94879045", 94879045));
  assert.ok(!referenceFits("94879045", 0, 45, 0)); // too short to mean anything
  assert.ok(!referenceFits("123", 123)); // a 3-digit number is not trusted
});

test("booked by amount and date; the reference decides between two entries of the same amount", () => {
  const entries = [
    entry({ transId: 1, accountKey: "500040", amount: 6219.31, date: "2026-08-31", reference2: 1111 }),
    entry({ transId: 2, accountKey: "500040", amount: 6219.31, date: "2026-09-02", reference2: 9045 }),
  ];
  const r = matchInvoices([inv({ number: "94879045", date: "2026-08-31", total: 6219.31, party_tax_id: "512293200" })], entries, accounts, { booksUpTo: "2026-11-03" });
  assert.equal(r.results[0].status, "booked");
  assert.equal(r.results[0].entry.transId, 2);
  assert.equal(r.results[0].how, "amount, date and number");
});

test("a credit note matches a minus entry; one entry serves one invoice only", () => {
  const entries = [entry({ transId: 5, accountKey: "500003", amount: -33, date: "2026-10-12", reference2: 6113 })];
  const list = [
    inv({ number: "6113", date: "2026-10-12", total: 33, doc_type: "credit_note", party_tax_id: "515982296" }),
    inv({ number: "6114", date: "2026-10-12", total: 33, doc_type: "credit_note", party_tax_id: "515982296" }),
  ];
  const r = matchInvoices(list, entries, accounts, { booksUpTo: "2026-11-03" });
  assert.deepEqual(statuses(r), ["booked", "not_booked"]);
});

test("amount differs: the number is in the books with another total", () => {
  const entries = [entry({ transId: 7, accountKey: "500040", amount: 6000, date: "2026-08-31", reference2: 9045 })];
  const r = matchInvoices([inv({ number: "94879045", date: "2026-08-31", total: 6219.31, party_tax_id: "512293200" })], entries, accounts, { booksUpTo: "2026-11-03" });
  assert.equal(r.results[0].status, "amount_differs");
  assert.equal(r.results[0].entry.transId, 7);
});

test("not booked vs pending (the books' last date decides), and no account", () => {
  const list = [
    inv({ number: "100", date: "2026-06-01", total: 500, party_tax_id: "512293200" }),
    inv({ number: "101", date: "2026-10-30", total: 500, party_tax_id: "512293200" }),
    inv({ number: "102", date: "2026-06-01", total: 500, party_tax_id: "999999999" }),
  ];
  const r = matchInvoices(list, [], accounts, { booksUpTo: "2026-11-03", recentDays: 21 });
  assert.deepEqual(statuses(r), ["not_booked", "pending", "no_account"]);
  assert.equal(r.results[1].how, "dated after 2026-10-13: probably not entered yet");
});

test("an earlier flag keeps its entry (even when a newer invoice would fit it better); recheck frees it", () => {
  const entries = [entry({ transId: 9, accountKey: "500040", amount: 100, date: "2026-09-10", reference2: 0 })];
  const list = [
    inv({ number: "9000", date: "2026-09-10", total: 100, party_tax_id: "512293200" }),
    inv({ number: "9001", date: "2026-09-20", total: 100, party_tax_id: "512293200", books: { status: "booked", year: 2026, transId: 9 } }),
  ];
  const kept = matchInvoices(list, entries, accounts, { booksUpTo: "2026-11-03" });
  assert.deepEqual(statuses(kept), ["not_booked", "booked"]);
  assert.equal(kept.results[1].how, "kept");
  const fresh = matchInvoices(list, entries, accounts, { booksUpTo: "2026-11-03", recheck: true });
  assert.deepEqual(statuses(fresh), ["booked", "not_booked"]);
});

test("the flag: matched true only for booked; a change of status or entry is worth writing, the check date is not", () => {
  const e = entry({ transId: 3, accountKey: "500040", amount: 10, date: "2026-01-01", reference2: 1234 });
  const a = booksFlag({ status: "booked", entry: e, account: { accountKey: "500040" } }, { checkedAt: "2026-11-08T10:00:00Z", booksUpTo: "2026-11-03" });
  assert.equal(a.matched, true);
  assert.equal(a.reference, 1234);
  const b = booksFlag({ status: "booked", entry: e, account: { accountKey: "500040" } }, { checkedAt: "2026-11-09T10:00:00Z", booksUpTo: "2026-11-04" });
  assert.equal(flagChanged(a, b), false);
  const c = booksFlag({ status: "not_booked", entry: null, account: { accountKey: "500040" } }, { checkedAt: "2026-11-09T10:00:00Z", booksUpTo: "2026-11-04" });
  assert.equal(c.matched, false);
  assert.equal(flagChanged(a, c), true);
  assert.equal(flagChanged(null, c), true);
});
