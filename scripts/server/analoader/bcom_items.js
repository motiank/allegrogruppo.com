// Beecomm dish sales per branch per business day → allegro.bcom_items_daily.
// The daily loader (index.js) saves the same date range it loads into bcom_cash, one Beecomm
// call per day (the items report can't split a range by date). Beecomm gives dish totals only,
// not dish lines per order.
//
// Backfill (CLI), e.g. from the project root:
//   node scripts/server/analoader/bcom_items.js --from 01/01/2026 --to 19/10/2026
// Dates are DD/MM/YYYY like the loader. --pause (ms, default 2000) waits between calls.
import moment from "moment";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { getDbPool } from "../../../admin/server/sources/dbpool.js";

const num = (v, digits = 2) =>
  v == null || v === "" || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 10 ** digits) / 10 ** digits;
const text = (v, max) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, max));

const itemRow = (r) => [
  r.businessDate,
  r.branchId,
  String(r.dishId),
  r.restaurantId || null,
  text(r.dishName, 255),
  r.isCombo ? 1 : 0,
  text(r.catalogLevel0Name, 128),
  text(r.catalogLevel1Name, 128),
  text(r.catalogLevel2Name, 128),
  num(r.quantity, 3),
  num(r.totalSales),
  num(r.soldInCombo, 3),
  num(r.cancelsCount, 3),
  num(r.cancelsSum),
  num(r.orderDiscountSum),
  num(r.discountSum),
  num(r.mcTotalBenefits),
];

// rows: bcomGetItemsByDay output. Each (branch, day) present in rows is replaced as a whole,
// so a dish that no longer appears in a reloaded day is removed.
export const saveItems = async (rows) => {
  const list = (rows || []).filter((r) => r && r.businessDate && r.branchId && r.dishId);
  if (!list.length) return 0;
  const pool = await getDbPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const days = [...new Set(list.map((r) => `${r.branchId}|${r.businessDate}`))].map((k) => k.split("|"));
    for (const [branchId, day] of days) {
      await conn.query("DELETE FROM bcom_items_daily WHERE branchId = ? AND business_date = ?", [branchId, day]);
    }
    const values = list.map(itemRow);
    for (let i = 0; i < values.length; i += 500) {
      await conn.query(
        `INSERT INTO bcom_items_daily (business_date, branchId, dish_id, restaurantId, dish_name, is_combo,
           category0, category1, category2, quantity, total_sales, sold_in_combo, cancels_count, cancels_sum,
           order_discount_sum, discount_sum, member_benefits)
         VALUES ?
         ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity), total_sales = total_sales + VALUES(total_sales),
           sold_in_combo = sold_in_combo + VALUES(sold_in_combo), cancels_count = cancels_count + VALUES(cancels_count),
           cancels_sum = cancels_sum + VALUES(cancels_sum), order_discount_sum = order_discount_sum + VALUES(order_discount_sum),
           discount_sum = discount_sum + VALUES(discount_sum), member_benefits = member_benefits + VALUES(member_benefits)`,
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
  const { bcomGetItemsByDay } = await import("./bcom_api_loader.js");
  const argv = minimist(process.argv.slice(2));
  const from = moment(String(argv.from || ""), "DD/MM/YYYY", true);
  const to = argv.to ? moment(String(argv.to), "DD/MM/YYYY", true) : moment().subtract(1, "days");
  if (!from.isValid() || !to.isValid() || from.isAfter(to)) {
    console.log("usage: node scripts/server/analoader/bcom_items.js --from DD/MM/YYYY [--to DD/MM/YYYY] [--pause ms]");
    process.exit(1);
  }
  // Pause between Beecomm calls: long unpaused backfills get the API blocked (403 from CloudFront).
  const pauseMs = Number(argv.pause ?? 2000);
  let total = 0;
  for (let day = from.clone(); !day.isAfter(to); day.add(1, "days")) {
    const d = day.format("DD/MM/YYYY");
    const saved = await saveItems(await bcomGetItemsByDay({ startDate: d, endDate: d }));
    total += saved;
    await new Promise((r) => setTimeout(r, pauseMs));
    console.log(`${d}: ${saved} dish rows saved`);
  }
  console.log(`done: ${total} dish rows`);
  process.exit(0);
}
