// Beecomm Z details → allegro.bcom_z_reports.
// The daily loader (index.js) already calls the Beecomm zReports cube for bcom_cash, which keeps
// only 5 numbers per day. saveZDetails() stores the whole Z from the same rows: net, VAT,
// service, refunds, cancellations, diners, orders, and the payments by type (cards, cash, Wolt...).
// It is the same data as the "דוחות קופה" report in Beecomm, so that file is not uploaded.
//
// Backfill (CLI), e.g. from the project root:
//   node scripts/server/analoader/bcom_z_details.js --from 01/01/2024 --to 19/10/2026
// Dates are DD/MM/YYYY like the loader. Long ranges are loaded one month at a time.
import moment from "moment";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { getDbPool } from "../../../admin/server/sources/dbpool.js";

const TZ = "Asia/Jerusalem";
const localFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

// ISO UTC → 'YYYY-MM-DD HH:MM:SS' in restaurant (Israel) time.
export const localTime = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(localFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
};

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100) / 100);
const int = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));

// Payments by type, without the ids Beecomm repeats on every entry.
const payments = (list) =>
  (Array.isArray(list) ? list : []).map((p) => ({
    type: p.paymentType,
    name: p.paymentTypeName,
    inTotalZ: p.calcInTotalZ,
    transactions: p.totalTransactions,
    charged: num(p.totalCharged),
    refunded: num(p.totalRefunded),
    net: num((Number(p.totalCharged) || 0) - (Number(p.totalRefunded) || 0)), // as the cash report shows it
    refundTransactions: p.totalRefundTransactions,
    brands: (p.subTypes || []).map((s) => ({
      brand: s.cardBrand,
      transactions: s.totalTransactions,
      charged: num(s.totalCharged),
      refunded: num(s.totalRefunded),
      net: num((Number(s.totalCharged) || 0) - (Number(s.totalRefunded) || 0)),
      refundTransactions: s.totalRefundTransactions,
      commission: num(s.commission),
    })),
  }));

export const zRow = (r) => {
  const opened = localTime(r.startTs);
  return [
    String(r._id),
    r.restaurantId || null,
    r.branchId,
    int(r.zNumber),
    // the business day Beecomm assigns (valueDate), in Israel time; fall back to the opening day
    (localTime(r.valueDate) || opened || "").slice(0, 10) || null,
    opened,
    localTime(r.endTs),
    num(r.netoIncom),
    num(r.taxAmount),
    num(r.serviceTotal),
    num(r.totalIncome),
    num(r.brutoIncom),
    num(r.discountTotal),
    num(r.totalPaymentRefund),
    num(r.totalItemCancels),
    int(r.orderCancelsCount),
    int(r.canceledItemsCount),
    int(r.dinnersCount),
    int(r.canceledDinnersCount),
    int(r.ordersCount),
    JSON.stringify(payments(r.paymentTypes)),
  ];
};

export const saveZDetails = async (rows) => {
  const values = (rows || []).filter((r) => r && r._id && r.branchId).map(zRow).filter((v) => v[4]);
  if (!values.length) return 0;
  const pool = await getDbPool();
  let affected = 0;
  for (let i = 0; i < values.length; i += 500) {
    const [res] = await pool.query(
      `INSERT INTO bcom_z_reports (z_id, restaurantId, branchId, z_no, business_date, opened_at, closed_at, net_income, vat, service,
         total_income, bruto_income, discounts, refunds, item_cancels, cancelled_orders, cancelled_items, diners, cancelled_diners,
         orders, payments_json)
       VALUES ?
       ON DUPLICATE KEY UPDATE restaurantId = VALUES(restaurantId), branchId = VALUES(branchId), z_no = VALUES(z_no),
         business_date = VALUES(business_date), opened_at = VALUES(opened_at), closed_at = VALUES(closed_at),
         net_income = VALUES(net_income), vat = VALUES(vat), service = VALUES(service), total_income = VALUES(total_income),
         bruto_income = VALUES(bruto_income), discounts = VALUES(discounts), refunds = VALUES(refunds),
         item_cancels = VALUES(item_cancels), cancelled_orders = VALUES(cancelled_orders), cancelled_items = VALUES(cancelled_items),
         diners = VALUES(diners), cancelled_diners = VALUES(cancelled_diners), orders = VALUES(orders),
         payments_json = VALUES(payments_json)`,
      [values.slice(i, i + 500)],
    );
    affected += res.affectedRows || 0;
  }
  return values.length;
};

// ── CLI backfill ──────────────────────────────────────────────────────────
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const dotenv = (await import("dotenv")).default;
  dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), "../../../.env") });
  const minimist = (await import("minimist")).default;
  const { default: bcomApiLoad } = await import("./bcom_api_loader.js");
  const argv = minimist(process.argv.slice(2));
  const from = moment(String(argv.from || ""), "DD/MM/YYYY", true);
  const to = argv.to ? moment(String(argv.to), "DD/MM/YYYY", true) : moment().subtract(1, "days");
  if (!from.isValid() || !to.isValid() || from.isAfter(to)) {
    console.log("usage: node scripts/server/analoader/bcom_z_details.js --from DD/MM/YYYY [--to DD/MM/YYYY]");
    process.exit(1);
  }
  let total = 0;
  for (let start = from.clone(); !start.isAfter(to); start.add(1, "month").startOf("month")) {
    const end = moment.min(start.clone().endOf("month"), to);
    const dates = { startDate: start.format("DD/MM/YYYY"), endDate: end.format("DD/MM/YYYY") };
    // bcomApiLoad does not await the push callback, so collect the saves and wait for them here
    const saves = [];
    await bcomApiLoad(dates, (src, rows) => {
      saves.push(saveZDetails(rows));
    });
    const saved = (await Promise.all(saves)).reduce((a, b) => a + b, 0);
    total += saved;
    console.log(`${dates.startDate} - ${dates.endDate}: ${saved} Z reports saved`);
  }
  console.log(`done: ${total} Z reports`);
  process.exit(0);
}
