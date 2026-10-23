-- 2026-10-21: Joya Headquarter reads its source data from the Allegro admin Local Data API and stops
-- storing it (src/services/source.js). For a database that already has the tables of the first
-- add-joya.sql (the local mirror). A new database only needs add-joya.sql.
--
-- Run once. It DROPS the copied source data (sales, dish sales, employees, attendance, payroll lines):
-- that data now lives only in Allegro. Joya's own records (lists, plans, rules, notes) stay.
-- Old demo locations keep allegro_branch_id NULL and are hidden; scripts/joya-seed-demo.mjs --remove
-- deletes them.

ALTER TABLE joya_locations ADD COLUMN allegro_branch_id VARCHAR(64) NULL AFTER name, ADD UNIQUE KEY uq_branch (allegro_branch_id);

ALTER TABLE joya_attendance_corrections
  ADD COLUMN location_id INT NULL AFTER attendance_id,
  ADD COLUMN business_date DATE NULL AFTER location_id,
  ADD COLUMN raw_clock_in DATETIME NULL AFTER business_date,
  ADD COLUMN raw_clock_out DATETIME NULL AFTER raw_clock_in;

CREATE TABLE IF NOT EXISTS joya_role_aliases (
  alias VARCHAR(80) NOT NULL PRIMARY KEY,
  role_code VARCHAR(40) NULL,
  updated_by VARCHAR(255) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
INSERT IGNORE INTO joya_role_aliases (alias, role_code, updated_by) VALUES
  ('מלצר', 'waiter', 'setup'), ('ראנר', 'runner', 'setup'), ('בר', 'bartender', 'setup'), ('ברמן', 'bartender', 'setup'),
  ('בריסטה', 'barista', 'setup'), ('צ''קר', 'checker', 'setup'), ('צ׳קר', 'checker', 'setup'), ('טבח', 'cook', 'setup');

-- the old corrections pointed at joya_attendance rows, which no longer exist
DELETE FROM joya_attendance_corrections;
DELETE FROM joya_payroll_issues;
DELETE FROM joya_import_batches WHERE kind IN ('SALES_CHECKS', 'SALES_ITEMS', 'EMPLOYEES', 'ATTENDANCE', 'PAYROLL', 'DEMO_SEED');

DROP TABLE IF EXISTS joya_sales_checks;
DROP TABLE IF EXISTS joya_sales_items;
DROP TABLE IF EXISTS joya_employee_ids;
DROP TABLE IF EXISTS joya_employees;
DROP TABLE IF EXISTS joya_attendance;
DROP TABLE IF EXISTS joya_payroll_lines;
