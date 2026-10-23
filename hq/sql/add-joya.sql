-- Joya Headquarter — the AI headquarters for the Joya restaurant chain (2026-10-12).
--
-- A separate business inside the MA BRAIN app: none of these tables is read by the
-- trading code, and no trading table is read by Joya. Every table starts with `joya_`.
-- Code: hq/src/ (API + logic), hq/client/ (pages),
-- hq/runner/ (the AI runner). Docs: hq/README.md.
--
-- Source data is NOT stored here. Sales, dish sales, employees, clock times, payroll and labor cost
-- are read from the Allegro admin Local Data API on demand (src/services/source.js). Joya keeps only
-- its own records, linked to Allegro ids: a location id is the Allegro branch id, an employee id
-- is Allegro's employeeId, an attendance id is Allegro's raw shift id.
--
-- Five kinds of data are kept apart on purpose:
--   1. source data        in Allegro (above); entered here: joya_menu_items, joya_recipe_lines,
--                         joya_shortages
--   2. recommendations    joya_order_recommendation_lines, joya_staffing_proposal_lines (never edited)
--   3. manager edits      joya_order_edits, joya_staffing_edits, joya_attendance_corrections
--   4. approved decisions joya_order_lists.final_json, joya_staffing_plans.final_json (frozen at approval)
--   5. execution/outcome  joya_order_lists.ordered_json/ordered_at, actual demand and hours (computed from 1.)
--
-- `is_demo = 1` marks demonstration rows (scripts/joya-seed-demo.mjs, for the fake Allegro API of the
-- smoke test). The UI labels them everywhere.
-- Missing values are NULL, never 0: a NULL quantity or diner count means "not known".

-- Locations are NOT stored here: a location id (every `location_id` below, VARCHAR(64)) IS the Allegro
-- branch id. Name, company and the list of branches come from the Allegro API /branches.

-- Users and their rights are NOT stored here: they are the Allegro admin users (repo-root users.json).

CREATE TABLE IF NOT EXISTS joya_audit_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(255) NULL,
  action VARCHAR(60) NOT NULL,                    -- e.g. ORDER_LIST_APPROVED, STAFFING_RULE_UPDATED
  entity VARCHAR(40) NOT NULL,
  entity_id BIGINT NULL,
  location_id VARCHAR(64) NULL,
  detail_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_entity (entity, entity_id),
  INDEX idx_time (created_at)
);

-- Chain-wide settings (key/value). Explicit numbers the logic uses are kept here, visible in the UI.
CREATE TABLE IF NOT EXISTS joya_settings (
  name VARCHAR(80) NOT NULL PRIMARY KEY,
  value_json JSON NOT NULL,
  updated_by VARCHAR(255) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------- imports

CREATE TABLE IF NOT EXISTS joya_import_batches (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  source ENUM('BIKUM_POS','TABIT','PAYROLL','MANUAL','DEMO') NOT NULL,
  kind VARCHAR(30) NOT NULL,                      -- SALES_ITEMS, SALES_CHECKS, MENU, RECIPES, EMPLOYEES, ATTENDANCE, PAYROLL, ORDER_HISTORY
  location_id VARCHAR(64) NULL,
  file_name VARCHAR(255) NULL,
  mapping_json JSON NULL,                         -- { targetField: 'source column' }
  row_count INT NOT NULL DEFAULT 0,
  rejected_count INT NOT NULL DEFAULT 0,
  errors_json JSON NULL,                          -- first rejected rows with the reason
  period_from DATE NULL,
  period_to DATE NULL,
  is_demo TINYINT(1) NOT NULL DEFAULT 0,
  created_by VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_kind (kind, location_id, created_at)
);

-- Saved column mappings, so the next file from the same system maps in one tap.
CREATE TABLE IF NOT EXISTS joya_import_mappings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  source VARCHAR(20) NOT NULL,
  kind VARCHAR(30) NOT NULL,
  mapping_json JSON NOT NULL,
  updated_by VARCHAR(255) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_source_kind (source, kind)
);

-- ---------------------------------------------------------------- menu and ingredients

CREATE TABLE IF NOT EXISTS joya_menu_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  location_id VARCHAR(64) NOT NULL,
  external_code VARCHAR(80) NOT NULL,             -- the POS item code (Bikum); sales match on this, not the name
  name VARCHAR(200) NOT NULL,
  category VARCHAR(100) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  is_demo TINYINT(1) NOT NULL DEFAULT 0,
  import_batch_id BIGINT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_loc_code (location_id, external_code)
);

CREATE TABLE IF NOT EXISTS joya_ingredients (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(80) NULL,                          -- optional stable code; the name is for people
  name VARCHAR(200) NOT NULL,
  unit VARCHAR(30) NULL,                          -- the ordering unit (kg, box, bottle…); NULL = not set
  category VARCHAR(100) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  is_demo TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_code (code),
  INDEX idx_name (name)
);

-- Which ingredients a dish uses. qty is optional: NULL = "the dish uses it, amount unknown".
CREATE TABLE IF NOT EXISTS joya_recipe_lines (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  menu_item_id BIGINT NOT NULL,
  ingredient_id BIGINT NOT NULL,
  qty DECIMAL(12,4) NULL,
  unit VARCHAR(30) NULL,
  is_demo TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY uq_dish_ing (menu_item_id, ingredient_id),
  INDEX idx_ing (ingredient_id)
);

-- ---------------------------------------------------------------- attendance and payroll (data in Allegro)

-- A manager's documented correction of one raw clock row. attendance_id = the Allegro raw shift id
-- (/shifts/raw id); the raw times are copied in as they were, so the correction stays readable even
-- if Allegro later replaces that month (a Tabit re-upload).
CREATE TABLE IF NOT EXISTS joya_attendance_corrections (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  attendance_id BIGINT NOT NULL,
  location_id VARCHAR(64) NULL,
  business_date DATE NULL,
  raw_clock_in DATETIME NULL,
  raw_clock_out DATETIME NULL,
  issue_id BIGINT NULL,
  action ENUM('SET_TIMES','EXCLUDE') NOT NULL,     -- EXCLUDE: e.g. a duplicate row
  clock_in DATETIME NULL,
  clock_out DATETIME NULL,
  note VARCHAR(1000) NOT NULL,
  created_by VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_att (attendance_id, id)
);

CREATE TABLE IF NOT EXISTS joya_payroll_issues (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  fingerprint VARCHAR(160) NOT NULL,              -- kind + rows, so a re-run never duplicates an issue
  period CHAR(7) NOT NULL,
  location_id VARCHAR(64) NOT NULL,
  employee_id BIGINT NULL,                        -- Allegro employeeId
  external_employee_id VARCHAR(80) NULL,          -- employeeId as text, or 'name:<Tabit name>' when unmatched
  kind ENUM('MISSING_CLOCK_OUT','MISSING_CLOCK_IN','DUPLICATE','OVERLAP','UNMATCHED_EMPLOYEE','HOURS_MISMATCH','NO_ATTENDANCE','LONG_SHIFT') NOT NULL,
  detail_json JSON NULL,
  status ENUM('OPEN','CORRECTED','ACCEPTED','DISMISSED') NOT NULL DEFAULT 'OPEN',
  resolution_note VARCHAR(1000) NULL,
  resolved_by VARCHAR(255) NULL,
  resolved_at DATETIME NULL,
  detected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fp (fingerprint),
  INDEX idx_period (period, location_id, status)
);

-- ---------------------------------------------------------------- replenishment

CREATE TABLE IF NOT EXISTS joya_shortages (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  location_id VARCHAR(64) NOT NULL,
  ingredient_id BIGINT NULL,                      -- NULL when typed as free text
  item_text VARCHAR(200) NULL,
  reported_date DATE NOT NULL,
  note VARCHAR(1000) NULL,
  is_demo TINYINT(1) NOT NULL DEFAULT 0,
  reported_by VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_loc_date (location_id, reported_date)
);

-- One ordering list for one location and date.
--   DRAFT    being edited; APPROVED  manager approved (final_json frozen);
--   ORDERED  manager says the order was actually placed (ordered_json); REJECTED  thrown away.
CREATE TABLE IF NOT EXISTS joya_order_lists (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  location_id VARCHAR(64) NOT NULL,
  list_date DATE NOT NULL,
  origin ENUM('RECOMMENDATION','MANUAL','HISTORICAL_IMPORT') NOT NULL,
  status ENUM('DRAFT','APPROVED','ORDERED','REJECTED') NOT NULL DEFAULT 'DRAFT',
  recommender_version VARCHAR(20) NULL,
  params_json JSON NULL,                          -- the settings the recommendation used
  final_json JSON NULL,
  ordered_json JSON NULL,
  note VARCHAR(1000) NULL,
  is_demo TINYINT(1) NOT NULL DEFAULT 0,
  created_by VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_by VARCHAR(255) NULL,
  approved_at DATETIME NULL,
  ordered_by VARCHAR(255) NULL,
  ordered_at DATETIME NULL,
  rejected_by VARCHAR(255) NULL,
  rejected_at DATETIME NULL,
  INDEX idx_loc (location_id, list_date),
  INDEX idx_status (status)
);

-- The recommendation exactly as the system made it. Never updated.
CREATE TABLE IF NOT EXISTS joya_order_recommendation_lines (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  list_id BIGINT NOT NULL,
  ingredient_id BIGINT NOT NULL,
  section ENUM('SUGGESTED','CHECK','NOT_DUE') NOT NULL, -- CHECK = included, quantity left for the manager
  qty DECIMAL(12,3) NULL,                         -- NULL = no supported quantity
  unit VARCHAR(30) NULL,
  method VARCHAR(30) NOT NULL,                    -- SALES_RATIO, HISTORY_MEDIAN, RECIPE_ESTIMATE, NONE
  confidence ENUM('HIGH','MEDIUM','LOW','NONE') NOT NULL,
  basis_json JSON NOT NULL,                       -- every number behind the line
  INDEX idx_list (list_id)
);

-- The working list the manager edits; after approval it is locked.
CREATE TABLE IF NOT EXISTS joya_order_list_lines (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  list_id BIGINT NOT NULL,
  ingredient_id BIGINT NULL,
  item_text VARCHAR(200) NULL,                    -- a free-text item the catalog does not have
  qty DECIMAL(12,3) NULL,
  unit VARCHAR(30) NULL,
  origin ENUM('RECOMMENDED','ADDED') NOT NULL,
  rec_line_id BIGINT NULL,
  removed TINYINT(1) NOT NULL DEFAULT 0,
  note VARCHAR(500) NULL,
  updated_by VARCHAR(255) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_list (list_id)
);

CREATE TABLE IF NOT EXISTS joya_order_edits (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  list_id BIGINT NOT NULL,
  line_id BIGINT NULL,
  action ENUM('ADD','REMOVE','RESTORE','SET_QTY','NOTE','APPROVE','MARK_ORDERED','REJECT','REOPEN') NOT NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  note VARCHAR(1000) NULL,
  via ENUM('UI','CHAT') NOT NULL DEFAULT 'UI',
  username VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_list (list_id, id)
);

-- What the system has learned per location and item, recomputed after every approved or
-- ordered list. A cache with its reasons: the recommendation explains itself from it.
CREATE TABLE IF NOT EXISTS joya_item_patterns (
  location_id VARCHAR(64) NOT NULL,
  ingredient_id BIGINT NOT NULL,
  stats_json JSON NOT NULL,
  examples INT NOT NULL,
  computed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (location_id, ingredient_id)
);

-- ---------------------------------------------------------------- staffing

CREATE TABLE IF NOT EXISTS joya_staff_roles (
  code VARCHAR(40) NOT NULL PRIMARY KEY,          -- cook, checker, barista, bartender, runner, waiter, …
  name_he VARCHAR(80) NOT NULL,
  name_en VARCHAR(80) NOT NULL,
  sort INT NOT NULL DEFAULT 100,
  active TINYINT(1) NOT NULL DEFAULT 1
);

-- Allegro role names (as Tabit / the admin write them: 'מלצר', 'התלמדות מלצר', 'פס חם', …) → a Joya
-- role code. NULL = seen but not mapped yet (the data quality page lists those). Set on the Settings page.
CREATE TABLE IF NOT EXISTS joya_role_aliases (
  alias VARCHAR(80) NOT NULL PRIMARY KEY,
  role_code VARCHAR(40) NULL,
  updated_by VARCHAR(255) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- A shift of a location: which days it runs and its hours (local time).
CREATE TABLE IF NOT EXISTS joya_shift_defs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  location_id VARCHAR(64) NOT NULL,
  code VARCHAR(40) NOT NULL,                      -- morning, evening, …
  name VARCHAR(80) NOT NULL,
  days_json JSON NOT NULL,                        -- [0..6], 0 = Sunday
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,                         -- may be past midnight (end < start)
  active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_loc_code (location_id, code)
);

-- A staffing rule. The most specific active rule of each kind wins
-- (location + shift > location > chain). See hq/src/lib/staffingRules.js.
--   FIXED      exactly params.count               (e.g. 1 checker in the morning)
--   MIN        never fewer than params.count       (a mandatory minimum)
--   MAX        never more than params.count
--   RATIO      ceil(demand / params.per)          demand in `demand_unit`
--   STEPS      params.steps [{ above, count }]: the count of the highest step whose `above` < demand
--   PEAK_EXTRA params.count more staff from params.start to params.end when the peak demand > params.above
CREATE TABLE IF NOT EXISTS joya_staffing_rules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  location_id VARCHAR(64) NULL,                           -- NULL = all locations
  shift_code VARCHAR(40) NULL,                    -- NULL = all shifts
  days_json JSON NULL,                            -- NULL = all days
  role_code VARCHAR(40) NOT NULL,
  rule_type ENUM('FIXED','MIN','MAX','RATIO','STEPS','PEAK_EXTRA') NOT NULL,
  demand_unit ENUM('DINERS_PER_SHIFT','DINERS_PEAK_HOUR','CONCURRENT_DINERS_PEAK','ORDERS_PER_SHIFT','ORDERS_PEAK_HOUR') NULL,
  params_json JSON NOT NULL,
  role_start TIME NULL,                           -- this role starts later/earlier than the shift
  role_end TIME NULL,
  mandatory TINYINT(1) NOT NULL DEFAULT 0,        -- a manager edit can never go below it
  active TINYINT(1) NOT NULL DEFAULT 1,
  note VARCHAR(500) NULL,
  updated_by VARCHAR(255) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_scope (location_id, shift_code, role_code)
);

-- Existing staffing examples (what the restaurant really staffed before this system): a baseline.
CREATE TABLE IF NOT EXISTS joya_staffing_baseline (
  id INT AUTO_INCREMENT PRIMARY KEY,
  location_id VARCHAR(64) NOT NULL,
  shift_code VARCHAR(40) NOT NULL,
  weekday TINYINT NOT NULL,                       -- 0 = Sunday
  role_code VARCHAR(40) NOT NULL,
  headcount INT NOT NULL,
  note VARCHAR(500) NULL,
  updated_by VARCHAR(255) NULL,
  UNIQUE KEY uq_slot (location_id, shift_code, weekday, role_code)
);

CREATE TABLE IF NOT EXISTS joya_staffing_plans (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  location_id VARCHAR(64) NOT NULL,
  week_start DATE NOT NULL,                       -- a Sunday
  status ENUM('DRAFT','APPROVED','REJECTED') NOT NULL DEFAULT 'DRAFT',
  forecast_json JSON NULL,                        -- the demand forecast per day and shift, with its history
  rules_json JSON NULL,                           -- the rules as they were when the proposal was made
  final_json JSON NULL,                           -- frozen at approval
  note VARCHAR(1000) NULL,
  is_demo TINYINT(1) NOT NULL DEFAULT 0,
  created_by VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_by VARCHAR(255) NULL,
  approved_at DATETIME NULL,
  rejected_by VARCHAR(255) NULL,
  rejected_at DATETIME NULL,
  INDEX idx_loc_week (location_id, week_start)
);

-- The proposal exactly as the system made it. Never updated.
CREATE TABLE IF NOT EXISTS joya_staffing_proposal_lines (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  plan_id BIGINT NOT NULL,
  work_date DATE NOT NULL,
  shift_code VARCHAR(40) NOT NULL,
  role_code VARCHAR(40) NOT NULL,
  headcount INT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_peak_extra TINYINT(1) NOT NULL DEFAULT 0,
  min_required INT NOT NULL DEFAULT 0,            -- the mandatory floor for this slot
  explain_json JSON NOT NULL,
  INDEX idx_plan (plan_id)
);

CREATE TABLE IF NOT EXISTS joya_staffing_plan_lines (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  plan_id BIGINT NOT NULL,
  work_date DATE NOT NULL,
  shift_code VARCHAR(40) NOT NULL,
  role_code VARCHAR(40) NOT NULL,
  headcount INT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_peak_extra TINYINT(1) NOT NULL DEFAULT 0,
  min_required INT NOT NULL DEFAULT 0,
  origin ENUM('PROPOSED','ADDED') NOT NULL,
  proposal_line_id BIGINT NULL,
  note VARCHAR(500) NULL,
  updated_by VARCHAR(255) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_plan (plan_id, work_date)
);

CREATE TABLE IF NOT EXISTS joya_staffing_edits (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  plan_id BIGINT NOT NULL,
  line_id BIGINT NULL,
  action ENUM('ADD','SET','REMOVE','APPROVE','REJECT','REOPEN') NOT NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  note VARCHAR(1000) NULL,
  via ENUM('UI','CHAT') NOT NULL DEFAULT 'UI',
  username VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_plan (plan_id, id)
);

-- ---------------------------------------------------------------- tasks, inquiries, AI

CREATE TABLE IF NOT EXISTS joya_tasks (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  location_id VARCHAR(64) NULL,                           -- NULL = chain level
  title VARCHAR(300) NOT NULL,
  description TEXT NULL,
  owner_username VARCHAR(255) NULL,
  due_date DATE NULL,
  status ENUM('OPEN','IN_PROGRESS','DONE','CANCELLED') NOT NULL DEFAULT 'OPEN',
  source_kind VARCHAR(40) NULL,                   -- DATA_QUALITY, PAYROLL_ISSUE, SALES_ANOMALY, INQUIRY, AI, MANUAL
  source_ref VARCHAR(120) NULL,
  is_demo TINYINT(1) NOT NULL DEFAULT 0,
  created_by VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_status (status, due_date)
);

-- Instagram / Google inquiries and reviews. Today: manual entry only (no live connection).
-- Nothing is ever sent from here: "responded" is set by the person who answered on the platform.
CREATE TABLE IF NOT EXISTS joya_inquiries (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  source ENUM('INSTAGRAM','GOOGLE','OTHER') NOT NULL,
  kind ENUM('REVIEW','MESSAGE','COMMENT') NOT NULL,
  location_id VARCHAR(64) NULL,
  author_name VARCHAR(200) NULL,
  content TEXT NOT NULL,
  rating TINYINT NULL,
  received_at DATETIME NULL,
  external_ref VARCHAR(255) NULL,
  status ENUM('NEW','IN_PROGRESS','DRAFT_READY','RESPONDED','CLOSED') NOT NULL DEFAULT 'NEW',
  owner_username VARCHAR(255) NULL,
  draft_response TEXT NULL,
  draft_by VARCHAR(255) NULL,                     -- a username, or 'AI'
  response_approved_by VARCHAR(255) NULL,
  response_approved_at DATETIME NULL,
  responded_by VARCHAR(255) NULL,
  responded_at DATETIME NULL,
  entered_via ENUM('MANUAL','IMPORT','INTEGRATION') NOT NULL DEFAULT 'MANUAL',
  is_demo TINYINT(1) NOT NULL DEFAULT 0,
  created_by VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_status (status, location_id)
);

-- A question or a request in words. The AI runner (hq/runner) picks THINKING rows up.
-- Numbers in the answer come only from `calcs_json`, computed by the hub, never by the model.
CREATE TABLE IF NOT EXISTS joya_ai_requests (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(255) NOT NULL,
  location_id VARCHAR(64) NULL,
  context_kind ENUM('GENERAL','ORDER_LIST','STAFFING_PLAN','INQUIRY','AREA') NOT NULL DEFAULT 'GENERAL',
  context_id BIGINT NULL,                         -- AREA: 1 stock and purchasing, 2 manpower, 3 performance
  question TEXT NOT NULL,
  status ENUM('THINKING','ANSWERED','FAILED') NOT NULL DEFAULT 'THINKING',
  calcs_json JSON NULL,                           -- [{ calc, params, result, period, source }]
  answer_text MEDIUMTEXT NULL,
  proposal_json JSON NULL,                        -- validated changes, shown before saving
  proposal_status ENUM('PENDING','APPLIED','DISCARDED') NULL,
  error TEXT NULL,
  lang VARCHAR(5) NOT NULL DEFAULT 'he',
  meta_json JSON NULL,                            -- { model, durationMs, unverifiedNumbers: [] }
  claimed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  answered_at DATETIME NULL,
  INDEX idx_pending (status, created_at),
  INDEX idx_ctx (context_kind, context_id)
);

-- Default roles (names in Hebrew and English). The admin can add more in the app.
INSERT IGNORE INTO joya_staff_roles (code, name_he, name_en, sort) VALUES
  ('cook', 'טבח', 'Cook', 10),
  ('checker', 'צ׳קר', 'Checker', 20),
  ('barista', 'בריסטה', 'Barista', 30),
  ('bartender', 'ברמן', 'Bartender', 40),
  ('runner', 'ראנר', 'Runner', 50),
  ('waiter', 'מלצר', 'Waiter', 60);

-- The Allegro role names that are clearly one of the default roles. Everything else is mapped by the admin.
INSERT IGNORE INTO joya_role_aliases (alias, role_code, updated_by) VALUES
  ('מלצר', 'waiter', 'setup'), ('ראנר', 'runner', 'setup'), ('בר', 'bartender', 'setup'), ('ברמן', 'bartender', 'setup'),
  ('בריסטה', 'barista', 'setup'), ('צ''קר', 'checker', 'setup'), ('צ׳קר', 'checker', 'setup'), ('טבח', 'cook', 'setup');

-- Default settings. Every number is visible and editable on the Settings page.
INSERT IGNORE INTO joya_settings (name, value_json) VALUES
  ('replenishment', '{"historyLists": 8, "halfLifeLists": 4, "minExamplesForQty": 2, "minExamplesForRatio": 3, "dueFraction": 0.8, "shortageBumpPct": 15, "removedSuppressShare": 0.75, "approvedOnlyWeight": 0.5}'),
  ('staffing', '{"historyWeeks": 8, "minDaysForForecast": 3, "learnedAdjustMinPlans": 3, "learnedAdjustWindow": 4}'),
  ('labor', '{"employerCostFactorEstimate": 1.25}'),
  ('dataQuality', '{"staleDays": 3, "longShiftHours": 14}');
