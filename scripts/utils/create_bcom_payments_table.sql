-- Beecomm payments report (דוח תשלומים, getPaymentsReport) per branch per business day: charges, refunds,
-- transactions and service (tips) per payment type (אשראי, מזומן, וולט, הקפה, Sodexo, תן ביס, מולטיפס…) and,
-- inside a type, per card brand (VISA, MASTERCARD, AMEX…). The report has no branch or date in its rows, so
-- it is read one branch and one day per call. Amounts are whole shekels (the Z has agorot); a day's type
-- totals inside the Z sum to the Z totalIncome (service included). Filled by the daily Beecomm API loader
-- (scripts/server/analoader/bcom_payments.js, called from index.js) and served by the local API
-- (GET /local-api/v1/beecomm/payments/stored). Backfill with:
--   node scripts/server/analoader/bcom_payments.js --from DD/MM/YYYY [--to DD/MM/YYYY]
-- A reloaded day replaces that branch's rows for the day.
-- Production runs ANSI_QUOTES: keep string literals in single quotes.
CREATE TABLE IF NOT EXISTS `bcom_payments_daily` (
  `business_date` DATE NOT NULL,
  `branchId` VARCHAR(64) NOT NULL,
  `payment_type` INT NOT NULL COMMENT 'Beecomm paymentType: 1 credit, 2 cash, 4 Wolt, 5 hakafa, 10 Sodexo, 12 10bis, 14 tip deposit, 24 Multipass…',
  `card_brand` VARCHAR(128) NOT NULL DEFAULT '' COMMENT 'empty = the total row of the payment type; else one brand inside it',
  `restaurantId` VARCHAR(64) DEFAULT NULL,
  `payment_type_name` VARCHAR(128) DEFAULT NULL,
  `in_z` TINYINT(1) DEFAULT NULL COMMENT 'calcInTotalZ: 0 = outside the Z (e.g. tip deposits)',
  `total_charges` DECIMAL(12,2) DEFAULT NULL COMMENT 'charged, with service (tips)',
  `total_refunded` DECIMAL(12,2) DEFAULT NULL,
  `transactions` INT DEFAULT NULL,
  `refund_transactions` INT DEFAULT NULL,
  `hakafa_returns` DECIMAL(12,2) DEFAULT NULL,
  `service` DECIMAL(12,2) DEFAULT NULL COMMENT 'service (tips) inside the charges',
  `service_only` DECIMAL(12,2) DEFAULT NULL COMMENT 'brand rows: serviceOnly from Beecomm',
  `tax_amount` DECIMAL(12,2) DEFAULT NULL,
  `no_tips` DECIMAL(12,2) DEFAULT NULL COMMENT 'Beecomm totalNoTips: in the data it is charges minus refunds (service still in)',
  `no_tips_no_tax` DECIMAL(12,2) DEFAULT NULL COMMENT 'no_tips without VAT',
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`business_date`, `branchId`, `payment_type`, `card_brand`),
  KEY `idx_branch_date` (`branchId`, `business_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
