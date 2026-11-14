// The other side of a bank transfer, from the bank file the admin uploads (bank_transactions, the Upload page).
// Hashavshevet's bank lines say only "העברה" / "העברה לאחר"; the bank's own file says who: "לטובת: <name>[ עבור: <purpose>]"
// = money out, to the payee; "המבצע: <name>[ <bank-branch-account>][ עבור: <purpose>]" = money in, from the payer.
// The bank's transaction status file (bankEvents.js) names only the orders we gave (money out), so money that came IN
// had no name anywhere — owner 2026-11-14: the 50,000 from אן-קור on 10/4/26 (reference 452606556) looked like the
// transfer TO אן-קור of the same day (reference 452609196). A line is found by account + day + reference + signed amount.
// Pure matching in matchBankFileNames (tests: scripts/test_bank_events.js); addBankFileNames reads the table.
import { executeSql } from "../sources/dbpool.js";
import { stamp } from "./bankEvents.js";

export const PAYEE_SOURCE_BANK_FILE = "bank_file";
const ACCOUNT_TAIL = /\s+\d{2}-\d{3}-\d{3,}\s*$/; // "… 12-584-55663" after the payer's name

/** { name, role: 'to' | 'from', purpose } of a bank file row's details, or null when it names nobody. */
export function partyOfDetails(details) {
  const m = String(details || "").trim().match(/^(לטובת|המבצע):\s*(.*)$/s);
  if (!m) return null;
  let rest = m[2];
  let purpose = null;
  const p = rest.match(/\s*עבור:\s*(.*)$/s);
  if (p) {
    purpose = p[1].trim() || null;
    rest = rest.slice(0, p.index);
  }
  const name = rest.replace(ACCOUNT_TAIL, "").trim();
  return name ? { name, role: m[1] === "לטובת" ? "to" : "from", purpose } : null;
}

const fileKey = (date, reference, signedAmount) => `${String(date || "").slice(0, 10)}|${String(reference ?? "").trim()}|${Math.round(Number(signedAmount) * 100)}`;

/**
 * Names the rows that have no payee yet from the bank file rows. fileRows: [{ id, date, reference, signedAmount,
 * details }] (money in plus, money out minus). date(r) / reference(r) / amount(r) read a row (amount signed the same
 * way). Sets payee, payeeSource "bank_file", payeeRole "to" | "from" (+ payeePurpose when the file says "עבור: …").
 * The same bank row uploaded twice is one key. @returns {{lines:number, found:number, from:number}}
 */
export function matchBankFileNames(rows, fileRows, { date, reference, amount }) {
  const byKey = new Map();
  for (const f of fileRows || []) {
    const party = partyOfDetails(f.details);
    if (!party) continue;
    const k = fileKey(f.date, f.reference, f.signedAmount);
    if (!byKey.has(k)) byKey.set(k, { ...party, id: f.id });
  }
  const stats = { lines: 0, found: 0, from: 0 };
  for (const r of rows || []) {
    if (r.payee) continue;
    const d = date(r);
    const amt = amount(r);
    const ref = reference(r);
    if (!d || amt == null || ref == null || ref === "") continue;
    stats.lines++;
    const hit = byKey.get(fileKey(d, ref, amt));
    if (!hit) continue;
    r.payee = hit.name;
    r.payeeSource = PAYEE_SOURCE_BANK_FILE;
    r.payeeRole = hit.role;
    if (hit.purpose) r.payeePurpose = hit.purpose;
    stats.found++;
    if (hit.role === "from") stats.from++;
  }
  return stats;
}

/**
 * matchBankFileNames against the uploaded bank file of `accounts` (as in the file, e.g. "12-584-136663") between the
 * rows' first and last day. A missing table or a DB error leaves the rows unchanged (stats.error).
 */
export async function addBankFileNames(rows, { accounts = [], date, reference, amount }) {
  const list = (rows || []).filter((r) => !r.payee && date(r) && amount(r) != null && reference(r) != null && reference(r) !== "");
  const accs = [...new Set(accounts.filter(Boolean))];
  if (!list.length || !accs.length) return { lines: 0, found: 0, from: 0 };
  const days = list.map((r) => String(date(r)).slice(0, 10)).sort();
  const params = { from: days[0], to: days[days.length - 1] };
  accs.forEach((a, i) => (params[`a${i}`] = a));
  try {
    const [fileRows] = await executeSql(
      `SELECT id, tx_date, reference, details, debit, credit FROM bank_transactions
        WHERE account IN (${accs.map((_, i) => `:a${i}`).join(",")}) AND tx_date BETWEEN :from AND :to
          AND (details LIKE 'לטובת:%' OR details LIKE 'המבצע:%')
        ORDER BY upload_id DESC, id`,
      params,
    );
    return matchBankFileNames(
      list,
      fileRows.map((f) => ({ id: f.id, date: stamp(f.tx_date)?.slice(0, 10), reference: f.reference, signedAmount: f.credit != null ? Number(f.credit) : -Number(f.debit), details: f.details })),
      { date, reference, amount },
    );
  } catch (err) {
    return { lines: list.length, found: 0, from: 0, error: `bank file not looked up: ${err.code || err.message}` };
  }
}
