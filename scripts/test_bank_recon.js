// Tests of the detailed bank reconciliation report (admin/server/modules/bankRecon.js + shared/bankReconHtml.js).
// Runs against the finance DB of the environment (FINANCE_DB_* / DB_*; locally the hash-sync copy):
//   FINANCE_DB_HOST=127.0.0.1 FINANCE_DB_USER=moti FINANCE_DB_PASSWORD=… FINANCE_DB_NAME=allegro_finance_dev \
//   node --test scripts/test_bank_recon.js
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { buildBankReconReport, renderBankReconXlsx, resolveParams } from "../admin/server/modules/bankRecon.js";
import { renderBankReconHtml, renderBankReconBody, fmtMoney, fmtDate } from "../shared/bankReconHtml.js";
import { financeSql, closeFinancePool } from "../admin/server/sources/financePool.js";

const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs");

process.env.FINANCE_TODAY ||= "2026-11-07";
const sum = (rows, f) => Math.round(rows.reduce((a, r) => a + Number(f(r) || 0), 0) * 100) / 100;

after(() => closeFinancePool());

test("formatting helpers", () => {
  assert.equal(fmtDate("2026-11-05"), "05/11/2026");
  assert.equal(fmtDate("2026-11-05 00:00:00.000"), "05/11/2026");
  assert.equal(fmtDate(null), "");
  assert.equal(fmtMoney(1234.5).replace(/‏/g, ""), "1,234.50");
  assert.equal(fmtMoney(null), "");
});

test("parameters: defaults and refusals", async () => {
  const p = await resolveParams({});
  assert.equal(p.to, "2026-11-07");
  assert.equal(p.from, "2026-01-01");
  assert.ok(p.accountKey);
  await assert.rejects(resolveParams({ from: "2026-13-01", to: "2026-11-05" }), /YYYY-MM-DD/);
  await assert.rejects(resolveParams({ from: "2026-11-06", to: "2026-11-05" }), /not be after/);
  await assert.rejects(resolveParams({ from: "2020-01-01", to: "2026-11-05" }), /longer than/);
  await assert.rejects(resolveParams({ account: "999" }), /not a bank account/);
  await assert.rejects(resolveParams({ company: "nope" }), /unknown company/);
});

for (const [from, to] of [["2026-01-01", "2026-11-05"], ["2025-01-01", "2025-12-31"], ["2026-10-01", "2026-10-31"]]) {
  test(`report ${from}..${to}: the summary ties and the sections add up`, async () => {
    const r = await buildBankReconReport({ from, to });
    const s = r.summary;
    assert.equal(r.from, from);
    assert.equal(r.to, to);
    // Totals of the tables equal the summary.
    assert.equal(sum(r.bankOpen, (x) => x.amount), s.bankOpen.total);
    assert.equal(sum(r.bookOpen, (x) => x.amount), s.bookOpen.total);
    assert.equal(sum(r.chequesOpen, (x) => x.amount), s.chequesOpen.total);
    assert.equal(sum(r.chequesCleared, (x) => x.amount), s.chequesCleared.total);
    assert.equal(r.bankOpen.length, s.bankOpen.count);
    assert.equal(r.chequesOpen.filter((x) => x.status === "past_due").length, s.chequesOpen.pastDueCount);
    assert.equal(r.chequesOpen.filter((x) => x.status === "not_due").length, s.chequesOpen.notDueCount);
    // The reconciliation formula.
    const expected = Math.round((s.bankBalance - s.bankOpen.total + s.bookOpen.total + s.chequesOpen.total - s.bookFutureMatched.total) * 100) / 100;
    assert.equal(s.expectedBookBalance, expected);
    assert.equal(s.unexplained, Math.round((s.bookBalance - expected) * 100) / 100);
    assert.equal(s.unexplained, 0, "Hashavshevet's matches should explain the whole gap");
    // Cheque lines of section 1 carry the beneficiary (or "missing"); the summary counts them.
    const chq = r.bankOpen.filter((x) => /^שיק/.test(x.details));
    assert.ok(chq.every((x) => ["cheques", "journal", "missing"].includes(x.payeeSource) && (x.payeeSource === "missing" ? x.payee === null : x.payee)));
    assert.ok(r.bankOpen.filter((x) => !/שיק/.test(x.details)).every((x) => !("payee" in x)));
    assert.equal(s.bankOpen.cheques.missing, r.bankOpen.filter((x) => x.payeeSource === "missing").length);
    assert.ok(s.bankOpen.cheques.found + s.bankOpen.cheques.missing === s.bankOpen.cheques.count);
    // Every row is dated up to `to`; cleared cheques inside the period.
    assert.ok(r.bankOpen.every((x) => x.date <= to));
    assert.ok(r.bookOpen.every((x) => x.date <= to && !r.chequesOpen.some((c) => c.lineId === x.lineId)));
    assert.ok(r.chequesCleared.every((x) => x.clearedDate >= from && x.clearedDate <= to));
    assert.ok(r.chequesOpen.every((x) => x.issueDate <= to));
    assert.ok(r.chequesOpen.filter((x) => x.status === "not_due").every((x) => x.dueDate > to));
    assert.ok(r.chequesOpen.filter((x) => x.status === "past_due").every((x) => x.dueDate <= to));
    // Book balance checked against the DB directly.
    const [db] = await financeSql(
      `SELECT SUM(l.signed_amount) AS s FROM journal_lines l JOIN journal_entries e ON e.company_id = l.company_id AND e.fiscal_year = l.fiscal_year AND e.trans_id = l.trans_id
        WHERE l.account_key = :acc AND l.deleted_at IS NULL AND e.deleted_at IS NULL AND e.value_date <= :to`,
      { acc: r.account.key, to },
    );
    assert.equal(s.bookBalance, Math.round(Number(db.s) * 100) / 100);
  });
}

test("as of today, section 1 equals Hashavshevet's own open bank lines", async () => {
  const r = await buildBankReconReport({ from: "2026-01-01", to: "2026-11-07" });
  const [db] = await financeSql(`SELECT COUNT(*) AS n, SUM(signed_amount) AS s FROM bank_lines WHERE account_key = :acc AND deleted_at IS NULL AND is_matched = 0`, { acc: r.account.key });
  assert.equal(r.summary.bankOpen.count, Number(db.n));
  assert.equal(r.summary.bankOpen.total, Math.round(Number(db.s) * 100) / 100);
  assert.equal(r.summary.bankBalance, 121642.83); // Hashavshevet's running balance after the last line (readme figure)
});

test("cleared cheques are paired to a bank line with the same cheque number and amount", async () => {
  const r = await buildBankReconReport({ from: "2026-01-01", to: "2026-11-05" });
  const paired = r.chequesCleared.filter((x) => x.status === "cleared");
  assert.ok(paired.length > 1000, `paired ${paired.length}`);
  for (const x of paired.slice(0, 200)) {
    assert.equal(x.bankAmount, x.amount, `cheque ${x.chequeNo}`);
    assert.ok(x.clearedDate, `cheque ${x.chequeNo} has a clearing date`);
  }
  const byNo = paired.filter((x) => String(x.bankReference) === String(x.chequeNo));
  assert.ok(byNo.length / paired.length > 0.9, "most pairs carry the cheque number in the bank line");
  assert.ok(r.notes.some((n) => n.includes("מבוטלים")), "cancelled cheques are explained in the notes");
});

test("HTML and Excel", async () => {
  const r = await buildBankReconReport({ from: "2026-10-01", to: "2026-10-31" });
  const html = renderBankReconHtml(r);
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes('dir="rtl"'));
  for (const t of ["דוח התאמת בנק מפורט", "data-filter=\"1\">מוטב</th>", "1. תנועות בנק ללא התאמה בספרים", "2. תנועות ספרים ללא התאמה בבנק", "3א. פירעון צ'קים", "3ב. צ'קים שהונפקו וטרם נפרעו", "הפרש לא מוסבר"])
    assert.ok(html.includes(t), t);
  // the page carries the filters' script; the body (the admin page) stays script-free and calls bankReconBehavior itself
  assert.ok(html.includes("<script>(function bankReconBehavior(root)") && html.includes('data-filter="1">מוטב') && html.includes('data-filter="1">פרטים'));
  assert.ok(!html.includes("</script>".slice(0, 8) + "<"), "the embedded script does not close itself early");
  assert.equal((html.match(/data-filter="1"/g) || []).length, 6 + (r.bookFutureMatched.length ? 2 : 0)); // פרטים, מוטב, חשבון נגדי per table
  const body = renderBankReconBody(r);
  assert.ok(body.startsWith('<div class="bank-recon">') && !body.includes("<html"));
  assert.ok(body.includes("<script") === false);
  const buf = await renderBankReconXlsx(r);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const names = wb.worksheets.map((w) => w.name);
  assert.deepEqual(names.slice(0, 3), ["סיכום", "1 בנק ללא ספרים", "2 ספרים ללא בנק"]);
  assert.ok(names.includes("3א צ'קים שנפרעו") && names.includes("3ב צ'קים פתוחים"));
  assert.ok(wb.worksheets.every((w) => w.views?.[0]?.rightToLeft === true), "every sheet is right to left");
  const s1 = wb.getWorksheet("1 בנק ללא ספרים");
  assert.equal(s1.rowCount, r.bankOpen.length + 2); // header + rows + total
  assert.ok(s1.getRow(1).values.includes("מוטב"), "the Excel has the beneficiary column");
});
