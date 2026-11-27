// Tests of the cheque archive reader (admin/server/modules/chequeArchive.js) and of what it adds to the cheque lookup
// (chequePayees.js pickPayee / pickImage) and to the one table of cheques (chequesAll.js mergeCheques). No database,
// no Drive: made-up index rows in the shape the owner's machine writes to Drive.
//   node --test scripts/test_cheque_archive.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeEntry, normalizeIndex, searchArchive, archiveCounts, driveImageUrl, archiveFolderOf } from "../admin/server/modules/chequeArchive.js";
import { pickPayee, pickImage, PAYEE_SOURCE } from "../admin/server/modules/chequePayees.js";
import { mergeCheques } from "../admin/server/modules/chequesAll.js";

const img = (id, folder, name) => ({ front: { id, path: `cheques/${folder}/${name}.jpg` } });
const INDEX = {
  company: "פסטה לינה בע״מ",
  cheques: [
    { rowId: 207, date: "2025-05-12", reference: "10201", amount: -1193, details: "שיק", payee: "פקר טומי", payeeSource: "פריוריטי", party_folder: "פקר טומי", name: "10201", files: img("A1", "פקר טומי", "10201") },
    { rowId: 1173, date: "2025-07-27", reference: "11106", amount: -3639, details: "שיק", payee: "ציונוב מעיין", payeeSource: "image_handwriting", party_folder: "ציונוב מעיין", name: "11106", files: img("B2", "ציונוב מעיין", "11106"), reviewed: "image" },
    { rowId: 1200, date: "2025-08-01", reference: "11200", amount: -500.5, details: "שיק", payee: 'חצרי א.ב ארזים בע"מ', payeeSource: "image", party_folder: "חצרי א.ב ארזים בעמ", name: "11200", files: img("C3", "חצרי", "11200"), reviewed: "image" },
    { rowId: 1444, date: "2025-08-14", reference: "11386", amount: -4000, details: "שיק", payee: "", payeeSource: "חסר", party_folder: "_unknown", name: "11386", files: img("D4", "_unknown", "11386"), payeeGuess: "שגב", reviewed: "image" },
    { rowId: 1500, date: "2025-09-01", reference: "13828", amount: -250, details: "שיק", payee: "", payeeSource: "חסר", party_folder: "_unknown", name: "13828", files: img("E5", "_unknown", "13828") },
    // the same number used twice: another amount, another payee
    { rowId: 1600, date: "2025-10-01", reference: "11200", amount: -900, details: "שיק", payee: "מישהו אחר", payeeSource: "image", party_folder: "מישהו אחר", name: "11200_2025-10-01", files: img("F6", "מישהו אחר", "11200_2025-10-01"), reviewed: "image" },
    { rowId: 1700, date: "2025-10-02", reference: "17028", amount: -1000, details: "שיק", payee: "אליהו מלך", payeeSource: "פקודת יומן", party_folder: "אליהו מלך", name: "17028", files: img("G7", "אליהו מלך", "17028") },
    { rowId: 1800, date: "2025-10-03", reference: "abc", amount: -1, details: "שיק", payee: "x", payeeSource: "image", party_folder: "x", name: "abc", files: img("H8", "x", "abc") },
  ],
};

test("an index row becomes one record: number, absolute amount, where the name came from, the picture", () => {
  const rows = normalizeIndex(INDEX);
  assert.equal(rows.length, 7, "a row without a cheque number is dropped");
  const a = rows[0];
  assert.deepEqual([a.reference, a.amount, a.signedAmount, a.payee, a.source, a.fromImage, a.guess, a.imageId], ["10201", 1193, -1193, "פקר טומי", "priority", false, null, "A1"]);
  const b = rows[1];
  assert.deepEqual([b.source, b.fromImage, b.reviewed], ["image_handwriting", true, "image"]);
  assert.deepEqual([rows[2].source, rows[2].fromImage], ["image", true]);
  const g = rows[3];
  assert.deepEqual([g.payee, g.source, g.guess, g.fromImage], [null, "none", "שגב", false]);
  assert.deepEqual([rows[4].payee, rows[4].guess], [null, null]);
  assert.equal(rows[6].source, "journal");
  assert.equal(normalizeEntry({ reference: "0010201", amount: "-12.345" }).amount, 12.35);
  assert.equal(normalizeEntry({ reference: "10201", amount: -5, payee: "  ", payeeSource: "image", payeeGuess: " שם " }).guess, "שם");
  assert.equal(driveImageUrl("A1"), "https://drive.google.com/file/d/A1/view");
  assert.equal(driveImageUrl(null), null);
  assert.deepEqual(archiveCounts(rows), { total: 7, named: 5, fromImage: 3, guess: 1, unnamed: 1, withImage: 7, noImage: 0, bySource: { priority: 1, image_handwriting: 1, image: 2, none: 2, journal: 1 } });
});

test("the archive belongs to the company whose finance_map folder it is", () => {
  assert.equal(archiveFolderOf("pastalina"), "פסטה לינה בע״מ");
  assert.equal(archiveFolderOf("nope"), null);
});

test("search: number, payee text, amount(s), bank days, named, paging", () => {
  const rows = normalizeIndex(INDEX);
  assert.deepEqual(searchArchive(rows, { number: "11200" }).rows.map((r) => r.amount), [500.5, 900]);
  assert.deepEqual(searchArchive(rows, { number: ["11200", 10201, "x"], amount: 900 }).rows.map((r) => r.payee), ["מישהו אחר"]);
  assert.equal(searchArchive(rows, { q: 'חצרי ארזים בע"מ' }).total, 1, "quotes are ignored, every word must be there");
  assert.equal(searchArchive(rows, { q: "שגב" }).total, 1, "the guess is searched too");
  assert.deepEqual(searchArchive(rows, { amount: "4000,250" }).rows.map((r) => r.reference), ["11386", "13828"]);
  assert.deepEqual(searchArchive(rows, { from: "2025-08-01", to: "2025-08-31" }).rows.map((r) => r.reference), ["11200", "11386"]);
  assert.deepEqual(searchArchive(rows, { named: false }).rows.map((r) => r.reference), ["11386", "13828"]);
  assert.equal(searchArchive(rows, { named: true }).total, 5);
  const page = searchArchive(rows, { limit: 2, offset: 1 });
  assert.deepEqual([page.rows.length, page.total, page.totals.count, page.totals.amount], [2, 7, 7, 11482.5]);
  assert.equal(searchArchive(rows, { number: "999" }).total, 0);
});

test("pickPayee: Hashavshevet first, then Priority, then the name read from the picture (same amount only), a guess last", () => {
  const image = { payee: "מהתמונה", amount: 100, source: PAYEE_SOURCE.image, imageId: "I" };
  const guess = { payee: "אולי", amount: 100, source: PAYEE_SOURCE.imageGuess, imageId: "J" };
  const only = { payee: null, amount: 100, source: "archive", imageId: "K" };
  assert.equal(pickPayee([{ payee: "ספק בחשבשבת", amount: 100, source: "journal" }, { payee: "ספק בפריוריטי", amount: 100, source: "priority" }, image], -100).payee, "ספק בחשבשבת");
  assert.equal(pickPayee([{ payee: "ספק בפריוריטי", amount: 100, source: "priority" }, image], -100).payee, "ספק בפריוריטי");
  assert.equal(pickPayee([{ payee: "עמלות", amount: 0.25, source: "journal" }, image], -100).payee, "מהתמונה", "a fee entry with another amount loses to the picture");
  assert.equal(pickPayee([{ payee: "ספק בפריוריטי", amount: 90, source: "priority" }, image], -100).payee, "מהתמונה", "the picture of THIS cheque (same amount) beats a Priority name by number only");
  assert.equal(pickPayee([{ payee: "ספק בפריוריטי", amount: 90, source: "priority" }, { ...image, amount: 80 }], -100).payee, "ספק בפריוריטי", "no picture with the amount: Priority names by number");
  assert.equal(pickPayee([image], -90), null, "the archive's rows are bank lines: another amount is another cheque");
  assert.equal(pickPayee([guess], -100).source, "image_guess");
  assert.equal(pickPayee([guess, { payee: "ספק בפריוריטי", amount: 90, source: "priority" }], -100).payee, "ספק בפריוריטי", "a sure name by number beats a guess");
  assert.equal(pickPayee([only], -100), null, "a picture without a name names nobody");
  assert.equal(pickPayee([], -100), null);
  // the picture: by amount, else the only one
  assert.equal(pickImage([image, { ...image, amount: 200, imageId: "I2" }], -200).imageId, "I2");
  assert.equal(pickImage([only], -5).imageId, "K", "one picture of that number: shown even with another amount");
  assert.equal(pickImage([image, { ...image, amount: 200, imageId: "I2" }], -5), null, "two pictures, neither amount: none");
  assert.equal(pickImage([{ payee: "x", amount: 5, source: "cheques" }], -5), null);
});

test("mergeCheques: the picture joins a known cheque, an unknown scanned cheque is a row of its own", () => {
  const archive = normalizeIndex(INDEX);
  const hash = [{ reference: 17028, payee: "אליהו מלך ושות'", amount: 1000, dueDate: "2025-10-01", issueDate: "2025-09-20", state: "cleared", account: "500001", accountName: "אליהו מלך", chequeId: 7 }];
  const priority = [{ cheque: 10201, supplier: "פקר טומי", net: 1193, amount: 1193, withholding: 0, chequeDate: "2025-05-10", payDate: "2025-05-01", payment: "CH1", supplierAccount: "200001", lines: [] }];
  const bank = [{ reference: "10201", amount: 1193, date: "2025-05-12" }];
  const r = mergeCheques({ hash, priority, bank, archive, today: "2026-11-07" });
  assert.deepEqual(r.counts, { total: 7, hashavshevet: 1, priority: 1, both: 0, archive: 5, bankPaid: 6, withImage: 7 });
  const h = r.rows.find((x) => x.source === "hashavshevet");
  assert.deepEqual([h.imageId, h.image], ["G7", "https://drive.google.com/file/d/G7/view"]);
  const p = r.rows.find((x) => x.source === "priority");
  assert.deepEqual([p.imageId, p.bankDate], ["A1", "2025-05-12"]);
  const scanned = r.rows.filter((x) => x.source === "archive");
  assert.deepEqual(scanned.map((x) => x.cheque), [11106, 11200, 11386, 13828, 11200]);
  const a = scanned.find((x) => x.cheque === 11106);
  assert.deepEqual([a.payee, a.payeeSource, a.amount, a.dueDate, a.bankDate, a.state, a.issueDate, a.imageId], ["ציונוב מעיין", "image_handwriting", 3639, "2025-07-27", "2025-07-27", "cleared", null, "B2"]);
  const g = scanned.find((x) => x.cheque === 11386);
  assert.deepEqual([g.payee, g.payeeGuess], [null, "שגב"]);
  assert.equal(r.totals.cleared, 1000 + 1193 + 3639 + 500.5 + 4000 + 250 + 900);
  // without an archive nothing changes
  const r0 = mergeCheques({ hash, priority, bank, today: "2026-11-07" });
  assert.deepEqual(r0.counts, { total: 2, hashavshevet: 1, priority: 1, both: 0, archive: 0, bankPaid: 1, withImage: 0 });
});

test("a placeholder row (the bank has no picture; owner 2026-11-28): not a scan, not in the work list, counted apart", () => {
  const rows = normalizeIndex({ cheques: [
    { date: "2025-11-17", reference: "13759", amount: -1290, payee: "ספק", payeeSource: "פריוריטי", party_folder: "ספק", name: "13759", files: {}, noImage: true, noImageAt: "2026-11-28T10:00:00Z", noImageReason: "0 bytes" },
    { date: "2025-11-17", reference: "13760", amount: -500, payee: "", payeeSource: "image", party_folder: "x", name: "13760", files: { front: { id: "F1", path: "cheques/x/13760.jpg" } }, noImage: true },
  ] });
  assert.deepEqual([rows[0].noImage, rows[0].imageId, rows[0].noImageAt], [true, null, "2026-11-28T10:00:00Z"]);
  assert.equal(rows[1].noImage, false, "a row with a picture is never a placeholder, whatever the flag says");
  assert.deepEqual(searchArchive(rows, {}).rows.map((r) => r.reference), ["13760"], "placeholders are left out of a search");
  assert.deepEqual(searchArchive(rows, { noImage: true }).rows.map((r) => r.reference), ["13759", "13760"]);
  const counts = archiveCounts(rows);
  assert.deepEqual([counts.total, counts.noImage, counts.withImage, counts.named, counts.bySource], [2, 1, 1, 0, { none: 1 }]);
  assert.equal(pickImage([rows[0]], 1290), null, "a placeholder has no picture to pick");
});
