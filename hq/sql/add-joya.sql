-- Joya Headquarter — the AI headquarters of the Allegro group's restaurants. Every table starts with `joya_`.
-- Code: hq/src/ (API + logic), hq/client/ (pages), hq/runner/ (the AI runner). Docs: hq/README.md.
--
-- Source data is NOT stored here. Sales, dish sales, employees, clock times, payroll and labor cost are read
-- from the Allegro admin Local Data API on demand (src/services/source.js). Locations are the Allegro
-- branches (a `location_id` IS the Allegro branch id); users are the Allegro admin users (repo-root users.json).
--
-- A real column only where we query on it (status, location, date, an id we look up); everything that is
-- only read and written whole — config lists, the lines of a plan or list, their edit history — is JSON.
--
-- Five kinds of data are kept apart on purpose:
--   1. source data        in Allegro; entered here: joya_ingredients, joya_menu_items.recipe_json, joya_shortages
--   2. recommendations    proposal_json / recommendation_json (never changed after they are made)
--   3. manager edits      lines_json (the working copy) + edits_json (every change), joya_attendance_corrections
--   4. approved decisions final_json (frozen at approval)
--   5. execution/outcome  joya_order_lists.ordered_json, actual demand and hours (computed from 1.)
--
-- `is_demo = 1` marks demonstration rows (scripts/joya-seed-demo.mjs, for the fake Allegro API of the smoke test).
-- Missing values are NULL, never 0: a NULL quantity means "not known".

CREATE TABLE IF NOT EXISTS joya_audit_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(255) NULL,
  action VARCHAR(60) NOT NULL,                    -- e.g. ORDER_LIST_APPROVED, STAFFING_RULE_SAVED
  entity VARCHAR(40) NOT NULL,
  entity_id BIGINT NULL,
  location_id VARCHAR(64) NULL,
  detail_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_entity (entity, entity_id),
  INDEX idx_time (created_at)
);

-- Settings and config, one JSON document per name (src/db.js getConfig / saveConfig):
--   replenishment, staffing, labor, dataQuality   the numbers the logic uses (Settings page)
--   roles            [{ code, nameHe, nameEn, sort, active }]
--   roleAliases      { "<Allegro role name>": "<role code>" | null }   (null = seen, not mapped yet)
--   staffingRules    [{ id, locationId|null, shiftCode|null, days|null, roleCode, type, unit, params,
--                       roleStart, roleEnd, mandatory, active, note, updatedBy, updatedAt }]
--   location:<id>    { shifts: [{ code, name, days, start, end, active }],
--                      baseline: [{ shiftCode, weekday, roleCode, headcount, note }] }
CREATE TABLE IF NOT EXISTS joya_settings (
  name VARCHAR(80) NOT NULL PRIMARY KEY,
  value_json JSON NOT NULL,
  updated_by VARCHAR(255) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------- menu and ingredients

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

-- A dish, matched to sales by the POS (Beecomm) dish code. recipe_json: [{ ingredientId, qty, unit }],
-- qty NULL = "the dish uses it, amount unknown".
CREATE TABLE IF NOT EXISTS joya_menu_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  location_id VARCHAR(64) NOT NULL,
  external_code VARCHAR(80) NOT NULL,
  name VARCHAR(200) NOT NULL,
  category VARCHAR(100) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  recipe_json JSON NULL,
  is_demo TINYINT(1) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_loc_code (location_id, external_code)
);

-- ---------------------------------------------------------------- attendance and payroll (data in Allegro)

-- A manager's documented correction of one raw clock row. attendance_id = the Allegro raw shift id
-- (/shifts/raw id); the raw times are copied in, so the correction stays readable after a Tabit re-upload.
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
-- recommendation_json  [{ id, ingredientId, section, qty, unit, method, confidence, basis }]  never changed
-- lines_json           [{ id, ingredientId|null, itemText|null, qty, unit, origin, recLineId, removed, note, updatedBy }]
-- edits_json           [{ id, lineId, action, before, after, note, via, by, at }]
CREATE TABLE IF NOT EXISTS joya_order_lists (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  location_id VARCHAR(64) NOT NULL,
  list_date DATE NOT NULL,
  origin ENUM('RECOMMENDATION','MANUAL') NOT NULL,
  status ENUM('DRAFT','APPROVED','ORDERED','REJECTED') NOT NULL DEFAULT 'DRAFT',
  params_json JSON NULL,                          -- the settings and recommender version the recommendation used
  recommendation_json JSON NULL,
  lines_json JSON NULL,
  edits_json JSON NULL,
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

-- ---------------------------------------------------------------- staffing

-- One weekly staffing plan of a location (week_start = a Sunday).
-- proposal_json  [{ id, date, shiftCode, roleCode, headcount, start, end, isPeakExtra, minRequired, explain }]  never changed
-- lines_json     [{ id, date, shiftCode, roleCode, headcount, start, end, isPeakExtra, minRequired, origin, proposalLineId, note, updatedBy }]
-- edits_json     [{ id, lineId, action, before, after, note, via, by, at }]
CREATE TABLE IF NOT EXISTS joya_staffing_plans (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  location_id VARCHAR(64) NOT NULL,
  week_start DATE NOT NULL,
  status ENUM('DRAFT','APPROVED','REJECTED') NOT NULL DEFAULT 'DRAFT',
  forecast_json JSON NULL,                        -- the demand forecast per day and shift, with its history
  rules_json JSON NULL,                           -- the rules as they were when the proposal was made
  proposal_json JSON NULL,
  lines_json JSON NULL,
  edits_json JSON NULL,
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

-- ---------------------------------------------------------------- AI

-- A question or a request in words. The AI runner (hq/runner) picks THINKING rows up.
-- Numbers in the answer come only from `calcs_json`, computed by the hub, never by the model.
CREATE TABLE IF NOT EXISTS joya_ai_requests (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(255) NOT NULL,
  location_id VARCHAR(64) NULL,
  context_kind ENUM('GENERAL','ORDER_LIST','STAFFING_PLAN','AREA') NOT NULL DEFAULT 'GENERAL',
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

-- ---------------------------------------------------------------- defaults (INSERT IGNORE: never overwrite)

-- Every number is visible and editable on the Settings page.
INSERT IGNORE INTO joya_settings (name, value_json, updated_by) VALUES
  ('replenishment', '{"historyLists": 8, "halfLifeLists": 4, "minExamplesForQty": 2, "minExamplesForRatio": 3, "dueFraction": 0.8, "shortageBumpPct": 15, "removedSuppressShare": 0.75, "approvedOnlyWeight": 0.5}', 'setup'),
  ('staffing', '{"historyWeeks": 8, "minDaysForForecast": 3, "learnedAdjustMinPlans": 3, "learnedAdjustWindow": 4}', 'setup'),
  ('labor', '{"employerCostFactorEstimate": 1.25}', 'setup'),
  ('dataQuality', '{"staleDays": 3, "longShiftHours": 14}', 'setup'),
  -- Default roles; the admin can add more in the app.
  ('roles', '[{"code": "cook", "nameHe": "טבח", "nameEn": "Cook", "sort": 10, "active": true},
              {"code": "checker", "nameHe": "צ׳קר", "nameEn": "Checker", "sort": 20, "active": true},
              {"code": "barista", "nameHe": "בריסטה", "nameEn": "Barista", "sort": 30, "active": true},
              {"code": "bartender", "nameHe": "ברמן", "nameEn": "Bartender", "sort": 40, "active": true},
              {"code": "runner", "nameHe": "ראנר", "nameEn": "Runner", "sort": 50, "active": true},
              {"code": "waiter", "nameHe": "מלצר", "nameEn": "Waiter", "sort": 60, "active": true}]', 'setup'),
  -- The Allegro role names that are clearly one of the default roles. Everything else is mapped by the admin.
  ('roleAliases', '{"מלצר": "waiter", "ראנר": "runner", "בר": "bartender", "ברמן": "bartender", "בריסטה": "barista", "צ''קר": "checker", "צ׳קר": "checker", "טבח": "cook"}', 'setup'),
  ('staffingRules', '[]', 'setup');
