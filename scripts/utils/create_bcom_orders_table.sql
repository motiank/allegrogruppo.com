-- Beecomm order headers, one row per order. Filled by the daily Beecomm API loader
-- (scripts/server/analoader/bcom_orders.js, called from index.js) and served by the local API
-- (GET /local-api/v1/beecomm/orders/stored). Backfill with:
--   node scripts/server/analoader/bcom_orders.js --from DD/MM/YYYY [--to DD/MM/YYYY]
-- Times in Israel time; business_date is the business day of the order's Z.
-- Production runs ANSI_QUOTES: keep string literals in single quotes.
CREATE TABLE IF NOT EXISTS `bcom_orders` (
  `order_id` VARCHAR(32) NOT NULL COMMENT 'Beecomm order id',
  `restaurantId` VARCHAR(64) DEFAULT NULL,
  `branchId` VARCHAR(64) NOT NULL,
  `order_no` INT DEFAULT NULL COMMENT 'orderNumber (unique per branch only)',
  `daily_no` INT DEFAULT NULL COMMENT 'orderDailyNumber',
  `business_date` DATE NOT NULL COMMENT 'business day of the Z (fallback: opening day)',
  `z_id` VARCHAR(32) DEFAULT NULL COMMENT 'bcom_z_reports.z_id',
  `opened_at` DATETIME DEFAULT NULL,
  `closed_at` DATETIME DEFAULT NULL,
  `order_type` TINYINT DEFAULT NULL COMMENT '1 dine-in; 2/3 platform delivery/takeaway; 9 unidentified',
  `status` TINYINT DEFAULT NULL,
  `table_no` INT DEFAULT NULL,
  `diners` INT DEFAULT NULL,
  `total` DECIMAL(12,2) DEFAULT NULL COMMENT 'before order discount',
  `net_total` DECIMAL(12,2) DEFAULT NULL COMMENT 'after order discount',
  `discount_rate` DECIMAL(14,6) DEFAULT NULL COMMENT 'usually a fraction (0.1 = 10%); a few orders hold a fixed ₪ amount',
  `discount_amount` DECIMAL(12,2) DEFAULT NULL,
  `service_rate` DECIMAL(14,6) DEFAULT NULL COMMENT 'usually a fraction (0.12 = 12%); a few orders hold a fixed ₪ amount (= service_amount)',
  `service_amount` DECIMAL(12,2) DEFAULT NULL,
  `total_items` INT DEFAULT NULL,
  `total_canceled` INT DEFAULT NULL,
  `exceptions_count` INT DEFAULT NULL COMMENT 'orderExceptions',
  `source` VARCHAR(64) DEFAULT NULL COMMENT 'externalCompanyName, e.g. wolt, 10Bis',
  `external_order_id` VARCHAR(64) DEFAULT NULL,
  `creator` VARCHAR(128) DEFAULT NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`order_id`),
  KEY `idx_branch_date` (`branchId`, `business_date`),
  KEY `idx_branch_order` (`branchId`, `order_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
