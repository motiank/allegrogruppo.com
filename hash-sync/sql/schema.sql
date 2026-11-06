-- allegro_finance: one database for all companies and years.
-- Every business table has company_id + fiscal_year in its primary key.
-- Hashavshevet is the master: these tables are written only by hash-sync.
-- `extra` holds every source column without its own column; NULL source values are left out of it.
-- A number with more than 15 significant digits is kept in JSON as {"$double": "..."}, because MySQL's JSON parser
-- can change its last digit.
-- Rows are never deleted by the sync: deleted_at marks a row that left the source.

-- Control tables ------------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS companies (
  company_id   SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code         VARCHAR(40)  NOT NULL,
  name         VARCHAR(200) NOT NULL,
  tax_id       VARCHAR(20)  NULL,
  settings     JSON         NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (company_id),
  UNIQUE KEY uq_companies_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS fiscal_years (
  company_id   SMALLINT UNSIGNED NOT NULL,
  fiscal_year  SMALLINT UNSIGNED NOT NULL,
  status       ENUM('open','closed') NOT NULL DEFAULT 'open',
  PRIMARY KEY (company_id, fiscal_year),
  CONSTRAINT fk_fiscal_years_company FOREIGN KEY (company_id) REFERENCES companies (company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS sync_runs (
  sync_run_id    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id     SMALLINT UNSIGNED NOT NULL,
  snapshot_year  SMALLINT UNSIGNED NOT NULL,
  source_label   VARCHAR(200) NOT NULL,
  source_years   JSON NULL,
  started_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at    DATETIME(3) NULL,
  status         ENUM('running','done','failed') NOT NULL DEFAULT 'running',
  error_text     TEXT NULL,
  PRIMARY KEY (sync_run_id),
  KEY ix_sync_runs_company (company_id, started_at),
  CONSTRAINT fk_sync_runs_company FOREIGN KEY (company_id) REFERENCES companies (company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS sync_table_audit (
  sync_run_id    BIGINT UNSIGNED NOT NULL,
  source_table   VARCHAR(128) NOT NULL,
  company_id     SMALLINT UNSIGNED NOT NULL,
  fiscal_year    SMALLINT UNSIGNED NOT NULL,
  target_table   VARCHAR(64) NOT NULL,
  source_rows    INT UNSIGNED NOT NULL,
  inserted_rows  INT UNSIGNED NOT NULL DEFAULT 0,
  updated_rows   INT UNSIGNED NOT NULL DEFAULT 0,
  flagged_rows   INT UNSIGNED NOT NULL DEFAULT 0,
  unchanged_rows INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (sync_run_id, source_table),
  CONSTRAINT fk_audit_run FOREIGN KEY (sync_run_id) REFERENCES sync_runs (sync_run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- The full source schema, including empty tables, so nothing about the source is lost.
CREATE TABLE IF NOT EXISTS source_columns (
  company_id     SMALLINT UNSIGNED NOT NULL,
  fiscal_year    SMALLINT UNSIGNED NOT NULL,
  source_table   VARCHAR(128) NOT NULL,
  column_name    VARCHAR(128) NOT NULL,
  ordinal        SMALLINT UNSIGNED NOT NULL,
  data_type      VARCHAR(40) NOT NULL,
  max_length     INT NULL,
  is_nullable    TINYINT(1) NOT NULL,
  is_primary_key TINYINT(1) NOT NULL DEFAULT 0,
  is_identity    TINYINT(1) NOT NULL DEFAULT 0,
  target_table   VARCHAR(64) NOT NULL,
  target_column  VARCHAR(64) NOT NULL,
  PRIMARY KEY (company_id, fiscal_year, source_table, column_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Every source table without its own clean table lands here, one JSON document per row.
CREATE TABLE IF NOT EXISTS source_rows (
  company_id     SMALLINT UNSIGNED NOT NULL,
  fiscal_year    SMALLINT UNSIGNED NOT NULL,
  source_table   VARCHAR(128) NOT NULL,
  row_key        VARCHAR(190) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  data           JSON NOT NULL,
  source_hash    CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  first_run_id   BIGINT UNSIGNED NOT NULL,
  updated_run_id BIGINT UNSIGNED NOT NULL,
  deleted_at     DATETIME(3) NULL,
  PRIMARY KEY (company_id, fiscal_year, source_table, row_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- The old version of every row that a sync changed or flagged.
CREATE TABLE IF NOT EXISTS row_history (
  row_history_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id     SMALLINT UNSIGNED NOT NULL,
  fiscal_year    SMALLINT UNSIGNED NOT NULL,
  source_table   VARCHAR(128) NOT NULL,
  row_key        VARCHAR(190) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  sync_run_id    BIGINT UNSIGNED NOT NULL,
  change_type    ENUM('updated','left_source','returned') NOT NULL,
  old_row        JSON NOT NULL,
  changed_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (row_history_id),
  KEY ix_row_history_row (company_id, source_table, row_key),
  KEY ix_row_history_year (company_id, fiscal_year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Master data: one copy per company per open year, so a closed year keeps its names and groups -------------------------

CREATE TABLE IF NOT EXISTS account_groups (
  company_id     SMALLINT UNSIGNED NOT NULL,
  fiscal_year    SMALLINT UNSIGNED NOT NULL,
  group_id       INT NOT NULL,
  group_code     INT NULL,
  name           VARCHAR(200) NULL,
  extra          JSON NOT NULL,
  source_hash    CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  first_run_id   BIGINT UNSIGNED NOT NULL,
  updated_run_id BIGINT UNSIGNED NOT NULL,
  deleted_at     DATETIME(3) NULL,
  PRIMARY KEY (company_id, fiscal_year, group_id),
  KEY ix_groups_code (company_id, fiscal_year, group_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS accounts (
  company_id     SMALLINT UNSIGNED NOT NULL,
  fiscal_year    SMALLINT UNSIGNED NOT NULL,
  account_id     INT NOT NULL,
  account_key    VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  name           VARCHAR(200) NULL,
  group_code     INT NULL,
  balance_code   INT NULL,
  main_account   INT NULL,
  cost_code      VARCHAR(40) NULL,
  tax_file_num   VARCHAR(40) NULL,
  address        VARCHAR(200) NULL,
  city           VARCHAR(100) NULL,
  phone          VARCHAR(60) NULL,
  email          VARCHAR(200) NULL,
  bank_code      VARCHAR(20) NULL,
  bank_branch    VARCHAR(20) NULL,
  bank_account   VARCHAR(40) NULL,
  deduction_pct  DOUBLE NULL,
  deduction_valid_to DATETIME(3) NULL,
  stored_balance DOUBLE NULL,
  extra          JSON NOT NULL,
  source_hash    CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  first_run_id   BIGINT UNSIGNED NOT NULL,
  updated_run_id BIGINT UNSIGNED NOT NULL,
  deleted_at     DATETIME(3) NULL,
  PRIMARY KEY (company_id, fiscal_year, account_id),
  UNIQUE KEY uq_accounts_key (company_id, fiscal_year, account_key),
  KEY ix_accounts_group (company_id, fiscal_year, group_code),
  KEY ix_accounts_name (company_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS cost_centers (
  company_id     SMALLINT UNSIGNED NOT NULL,
  fiscal_year    SMALLINT UNSIGNED NOT NULL,
  cost_center_id INT NOT NULL,
  cost_code      VARCHAR(40) NULL,
  name           VARCHAR(200) NULL,
  extra          JSON NOT NULL,
  source_hash    CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  first_run_id   BIGINT UNSIGNED NOT NULL,
  updated_run_id BIGINT UNSIGNED NOT NULL,
  deleted_at     DATETIME(3) NULL,
  PRIMARY KEY (company_id, fiscal_year, cost_center_id),
  KEY ix_cost_centers_code (company_id, fiscal_year, cost_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS transaction_types (
  company_id     SMALLINT UNSIGNED NOT NULL,
  fiscal_year    SMALLINT UNSIGNED NOT NULL,
  type_id        INT NOT NULL,
  type_code      VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  name           VARCHAR(200) NULL,
  extra          JSON NOT NULL,
  source_hash    CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  first_run_id   BIGINT UNSIGNED NOT NULL,
  updated_run_id BIGINT UNSIGNED NOT NULL,
  deleted_at     DATETIME(3) NULL,
  PRIMARY KEY (company_id, fiscal_year, type_id),
  KEY ix_types_code (company_id, fiscal_year, type_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS batches (
  company_id     SMALLINT UNSIGNED NOT NULL,
  fiscal_year    SMALLINT UNSIGNED NOT NULL,
  batch_id       INT NOT NULL,
  batch_no       INT NULL,
  batch_date     DATETIME(3) NULL,
  details        VARCHAR(500) NULL,
  extra          JSON NOT NULL,
  source_hash    CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  first_run_id   BIGINT UNSIGNED NOT NULL,
  updated_run_id BIGINT UNSIGNED NOT NULL,
  deleted_at     DATETIME(3) NULL,
  PRIMARY KEY (company_id, fiscal_year, batch_id),
  KEY ix_batches_no (company_id, fiscal_year, batch_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Transactions: fiscal_year comes from the record's own date --------------------------------------------------------------

CREATE TABLE IF NOT EXISTS journal_entries (
  company_id     SMALLINT UNSIGNED NOT NULL,
  fiscal_year    SMALLINT UNSIGNED NOT NULL,
  trans_id       INT NOT NULL,
  batch_no       INT NULL,
  status         TINYINT NULL COMMENT '1 = posted, 0 = not posted',
  trans_type     VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  debit_account  VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  credit_account VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  debit_name     VARCHAR(200) NULL,
  credit_name    VARCHAR(200) NULL,
  amount         DECIMAL(18,2) NULL,
  amount_fx      DOUBLE NULL,
  currency       VARCHAR(10) NULL,
  value_date     DATETIME(3) NULL,
  due_date       DATETIME(3) NULL,
  third_date     DATETIME(3) NULL,
  issue_date     DATETIME(3) NULL,
  reference      INT NULL,
  reference2     INT NULL,
  reference3     INT NULL,
  description    VARCHAR(500) NULL,
  details        VARCHAR(500) NULL,
  cost_code      VARCHAR(40) NULL,
  document_id    INT NULL,
  cheque_id      INT NULL,
  tax_alloc_number VARCHAR(40) NULL,
  extra          JSON NOT NULL,
  source_hash    CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  first_run_id   BIGINT UNSIGNED NOT NULL,
  updated_run_id BIGINT UNSIGNED NOT NULL,
  deleted_at     DATETIME(3) NULL,
  PRIMARY KEY (company_id, fiscal_year, trans_id),
  KEY ix_journal_trans (company_id, trans_id),
  KEY ix_journal_date (company_id, value_date),
  KEY ix_journal_debit (company_id, debit_account, value_date),
  KEY ix_journal_credit (company_id, credit_account, value_date),
  KEY ix_journal_type (company_id, trans_type, value_date),
  KEY ix_journal_batch (company_id, batch_no),
  KEY ix_journal_reference (company_id, reference)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS journal_lines (
  company_id     SMALLINT UNSIGNED NOT NULL,
  fiscal_year    SMALLINT UNSIGNED NOT NULL,
  line_id        INT NOT NULL,
  trans_id       INT NOT NULL,
  account_key    VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  side           ENUM('credit','debit') NOT NULL,
  amount         DECIMAL(18,2) NULL,
  signed_amount  DECIMAL(18,2) GENERATED ALWAYS AS (IF(side = 'debit', amount, -amount)) STORED COMMENT 'debit is plus',
  extra          JSON NOT NULL,
  source_hash    CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  first_run_id   BIGINT UNSIGNED NOT NULL,
  updated_run_id BIGINT UNSIGNED NOT NULL,
  deleted_at     DATETIME(3) NULL,
  PRIMARY KEY (company_id, fiscal_year, line_id),
  KEY ix_lines_line (company_id, line_id),
  KEY ix_lines_entry (company_id, fiscal_year, trans_id),
  KEY ix_lines_account (company_id, account_key, fiscal_year),
  CONSTRAINT fk_lines_entry FOREIGN KEY (company_id, fiscal_year, trans_id)
    REFERENCES journal_entries (company_id, fiscal_year, trans_id) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS bank_lines (
  company_id     SMALLINT UNSIGNED NOT NULL,
  fiscal_year    SMALLINT UNSIGNED NOT NULL,
  bank_line_id   INT NOT NULL,
  account_key    VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  line_date      DATETIME(3) NULL,
  second_date    DATETIME(3) NULL,
  reference      INT NULL,
  details        VARCHAR(500) NULL,
  direction      ENUM('in','out') NOT NULL,
  amount         DECIMAL(18,2) NULL,
  signed_amount  DECIMAL(18,2) GENERATED ALWAYS AS (IF(direction = 'in', amount, -amount)) STORED COMMENT 'money in is plus',
  running_balance DOUBLE NULL,
  is_matched     TINYINT NULL,
  match_num      BIGINT NULL,
  page_no        INT NULL,
  extra          JSON NOT NULL,
  source_hash    CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  first_run_id   BIGINT UNSIGNED NOT NULL,
  updated_run_id BIGINT UNSIGNED NOT NULL,
  deleted_at     DATETIME(3) NULL,
  PRIMARY KEY (company_id, fiscal_year, bank_line_id),
  KEY ix_bank_line (company_id, bank_line_id),
  KEY ix_bank_date (company_id, account_key, line_date),
  KEY ix_bank_open (company_id, account_key, is_matched),
  KEY ix_bank_match (company_id, match_num)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- side = 'bank': linked_id is bank_lines.bank_line_id. side = 'book': linked_id is journal_lines.line_id.
CREATE TABLE IF NOT EXISTS bank_matches (
  company_id     SMALLINT UNSIGNED NOT NULL,
  fiscal_year    SMALLINT UNSIGNED NOT NULL,
  bank_match_id  INT NOT NULL,
  account_key    VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  match_num      INT NULL,
  side           ENUM('book','bank') NOT NULL,
  linked_id      INT NULL,
  matched_on     DATETIME(3) NULL,
  matched_by     INT NULL,
  extra          JSON NOT NULL,
  source_hash    CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  first_run_id   BIGINT UNSIGNED NOT NULL,
  updated_run_id BIGINT UNSIGNED NOT NULL,
  deleted_at     DATETIME(3) NULL,
  PRIMARY KEY (company_id, fiscal_year, bank_match_id),
  KEY ix_bank_matches_link (company_id, side, linked_id),
  KEY ix_bank_matches_num (company_id, match_num)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Customer and supplier matching. journal_line_id is journal_lines.line_id.
CREATE TABLE IF NOT EXISTS ledger_matches (
  company_id     SMALLINT UNSIGNED NOT NULL,
  fiscal_year    SMALLINT UNSIGNED NOT NULL,
  ledger_match_id INT NOT NULL,
  journal_line_id INT NULL,
  match_num      INT NULL,
  amount         DECIMAL(18,2) NULL,
  currency       VARCHAR(10) NULL,
  is_full_match  TINYINT NULL,
  document_id    INT NULL,
  reference      INT NULL,
  matched_on     DATETIME(3) NULL,
  matched_by     INT NULL,
  extra          JSON NOT NULL,
  source_hash    CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  first_run_id   BIGINT UNSIGNED NOT NULL,
  updated_run_id BIGINT UNSIGNED NOT NULL,
  deleted_at     DATETIME(3) NULL,
  PRIMARY KEY (company_id, fiscal_year, ledger_match_id),
  KEY ix_ledger_line (company_id, journal_line_id),
  KEY ix_ledger_num (company_id, match_num)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS documents (
  company_id     SMALLINT UNSIGNED NOT NULL,
  fiscal_year    SMALLINT UNSIGNED NOT NULL,
  document_id    INT NOT NULL,
  document_type  INT NULL,
  doc_number     INT NULL,
  status         SMALLINT NULL,
  account_key    VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  account_name   VARCHAR(200) NULL,
  value_date     DATETIME(3) NULL,
  due_date       DATETIME(3) NULL,
  total          DOUBLE NULL,
  total_vat_free DOUBLE NULL,
  total_vat      DOUBLE NULL,
  vat_pct        DOUBLE NULL,
  reference      INT NULL,
  cost_code      VARCHAR(40) NULL,
  tax_alloc_number VARCHAR(40) NULL,
  extra          JSON NOT NULL,
  source_hash    CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  first_run_id   BIGINT UNSIGNED NOT NULL,
  updated_run_id BIGINT UNSIGNED NOT NULL,
  deleted_at     DATETIME(3) NULL,
  PRIMARY KEY (company_id, fiscal_year, document_id),
  KEY ix_documents_doc (company_id, document_id),
  KEY ix_documents_number (company_id, document_type, doc_number),
  KEY ix_documents_account (company_id, account_key, value_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS document_lines (
  company_id     SMALLINT UNSIGNED NOT NULL,
  fiscal_year    SMALLINT UNSIGNED NOT NULL,
  document_line_id INT NOT NULL,
  document_id    INT NOT NULL,
  line_num       INT NULL,
  item_key       VARCHAR(60) NULL,
  item_name      VARCHAR(300) NULL,
  quantity       DOUBLE NULL,
  price          DOUBLE NULL,
  total          DOUBLE NULL,
  vat_pct        DOUBLE NULL,
  cost_code      VARCHAR(40) NULL,
  journal_account VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  extra          JSON NOT NULL,
  source_hash    CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  first_run_id   BIGINT UNSIGNED NOT NULL,
  updated_run_id BIGINT UNSIGNED NOT NULL,
  deleted_at     DATETIME(3) NULL,
  PRIMARY KEY (company_id, fiscal_year, document_line_id),
  KEY ix_document_lines_doc (company_id, fiscal_year, document_id),
  CONSTRAINT fk_document_lines_doc FOREIGN KEY (company_id, fiscal_year, document_id)
    REFERENCES documents (company_id, fiscal_year, document_id) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS cheques (
  company_id     SMALLINT UNSIGNED NOT NULL,
  fiscal_year    SMALLINT UNSIGNED NOT NULL,
  cheque_id      INT NOT NULL,
  account_key    VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  payee_name     VARCHAR(200) NULL,
  amount_to_pay  DOUBLE NULL,
  paid           DOUBLE NULL,
  deducted       DOUBLE NULL,
  due_date       DATETIME(3) NULL,
  original_date  DATETIME(3) NULL,
  issue_date     DATETIME(3) NULL,
  status         TINYINT NULL,
  reference      INT NULL,
  bank_key       VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  extra          JSON NOT NULL,
  source_hash    CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  first_run_id   BIGINT UNSIGNED NOT NULL,
  updated_run_id BIGINT UNSIGNED NOT NULL,
  deleted_at     DATETIME(3) NULL,
  PRIMARY KEY (company_id, fiscal_year, cheque_id),
  KEY ix_cheques_cheque (company_id, cheque_id),
  KEY ix_cheques_account (company_id, account_key, due_date),
  KEY ix_cheques_due (company_id, due_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS vat_lines (
  company_id     SMALLINT UNSIGNED NOT NULL,
  fiscal_year    SMALLINT UNSIGNED NOT NULL,
  vat_line_id    INT NOT NULL,
  issue_id       INT NULL,
  trans_id       INT NULL,
  record_type    VARCHAR(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  value_date     DATETIME(3) NULL,
  reference      INT NULL,
  amount         DOUBLE NULL,
  base_amount    DOUBLE NULL,
  account_key    VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  tax_file_num   VARCHAR(40) NULL,
  debit_credit   SMALLINT NULL,
  tax_alloc_number VARCHAR(40) NULL,
  extra          JSON NOT NULL,
  source_hash    CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  first_run_id   BIGINT UNSIGNED NOT NULL,
  updated_run_id BIGINT UNSIGNED NOT NULL,
  deleted_at     DATETIME(3) NULL,
  PRIMARY KEY (company_id, fiscal_year, vat_line_id),
  KEY ix_vat_line (company_id, vat_line_id),
  KEY ix_vat_issue (company_id, issue_id),
  KEY ix_vat_trans (company_id, trans_id),
  KEY ix_vat_date (company_id, value_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
