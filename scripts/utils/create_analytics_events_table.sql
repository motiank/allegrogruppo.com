-- Create analytics_events table for storing analytics tracking data
-- This table stores analytics events with JSON field for event details
-- and separate columns for commonly searched fields

CREATE TABLE IF NOT EXISTS `analytics_events` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `timestamp` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `userId` VARCHAR(255) NOT NULL COMMENT 'Generated user ID from analytics system',
  `domain` VARCHAR(255) DEFAULT NULL COMMENT 'Domain where the event occurred',
  `event_name` VARCHAR(255) NOT NULL COMMENT 'Name of the analytics event',
  `details` JSON DEFAULT NULL COMMENT 'Additional event details stored as JSON',
  PRIMARY KEY (`id`),
  KEY `idx_timestamp` (`timestamp`),
  KEY `idx_userId` (`userId`),
  KEY `idx_event_name` (`event_name`),
  KEY `idx_domain` (`domain`),
  KEY `idx_timestamp_event` (`timestamp`, `event_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Example queries for searching:

-- Search by userId:
-- SELECT * FROM analytics_events WHERE userId = '1234567890-abc123';

-- Search by event name:
-- SELECT * FROM analytics_events WHERE event_name = 'page_view';

-- Search by domain:
-- SELECT * FROM analytics_events WHERE domain = 'www.eatalia-market.co.il';

-- Search by date range:
-- SELECT * FROM analytics_events WHERE timestamp >= '2024-01-01' AND timestamp < '2024-02-01';

-- Search by date (specific day):
-- SELECT * FROM analytics_events WHERE DATE(timestamp) = '2024-01-15';

-- Search events by user in date range:
-- SELECT * FROM analytics_events WHERE userId = '1234567890-abc123' AND timestamp >= '2024-01-01';

-- Access JSON details:
-- SELECT event_name, JSON_EXTRACT(details, '$.property') as property FROM analytics_events;
-- SELECT event_name, details->>'$.property' as property FROM analytics_events;

-- Count events by type:
-- SELECT event_name, COUNT(*) as count FROM analytics_events GROUP BY event_name;

-- Count events by domain:
-- SELECT domain, COUNT(*) as count FROM analytics_events GROUP BY domain;
