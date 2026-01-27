-- Affiliate table: stores affiliate partners
-- affiliate_id is the primary key; name and phone identify the affiliate

CREATE TABLE IF NOT EXISTS `affiliate` (
  `affiliate_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL,
  `phone` VARCHAR(20) DEFAULT NULL COMMENT 'Contact phone number',
  `affiliate_code` CHAR(8) DEFAULT NULL COMMENT 'Affiliate code',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`affiliate_id`),
  KEY `idx_phone` (`phone`),
  KEY `idx_name` (`name`),
  KEY `idx_affiliate_code` (`affiliate_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Junction table: links affiliates to orders (many-to-many)
-- References orders.id (PK) and affiliate.affiliate_id (PK)

CREATE TABLE IF NOT EXISTS `affiliate_orders` (
  `affiliate_id` INT UNSIGNED NOT NULL,
  `order_id` INT UNSIGNED NOT NULL COMMENT 'FK to orders.id',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`affiliate_id`, `order_id`),
  KEY `idx_order_id` (`order_id`),
  CONSTRAINT `fk_affiliate_orders_affiliate` FOREIGN KEY (`affiliate_id`) REFERENCES `affiliate` (`affiliate_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_affiliate_orders_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
