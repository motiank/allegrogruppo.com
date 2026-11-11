// One table of every cheque the company wrote: Hashavshevet's cheques module (since 2025-10-09) and the Priority
// cheque file (the history before it, shared/priority_cheques.json) merged, one row per cheque, with the day the bank
// paid it. Owner 2026-11-11: "merge into one table the Priority and Hashavshevet cheques — a fixed Excel on the Drive
// that is updated all the time". The Finance API serves it at /cheques/all; Joya HQ keeps the fixed Google Sheet.
//
// Merge rule: the same cheque number AND amount (±0.01) on both sides is ONE row (source "both": Hashavshevet's
// fields, Priority's supplier account, payment number, withholding and invoices added). The same number with another
// amount stays two rows (a number can be reused). The bank day comes from the bank statement's cheque lines with that
// number and amount; a Priority-only cheque is "cleared" when the bank paid it, else "future" or "not_cleared" by its date.

const amountKey = (n) => (Math.round(Math.abs(Number(n) || 0) * 100) / 100).toFixed(2);
const key = (no, amount) => `${String(Number(no))}|${amountKey(amount)}`;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * @param {object} p
 * @param {Array} p.hash      rows of the Finance API's /cheques (chequeRows): reference, payee, amount, dueDate, issueDate, originalDate, state, account, accountName, chequeId
 * @param {Array} p.priority  records of shared/priority_cheques.json
 * @param {Array} p.bank      the bank statement's cheque lines: { reference, amount (absolute), date }
 * @param {string} p.today    YYYY-MM-DD
 * @returns {{ rows: Array, counts: object, totals: object }}
 */
export function mergeCheques({ hash = [], priority = [], bank = [], today }) {
  const bankBy = new Map(); // number|amount → earliest bank day
  for (const b of bank) {
    if (b.reference == null || !/^\d+$/.test(String(b.reference).trim())) continue;
    const k = key(b.reference, b.amount);
    if (!bankBy.has(k) || (b.date && b.date < bankBy.get(k))) bankBy.set(k, b.date || null);
  }
  // every Hashavshevet cheque is a row of its own (a cancelled cheque and its rewrite share the number and amount);
  // the first row with a number + amount is the one a Priority record joins
  const rows = [];
  const hashByKey = new Map();
  for (const c of hash) {
    const hasNo = c.reference != null && /^\d+$/.test(String(c.reference).trim());
    const k = hasNo ? key(c.reference, c.amount) : null;
    const row = {
      source: "hashavshevet", cheque: hasNo ? Number(c.reference) : null, payee: c.payee || c.accountName || null, amount: r2(c.amount), dueDate: c.dueDate || null,
      issueDate: c.issueDate || c.originalDate || null, state: c.state, bankDate: k ? bankBy.get(k) ?? null : null, account: c.account || null, accountName: c.accountName || null, chequeId: c.chequeId ?? null,
      supplierAccount: null, priorityPayment: null, grossAmount: null, withholding: null, invoices: null, details: null,
    };
    rows.push(row);
    if (k && !hashByKey.has(k)) hashByKey.set(k, row);
  }
  const extra = [];
  for (const c of priority) {
    const invoices = (c.lines || []).map((l) => l.invoice).filter(Boolean).join(", ") || null;
    const p = { supplierAccount: c.supplierAccount || null, priorityPayment: c.payment, grossAmount: r2(c.amount), withholding: r2(c.withholding), invoices, details: c.details || null };
    const k = c.cheque == null ? null : key(c.cheque, c.net);
    const twin = k ? hashByKey.get(k) : null;
    if (twin && twin.source === "hashavshevet") {
      Object.assign(twin, p, { source: "both" });
      continue;
    }
    const bankDate = k ? bankBy.get(k) ?? null : null;
    const state = bankDate ? "cleared" : c.chequeDate && today && c.chequeDate > today ? "future" : "not_cleared";
    extra.push({
      source: "priority", cheque: c.cheque ?? null, payee: c.supplier || null, amount: r2(c.net), dueDate: c.chequeDate || null, issueDate: c.payDate || null, state, bankDate,
      account: null, accountName: null, chequeId: null, ...p,
    });
  }
  const all = [...rows, ...extra].sort((a, b) => String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999")) || (a.cheque ?? 0) - (b.cheque ?? 0));
  const counts = { total: all.length, hashavshevet: 0, priority: 0, both: 0, bankPaid: 0 };
  const totals = { amount: 0, future: 0, cleared: 0, not_cleared: 0 };
  for (const x of all) {
    counts[x.source] += 1;
    if (x.bankDate) counts.bankPaid += 1;
    totals.amount += x.amount;
    totals[x.state] = (totals[x.state] || 0) + x.amount;
  }
  for (const k of Object.keys(totals)) totals[k] = r2(totals[k]);
  return { rows: all, counts, totals };
}
