-- Create orders table for storing order data
-- This table stores order information with JSON field for nested data
-- and separate columns for commonly searched fields

CREATE TABLE IF NOT EXISTS `orders` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `orderId` VARCHAR(36) NOT NULL,
  `total` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  `currency` VARCHAR(10) NOT NULL DEFAULT '1',
  `language` VARCHAR(5) NOT NULL DEFAULT 'HE',
  `customer_name` VARCHAR(255) DEFAULT NULL COMMENT 'Extracted from orderData.locationData.name for searching',
  `phone` VARCHAR(20) DEFAULT NULL COMMENT 'Extracted from orderData.locationData.phone for searching',
  `orderData` JSON NOT NULL COMMENT 'Full order data including cartItems, locationData, etc.',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_orderId` (`orderId`),
  KEY `idx_phone` (`phone`),
  KEY `idx_customer_name` (`customer_name`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_language` (`language`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Example queries for searching:

-- Search by orderId:
-- SELECT * FROM orders WHERE orderId = '63cdf982-e3e7-4e00-8c94-47d4b2a1b1c5';

-- Search by phone:
-- SELECT * FROM orders WHERE phone = '0526611747';

-- Search by customer name:
-- SELECT * FROM orders WHERE customer_name LIKE '%מוטי%';

-- Search by date range:
-- SELECT * FROM orders WHERE created_at >= '2024-01-01' AND created_at < '2024-02-01';

-- Search by date (specific day):
-- SELECT * FROM orders WHERE DATE(created_at) = '2024-01-15';

-- Access JSON data:
-- SELECT orderId, customer_name, JSON_EXTRACT(orderData, '$.cartItems') as cartItems FROM orders;
-- SELECT orderId, JSON_EXTRACT(orderData, '$.locationData.building') as building FROM orders;

