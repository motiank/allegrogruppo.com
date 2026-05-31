CREATE TABLE IF NOT EXISTS employees (
  employee_id   INT NOT NULL AUTO_INCREMENT,
  rest          VARCHAR(64)  NOT NULL,
  name          VARCHAR(128) NOT NULL,
  ID_nmbr       VARCHAR(32)  NULL,
  roles         JSON         NULL,
  t101          BOOLEAN      NOT NULL DEFAULT FALSE,
  `global`      DECIMAL(10,2) NULL,
  hourly_wage   DECIMAL(10,2) NULL,
  wage_type     ENUM('gross','net') NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (employee_id),
  KEY idx_rest (rest),
  KEY idx_id_nmbr (ID_nmbr)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payroll (
  auto_id       INT NOT NULL AUTO_INCREMENT,
  rest          VARCHAR(64) NOT NULL,
  month         CHAR(7)     NOT NULL,
  employee_id   INT         NOT NULL,
  payroll_data  JSON        NULL,
  created_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (auto_id),
  UNIQUE KEY uniq_rest_month_emp (rest, month, employee_id),
  KEY idx_employee (employee_id),
  KEY idx_rest_month (rest, month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


ALTER TABLE employees
  ADD COLUMN hourly_wage DECIMAL(10,2) NULL AFTER `global`,                                                                            
  ADD COLUMN wage_type ENUM('gross','net') NULL AFTER hourly_wage;

ALTER TABLE employees
  ADD COLUMN travel DECIMAL(10,2) NULL AFTER `hourly_wage`;

ALTER TABLE employees
  ADD COLUMN maxTravel DECIMAL(10,2) NULL AFTER travel;

ALTER TABLE employees
  ADD COLUMN contractor BOOLEAN NOT NULL DEFAULT FALSE AFTER maxTravel;

ALTER TABLE employees
  ADD COLUMN active BOOLEAN NOT NULL DEFAULT TRUE AFTER contractor;

ALTER TABLE employees
  ADD COLUMN duplicate INT NULL AFTER active,
  ADD KEY idx_duplicate (duplicate);

ALTER TABLE employees
  DROP INDEX uniq_rest_mic,
  DROP COLUMN mic_nmbr;

ALTER TABLE employees
  ADD COLUMN phone VARCHAR(32) NULL AFTER ID_nmbr;

ALTER TABLE employees
  ADD COLUMN company VARCHAR(128) NULL AFTER employee_id;

CREATE TABLE IF NOT EXISTS micpal (
  keyName   VARCHAR(64)  NOT NULL,
  name      VARCHAR(128) NULL,
  family    VARCHAR(128) NULL,
  ID_nmbr   VARCHAR(32)  NULL,
  updated_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (keyName),
  KEY idx_id_nmbr (ID_nmbr)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


ALTER TABLE micpal
  ADD COLUMN mic_nmbr VARCHAR(64) NULL AFTER keyName;

ALTER TABLE micpal  
  ADD UNIQUE KEY idx_id_nmbr (ID_nmbr, mic_nmbr);

delete from employees where rest = '5ff419934676f0fddabaef3a';


5ff419934676f0fddabaef3a

ALTER TABLE employees
  ADD COLUMN new_wage_type ENUM('global_net','global_gross','hourly_net','hourly_gross','hourly_min_net','hourly_min_gross') NULL AFTER wage_type,
  ADD COLUMN wage DECIMAL(10,2) NULL AFTER new_wage_type;

-- Backfill new_wage_type + wage from legacy columns
-- Rules:
--   global IS NOT NULL              -> wage = global,      new_wage_type = global_<wage_type>
--   hourly_wage = -1                -> wage = -1,          new_wage_type = hourly_min_<wage_type>
--   hourly_wage IS NOT NULL (other) -> wage = hourly_wage, new_wage_type = hourly_<wage_type>
UPDATE employees
SET
  wage = CASE
    WHEN `global` IS NOT NULL THEN `global`
    WHEN hourly_wage IS NOT NULL THEN hourly_wage
    ELSE wage
  END,
  new_wage_type = CASE
    WHEN `global` IS NOT NULL AND wage_type = 'gross' THEN 'global_gross'
    WHEN `global` IS NOT NULL AND wage_type = 'net'   THEN 'global_net'
    WHEN hourly_wage = -1      AND wage_type = 'gross' THEN 'hourly_min_gross'
    WHEN hourly_wage = -1      AND wage_type = 'net'   THEN 'hourly_min_net'
    WHEN hourly_wage IS NOT NULL AND wage_type = 'gross' THEN 'hourly_gross'
    WHEN hourly_wage IS NOT NULL AND wage_type = 'net'   THEN 'hourly_net'
    ELSE new_wage_type
  END
WHERE `global` IS NOT NULL OR hourly_wage IS NOT NULL;

-- Rename micpal -> payroll_soft_ix (the table now backs all payroll-software
-- employee indexes, not only Micpal).
RENAME TABLE micpal TO payroll_soft_ix;