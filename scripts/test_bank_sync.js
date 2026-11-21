// Tests of the bank update from the bank site (admin/server/modules/bankSync.js): the site's JSON rows → the Excel row
// shape the Upload page stores, the row_key formula, and the text-free move key that stops a move stored from an Excel
// file from being stored again from the site. No database, no Drive.
//   node --test scripts/test_bank_sync.js
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { siteRowToStored, keyRows, moveKey, dropStored, configuredAccounts, companyOfAccount, financeCodeOf, OVERLAP_DAYS } from "../admin/server/modules/bankSync.js";

const ACC = "12-584-136663";
const site = (o) => ({ eventDate: "20261115", valueDate: "20261115", activityTypeCode: 485, activityDescription: "העברה מהבנק", referenceNumber: 493349818, eventAmount: 2000, eventActivityTypeCode: 2, currentBalance: -16131.43, serialNumber: 7, beneficiaryDetailsData: { partyHeadline: "לטובת", partyName: "ליאור אניס", messageHeadline: "עבור", messageDetail: null }, ...o });

test("a transfer out of the site becomes the Excel row: date, 3-digit code, action, 'לטובת: name', debit", () => {
  const r = siteRowToStored(site(), ACC);
  assert.deepEqual(
    { ...r },
    { account: ACC, tx_date: "2026-11-15", action_code: "485", action: "העברה מהבנק", details: "לטובת: ליאור אניס", reference: "493349818", bundle: null, debit: 2000, credit: null, balance: -16131.43, note: null },
  );
});

test("money in: credit, 'המבצע: name account', a purpose adds ' עבור: …'; the site's headlines end with ':' already", () => {
  const r = siteRowToStored(site({ activityTypeCode: 175, activityDescription: "העברה", eventActivityTypeCode: 1, eventAmount: 50000, beneficiaryDetailsData: { partyHeadline: "המבצע:", partyName: 'אלגרו גרופו בע"מ 12-584-136661', messageHeadline: "עבור:", messageDetail: "הלוואה" } }), ACC);
  assert.equal(r.credit, 50000);
  assert.equal(r.debit, null);
  assert.equal(r.details, 'המבצע: אלגרו גרופו בע"מ 12-584-136661 עבור: הלוואה');
  assert.equal(siteRowToStored(site({ beneficiaryDetailsData: { partyHeadline: "לטובת:", partyName: "ליאור אניס" } }), ACC).details, "לטובת: ליאור אניס");
});

test("a cheque: no details (the row's own `details` is a service link, not text); a value date that differs is written after the action like the Excel; pending rows are dropped", () => {
  const c = siteRowToStored(site({ activityTypeCode: 493, activityDescription: "שיק", referenceNumber: 17669, eventAmount: 1689, beneficiaryDetailsData: null, details: "/ServerServices/current-account/cheques/17669?view=paying" }), ACC);
  assert.equal(c.details, null);
  assert.equal(c.reference, "17669");
  const v = siteRowToStored(site({ activityTypeCode: 213, activityDescription: 'החזר חיוב-אכ"מ', eventDate: 20261116, valueDate: 20261115, eventActivityTypeCode: 1, eventAmount: 117031 }), ACC);
  assert.equal(v.tx_date, "2026-11-16");
  assert.equal(v.action, 'החזר חיוב-אכ"מ (תאריך ערך: 15/11)');
  assert.equal(siteRowToStored(site({ serialNumber: 0 }), ACC), null);
  assert.equal(siteRowToStored({ eventDate: "junk" }, ACC), null);
  assert.equal(siteRowToStored(null, ACC), null);
});

test("row_key = the parsers.js formula: the fields without the balance, numbered among equal rows", () => {
  const rows = keyRows([siteRowToStored(site(), ACC), siteRowToStored(site({ currentBalance: 1 }), ACC), siteRowToStored(site({ referenceNumber: 1 }), ACC)]);
  const fields = JSON.stringify([ACC, "2026-11-15", "485", "העברה מהבנק", "לטובת: ליאור אניס", "493349818", null, 2000, null]);
  assert.equal(rows[0].row_key, crypto.createHash("sha256").update(`${fields}#1`).digest("hex"));
  assert.equal(rows[1].row_key, crypto.createHash("sha256").update(`${fields}#2`).digest("hex")); // the balance does not count
  assert.notEqual(rows[2].row_key, rows[0].row_key);
});

test("dropStored: a move an Excel upload stored is not stored again, even when its texts differ; the third equal fee is new", () => {
  const fee = (n) => ({ account: ACC, tx_date: "2026-11-15", action_code: "473", action: "עמ העברה/הפקדה", details: null, reference: "493350060", bundle: "12268", debit: 10.25, credit: null, n });
  const existing = new Map([
    [moveKey({ account: ACC, tx_date: "2026-11-15", action_code: "485", reference: "493349818", debit: 2000, credit: null }), 1],
    [moveKey(fee()), 2],
  ]);
  const transfer = siteRowToStored(site({ beneficiaryDetailsData: { partyHeadline: "לטובת", partyName: "ליאור  אניס  " } }), ACC); // other spacing in the name
  const { fresh, alreadyStored } = dropStored([transfer, fee(1), fee(2), fee(3), siteRowToStored(site({ referenceNumber: 5 }), ACC)], existing);
  assert.equal(alreadyStored, 3);
  assert.deepEqual(fresh.map((r) => r.reference), ["493350060", "5"]);
});

test("moveKey rounds the amounts and ignores the texts", () => {
  assert.equal(moveKey({ account: ACC, tx_date: "2026-01-01", action_code: "493", reference: "1", debit: 10.004, credit: null }), moveKey({ account: ACC, tx_date: "2026-01-01", action_code: "493", action: "x", details: "y", reference: "1", debit: 10, credit: null }));
});

test("the configured accounts come from restaurants.json and map to the finance company", () => {
  const accs = configuredAccounts();
  assert.ok(accs.some((a) => a.account === ACC && a.company === "pastaLina"));
  assert.equal(companyOfAccount(ACC).companyLabel, "פסטה לינה");
  assert.equal(companyOfAccount("nope"), null);
  assert.equal(financeCodeOf("pastaLina"), "pastalina");
  assert.equal(OVERLAP_DAYS, 7);
});
