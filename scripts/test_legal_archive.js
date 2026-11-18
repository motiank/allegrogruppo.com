// The legal archive (admin/server/modules/legalArchive.js) — the pure parts: finding a case by a name in any
// spelling, the key facts of a case (verdict, last decision, hearings), the hearings ahead, the paper search.
// No Drive and no DB.  Run: node --test scripts/test_legal_archive.js
import test from "node:test";
import assert from "node:assert/strict";
import { norm, skeleton, isoDate, datesAhead, keyFacts, caseHead, matchScore, allCases, listCases, findCase, hearings, searchDocuments, peopleOf, documentByDriveId, documentById } from "../admin/server/modules/legalArchive.js";

const DAY = "2026-11-18";
const doc = (id, date, type, extra = {}) => ({ documentID: id, date, type, detail: "", by: "", kind: "document", attachmentOf: 0, file: `${date} ${type} [${id}].pdf`, key: false, description: type, descriptionSource: "rule", driveId: `drv${id}`, textDriveId: "", ...extra });
const bludman = {
  caseID: 1, number: "68499-05-26", name: "בלודמן נ' פסטה לינה בע\"מ ואח'", court: "אזורי לעבודה תל אביב - יפו", type: "סע\"ש", subject: "", status: "פתוח", downloaded: true, scope: "all", complete: true,
  summary: "תביעת עובדת לזכויות סוציאליות.", history: "התובעת עבדה ברשת. נקבע דיון מוקדם.", outcome: "", amount: "293,504 ₪", firstDate: "2026-05-24", lastDate: "2026-11-11",
  parties: [{ role: "תובעת", name: "אופל דליה בלודמן" }, { role: "נתבעת", name: "פסטה לינה בע\"מ" }],
  sittings: [{ date: "29/03/2027", time: "10:30", type: "דיון מוקדם", status: "נקבע", judge: "דפנה חסון זכריה" }, { date: "25/11/2026", time: "13:00", type: "דיון מוקדם", status: "נדחה", judge: "" }, { date: "11/11/2026", time: "09:00", type: "פישור", status: "בוטל", judge: "" }],
  documents: [
    doc(10, "2026-05-24", "כתב תביעה", { key: true, descriptionSource: "ai", description: "תביעה על סך 293,504 ₪.", textDriveId: "txt10" }),
    doc(11, "2026-05-24", "אחר (מהאתר)", { kind: "attachment", attachmentOf: 10 }),
    doc(12, "2026-08-16", "כתב הגנה", { key: true, descriptionSource: "ai", description: "הנתבעים מכחישים." }),
    doc(13, "2026-11-11", "החלטה", { key: true, descriptionSource: "ai", description: "זכות תגובה.", result: "תגובה עד 6.12.2026 ועיון ב-7.12.2026." }),
  ],
};
const closed = {
  caseID: 2, number: "64015-08-23", name: "נאמן נ' ג'ויה רום בע\"מ ואח'", court: "אזורי לעבודה בת ים", type: "סע\"ש", subject: "", status: "סגור", downloaded: true, scope: "claim_and_verdict", complete: true,
  summary: "התביעה התקבלה בחלקה.", history: "", outcome: "חיוב של כ-216,500 ₪.", amount: "", firstDate: "2023-08-30", lastDate: "2026-07-09", parties: [], sittings: [],
  documents: [doc(20, "2023-08-30", "כתב תביעה", { key: true, descriptionSource: "ai" }), doc(21, "2026-07-09", "פסק דין", { key: true, descriptionSource: "ai", description: "התביעה התקבלה בחלקה.", result: "חיוב הנתבע 3." })],
};
const appeal = {
  caseID: 3, number: "51710-09-26", name: "נאמן נ' אנקונינה ואח'", court: "הארצי לעבודה", type: "ע\"ע", subject: "ערעור עבודה", status: "פתוח", downloaded: true, scope: "all", complete: true,
  summary: "", history: "", outcome: "", amount: "", firstDate: "2026-09-17", lastDate: "2026-11-16", parties: [], sittings: [],
  documents: [doc(30, "2026-10-12", "החלטה", { key: true, descriptionSource: "ai", description: "נקבע דיון להשלמת טיעונים ליום 01.02.2027 בשעה 09:00. המועד 1.1.2020 חלף.", result: "" })],
};
const notSaved = { caseID: 4, number: "5757-07-15", name: "SHAOYI ואח' נ' טוקו שף בע\"מ ואח'", court: "אזורי לעבודה", type: "סע\"ש", status: "סגור", downloaded: false, documents: 0, note: "not downloaded yet" };
// the same case in a second person's folder, with fewer papers
const catalogs = [
  { person: "moti", builtAt: "2026-11-18T01:00:00Z", cases: [bludman] },
  { person: "itzik", builtAt: "2026-11-18T01:00:00Z", cases: [{ ...bludman, documents: bludman.documents.slice(0, 2), sittings: [] }, closed, appeal, notSaved] },
];

test("a name is found in any spelling: Hebrew with or without vowel letters, and Latin letters", () => {
  assert.equal(skeleton("בלודמן"), "bldmn");
  assert.equal(skeleton("בלדמן"), "bldmn");
  assert.equal(skeleton("Baldman"), "bldmn");
  assert.equal(skeleton("bludman"), "bldmn");
  assert.equal(norm('פסטה לינה בע"מ'), "פסטה לינה בע מ");
  for (const q of ["בלודמן", "בלדמן", "baldman", "Bludman", "68499-05-26", "68499", "פסטה לינה", "xxx|baldman"]) assert.ok(matchScore(bludman, q) > 0, q);
  assert.equal(matchScore(bludman, "68499-05-26"), 100);
  assert.ok(matchScore(bludman, "בלודמן") > matchScore(bludman, "baldman")); // the exact letters beat the skeleton
  assert.equal(matchScore(bludman, "כהן"), 0);
  assert.equal(matchScore(bludman, "בלודמן כהן"), 0); // every word must be found
  assert.equal(matchScore(closed, "baldman"), 0);
});

test("dates: the court's dd/mm/yyyy and the dates a decision mentions", () => {
  assert.equal(isoDate("29/03/2027"), "2027-03-29");
  assert.equal(isoDate("1.2.2027"), "2027-02-01");
  assert.equal(isoDate("23.11.26"), "2026-11-23");
  assert.equal(isoDate("2026-11-18T10:00"), "2026-11-18");
  assert.equal(isoDate("31/13/2026"), null);
  const d = datesAhead("נקבע דיון ליום 01.02.2027 בשעה 09:00. המועד 1.1.2020 חלף. סיכומים עד 13.12.2026.", DAY);
  assert.deepEqual(d.map((x) => x.date), ["2026-12-13", "2027-02-01"]);
  assert.match(d[1].text, /נקבע דיון/);
});

test("the key facts of a case: verdict, last decision, the next hearing", () => {
  const k = keyFacts(bludman, DAY);
  assert.equal(k.verdict, null);
  assert.equal(k.lastDecision.documentID, 13);
  assert.equal(k.lastDecision.file, "drv13");
  assert.deepEqual(k.nextHearing, { date: "2027-03-29", time: "10:30", type: "דיון מוקדם", status: "נקבע", judge: "דפנה חסון זכריה" }); // not the postponed one, not the cancelled one
  assert.equal(k.hearings.length, 3);
  assert.deepEqual(k.datesMentioned.map((x) => x.date), ["2026-12-06", "2026-12-07"]);
  const c = keyFacts(closed, DAY);
  assert.equal(c.verdict.documentID, 21);
  assert.equal(c.verdict.result, "חיוב הנתבע 3.");
  assert.equal(c.lastDecision.documentID, 21); // a verdict is also the last decision
  assert.equal(c.nextHearing, null);
  const h = caseHead(appeal, DAY);
  assert.equal(h.documents, undefined);
  assert.equal(h.nextHearing, null);
  assert.equal(h.nextDateMentioned.date, "2027-02-01");
});

test("the case list: one row per case number, filters, best match first", () => {
  const all = allCases(catalogs);
  assert.equal(all.length, 4);
  const b = all.find((c) => c.number === "68499-05-26");
  assert.deepEqual(b.people.sort(), ["itzik", "moti"]);
  assert.equal(b.documents.length, 4); // the copy with more papers
  assert.equal(listCases(catalogs, {}, DAY).rows[0].number, "51710-09-26"); // newest case first
  assert.deepEqual(listCases(catalogs, { status: "open" }, DAY).rows.map((c) => c.number), ["51710-09-26", "68499-05-26"]);
  assert.equal(listCases(catalogs, { status: "closed" }, DAY).total, 2);
  assert.equal(listCases(catalogs, { downloaded: true }, DAY).total, 3);
  assert.equal(listCases(catalogs, { person: "moti" }, DAY).total, 1);
  const n = listCases(catalogs, { q: "נאמן" }, DAY);
  assert.deepEqual(n.rows.map((c) => c.number), ["51710-09-26", "64015-08-23"]);
  assert.ok(n.rows.every((c) => c.match > 0 && !("documents" in c && Array.isArray(c.documents))));
  assert.equal(listCases(catalogs, { q: "baldman" }, DAY).rows[0].number, "68499-05-26");
  assert.equal(listCases(catalogs, { q: "אין כזה" }, DAY).total, 0);
});

test("one case in full, and the papers behind an id", () => {
  const c = findCase(catalogs, "68499-05-26", null, DAY);
  assert.equal(c.documents.length, 4);
  assert.equal(c.facts.nextHearing.date, "2027-03-29");
  assert.equal(findCase(catalogs, "68499-05-26", "itzik", DAY).documents.length, 2);
  assert.equal(findCase(catalogs, "1-01-01"), null);
  assert.equal(findCase(catalogs, "5757-07-15").facts, null);
  assert.equal(documentByDriveId(catalogs, "drv21").doc.type, "פסק דין");
  assert.equal(documentByDriveId(catalogs, "not-in-a-catalog"), null); // only listed files are served
  assert.equal(documentById(catalogs, 10).doc.textDriveId, "txt10");
  assert.equal(documentById(catalogs, 999), null);
  assert.deepEqual(peopleOf(catalogs).map((p) => [p.person, p.cases, p.saved, p.open]), [["moti", 1, 1, 1], ["itzik", 4, 3, 2]]);
});

test("the hearings ahead: the court's sittings, else the dates a decision mentions", () => {
  const h = hearings(catalogs, {}, DAY);
  assert.deepEqual(h.map((x) => [x.date, x.number, x.source]), [["2027-02-01", "51710-09-26", "decision"], ["2027-03-29", "68499-05-26", "court"]]);
  assert.equal(hearings(catalogs, { to: "2027-02-28" }, DAY).length, 1);
  assert.equal(hearings(catalogs, { cancelled: true }, DAY).length, 3); // + the postponed sitting of 25/11
  assert.equal(hearings(catalogs, { person: "moti" }, DAY).length, 1);
});

test("papers by words", () => {
  assert.equal(searchDocuments(catalogs, { type: "פסק דין" }).rows[0].number, "64015-08-23");
  assert.equal(searchDocuments(catalogs, { key: true }).total, 6);
  assert.equal(searchDocuments(catalogs, { number: "68499-05-26" }).total, 4);
  assert.equal(searchDocuments(catalogs, { q: "מכחישים" }).rows[0].documentID, 12);
  assert.equal(searchDocuments(catalogs, { from: "2026-11-01" }).total, 1);
  assert.equal(searchDocuments(catalogs, { q: "תביעה", limit: 1 }).rows.length, 1);
});
