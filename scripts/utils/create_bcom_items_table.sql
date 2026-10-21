-- Beecomm dish sales per branch per business day (getAnalyticsItemsReport, one call per day).
-- No per-order lines: Beecomm only reports dish totals. Filled by the daily Beecomm API loader
-- (scripts/server/analoader/bcom_items.js, called from index.js) and served by the local API
-- (GET /local-api/v1/beecomm/items/stored). Backfill with:
--   node scripts/server/analoader/bcom_items.js --from DD/MM/YYYY [--to DD/MM/YYYY]
-- A reloaded day replaces that branch's rows for the day.
-- Production runs ANSI_QUOTES: keep string literals in single quotes.
CREATE TABLE IF NOT EXISTS `bcom_items_daily` (
  `business_date` DATE NOT NULL,
  `branchId` VARCHAR(64) NOT NULL,
  `dish_id` VARCHAR(32) NOT NULL,
  `restaurantId` VARCHAR(64) DEFAULT NULL,
  `dish_name` VARCHAR(255) DEFAULT NULL,
  `is_combo` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'a combo/meal; its parts are separate rows with sold_in_combo',
  `category0` VARCHAR(128) DEFAULT NULL COMMENT 'catalogLevel0Name, e.g. אוכל / שתיה',
  `category1` VARCHAR(128) DEFAULT NULL,
  `category2` VARCHAR(128) DEFAULT NULL,
  `quantity` DECIMAL(12,3) DEFAULT NULL,
  `total_sales` DECIMAL(12,2) DEFAULT NULL COMMENT 'before order discounts; days sum to the Z bruto income',
  `sold_in_combo` DECIMAL(12,3) DEFAULT NULL COMMENT 'of quantity, units sold inside a combo',
  `cancels_count` DECIMAL(12,3) DEFAULT NULL,
  `cancels_sum` DECIMAL(12,2) DEFAULT NULL,
  `order_discount_sum` DECIMAL(12,2) DEFAULT NULL COMMENT 'share of order-level discounts',
  `discount_sum` DECIMAL(12,2) DEFAULT NULL COMMENT 'item-level discounts',
  `member_benefits` DECIMAL(12,2) DEFAULT NULL COMMENT 'mcTotalBenefits',
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`business_date`, `branchId`, `dish_id`),
  KEY `idx_branch_date` (`branchId`, `business_date`),
  KEY `idx_dish` (`dish_id`, `business_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
