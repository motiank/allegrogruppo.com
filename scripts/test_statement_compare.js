// Rules of shared/statementCompare.js (a party's statement against our account card), with made-up data.
//   $ node --test scripts/test_statement_compare.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareStatements, toEvents, referenceFits } from "../shared/statementCompare.js";

test("numbers fit by their last digits (4+)", () => {
  assert.ok(referenceFits("94879045", 9045));
  assert.ok(referenceFits(9045, "94879045"));
  assert.ok(!referenceFits("123", 123));
  assert.ok(!referenceFits(null, 9045));
});

test("events: a supplier's statement — their debit is our charge; in our books the credit is the charge", () => {
  const t = toEvents([{ date: "2026-01-05", reference: "5551", debit: 1000, credit: 0 }, { date: "2026-02-01", reference: "", debit: 0, credit: "1,000.00" }], "theirs", "supplier");
  assert.deepEqual(t.map((e) => [e.kind, e.amount]), [["charge", 1000], ["payment", 1000]]);
  const o = toEvents([{ date: "2026-01-05", reference: 5551, debit: 0, credit: 1000 }, { date: "2026-02-03", reference: 77, debit: 1000, credit: 0 }], "ours", "supplier");
  assert.deepEqual(o.map((e) => [e.kind, e.amount]), [["charge", 1000], ["payment", 1000]]);
  // a customer's statement of us: their credit is our invoice (charge)
  const c = toEvents([{ date: "2026-01-05", reference: "50077", debit: 0, credit: 1300 }], "theirs", "customer");
  assert.deepEqual(c.map((e) => e.kind), ["charge"]);
});

test("only the differences stay: missing on each side, an amount that differs, and the balance gap explained", () => {
  const theirs = {
    perspective: "supplier",
    closingBalance: 3500, // we owe them, by their card
    rows: [
      { date: "2026-01-05", reference: "5551", description: "חשבונית", debit: 1000, credit: 0 }, // matched by number
      { date: "2026-01-20", reference: "5602", description: "חשבונית", debit: 2000, credit: 0 }, // in our books with 1,900 → amount differs
      { date: "2026-02-10", reference: "5700", description: "חשבונית", debit: 1500, credit: 0 }, // missing in our books
      { date: "2026-02-15", reference: "", description: "תשלום", debit: 0, credit: 1000 }, // matched by amount + date
    ],
  };
  const ours = {
    closingBalance: -1400, // credit balance 1,400 = we owe 1,400 in our books (2,900 charged − 1,500 paid)
    lines: [
      { date: "2026-01-05", reference: 5551, description: "מיט", type: "ח18", debit: 0, credit: 1000 },
      { date: "2026-01-22", reference: 5602, description: "מיט", type: "ח18", debit: 0, credit: 1900 },
      { date: "2026-02-13", reference: 0, description: "העברה", type: "תש", debit: 1000, credit: 0 },
      { date: "2026-02-20", reference: 0, description: "העברה", type: "תש", debit: 500, credit: 0 }, // only in our books
    ],
  };
  const r = compareStatements(theirs, ours);
  assert.equal(r.counts.matched, 2);
  assert.deepEqual(r.onlyTheirs.map((x) => [x.reference, x.kind, x.amount]), [["5700", "charge", 1500]]);
  assert.deepEqual(r.onlyOurs.map((x) => [x.kind, x.amount]), [["payment", 500]]);
  assert.equal(r.amountDiffers.length, 1);
  assert.equal(r.amountDiffers[0].difference, 100);
  // their 3,500 − our 1,400 = 2,100: their extra charge 1,500 + our extra payment 500 + the 100 of the amount that differs
  assert.deepEqual(r.balance, { theirs: 3500, ours: 1400, difference: 2100, explainedByDifferences: 2100, unexplained: 0 });
  assert.equal(r.matchedHow["amount and number"], 1);
});

test("a one-off amount matches across a long gap; a recurring amount does not", () => {
  const theirs = { perspective: "supplier", rows: [{ date: "2025-09-01", reference: "", debit: 500, credit: 0 }, { date: "2026-03-01", reference: "", debit: 14000, credit: 0 }, { date: "2026-09-01", reference: "", debit: 14000, credit: 0 }] };
  const ours = { lines: [{ date: "2026-09-01", reference: 0, debit: 0, credit: 500 }, { date: "2026-03-05", reference: 0, debit: 0, credit: 14000 }, { date: "2026-01-05", reference: 0, debit: 0, credit: 14000 }] };
  const r = compareStatements(theirs, ours);
  assert.equal(r.counts.matched, 2);
  assert.deepEqual(r.onlyTheirs.map((x) => x.date), ["2026-09-01"]);
  assert.deepEqual(r.onlyOurs.map((x) => x.date), ["2026-01-05"]);
});
