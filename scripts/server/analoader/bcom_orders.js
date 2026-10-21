// Beecomm order headers → allegro.bcom_orders.
// The daily loader (index.js) saves the orders of the same date range it loads into bcom_cash /
// bcom_z_reports, so the local API can serve long order history without the live Beecomm call.
// One row per order (header only: totals, discount, service, table, diners, source; no dish lines).
// Client name/phone are not stored.
//
// Backfill (CLI), e.g. from the project root:
//   node scripts/server/analoader/bcom_orders.js --from 01/01/2026 --to 19/10/2026
// Dates are DD/MM/YYYY like the loader. --pause (ms, default 2000) waits between calls. Long ranges are loaded one week at a time.
import moment from "moment";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { getDbPool } from "../../../admin/server/sources/dbpool.js";
import { localTime } from "./bcom_z_details.js";

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100) / 100);
const int = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));
const rate = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

// Business day of each order = the business day of its Z (bcom_z_reports, saved earlier in the
// same loader run). Orders whose Z is not stored fall back to the local opening day.
const zBusinessDates = async (pool, zIds) => {
  const map = new Map();
  const ids = [...new Set(zIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += 500) {
    const [rows] = await pool.query(
      "SELECT z_id, DATE_FORMAT(business_date, '%Y-%m-%d') AS d FROM bcom_z_reports WHERE z_id IN (?)",
      [ids.slice(i, i + 500)],
    );
    for (const r of rows) map.set(r.z_id, r.d);
  }
  return map;
};

const orderRow = (o, zDates) => {
  const opened = localTime(o.openedAt);
  return [
    String(o.id),
    o.restaurantId || null,
    o.branchId,
    int(o.orderNumber),
    int(o.orderDailyNumber),
    zDates.get(o.zId) || (opened || "").slice(0, 10) || null,
    o.zId || null,
    opened,
    localTime(o.closedAt),
    int(o.orderType),
    int(o.status),
    int(o.tableNumber),
    int(o.dinnersCount),
    num(o.total),
    num(o.netTotal),
    rate(o.discount),
    num(o.discountAmount),
    rate(o.service),
    num(o.serviceAmount),
    int(o.totalItems),
    int(o.totalCanceled),
    int(o.orderExceptions),
    o.externalCompanyName || null,
    o.externalOrderId == null ? null : String(o.externalOrderId),
    o.creator || null,
  ];
};

export const saveOrders = async (orders) => {
  const list = (orders || []).filter((o) => o && o.id && o.branchId);
  if (!list.length) return 0;
  const pool = await getDbPool();
  let zDates = new Map();
  try {
    zDates = await zBusinessDates(pool, list.map((o) => o.zId));
  } catch (e) {
    console.log(`bcom_orders: no Z business dates (${e.message}), using opening day`);
  }
  const values = list.map((o) => orderRow(o, zDates)).filter((v) => v[5]);
  let affected = 0;
  for (let i = 0; i < values.length; i += 500) {
    const [res] = await pool.query(
      `INSERT INTO bcom_orders (order_id, restaurantId, branchId, order_no, daily_no, business_date, z_id, opened_at, closed_at,
         order_type, status, table_no, diners, total, net_total, discount_rate, discount_amount, service_rate, service_amount,
         total_items, total_canceled, exceptions_count, source, external_order_id, creator)
       VALUES ?
       ON DUPLICATE KEY UPDATE restaurantId = VALUES(restaurantId), branchId = VALUES(branchId), order_no = VALUES(order_no),
         daily_no = VALUES(daily_no), business_date = VALUES(business_date), z_id = VALUES(z_id), opened_at = VALUES(opened_at),
         closed_at = VALUES(closed_at), order_type = VALUES(order_type), status = VALUES(status), table_no = VALUES(table_no),
         diners = VALUES(diners), total = VALUES(total), net_total = VALUES(net_total), discount_rate = VALUES(discount_rate),
         discount_amount = VALUES(discount_amount), service_rate = VALUES(service_rate), service_amount = VALUES(service_amount),
         total_items = VALUES(total_items), total_canceled = VALUES(total_canceled), exceptions_count = VALUES(exceptions_count),
         source = VALUES(source), external_order_id = VALUES(external_order_id), creator = VALUES(creator)`,
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
  const { bcomGetOrders } = await import("./bcom_api_loader.js");
  const argv = minimist(process.argv.slice(2));
  const from = moment(String(argv.from || ""), "DD/MM/YYYY", true);
  const to = argv.to ? moment(String(argv.to), "DD/MM/YYYY", true) : moment().subtract(1, "days");
  if (!from.isValid() || !to.isValid() || from.isAfter(to)) {
    console.log("usage: node scripts/server/analoader/bcom_orders.js --from DD/MM/YYYY [--to DD/MM/YYYY] [--pause ms]");
    process.exit(1);
  }
  // Pause between Beecomm calls: long unpaused backfills get the API blocked (403 from CloudFront).
  const pauseMs = Number(argv.pause ?? 2000);
  let total = 0;
  for (let start = from.clone(); !start.isAfter(to); start.add(7, "days")) {
    const end = moment.min(start.clone().add(6, "days"), to);
    const dates = { startDate: start.format("DD/MM/YYYY"), endDate: end.format("DD/MM/YYYY") };
    const saved = await saveOrders(await bcomGetOrders(dates));
    total += saved;
    await new Promise((r) => setTimeout(r, pauseMs));
    console.log(`${dates.startDate} - ${dates.endDate}: ${saved} orders saved`);
  }
  console.log(`done: ${total} orders`);
  process.exit(0);
}
