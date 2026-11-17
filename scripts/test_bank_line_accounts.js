// Tests of the card (כרטסת) resolver of the bank lines (admin/server/modules/bankLineAccounts.js) and of what it adds to
// the report's HTML, filters and facets. No database: a made-up context in the shape accountContext() builds.
//   node --test scripts/test_bank_line_accounts.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAccount, setCard, looksLikePerson, wordKey, topOf, historyOf, accountByName, indexAccounts, employeesRule, cardAliases } from "../admin/server/modules/bankLineAccounts.js";
import { normName, facetsOf, matchRow, applyFilter, parseFilter } from "../shared/bankReconFilter.js";
import { renderBankReconBody, accountCell } from "../shared/bankReconHtml.js";

const ACCOUNTS = [
  ["450001", "עובד"], ["500018", "משק החלב 18"], ["500084", 'חצרי א.ב ארזים בע"מ'], ["500030", 'סופרנוב בע"מ'], ["490002", "אן קור שירותי"],
  ["200014", "משלוחה (דיב אנד רד פרוג'קטס בע\"מ)"], ["500228", "נציגות הבית המשותף אבא הלל 154"], ["100020", "קופת אשראי"], ["950000", "עמלות ורבית בנק"],
  ["200001", "וולט"], ["500059", "wolt"], ["500067", 'פלאקסי ישראל בע"מ'], ["200031", 'פלאקסי ישראל בע"מ'], ["400004", 'חו"ז מע"מ'],
];
function ctxOf() {
  const { accounts, byName, byCompact } = indexAccounts(ACCOUNTS.map(([key, name]) => ({ key, name })));
  const nameHistory = new Map([
    [normName("פקר טומי"), [{ key: "450001", n: 37 }]],
    [normName("אלופא כח אדם"), [{ key: "500172", n: 44 }]],
    [normName("מישהו מעורב"), [{ key: "500001", n: 2 }, { key: "500002", n: 2 }]],
    // a group company: paid as a supplier (debit side when money goes out), pays us as a customer (credit side when money comes in)
    [normName('אלגרו גרופו בע"מ'), { debit: [{ key: "500117", n: 16 }], credit: [{ key: "200040", n: 24 }] }],
    [normName("רק צד אחד"), { debit: [], credit: [{ key: "200044", n: 3 }] }],
  ]);
  const textHistory = new Map([
    [normName("מקס איט פיננסי"), [{ key: "100020", n: 551 }, { key: "200010", n: 1 }]],
    [normName("דמי רשום פעולה"), [{ key: "950000", n: 10 }]],
    [normName("10 ביס.קו.איל."), [{ key: "200010", n: 10 }, { key: "500089", n: 10 }]],
    [normName("העב' במקבץ-נט"), [{ key: "200014", n: 8 }]],
    [normName("החזרת שיק-טכני"), [{ key: "500018", n: 45 }]],
    [normName("הפקדה לפקדון"), [{ key: "130001", n: 1 }]],
  ]);
  const employeeNames = new Set(["ולעל יובל", "ספטי נטע", "*אור חן - ברמנית", "Aviv Lotenberg"].map(wordKey));
  return { accounts, byName, byCompact, aliases: cardAliases("pastalina"), nameHistory, textHistory, employeeNames, employees: { account: "450001", prioritySuppliers: ["108"] } };
}
const r = (row, ctx = ctxOf()) => resolveAccount(row, ctx);

test("finance_map: the employees card and the fixed aliases of Pasta Lina", () => {
  assert.deepEqual(employeesRule("pastalina"), { account: "450001", prioritySuppliers: ["108"] });
  assert.equal(employeesRule("nope"), null);
  const a = cardAliases("pastalina");
  assert.deepEqual(a.get(normName('מע"מ')), { in: "400004", out: "400004" });
  assert.deepEqual(a.get(normName("SER LICENSE WOLT")), { in: "200001", out: "500059" });
});

test("wordKey / looksLikePerson: the bank writes 'last first', Tabit adds ' - role'; companies are not people", () => {
  assert.equal(wordKey("יובל ולעל"), wordKey("ולעל יובל"));
  assert.equal(wordKey("*אור חן - ברמנית"), wordKey("חן אור"));
  for (const n of ["ולעל יובל", "MESGENA GERMAY", "אלקואסמי סייף אלדין", "אמיר תורג'מן", "ויקטור כהן"]) assert.ok(looksLikePerson(n), n);
  for (const n of ['חיל אבטחה בע"מ', "WOLT ENTERPRISES ISR", "JOYA ORYAM", "מזרחי טפחות", "ישראכרט-חבר-נטען", "המוסד לביטוח לאומי-תשלום", "אורן מ=מנעולים", "א.ב ארזים", "דנון אורי, צוקרמן דפנה", "שגב", 'עו"ז זיו אברהמי', "גלובל מטאורי", "קו המים מערכות", "זאב חנוך-עבודות לבית", "רחוב 5 בע", "עובדים"])
    assert.equal(looksLikePerson(n), false, n);
});

test("topOf: the dominant account of a history (60 % of at least `min` hits)", () => {
  assert.deepEqual(topOf([{ key: "a", n: 8 }, { key: "b", n: 2 }]), { key: "a", n: 8, of: 10 });
  assert.equal(topOf([{ key: "a", n: 5 }, { key: "b", n: 5 }]), null);
  assert.equal(topOf([{ key: "a", n: 1 }], { min: 2 }), null);
  assert.equal(topOf([]), null);
  assert.deepEqual(historyOf({ debit: [{ key: "a", n: 1 }], credit: [{ key: "b", n: 2 }] }, true), [{ key: "a", n: 1 }]);
  assert.deepEqual(historyOf({ debit: [], credit: [{ key: "b", n: 2 }] }, true), [{ key: "b", n: 2 }]);
  assert.deepEqual(historyOf([{ key: "c", n: 1 }], false), [{ key: "c", n: 1 }]);
  assert.equal(historyOf(undefined, true), null);
});

test("accountByName: exact, without spaces, cut short by the bank file, a shared start; never when two accounts fit", () => {
  const ctx = ctxOf();
  assert.deepEqual(accountByName('חצרי א.ב. ארזים בע״מ', ctx), { key: "500084", partial: false });
  assert.deepEqual(accountByName("סופר נוב בעמ", ctx), { key: "500030", partial: false });
  assert.deepEqual(accountByName('אן-קור שירותי תוכנה בע"', ctx), { key: "490002", partial: true }, "the account's name is the start of the bank's longer one");
  assert.deepEqual(accountByName("דיב אנד רד פרוג'קטס בע\"מ", ctx), { key: "200014", partial: true }, "contained in the account's name");
  assert.deepEqual(accountByName("נציגות הבית המשותף אבא הלל רמת גן", ctx), { key: "500228", partial: true }, "the same first 12 letters");
  assert.equal(accountByName("פלאקסי ישראל ב", ctx), null, "two accounts (customer and supplier) start the same: no guess");
  assert.equal(accountByName('פלאקסי ישראל בע"מ', ctx), null, "the same name on two accounts: no guess");
  assert.equal(ctx.accounts.size, ACCOUNTS.length);
  assert.equal(accountByName("קיש", ctx), null, "too short");
  assert.deepEqual(accountByName("SER LICENSE WOLT", ctx, { moneyOut: false }), { key: "200001", alias: true });
  assert.deepEqual(accountByName("SER LICENSE WOLT", ctx, { moneyOut: true }), { key: "500059", alias: true });
});

test("resolveAccount: the books first, then the name, the employees, the history, a person's name, the bank text", () => {
  const books = r({ payee: "משק החלב 18", payeeSource: "cheques", booksAccount: "500018", details: "שיק", amount: -100 });
  assert.deepEqual([books.key, books.name, books.source, books.employee], ["500018", "משק החלב 18", "books", false]);
  const emp = r({ payee: "פקר טומי", payeeSource: "journal", booksAccount: "450001", details: "שיק", amount: -100 });
  assert.deepEqual([emp.key, emp.source, emp.employee], ["450001", "books", true], "a cheque the journal booked on the employees card");
  assert.deepEqual(r({ payee: 'חצרי א.ב ארזים בע"מ', payeeSource: "image", details: "שיק", amount: -100 }).source, "name");
  const pr = r({ payee: "גדזייב מרים", payeeSource: "priority", payeeSupplier: "108", details: "שיק", amount: -100 });
  assert.deepEqual([pr.key, pr.source, pr.employee], ["450001", "employee", true], "Priority's employees supplier");
  assert.match(pr.basis, /108/);
  const h = r({ payee: "פקר טומי", payeeSource: "image", details: "שיק", amount: -100 });
  assert.deepEqual([h.key, h.source, h.employee], ["450001", "history", true], "the journal booked this name on the employees card before");
  assert.equal(r({ payee: "אלופא כח אדם", payeeSource: "priority", payeeSupplier: "200100", details: "שיק", amount: -100 }).source, "history");
  assert.equal(r({ payee: 'אלגרו גרופו בע"מ', payeeSource: "events", details: "העברה", amount: -5000 }).key, "500117", "money out: the supplier side of the history");
  assert.equal(r({ payee: 'אלגרו גרופו בע"מ', payeeSource: "bank_file", payeeRole: "from", details: "העברה", amount: 5000 }).key, "200040", "money in: the customer side");
  assert.equal(r({ payee: "רק צד אחד", payeeSource: "events", details: "העברה", amount: -50 }).key, "200044", "one side empty: the other side counts");
  assert.equal(r({ payee: "מישהו מעורב", payeeSource: "image", details: "שיק", amount: -100 }), null, "a name split between two accounts (and not a person's name) names nothing");
  const e = r({ payee: "יובל ולעל", payeeSource: "image", details: "שיק", amount: -3000 });
  assert.deepEqual([e.key, e.source, e.employee], ["450001", "employee", true], "in the admin's employee tables, words in any order");
  assert.equal(r({ payee: "חן אור", payeeSource: "events", details: "העברה", amount: -3000 }).source, "employee", "Tabit's name with the role suffix");
  const g = r({ payee: "חטואל יובל", payeeSource: "image", details: "שיק", amount: -2500 });
  assert.deepEqual([g.key, g.source, g.employee], ["450001", "employee_guess", true], "a person's name with no card: probably an employee, to check");
  assert.equal(r({ payee: "חטואל יובל", payeeSource: "bank_file", payeeRole: "from", details: "העברה", amount: 2500 }), null, "money IN from a person is never an employee's pay");
  assert.equal(r({ payee: "מלקור", payeeSource: "image", details: "שיק", amount: -100 }), null, "one word, no card, no history");
  assert.equal(r({ payee: 'מע"מ', payeeSource: "image", details: "שיק", amount: -100 }).key, "400004", "a fixed alias");
  assert.equal(r({ payee: "SER LICENSE WOLT", payeeSource: "bank_file", payeeRole: "from", details: "העברה", amount: 5000 }).key, "200001", "money in from Wolt = the customer");
  // no name: the bank text's past matches, only for texts that name the other side
  const t = r({ details: "מקס איט פיננסי", amount: 1000 });
  assert.deepEqual([t.key, t.source, t.name], ["100020", "text", "קופת אשראי"]);
  assert.match(t.basis, /551 מתוך 552/);
  assert.equal(r({ details: "דמי רשום פעולה", amount: -3 }).key, "950000");
  assert.equal(r({ details: "10 ביס.קו.איל.", amount: 500 }), null, "half and half: no suggestion");
  assert.equal(r({ details: "העב' במקבץ-נט", amount: -500 }), null, "a transfer text says nothing about who");
  assert.equal(r({ details: "החזרת שיק-טכני", amount: 500 }), null, "a cheque text neither");
  assert.equal(r({ details: "הפקדה לפקדון", amount: -500 }), null, "one past match is not enough for a text");
  assert.equal(r({ details: "זיכוי", amount: 50 }), null);
  // without an employees rule nobody is an employee by guess
  const noEmp = { ...ctxOf(), employees: null };
  assert.equal(resolveAccount({ payee: "חטואל יובל", payeeSource: "image", details: "שיק", amount: -2500 }, noEmp), null);
  assert.equal(resolveAccount({ payee: "פקר טומי", payeeSource: "image", details: "שיק", amount: -100 }, noEmp).employee, false);
});

test("setCard writes the counter fields; the HTML cell, the filter and the facets use them", () => {
  const row = setCard({ payee: "חטואל יובל", details: "שיק", amount: -2500 }, r({ payee: "חטואל יובל", details: "שיק", amount: -2500 }));
  assert.deepEqual([row.counterAccount, row.counterName, row.counterSource, row.counterEmployee], ["450001", "עובד", "employee_guess", true]);
  const cell = accountCell(row);
  assert.match(cell, /class="acc acc-emp acc-guess sugg"/);
  assert.match(cell, /data-f="עובד \(450001\)"/);
  assert.match(cell, /450001<\/span>\?/);
  assert.match(accountCell({ counterAccount: "500018", counterName: "משק החלב 18", counterSource: "books" }), /class="acc" data-f="משק החלב 18 \(500018\)"/);
  assert.equal(accountCell({}), `<td class="acc" data-f=""></td>`);

  const report = {
    company: { code: "pastalina", name: "Pasta Lina" }, account: { key: "110011", name: "בנק" }, from: "2026-01-01", to: "2026-01-31", employees: { account: "450001", name: "עובד" },
    summary: { bankBalance: 0, bankOpen: { count: 3, total: -5600, beforeCount: 0, beforeTotal: 0, cheques: { count: 2, found: 1, missing: 0 } }, bookOpen: { count: 1, total: -100, beforeCount: 0, beforeTotal: 0 }, chequesOpen: { count: 1, total: -100, pastDueCount: 0, pastDueTotal: 0, notDueCount: 1, notDueTotal: -100, clearedUnmatchedCount: 0, clearedUnmatchedTotal: 0 }, bookFutureMatched: { count: 0, total: 0 }, chequesCleared: { count: 0, total: 0, groupOnly: 0 }, expectedBookBalance: 0, bookBalance: 0, unexplained: 0, bankLinesSum: 0 },
    notes: [],
    bankOpen: [
      { date: "2026-01-05", reference: "11106", details: "שיק", amount: -2500, payee: "חטואל יובל", payeeSource: "image", counterAccount: "450001", counterName: "עובד", counterSource: "employee_guess", counterBasis: "x", counterEmployee: true },
      { date: "2026-01-06", reference: "11107", details: "שיק", amount: -3000, payee: "פקר טומי", payeeSource: "priority", counterAccount: "450001", counterName: "עובד", counterSource: "employee", counterBasis: "y", counterEmployee: true },
      { date: "2026-01-07", reference: "1", details: "מקס איט פיננסי", amount: -100, counterAccount: "100020", counterName: "קופת אשראי", counterSource: "text", counterBasis: "z" },
    ],
    bookOpen: [{ date: "2026-01-08", reference: "5", description: "משכורת", counterAccount: "450001", counterName: "אזרן שירה", amount: -100, ageDays: 3, posted: true, counterEmployee: true }],
    bookFutureMatched: [], chequesCleared: [],
    chequesOpen: [{ chequeNo: 20001, payee: "משק החלב 18", issueDate: "2026-01-02", dueDate: "2026-02-01", amount: -100, status: "not_due", counterAccount: "500018", counterName: "משק החלב 18", counterSource: "books" }],
  };
  const html = renderBankReconBody(applyFilter(structuredClone(report), parseFilter({ facets: 1 })));
  assert.match(html, /<th data-filter="1">כרטסת<\/th>/);
  assert.match(html, /כרטיס העובדים עובד \(450001\)/, "the legend names the employees card");
  assert.equal((html.match(/acc-emp/g) || []).length >= 4, true, "section 1 twice, section 2 once, the legend");
  // facets: the employees card is one party named by the card, each person stays a party of its own
  const f = facetsOf(applyFilter(structuredClone(report), parseFilter({})), { withParties: true });
  const emp = f.parties.find((p) => p.key === "450001");
  assert.deepEqual([emp.name, emp.count, emp.bankOpen], ["עובד", 3, 2]);
  assert.ok(f.parties.find((p) => p.name === "חטואל יובל" && !p.key));
  assert.ok(f.parties.find((p) => p.key === "100020" && p.name === "קופת אשראי"), "a text-matched line is a party by its card");
  // the filter party=<card key> keeps the lines booked on it, party=<name> finds them by the payee or the card's name
  const byKey = applyFilter(structuredClone(report), parseFilter({ party: "450001" }));
  assert.equal(byKey.bankOpen.length, 2);
  assert.equal(byKey.bookOpen.length, 1);
  assert.equal(byKey.filter.label, "ספק / מוטב: עובד (450001)");
  assert.equal(applyFilter(structuredClone(report), parseFilter({ party: "חטואל" })).bankOpen.length, 1);
  assert.equal(applyFilter(structuredClone(report), parseFilter({ party: "קופת אשראי" })).bankOpen.length, 1, "by the card's name");
  assert.equal(matchRow(report.bankOpen[2], "bankOpen", parseFilter({ q: "100020" })), true, "q finds the card key");
});
