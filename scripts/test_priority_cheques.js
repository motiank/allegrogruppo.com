// Tests of the Priority cheque file (shared/priority_cheques.json, built by scripts/priority_cheques_import.js) and its
// lookup (admin/server/modules/priorityCheques.js). No database:  node --test scripts/test_priority_cheques.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { PRIORITY_CHEQUES, PRIORITY_CHEQUES_META, priorityChequesByNumber, searchPriorityCheques } from "../admin/server/modules/priorityCheques.js";

const r2 = (n) => Math.round(n * 100) / 100;

test("the file: one record per payment, sums that tie, ordered by cheque number", () => {
  assert.equal(PRIORITY_CHEQUES_META.company, "pastaLina");
  assert.equal(PRIORITY_CHEQUES_META.count, PRIORITY_CHEQUES.length);
  assert.equal(PRIORITY_CHEQUES.length, 2678);
  assert.equal(new Set(PRIORITY_CHEQUES.map((c) => c.payment)).size, PRIORITY_CHEQUES.length, "a payment appears once");
  assert.equal(PRIORITY_CHEQUES.filter((c) => c.cheque == null).length, PRIORITY_CHEQUES_META.withoutNumber);
  assert.equal(r2(PRIORITY_CHEQUES.reduce((s, c) => s + c.net, 0)), PRIORITY_CHEQUES_META.net);
  for (const c of PRIORITY_CHEQUES) {
    assert.equal(r2(c.amount - c.withholding), c.net, `${c.payment}: amount − withholding = net`);
    if (c.lines.length) {
      assert.equal(r2(c.lines.reduce((s, l) => s + l.net, 0)), c.net, `${c.payment}: the lines add up`);
      assert.equal(r2(c.lines.reduce((s, l) => s + l.amount, 0)), c.amount);
    }
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(c.payDate) && /^\d{4}-\d{2}-\d{2}$/.test(c.chequeDate), `${c.payment}: dates`);
    assert.ok(typeof c.supplier === "string" && c.supplier, `${c.payment}: supplier`);
  }
  const numbered = PRIORITY_CHEQUES.filter((c) => c.cheque != null).map((c) => c.cheque);
  assert.deepEqual(numbered, [...numbered].sort((a, b) => a - b));
  assert.ok(PRIORITY_CHEQUES.at(-1).cheque == null, "records without a number come last");
});

test("a cheque that paid several invoices keeps its lines", () => {
  const [c] = priorityChequesByNumber([10337]).get("10337");
  assert.equal(c.supplier, 'שיווק א.א עפולה צ.א בע"מ');
  assert.equal(c.net, 14389);
  assert.deepEqual(c.lines.map((l) => l.invoice), ["9473", "9100", "8528", "8156"]);
  const [w] = priorityChequesByNumber(["10334"]).get("10334");
  assert.deepEqual([w.amount, w.withholdingPct, w.withholding, w.net], [28875, 5, 1443.75, 27431.25], "withholding tax: the net is on the cheque");
});

test("lookup by number: strings, leading zeros, numbers used twice, unknown numbers", () => {
  const m = priorityChequesByNumber(["10101", 10777, "0010101", "abc", null, 999999999]);
  assert.deepEqual([...m.keys()], ["10101", "10777"]);
  assert.equal(m.get("10101")[0].supplier, "נאורי רפאל וטל");
  assert.deepEqual(m.get("10777").map((c) => [c.supplier, c.net]), [["קפלן ליה", 1110.84], ['מיט 2 איט בע"מ', 16878]]);
});

test("search: by number, name, invoice number, amount, dates, paging", () => {
  assert.equal(searchPriorityCheques({ cheque: "10337" }).total, 1);
  assert.equal(searchPriorityCheques({ cheque: ["10337", "10101", "1"] }).total, 2);
  const nasifiAll = searchPriorityCheques({ q: "נסיפי", from: "2025-06-01", to: "2025-06-30" });
  const nasifi = searchPriorityCheques({ q: "נסיפי", from: "2025-06-01", to: "2025-06-30", limit: 2 });
  assert.equal(nasifi.total, 4);
  assert.equal(nasifi.rows.length, 2);
  assert.equal(nasifi.totals.count, 4);
  assert.equal(nasifi.totals.net, r2(nasifi.totals.amount - nasifi.totals.withholding));
  assert.deepEqual(searchPriorityCheques({ q: "נסיפי", from: "2025-06-01", to: "2025-06-30", limit: 2, offset: 2 }).rows.map((c) => c.cheque), nasifiAll.rows.slice(2).map((c) => c.cheque));
  assert.deepEqual(searchPriorityCheques({ q: "9473" }).rows.map((c) => c.cheque), [10337], "an invoice number finds its cheque");
  assert.deepEqual(searchPriorityCheques({ amount: 16878 }).rows.map((c) => c.cheque), [10777]);
  assert.deepEqual(searchPriorityCheques({ amount: 57750 }).rows.map((c) => c.cheque).includes(10334), false, "the amount is the cheque's, not a line's");
  assert.equal(searchPriorityCheques({ q: 'מיט 2 איט בע"מ', supplierAccount: "200069" }).rows.every((c) => c.supplierAccount === "200069"), true);
  assert.equal(searchPriorityCheques({ dateField: "payDate", to: "2025-04-30" }).total, 155);
  assert.equal(searchPriorityCheques({ from: "2027-01-01" }).total, 35, "post-dated cheques to 2029");
  assert.equal(searchPriorityCheques({ q: "no such supplier" }).total, 0);
  assert.equal(searchPriorityCheques({}).total, 2678);
});
