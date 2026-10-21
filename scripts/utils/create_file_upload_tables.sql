-- Tables for the "Upload files" page (admin/server/modules/files.js) and the Beecomm Z details.
-- One page takes every data file (Tabit, Micpal/Shiklulit, bank), recognizes each one, and imports
-- the approved ones; Beecomm data comes from its API. Only new tables; nothing existing changes.
-- Production runs ANSI_QUOTES: keep string literals in single quotes.

-- Every approved file, with what was done with it (audit + "already uploaded" warning).
CREATE TABLE IF NOT EXISTS `file_uploads` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `file_name` VARCHAR(255) NOT NULL,
  `file_hash` CHAR(64) NOT NULL COMMENT 'sha256 of the file content',
  `file_size` INT UNSIGNED NOT NULL DEFAULT 0,
  `kind` VARCHAR(40) NOT NULL COMMENT 'recognized kind, e.g. TABIT_DETAILED, BEECOMM_Z, BANK_HAPOALIM',
  `rest` VARCHAR(64) DEFAULT NULL COMMENT 'branch id (shared/restaurants.json), when the file belongs to one branch',
  `company` VARCHAR(64) DEFAULT NULL,
  `period_from` DATE DEFAULT NULL,
  `period_to` DATE DEFAULT NULL,
  `status` ENUM('OK','PARTIAL','FAILED') NOT NULL,
  `result_json` JSON DEFAULT NULL COMMENT 'counts and errors returned by the importer',
  `user_email` VARCHAR(255) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_hash` (`file_hash`),
  KEY `idx_kind_rest` (`kind`, `rest`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Raw shifts from the Tabit detailed report ("דוח מפורט"): one row per clock-in/out pair.
-- A new upload replaces the rows of the same branch + employee + month.
CREATE TABLE IF NOT EXISTS `tabit_shifts` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `rest` VARCHAR(64) NOT NULL,
  `month` CHAR(7) NOT NULL COMMENT 'YYYY-MM',
  `employee_name` VARCHAR(128) NOT NULL COMMENT 'as Tabit writes it (שם עובד)',
  `clock_id` VARCHAR(32) DEFAULT NULL COMMENT 'מזהה שעון, when the report has it',
  `work_date` DATE NOT NULL,
  `block_no` TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'shift block on that day (1, 2, ...)',
  `role` VARCHAR(64) DEFAULT NULL,
  `clock_in` DATETIME DEFAULT NULL COMMENT 'local restaurant time',
  `clock_out` DATETIME DEFAULT NULL COMMENT 'NULL = no clock-out in the report',
  `note` VARCHAR(255) DEFAULT NULL,
  `upload_id` INT UNSIGNED DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_rest_month` (`rest`, `month`),
  KEY `idx_rest_date` (`rest`, `work_date`),
  KEY `idx_employee` (`rest`, `employee_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Beecomm Z details, one row per Z (usually one per branch per day). Filled by the daily Beecomm
-- API loader (scripts/server/analoader/bcom_z_details.js) from the same zReports cube call that
-- fills bcom_cash. It is the data of Beecomm's "דוחות קופה" report, so that file is not uploaded.
-- Amounts as Beecomm sends them; times in Israel time.
CREATE TABLE IF NOT EXISTS `bcom_z_reports` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `z_id` VARCHAR(32) NOT NULL COMMENT 'Beecomm _id of the Z',
  `restaurantId` VARCHAR(64) DEFAULT NULL,
  `branchId` VARCHAR(64) NOT NULL,
  `z_no` INT DEFAULT NULL COMMENT 'zNumber',
  `business_date` DATE NOT NULL COMMENT 'valueDate (the business day)',
  `opened_at` DATETIME DEFAULT NULL COMMENT 'startTs',
  `closed_at` DATETIME DEFAULT NULL COMMENT 'endTs',
  `net_income` DECIMAL(12,2) DEFAULT NULL COMMENT 'netoIncom: without tips and VAT',
  `vat` DECIMAL(12,2) DEFAULT NULL COMMENT 'taxAmount',
  `service` DECIMAL(12,2) DEFAULT NULL COMMENT 'serviceTotal',
  `total_income` DECIMAL(12,2) DEFAULT NULL COMMENT 'totalIncome',
  `bruto_income` DECIMAL(12,2) DEFAULT NULL COMMENT 'brutoIncom (= bcom_cash.total)',
  `discounts` DECIMAL(12,2) DEFAULT NULL COMMENT 'discountTotal',
  `refunds` DECIMAL(12,2) DEFAULT NULL COMMENT 'totalPaymentRefund (ס.זיכויים)',
  `item_cancels` DECIMAL(12,2) DEFAULT NULL COMMENT 'totalItemCancels (ס.ביטולים)',
  `cancelled_orders` INT DEFAULT NULL COMMENT 'orderCancelsCount',
  `cancelled_items` INT DEFAULT NULL COMMENT 'canceledItemsCount',
  `diners` INT DEFAULT NULL COMMENT 'dinnersCount',
  `cancelled_diners` INT DEFAULT NULL COMMENT 'canceledDinnersCount',
  `orders` INT DEFAULT NULL COMMENT 'ordersCount',
  `payments_json` JSON DEFAULT NULL COMMENT 'payments by type, with card brands: [{type,name,charged,refunded,net,transactions,brands:[...]}]; net = charged - refunded, as the cash report shows',
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_z_id` (`z_id`),
  KEY `idx_branch_date` (`branchId`, `business_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bank account transactions (Bank Hapoalim "תנועות בחשבון" export). Overlapping periods
-- are fine: a row that is already stored (same row_key) is skipped.
CREATE TABLE IF NOT EXISTS `bank_transactions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `bank` VARCHAR(16) NOT NULL COMMENT 'e.g. hapoalim',
  `account` VARCHAR(40) NOT NULL COMMENT 'bank-branch-account as in the file, e.g. 12-407-56084',
  `tx_date` DATE NOT NULL,
  `action_code` VARCHAR(16) DEFAULT NULL,
  `action` VARCHAR(255) DEFAULT NULL,
  `details` VARCHAR(500) DEFAULT NULL,
  `reference` VARCHAR(40) DEFAULT NULL COMMENT 'אסמכתא',
  `bundle` VARCHAR(40) DEFAULT NULL COMMENT 'צרור',
  `debit` DECIMAL(14,2) DEFAULT NULL COMMENT 'חובה',
  `credit` DECIMAL(14,2) DEFAULT NULL COMMENT 'זכות',
  `balance` DECIMAL(14,2) DEFAULT NULL COMMENT 'יתרה',
  `note` VARCHAR(255) DEFAULT NULL,
  `row_key` CHAR(64) NOT NULL COMMENT 'sha256 of the row fields (skips rows already stored)',
  `upload_id` INT UNSIGNED DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_row_key` (`row_key`),
  KEY `idx_account_date` (`account`, `tx_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
