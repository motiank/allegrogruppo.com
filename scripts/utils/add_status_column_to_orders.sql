-- Add status column to orders table if it doesn't exist
-- This column tracks the current status of each order
-- Run this script manually - it will fail if column already exists (which is fine)

ALTER TABLE `orders` 
ADD COLUMN `status` VARCHAR(20) DEFAULT 'open' 
COMMENT 'Order status: open, in_preparation, in_delivery, closed' 
AFTER `orderData`;

-- Add index for status column for better query performance
CREATE INDEX `idx_status` ON `orders` (`status`);

