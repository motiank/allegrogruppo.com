-- Tabit Shift work plan (סידור עבודה, the Rota page): one row per slot of a week's plan (date × shift × role ×
-- employee). Filled by admin/server/modules/files.js fetchTabitRota (scripts/tabit_rota_fetch.js); a fetch of a
-- week replaces that week of the branch. An open slot (no one placed yet) has employee_* NULL.
-- No usernames or phones (Tabit's username is often the phone).
CREATE TABLE IF NOT EXISTS tabit_rota (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  rest             VARCHAR(32)  NOT NULL,           -- branch id (shared/restaurants.json)
  week_start       DATE         NOT NULL,           -- the Sunday of the week
  app_id           INT          NOT NULL,           -- Tabit app (Raanana: kitchen 4212 + floor 1198)
  rota_id          BIGINT       NOT NULL,
  published        TINYINT(1)   NOT NULL DEFAULT 0, -- the plan is published to the staff
  cell_id          BIGINT       NOT NULL,           -- Tabit's id of the slot
  work_date        DATE         NOT NULL,
  shift_name       VARCHAR(64)  NULL,               -- בוקר / ערב …
  role_name        VARCHAR(64)  NULL,
  slot_order       INT          NULL,               -- the row of the slot in its shift and role
  employee_name    VARCHAR(128) NULL,               -- first + last name as in Tabit (the clock report name)
  tabit_employee_id BIGINT      NULL,
  clock_id         VARCHAR(32)  NULL,
  planned_start    DATETIME     NULL,               -- restaurant time
  planned_end      DATETIME     NULL,
  manual_start     DATETIME     NULL,               -- a time set by hand on the slot
  manual_end       DATETIME     NULL,
  notes            VARCHAR(255) NULL,
  fetched_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_app_cell (app_id, cell_id),
  KEY idx_rest_week (rest, week_start),
  KEY idx_rest_date (rest, work_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
