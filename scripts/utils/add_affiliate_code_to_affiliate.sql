-- Add affiliate_code column to affiliate table if it doesn't exist
-- Run this manually for existing databases that already have the affiliate table

ALTER TABLE `affiliate`
ADD COLUMN `affiliate_code` CHAR(8) DEFAULT NULL COMMENT 'Affiliate code' AFTER `phone`;

-- Add index for lookups by affiliate code
CREATE INDEX `idx_affiliate_code` ON `affiliate` (`affiliate_code`);
