-- Standalone, company-level shift-employee roster, loaded from the Tabit
-- "רשימת עובדים" export. Independent of the payroll `employees` table.
--
-- Identity is resolved in application logic on three keys: clock_id, phone,
-- username. Any single key can legitimately change between exports, so there is
-- no DB-level UNIQUE constraint — only lookup indexes per (company, key).
CREATE TABLE IF NOT EXISTS shift_employees (
  id           INT NOT NULL AUTO_INCREMENT,
  company      VARCHAR(64)  NOT NULL,          -- companyId from shared/restaurants.json
  rest         VARCHAR(64)  NULL,              -- restaurant/branch id the load ran under
  username     VARCHAR(128) NULL,              -- שם משתמש  (key)
  first_name   VARCHAR(128) NULL,              -- שם פרטי, leading '*' stripped
  family_name  VARCHAR(128) NULL,              -- שם משפחה, ' - role/branch' suffix stripped
  clock_id     VARCHAR(32)  NULL,              -- מזהה שעון (key)
  phone        VARCHAR(32)  NULL,              -- טלפון נייד, digits only (key)
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_company (company),
  KEY idx_rest (rest),
  KEY idx_company_clock (company, clock_id),
  KEY idx_company_phone (company, phone),
  KEY idx_company_username (company, username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Added after initial deploy (incremental migration for existing installs):
-- ALTER TABLE shift_employees ADD COLUMN rest VARCHAR(64) NULL AFTER company, ADD KEY idx_rest (rest);
