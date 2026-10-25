-- The Tabit Shift detailed report JSON as its API returns it, one row per branch × month × Tabit app
-- (Raanana has two apps, kitchen and floor). Filled by the daily Tabit Shift job next to tabit_shifts
-- (admin/server/modules/files.js fetchTabitShift). tabit_shifts keeps only the clock pairs; the payroll
-- (admin/server/modules/payroll.js /extract-tabit) needs Tabit's hour split (100/125/150%, שבת, חג), tip,
-- השלמה and work days, which are only in the report. Each fetch replaces the row.
-- Only a new table; nothing existing changes. Production runs ANSI_QUOTES: keep string literals in single quotes.

CREATE TABLE IF NOT EXISTS `tabit_shift_reports` (
  `rest` VARCHAR(64) NOT NULL COMMENT 'branch id (shared/restaurants.json)',
  `month` CHAR(7) NOT NULL COMMENT 'YYYY-MM',
  `app_id` INT UNSIGNED NOT NULL COMMENT 'Tabit Shift application id (restaurants.json tabit_shift)',
  `report` MEDIUMTEXT NOT NULL COMMENT 'the /api/report/ JSON ({ data, errors })',
  `employees` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `upload_id` INT UNSIGNED DEFAULT NULL COMMENT 'file_uploads row of the fetch',
  `fetched_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`rest`, `month`, `app_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
