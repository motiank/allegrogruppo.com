// Tests of the bank reconciliation report filters (shared/bankReconFilter.js): the kind of a row, the party / text /
// amount matching, the facets and the filtered report. No database: node --test scripts/test_bank_recon_filter.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { bankKind, bookKind, normName, parseFilter, filterLabel, matchRow, facetsOf, applyFilter, KINDS, SECTIONS } from "../shared/bankReconFilter.js";
import { renderBankReconBody } from "../shared/bankReconHtml.js";

test("bankKind: the kind of a bank statement line from its text", () => {
  const cases = [
    ["שיק", -100, "cheque"], ["החזרת שיק-טכני", 100, "cheque"], ["עמ' בטול שיק", -5, "fee"],
    ["העברה", -100, "transfer"], ["העב' במקבץ-נט", -100, "transfer"], ["העברת זה\"ב", 100, "transfer"], ["העברה/הפקדה", 100, "transfer"], ["תשלום שובר-נט", -100, "transfer"],
    ["עמ העברה/הפקדה", -3, "fee"], ["עמלת החזרה", -3, "fee"], ["עמ.הע.זה\"ב נט", -3, "fee"], ["דמי רשום פעולה", -3, "fee"], ["ד.ניהול קבועים", -3, "fee"], ["ריבית מפקדון", 10, "fee"],
    ["מקס איט פיננסי", 1000, "card"], ["ישראכרט", -1000, "card"], ["אמריקן אקספרס", 100, "card"], ["פלאקסי ישראל ב", 100, "card"], ["איי.סי.מגא (מס", 100, "card"], ["מועדון חבר צרכ", 100, "card"], ["רעיונית בע\"מ", 100, "card"],
    ["הפ'.תיק ממסרים", 500, "deposit"], ["הפקדה לפקדון", -500, "deposit"], ["משיכת פקדון", 500, "deposit"],
    ["מע\"מ", -100, "authorities"], ["ביטוח לאומי", -100, "authorities"], ["עיריית רעננה", -100, "authorities"],
    ["גמלא מילניוםמ", -100, "salary"],
    ["בזק-הוראות קבע", -100, "direct_debit"], ["טאביט טכנולוגי", -100, "direct_debit"], ["חברת פרטנר תקש", -100, "direct_debit"],
    ["זיכוי", 100, "other"], ["תיקון", 100, "other"], ["", -1, "direct_debit"],
  ];
  for (const [details, amount, want] of cases) assert.equal(bankKind(details, amount), want, details);
});

test("bookKind: the kind of a book line from the cheque flag, the text and the counter account", () => {
  assert.equal(bookKind({ chequeId: 5, description: "x", counterAccount: "500001" }), "cheque");
  assert.equal(bookKind({ description: "ביטול שיק 1234", counterAccount: "500001" }), "cheque");
  assert.equal(bookKind({ description: "MUSA - משכורת 4.26", counterAccount: "450001", counterName: "עובד" }), "salary");
  assert.equal(bookKind({ description: "העברה לספק", counterAccount: "500001", counterName: "ספק" }), "transfer");
  assert.equal(bookKind({ description: "חצרי א.ב ארזים", counterAccount: "500084", counterName: "חצרי א.ב ארזים בע\"מ" }), "transfer"); // a supplier without an instrument word
  assert.equal(bookKind({ description: "מקס איט פיננסים", counterAccount: "200010", counterName: "מקס איט פיננסים" }), "card");
  assert.equal(bookKind({ description: "קופה", counterAccount: "210001", counterName: "קופה רעננה" }), "deposit");
  assert.equal(bookKind({ description: "מע\"מ 10/26", counterAccount: "400001" }), "authorities");
  assert.equal(bookKind({ description: "עמלות בנק", counterAccount: "900050" }), "fee");
  assert.equal(bookKind({ description: "משהו", counterAccount: null }), "other");
});

test("normName: quotes, בע\"מ, dots and dashes do not matter", () => {
  assert.equal(normName('חצרי א.ב ארזים בע"מ'), "חצרי א ב ארזים");
  assert.equal(normName("חצרי א.ב. ארזים בעמ"), "חצרי א ב ארזים");
  assert.equal(normName("  A.G  BOUTIQUE-WINERY Ltd "), "a g boutique winery");
});

test("parseFilter: kinds, sections, amount, refusals", () => {
  const f = parseFilter({ kind: "cheque, transfer", party: " 500084 ", q: "", amount: "1,234.50 ₪", sections: "bookOpen", facets: "1" });
  assert.deepEqual(f.kinds, ["cheque", "transfer"]);
  assert.equal(f.party, "500084");
  assert.equal(f.q, null);
  assert.equal(f.amount, 1234.5);
  assert.deepEqual(f.sections, ["bookOpen"]);
  assert.equal(f.facets, true);
  assert.equal(f.active, true);
  assert.equal(parseFilter({}).active, false);
  assert.equal(parseFilter({ amount: "-99" }).amount, 99);
  assert.throws(() => parseFilter({ kind: "cheque,visa" }), /unknown kind visa/);
  assert.throws(() => parseFilter({ sections: "cheques" }), /unknown section cheques/);
  assert.throws(() => parseFilter({ amount: "abc" }), /amount must be a number/);
  assert.match(filterLabel(f), /סוג: שיקים \/ העברות · ספק \/ מוטב: 500084 · סכום: 1,234.50 · סעיפים: 2 ספרים ללא בנק/);
  assert.equal(filterLabel(parseFilter({})), "");
  assert.equal(KINDS.length, 9);
  assert.equal(SECTIONS.length, 5);
});

const sample = () => ({
  company: { code: "pastaLina", name: "Pasta Lina" }, account: { key: "110011", name: "בנק הפועלים" }, from: "2026-01-01", to: "2026-11-05", dataUpTo: "2026-11-05",
  summary: {
    bankBalance: 100, bankLinesSum: 100, bookBalance: 50, unpostedCount: 0,
    bankOpen: { count: 3, total: -1700, beforeCount: 0, beforeTotal: 0, cheques: { count: 2, found: 1, missing: 1, missingTotal: -700, priority: 0, priorityTotal: 0 } },
    bookOpen: { count: 3, total: -1800, beforeCount: 0, beforeTotal: 0 }, chequesOpen: { count: 2, total: -300, pastDueCount: 1, pastDueTotal: -100, notDueCount: 1, notDueTotal: -200, clearedUnmatchedCount: 0, clearedUnmatchedTotal: 0 },
    bookFutureMatched: { count: 0, total: 0 }, chequesCleared: { count: 1, total: -250, groupOnly: 0 }, cancelledCheques: 0, expectedBookBalance: 50, unexplained: 0,
  },
  notes: [],
  bankOpen: [
    { bankLineId: 1, date: "2026-10-01", reference: 10001, details: "שיק", amount: -1000, ageDays: 35, payee: 'חצרי א.ב ארזים בע"מ', payeeSource: "cheques" },
    { bankLineId: 2, date: "2026-10-02", reference: 10002, details: "שיק", amount: -700, ageDays: 34, payee: null, payeeSource: "missing" },
    { bankLineId: 3, date: "2026-10-03", reference: 0, details: "עמ העברה/הפקדה", amount: -0.5, ageDays: 33 },
  ],
  bookOpen: [
    { lineId: 11, date: "2026-10-05", reference: 500, description: "חצרי א.ב ארזים", counterAccount: "500084", counterName: 'חצרי א.ב ארזים בע"מ', amount: -1200, ageDays: 31, posted: true },
    { lineId: 12, date: "2026-10-06", reference: 501, description: "MUSA - משכורת 9.26", counterAccount: "450001", counterName: "עובד", amount: -500, ageDays: 30, posted: true },
    { lineId: 13, date: "2026-10-07", reference: 502, description: "דורגז", counterAccount: "500040", counterName: 'דורגז החדשה בע"מ', amount: -100, ageDays: 29, posted: false },
  ],
  bookFutureMatched: [],
  chequesCleared: [{ chequeNo: 15940, payee: 'דורגז החדשה בע"מ', issueDate: "2026-09-01", dueDate: "2026-10-01", amount: -250, clearedDate: "2026-10-03", bankAmount: -250, bankReference: 15940, daysAfterDue: 2, status: "cleared" }],
  chequesOpen: [
    { chequeNo: 16000, payee: 'חצרי א.ב ארזים בע"מ', issueDate: "2026-10-01", dueDate: "2026-10-20", amount: -100, daysAfterDue: 16, clearedDate: null, status: "past_due" },
    { chequeNo: 16001, payee: "ספק אחר", issueDate: "2026-10-01", dueDate: "2026-12-20", amount: -200, daysAfterDue: null, clearedDate: null, status: "not_due" },
  ],
});

test("facetsOf: kinds always, parties on demand (by key or by normalised name, across the sections)", () => {
  const r = applyFilter(sample(), parseFilter({}));
  assert.deepEqual(r.facets.kinds.map((k) => [k.kind, k.count, k.total]), [["cheque", 5, -2250], ["fee", 1, -0.5], ["salary", 1, -500], ["transfer", 2, -1300]].sort((a, b) => KINDS.findIndex((k) => k.kind === a[0]) - KINDS.findIndex((k) => k.kind === b[0])));
  assert.equal(r.facets.parties, undefined);
  assert.equal(r.filtered, null);
  assert.equal(r.filter.active, false);
  const f = facetsOf(r, { withParties: true });
  const hatzeri = f.parties.find((p) => p.key === "500084");
  assert.ok(hatzeri, "the supplier by its counter account key");
  // the cheque payee (no key) with the same name is merged into the keyed party: one entry over the three sections
  const named = f.parties.filter((p) => normName(p.name) === "חצרי א ב ארזים");
  assert.equal(named.length, 1);
  assert.equal(named[0].count, 3);
  assert.deepEqual(named[0].sections.sort(), ["bankOpen", "bookOpen", "chequesOpen"]);
  assert.equal(named[0].bankOpen, 1, "bank moves missing from the books");
  assert.equal(named[0].bankOpenTotal, -1000);
  assert.equal(f.parties.find((p) => p.name === "עובד").bankOpen, 0);
  assert.ok(f.parties.find((p) => p.name === "עמ העברה/הפקדה"), "a bank line without a payee is listed by its text");
  assert.ok(!f.parties.find((p) => p.name === "שיק"), "a cheque line without a payee is not a party");
});

test("matchRow and applyFilter: kind, party (key / name), text, amount, sections", () => {
  let r = applyFilter(sample(), parseFilter({ kind: "cheque" }));
  assert.equal(r.bankOpen.length, 2);
  assert.equal(r.bookOpen.length, 0);
  assert.equal(r.chequesOpen.length, 2);
  assert.deepEqual(r.filtered.sections.bankOpen, { count: 2, total: -1700, of: 3, ofTotal: -1700.5 });
  assert.deepEqual(r.filtered.sections.bookOpen, { count: 0, total: 0, of: 3, ofTotal: -1800 });
  assert.equal(r.summary.bankOpen.count, 3, "the summary is for the whole account");
  assert.match(r.filter.label, /שיקים/);

  r = applyFilter(sample(), parseFilter({ party: "500084" }));
  assert.deepEqual(r.bookOpen.map((x) => x.lineId), [11]);
  assert.deepEqual(r.bankOpen.map((x) => x.bankLineId), [1], "the key also matches that account's name on the bank side");
  assert.deepEqual(r.chequesOpen.map((x) => x.chequeNo), [16000]);
  assert.equal(r.filter.label, 'ספק / מוטב: חצרי א.ב ארזים בע"מ (500084)', "a key is shown with its name");
  r = applyFilter(sample(), parseFilter({ party: "999999" }));
  assert.equal(r.bankOpen.length + r.bookOpen.length + r.chequesOpen.length, 0, "an unknown key matches nothing");

  r = applyFilter(sample(), parseFilter({ party: 'חצרי א.ב. ארזים' }));
  assert.deepEqual(r.bankOpen.map((x) => x.bankLineId), [1]);
  assert.deepEqual(r.bookOpen.map((x) => x.lineId), [11]);
  assert.deepEqual(r.chequesOpen.map((x) => x.chequeNo), [16000]);
  assert.equal(r.chequesCleared.length, 0);

  r = applyFilter(sample(), parseFilter({ party: "עמ העברה" }));
  assert.deepEqual(r.bankOpen.map((x) => x.bankLineId), [3], "a bank line without a payee matches the party by its text");

  r = applyFilter(sample(), parseFilter({ q: "דורגז" }));
  assert.deepEqual(r.bookOpen.map((x) => x.lineId), [13]);
  assert.deepEqual(r.chequesCleared.map((x) => x.chequeNo), [15940]);
  r = applyFilter(sample(), parseFilter({ q: "15940" }));
  assert.equal(r.chequesCleared.length, 1, "a cheque number is text too");
  assert.equal(r.bankOpen.length + r.bookOpen.length + r.chequesOpen.length, 0);

  r = applyFilter(sample(), parseFilter({ amount: "1,000" }));
  assert.deepEqual(r.bankOpen.map((x) => x.bankLineId), [1]);
  r = applyFilter(sample(), parseFilter({ amount: 250 }));
  assert.deepEqual(r.chequesCleared.map((x) => x.chequeNo), [15940]);

  r = applyFilter(sample(), parseFilter({ sections: "chequesOpen", kind: "cheque", party: "ספק אחר" }));
  assert.deepEqual(r.chequesOpen.map((x) => x.chequeNo), [16001]);
  assert.equal(r.bankOpen.length, 0);
  assert.equal(r.filtered.sections.bankOpen.omitted, true);
  assert.equal(r.filtered.sections.chequesOpen.omitted, undefined);
  assert.ok(matchRow({ kind: "cheque", details: "שיק", amount: -5, payee: "x" }, "bankOpen", parseFilter({ kind: "cheque,fee" })));
});

test("the HTML of a filtered report shows the filter, the kinds and 'מתוך'", () => {
  const html = renderBankReconBody(applyFilter(sample(), parseFilter({ kind: "cheque", sections: "bankOpen,chequesOpen" })));
  assert.match(html, /סינון:<\/b> סוג: שיקים · סעיפים: 1 בנק ללא ספרים, 3ב צ&#39;קים פתוחים/);
  assert.match(html, /סעיף 1: 2 מתוך 3/);
  assert.match(html, /לא נכללו: סעיף 2, סעיף 3א/);
  assert.match(html, /סה"כ 2 תנועות \(מתוך 3, סכום מלא/);
  assert.match(html, /<th data-filter="1">סוג<\/th>/);
  assert.match(html, /<td>שיקים<\/td>/);
  assert.match(html, /לא נכלל בסינון הסעיפים/);
  const plain = renderBankReconBody(applyFilter(sample(), parseFilter({})));
  assert.ok(!/סינון:/.test(plain));
  assert.match(plain, /סה"כ 3 תנועות<\/td>/);
});

// Noise (shared/bankReconNoise.js, owner 2026-11-15): de facto cancelled cheques and entry + cancellation pairs are
// tagged on the whole report; noise=hide drops them; the page shows a toggle.
test("tagNoise: stale cheques, reversal pairs on the bank and the books sides, the window, the counts", async () => {
  const { tagNoise, STALE_DAYS, PAIR_DAYS, NOISE_LABEL } = await import("../shared/bankReconNoise.js");
  const report = {
    summary: {},
    bankOpen: [
      { date: "2026-04-15", reference: 14127, details: "שיק", amount: -50000 }, // a cheque …
      { date: "2026-04-16", reference: 14127, details: "החזרת שיק-טכני", amount: 50000 }, // … returned the next day (same reference)
      { date: "2026-06-12", reference: 10335, details: "שיק", amount: -27431.25, payee: 'נסיפי כח אדם בע"מ' },
      { date: "2026-06-16", reference: 99, details: "החזרת שיק", amount: 27431.25, payee: "נסיפי כח אדם בעמ" }, // the same payee, spelled differently
      { date: "2026-04-10", reference: 452606556, details: "העברה", amount: 50000, payee: "אן-קור" }, // money in, no opposite twin → stays
      { date: "2026-01-02", reference: 777, details: "שיק", amount: -1000 },
      { date: "2026-09-01", reference: 777, details: "החזרת שיק", amount: 1000 }, // 8 months later: outside the window
    ],
    bookOpen: [
      { date: "2026-07-31", reference: 840, description: "שיק", counterAccount: "500084", counterName: "חצרי", amount: -47200 },
      { date: "2026-07-31", reference: 840, description: "ביטול שיק", counterAccount: "500084", counterName: "חצרי", amount: 47200 },
      { date: "2026-07-31", reference: 841, description: "שיק", counterAccount: "500084", counterName: "חצרי", amount: -47200 }, // a third one: no twin left
      { date: "2026-05-05", reference: 12, description: "העברה", counterAccount: "500001", amount: -300 },
    ],
    bookFutureMatched: [],
    chequesCleared: [],
    chequesOpen: [
      { chequeNo: 1, status: "past_due", daysAfterDue: 61, amount: -100, dueDate: "2026-09-01" },
      { chequeNo: 2, status: "past_due", daysAfterDue: 60, amount: -200, dueDate: "2026-09-02" }, // exactly 60: not yet
      { chequeNo: 3, status: "not_due", daysAfterDue: -5, amount: -300, dueDate: "2026-11-20" },
      { chequeNo: 4, status: "cleared_unmatched", daysAfterDue: 90, amount: -400, dueDate: "2026-08-01" }, // in the bank: real
    ],
  };
  tagNoise(report);
  assert.equal(STALE_DAYS, 60);
  assert.equal(PAIR_DAYS, 90);
  assert.deepEqual(report.bankOpen.map((x) => x.noise?.rule || null), ["reversal", "reversal", "reversal", "reversal", null, null, null]);
  assert.equal(report.bankOpen[0].noise.with, "2026-04-16");
  assert.deepEqual(report.bookOpen.map((x) => x.noise?.rule || null), ["reversal", "reversal", null, null]);
  assert.deepEqual(report.chequesOpen.map((x) => x.noise?.rule || null), ["stale_cheque", null, null, null]);
  assert.deepEqual(report.noise.sections, { bankOpen: { count: 4, total: 0 }, bookOpen: { count: 2, total: 0 }, chequesOpen: { count: 1, total: -100 } });
  assert.equal(report.noise.count, 7);
  assert.equal(report.noise.total, -100);
  assert.ok(NOISE_LABEL.stale_cheque.includes("60"));
  // idempotent
  tagNoise(report);
  assert.equal(report.noise.count, 7);
  // the filter noise=hide drops them; the summary stays
  const f = parseFilter({ noise: "hide" });
  assert.equal(f.noise, "hide");
  assert.equal(f.active, true);
  assert.equal(filterLabel(f), "ללא רעשים");
  const r2 = applyFilter(JSON.parse(JSON.stringify({ ...report, summary: { bankOpen: { total: 0 }, bookOpen: { total: 0 }, chequesOpen: { total: 0 } } })), f);
  assert.equal(r2.bankOpen.length, 3);
  assert.equal(r2.bookOpen.length, 2);
  assert.equal(r2.chequesOpen.length, 3);
  assert.deepEqual(r2.filtered.sections.bankOpen, { count: 3, total: 50000 - 1000 + 1000, of: 7, ofTotal: 50000 });
  assert.equal(r2.filter.noise, "hide");
  assert.equal(parseFilter({}).noise, null);
  // the page: the rows are marked, the box with the toggle is there; with noise=hide there is no toggle
  const html = renderBankReconBody({ ...report, company: {}, account: {}, from: "2026-01-01", to: "2026-11-15", notes: [], summary: { bankBalance: 0, bankOpen: { total: 0, count: 7 }, bookOpen: { total: 0, count: 4 }, chequesOpen: { total: 0, count: 4, pastDueTotal: 0, pastDueCount: 2, notDueTotal: 0, notDueCount: 1 }, chequesCleared: { total: 0, count: 0 }, expectedBookBalance: 0, bookBalance: 0, unexplained: 0, bankLinesSum: 0 }, filter: { active: false } });
  assert.ok(html.includes('class="bank-recon noise-off"'), "noise hidden by default");
  assert.ok(html.includes("noise-tog"), "the toggle button");
  assert.equal((html.match(/<tr class="[^"]*\bnoise\b/g) || []).length, 7);
  const html2 = renderBankReconBody({ ...r2, company: {}, account: {}, from: "2026-01-01", to: "2026-11-15", notes: [], summary: { bankBalance: 0, bankOpen: { total: 0, count: 7 }, bookOpen: { total: 0, count: 4 }, chequesOpen: { total: 0, count: 4, pastDueTotal: 0, pastDueCount: 2, notDueTotal: 0, notDueCount: 1 }, chequesCleared: { total: 0, count: 0 }, expectedBookBalance: 0, bookBalance: 0, unexplained: 0, bankLinesSum: 0 } });
  assert.ok(!html2.includes("noise-tog"));
  assert.ok(html2.includes("ללא רעשים"));
});
