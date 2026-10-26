// Beecomm payments report (דוח תשלומים) per branch per business day → allegro.bcom_payments_daily.
// The daily loader (index.js) saves the same date range it loads into bcom_cash. The report has no
// branch or date in its rows, so it is one Beecomm call per branch per day.
//
// Backfill (CLI), e.g. from the project root:
//   node scripts/server/analoader/bcom_payments.js --from 01/07/2026 --to 25/10/2026 [--branch id1,id2]
// Dates are DD/MM/YYYY like the loader. --pause (ms, default 2000) waits between days.
import moment from "moment";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { getDbPool } from "../../../admin/server/sources/dbpool.js";

const num = (v, digits = 2) =>
  v == null || v === "" || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 10 ** digits) / 10 ** digits;
const int = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));
const text = (v, max) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, max));

const paymentRow = (r) => [
  r.businessDate,
  r.branchId,
  Number(r.paymentType),
  r.master ? "" : text(r.cardBrand, 128) || "",
  r.restaurantId || null,
  text(r.paymentTypeName, 128),
  r.calcInTotalZ == null ? null : r.calcInTotalZ ? 1 : 0,
  num(r.totalCharges),
  num(r.totalRefunded),
  int(r.totalTransactions),
  int(r.totalRefundTransactions),
  num(r.totalHakafaReturns),
  num(r.service),
  num(r.serviceOnly),
  num(r.taxAmount),
  num(r.totalNoTips),
  num(r.totalNoTipsNoTax),
];

// rows: bcomGetPaymentsByDay output. Each (branch, day) present in rows is replaced as a whole.
export const savePayments = async (rows) => {
  const list = (rows || []).filter((r) => r && r.businessDate && r.branchId && r.paymentType != null);
  if (!list.length) return 0;
  const pool = await getDbPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const days = [...new Set(list.map((r) => `${r.branchId}|${r.businessDate}`))].map((k) => k.split("|"));
    for (const [branchId, day] of days) {
      await conn.query("DELETE FROM bcom_payments_daily WHERE branchId = ? AND business_date = ?", [branchId, day]);
    }
    const values = list.map(paymentRow);
    for (let i = 0; i < values.length; i += 500) {
      await conn.query(
        `INSERT INTO bcom_payments_daily (business_date, branchId, payment_type, card_brand, restaurantId, payment_type_name,
           in_z, total_charges, total_refunded, transactions, refund_transactions, hakafa_returns, service, service_only,
           tax_amount, no_tips, no_tips_no_tax)
         VALUES ?
         ON DUPLICATE KEY UPDATE total_charges = total_charges + VALUES(total_charges), total_refunded = total_refunded + VALUES(total_refunded),
           transactions = transactions + VALUES(transactions), refund_transactions = refund_transactions + VALUES(refund_transactions),
           hakafa_returns = hakafa_returns + VALUES(hakafa_returns), service = service + VALUES(service),
           service_only = service_only + VALUES(service_only), tax_amount = tax_amount + VALUES(tax_amount),
           no_tips = no_tips + VALUES(no_tips), no_tips_no_tax = no_tips_no_tax + VALUES(no_tips_no_tax)`,
        [values.slice(i, i + 500)],
      );
    }
    await conn.commit();
    return values.length;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

// ── CLI backfill ──────────────────────────────────────────────────────────
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const dotenv = (await import("dotenv")).default;
  dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), "../../../.env") });
  const minimist = (await import("minimist")).default;
  const { bcomGetPaymentsByDay } = await import("./bcom_api_loader.js");
  const argv = minimist(process.argv.slice(2), { string: ["branch"] });
  const from = moment(String(argv.from || ""), "DD/MM/YYYY", true);
  const to = argv.to ? moment(String(argv.to), "DD/MM/YYYY", true) : moment().subtract(1, "days");
  if (!from.isValid() || !to.isValid() || from.isAfter(to)) {
    console.log("usage: node scripts/server/analoader/bcom_payments.js --from DD/MM/YYYY [--to DD/MM/YYYY] [--branch id1,id2] [--pause ms]");
    process.exit(1);
  }
  const branchIds = argv.branch ? String(argv.branch).split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  // Pause between days: long unpaused backfills get the API blocked (403 from CloudFront).
  const pauseMs = Number(argv.pause ?? 2000);
  let total = 0;
  for (let day = from.clone(); !day.isAfter(to); day.add(1, "days")) {
    const d = day.format("DD/MM/YYYY");
    const saved = await savePayments(await bcomGetPaymentsByDay({ startDate: d, endDate: d }, { branchIds }));
    total += saved;
    await new Promise((r) => setTimeout(r, pauseMs));
    console.log(`${d}: ${saved} payment rows saved`);
  }
  console.log(`done: ${total} payment rows`);
  process.exit(0);
}
