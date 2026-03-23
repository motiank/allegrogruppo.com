-- Coupon table: stores coupon information
-- coupon_id is the primary key; name and type identify the coupon

CREATE TABLE IF NOT EXISTS `coupons` (
  `coupon_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL COMMENT 'Coupon name/code',
  `type` VARCHAR(50) DEFAULT NULL COMMENT 'Coupon type (e.g., percentage, fixed, etc.)',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expired_at` TIMESTAMP NULL DEFAULT NULL COMMENT 'Expiration date',
  `used_at` TIMESTAMP NULL DEFAULT NULL COMMENT 'Date when coupon was used',
  `cancelled_at` TIMESTAMP NULL DEFAULT NULL COMMENT 'Date when coupon was cancelled',
  PRIMARY KEY (`coupon_id`),
  KEY `idx_name` (`name`),
  KEY `idx_type` (`type`),
  KEY `idx_expired_at` (`expired_at`),
  KEY `idx_used_at` (`used_at`),
  KEY `idx_cancelled_at` (`cancelled_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
