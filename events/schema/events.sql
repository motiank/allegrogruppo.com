-- Events landing-page service — database schema.
-- Target DB: `allegro` (the same MySQL database used by admin / order_sys).
--
-- Apply with:
--   mysql -h $DB_HOST -P $DB_PORT -u $DB_USER -p $DB_NAME < events/schema/events.sql
-- or via the helper script:
--   node events/scripts/apply-schema.js
--
-- The admin backend (built later) owns writes to this table. The events
-- service only reads rows where status = 'published'.

CREATE TABLE IF NOT EXISTS events (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,

  -- Restaurant association. Uses the project-wide restaurant slug
  -- (see admin/server/modules/allegro.js name map), e.g. 'eatalia',
  -- 'la-braza', 'pasta-lina'. Kept as a slug rather than a FK so the events
  -- service has no hard dependency on a restaurants table.
  restaurant_slug  VARCHAR(64)  NOT NULL,

  -- URL slug for the landing page, unique within a restaurant.
  -- Final URL: https://events.allegrogruppo.com/<restaurant_slug>/<slug>
  slug             VARCHAR(128) NOT NULL,

  status           ENUM('draft','published','archived') NOT NULL DEFAULT 'draft',

  -- Content
  title            VARCHAR(255) NOT NULL,
  subtitle         VARCHAR(255) DEFAULT NULL,
  summary          VARCHAR(500) DEFAULT NULL,  -- meta description / social preview / card text
  body_html        MEDIUMTEXT   DEFAULT NULL,  -- main landing-page content (trusted, authored in admin)

  -- Media
  hero_image_url   VARCHAR(500) DEFAULT NULL,
  og_image_url     VARCHAR(500) DEFAULT NULL,  -- social share image (falls back to hero_image_url)

  -- Event details
  location         VARCHAR(255) DEFAULT NULL,
  starts_at        DATETIME     DEFAULT NULL,
  ends_at          DATETIME     DEFAULT NULL,
  price            VARCHAR(64)  DEFAULT NULL,  -- free-form text ("₪120", "From 90", "Free")

  -- Call to action
  cta_label        VARCHAR(128) DEFAULT NULL,  -- e.g. 'Reserve a table'
  cta_url          VARCHAR(500) DEFAULT NULL,

  lang             CHAR(2)      NOT NULL DEFAULT 'he',  -- drives <html lang> + rtl/ltr

  -- Lifecycle
  published_at     DATETIME     DEFAULT NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_event_slug (restaurant_slug, slug),
  KEY idx_restaurant_status (restaurant_slug, status),
  KEY idx_status_starts (status, starts_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
