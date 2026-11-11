// Tests of the cheque beneficiary lookup (admin/server/modules/chequePayees.js) against the finance DB of the environment:
//   FINANCE_DB_HOST=127.0.0.1 FINANCE_DB_USER=moti FINANCE_DB_PASSWORD=… FINANCE_DB_NAME=allegro_finance_dev node --test scripts/test_cheque_payees.js
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { isChequeLine, chequePayees, pickPayee, addChequePayees, financeCompanyId } from "../admin/server/modules/chequePayees.js";
import { financeSql, closeFinancePool } from "../admin/server/sources/financePool.js";
import { PRIORITY_CHEQUES } from "../admin/server/modules/priorityCheques.js";

after(() => closeFinancePool());

test("which bank texts are a cheque we wrote", () => {
  for (const t of ["שיק", "שיק ", "החזרת שיק (תאריך ערך: 25/10)", "החזרת שיק-טכני", "עמ' בטול שיק"]) assert.ok(isChequeLine(t), t);
  for (const t of ["קניית שיק", "הפ שיק-ממסרים", "הפקדת שיקים", "פנקסי שיקים", "שיקים", "העברה", null, ""]) assert.ok(!isChequeLine(t), String(t));
});

test("the company id from the finance code or the Allegro key", async () => {
  assert.equal(await financeCompanyId("pastalina"), 1);
  assert.equal(await financeCompanyId("pastaLina"), 1);
  assert.equal(await financeCompanyId("nope"), null);
});

test("names from the cheques module, from the journal, or missing", async () => {
  // a cheque of the module, an older cheque known only by its journal entry, a number Hashavshevet does not have
  const [mod] = await financeSql(`SELECT reference, payee_name, amount_to_pay FROM cheques WHERE company_id = 1 AND deleted_at IS NULL AND reference IN (SELECT reference FROM bank_lines WHERE details = 'שיק' AND deleted_at IS NULL) ORDER BY cheque_id DESC LIMIT 1`);
  const [jr] = await financeSql(
    `SELECT b.reference, e.debit_name, e.amount FROM bank_lines b JOIN journal_entries e ON e.company_id = b.company_id AND e.reference = b.reference AND e.credit_account = b.account_key AND e.deleted_at IS NULL AND e.amount = ABS(b.signed_amount)
      WHERE b.company_id = 1 AND b.details = 'שיק' AND b.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM cheques c WHERE c.company_id = b.company_id AND c.reference = b.reference AND c.deleted_at IS NULL) ORDER BY b.line_date DESC LIMIT 1`,
  );
  const names = await chequePayees(1, [mod.reference, String(jr.reference), 999999999, "abc", null]);
  assert.equal(pickPayee(names.get(String(mod.reference)), mod.amount_to_pay).payee, mod.payee_name);
  assert.equal(names.get(String(mod.reference))[0].source, "cheques");
  assert.equal(pickPayee(names.get(String(jr.reference)), -Number(jr.amount)).payee, jr.debit_name);
  assert.equal(names.get(String(jr.reference))[0].source, "journal");
  assert.ok(!names.has("999999999"));
  // a journal entry with another amount is only a guess (bank-fee entries copy the cheque number) → not used
  assert.equal(pickPayee([{ payee: "עמלות", amount: 0.25, source: "journal" }], -3669), null);
  assert.equal(pickPayee([{ payee: "ספק", amount: 100, source: "cheques" }], -90).payee, "ספק");
});

test("a duplicate cheque number is resolved by the amount", async () => {
  const dups = await financeSql(
    `SELECT reference, payee_name, amount_to_pay FROM cheques WHERE company_id = 1 AND deleted_at IS NULL AND reference IN
       (SELECT reference FROM (SELECT reference FROM cheques WHERE company_id = 1 AND deleted_at IS NULL GROUP BY reference HAVING COUNT(DISTINCT payee_name) > 1) x) ORDER BY reference, cheque_id`,
  );
  assert.ok(dups.length >= 2, "the local copy has a number written to two payees");
  const no = String(dups[0].reference);
  const two = dups.filter((d) => String(d.reference) === no);
  const names = await chequePayees(1, [no]);
  for (const d of two) assert.equal(pickPayee(names.get(no), -Number(d.amount_to_pay)).payee, d.payee_name);
});

test("addChequePayees marks only cheque rows, per company, and survives a bad company", async () => {
  const [mod] = await financeSql(`SELECT reference, payee_name, amount_to_pay FROM cheques WHERE company_id = 1 AND deleted_at IS NULL ORDER BY cheque_id DESC LIMIT 1`);
  const rows = [
    { company: "pastaLina", action: "שיק", reference: String(mod.reference), debit: Number(mod.amount_to_pay) },
    { company: "pastaLina", action: "שיק", reference: "999999999", debit: 10 },
    { company: "pastaLina", action: "העברה", reference: String(mod.reference), debit: 10 },
    { company: "nope", action: "שיק", reference: String(mod.reference), debit: 10 },
  ];
  const stats = await addChequePayees(rows, { company: (r) => r.company, text: (r) => r.action, amount: (r) => r.debit });
  assert.deepEqual(stats, { lines: 2, found: 1, priority: 0, missing: 1 });
  assert.equal(rows[0].payee, mod.payee_name);
  assert.equal(rows[0].payeeSource, "cheques");
  assert.deepEqual([rows[1].payee, rows[1].payeeSource], [null, "missing"]);
  assert.ok(!("payee" in rows[2]) && !("payee" in rows[3]));
});

test("a cheque Hashavshevet does not know is named by the Priority file (Pasta Lina only)", async () => {
  // Priority numbers that are in no Hashavshevet cheque and no journal entry of the bank account
  const [chq, jr] = await Promise.all([
    financeSql(`SELECT DISTINCT reference FROM cheques WHERE company_id = 1 AND deleted_at IS NULL`),
    financeSql(`SELECT DISTINCT e.reference FROM journal_entries e WHERE e.company_id = 1 AND e.deleted_at IS NULL AND (e.credit_account = '110011' OR e.debit_account = '110011')`),
  ]);
  const known = new Set([...chq, ...jr].map((r) => String(Number(r.reference))));
  const onlyPriority = PRIORITY_CHEQUES.filter((c) => c.cheque != null && !known.has(String(c.cheque)));
  assert.ok(onlyPriority.length > 500, `the local copy has ${onlyPriority.length} cheques known only from Priority`);
  const twice = PRIORITY_CHEQUES.filter((c) => c.cheque === 10777);
  assert.equal(twice.length, 2, "10777 was written twice in Priority");
  const [a, b] = onlyPriority;
  const rows = [
    { company: "pastaLina", action: "שיק", reference: String(a.cheque), debit: a.net },
    { company: "pastaLina", action: "שיק", reference: String(b.cheque), debit: b.net + 1 }, // another amount: the number still names the payee
    { company: "pastaLina", action: "שיק", reference: "999999999", debit: 10 },
  ];
  const stats = await addChequePayees(rows, { company: (r) => r.company, text: (r) => r.action, amount: (r) => r.debit });
  assert.deepEqual(stats, { lines: 3, found: 2, priority: 2, missing: 1 });
  assert.deepEqual([rows[0].payee, rows[0].payeeSource], [a.supplier, "priority"]);
  assert.deepEqual([rows[1].payee, rows[1].payeeSource], [b.supplier, "priority"]);
  assert.deepEqual([rows[2].payee, rows[2].payeeSource], [null, "missing"]);
  // a number used twice in Priority: the amount decides
  if (!known.has("10777")) {
    const names = await chequePayees(1, ["10777"]);
    for (const c of twice) assert.equal(pickPayee(names.get("10777"), -c.net).payee, c.supplier);
  }
  // Hashavshevet first: a journal candidate with the same amount wins over Priority, a journal fee entry does not
  assert.equal(pickPayee([{ payee: "ספק בחשבשבת", amount: 100, source: "journal" }, { payee: "ספק בפריוריטי", amount: 100, source: "priority" }], -100).payee, "ספק בחשבשבת");
  assert.equal(pickPayee([{ payee: "עמלות", amount: 0.25, source: "journal" }, { payee: "ספק בפריוריטי", amount: 100, source: "priority" }], -90).payee, "ספק בפריוריטי");
  // another company gets nothing from the file
  const other = await chequePayees(999, [String(a.cheque)]).catch(() => new Map());
  assert.ok(!other.has(String(a.cheque)));
});

test("on the real bank lines of this year most cheques get a name", async () => {
  const lines = await financeSql(`SELECT reference, signed_amount FROM bank_lines WHERE company_id = 1 AND deleted_at IS NULL AND details = 'שיק' AND line_date >= '2026-01-01'`);
  const rows = lines.map((l) => ({ details: "שיק", reference: l.reference, amount: Number(l.signed_amount) }));
  const t0 = Date.now();
  const stats = await addChequePayees(rows, { company: 1, bankAccounts: ["110011"] });
  assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms`);
  assert.equal(stats.lines, rows.length);
  assert.ok(stats.found / stats.lines > 0.9, `found ${stats.found} of ${stats.lines}`);
  assert.ok(rows.every((r) => r.payeeSource === "missing" ? r.payee === null : typeof r.payee === "string" && r.payee.length > 0));
});
