-- Joya event-inquiry leads (the "צרו קשר" form at /joya#lead).
-- Target DB: `allegro` (the same MySQL database used by admin / order_sys).
--
-- Apply with:
--   node events/scripts/apply-schema.js

CREATE TABLE IF NOT EXISTS joya_event_leads (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,

  name         VARCHAR(255) NOT NULL,
  phone        VARCHAR(64)  NOT NULL,
  email        VARCHAR(255) DEFAULT NULL,
  guests       SMALLINT UNSIGNED DEFAULT NULL,
  event_date   DATE         DEFAULT NULL,
  branch       VARCHAR(128) DEFAULT NULL,
  message      TEXT         DEFAULT NULL,

  -- Handling workflow, managed from the admin panel.
  status       ENUM('new','contacted','closed') NOT NULL DEFAULT 'new',
  notes        TEXT         DEFAULT NULL,

  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_status (status),
  KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
