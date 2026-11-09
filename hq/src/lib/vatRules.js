// The monthly VAT report rules (owner, 2026-11-03 and 2026-11-09), pure — on the rows of the Beecomm payments report
// (source.payments: { type, typeName, brand, inZ, charges, refunded }). analytics.vatReport sums with them.
//
//   income    = every payment in the Z, paid − refunded (Beecomm's "סה״כ"; the Z total has no tips).
//   hakafa    = the payments of type הקפה (5, "סה״כ הקפה"): a customer who pays later gets a tax invoice from us, so
//               this money is reported for VAT through the invoice, not through the register — it is taken out of
//               the income (owner, 2026-11-09: "we invoice those").
//   hever     = the payments of חבר: the credit brands "PRIVATE LABEL BRAND - חבר" AND "PRIVATE LABEL BRAND" (owner,
//               2026-11-09: both are חבר). 20% of them (VAT_DEDUCT_PCT) is Hever's commission, which Hever does not
//               invoice, so it is deducted from the income for VAT. Only חבר — not מולטיפס (owner, 2026-11-03).
//   vatIncome = income − hakafa − deduction;  vat = vatIncome × 18/118;  vatIncomeBeforeVat = vatIncome − vat.
export const VAT_RATE_PCT = 18;
export const VAT_DEDUCT_PCT = 20;
export const CREDIT_TYPE = 1;
export const HAKAFA_TYPE = 5;
export const HEVER_BRAND = 'PRIVATE LABEL BRAND';

const r2 = (n) => Math.round(n * 100) / 100;
/** A row of חבר: a credit-type brand row whose brand starts with "PRIVATE LABEL BRAND" (with or without "- חבר"). */
export const isHever = (r) => Number(r.type) === CREDIT_TYPE && String(r.brand || '').trim().toUpperCase().startsWith(HEVER_BRAND);
/** The total row of הקפה (type 5): brand null = the type's total. */
export const isHakafa = (r) => Number(r.type) === HAKAFA_TYPE && r.brand == null;

export const blankSums = () => ({ income: 0, hakafa: 0, hever: 0 });

/** Adds one payments-report row (in the Z) to the month's sums. Rows outside the Z are skipped by the caller. */
export function addRow(m, r) {
  const net = Number(r.charges || 0) - Number(r.refunded || 0);
  if (r.brand == null) m.income += net; // the type's total row (the brand rows are inside it)
  if (isHakafa(r)) m.hakafa += net;
  if (isHever(r)) m.hever += net;
  return m;
}

/** The report line of one month from its sums. */
export function vatLine(m) {
  const deduction = (m.hever * VAT_DEDUCT_PCT) / 100;
  const vatIncome = m.income - m.hakafa - deduction;
  const vat = (vatIncome * VAT_RATE_PCT) / (100 + VAT_RATE_PCT);
  return {
    income: r2(m.income),
    hakafa: r2(m.hakafa),
    hever: r2(m.hever),
    deduction: r2(deduction),
    vatIncome: r2(vatIncome),
    vat: r2(vat),
    vatIncomeBeforeVat: r2(vatIncome - vat),
  };
}

export const VAT_RULE = `income = all payments in the Z without tips; hakafa = the הקפה payments (type 5, "סה״כ הקפה") — taken out, they are invoiced to the customer and reported for VAT through the invoice; ${VAT_DEDUCT_PCT}% of the חבר payments (credit brands "PRIVATE LABEL BRAND - חבר" and "PRIVATE LABEL BRAND") is deducted (deduction) — Hever's commission, not invoiced; only חבר, not מולטיפס; vatIncome = income − hakafa − deduction; vat = vatIncome × ${VAT_RATE_PCT}/${100 + VAT_RATE_PCT} (VAT ${VAT_RATE_PCT}% included); vatIncomeBeforeVat = vatIncome − vat (owner, 2026-11-03, 2026-11-09)`;
