CREATE TABLE IF NOT EXISTS employees (
  employee_id   INT NOT NULL AUTO_INCREMENT,
  rest          VARCHAR(64)  NOT NULL,
  mic_nmbr      VARCHAR(32)  NULL,
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
  UNIQUE KEY uniq_rest_mic (rest, mic_nmbr),
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


delete from employees where rest = '65bb40ae6729db482e2ed6f2';