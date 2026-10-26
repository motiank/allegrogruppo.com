# CLAUDE.md — hq/ (Joya HQ)

Joya HQ: the AI headquarters of the Allegro group's restaurants, https://hq.allegrogruppo.com (planned). A separate
service in the Allegro repo (port 4300, own `package.json`, own phone app), next to `admin/`, `order_sys/`, `events/`.
The AI runner is `runner/`. Moved here from the tradewit repo on 2026-10-24.

Read `README.md` first — layout, data model, learning rules, permissions, deploy.

Rules for this folder:
- **Development uses the production DB** (owner 2026-10-24: "work on the production db always — even our dev
  environment"). The DB comes from the repo-root `.env` (production `allegro`), like every Allegro service;
  `hq/.env.local` doesn't override `DB_*`. Writes from dev are real: test with real data carefully. The smoke
  test, the eval-context script and the demo seed write fake rows, so they still refuse a non-local `DB_HOST`
  (run them only with a local MySQL set in the shell).
- **Users and their rights live only in the admin's JSON file** (repo-root `users.json`; owner 2026-10-24: users in
  JSON files, not the DB). Joya only reads it, never writes it, keeps no users table or file of its own, and checks
  passwords with the admin's `userApi.getUserKey`. Never copy the hashing code here.
- **No source data is stored here.** Sales, dish sales, employees, clock times and payroll come from the admin
  Local Data API through `src/services/source.js` only (never a new `joya_*` copy). Joya's tables hold only
  Joya's own records, linked to Allegro ids. A missing API is asked from the admin (`../local_api_readme.md`).
- Do not change admin code from here (`admin/` has its own uncommitted work); ask the owner, or write a prompt for
  the admin session.
- Keep the five kinds of data apart (source, recommendation, manager edit, approved decision, execution).
- Every string in both `client/i18n/*.he.js` and `*.en.js` (same keys). Hebrew is the default; RTL; phone first,
  boxes not tables. The main menu has three chat areas (stock and purchasing, manpower, performance).
- Numbers the AI shows come from `src/services/ai.js` calculations, never from the model. After a prompt change
  (`runner/hq-analyst.js`) run `npm run eval`. Model calls go through `claude -p` (subscription), never an API key.
- SQL: single-quoted strings (ANSI_QUOTES-safe). Logger: pino (`lib/log.js`).
- Tests: `npm test`, `npm run test:runner`; smoke test against a LOCAL DB with `scripts/fake-allegro.mjs` as the
  API (README → Tests). Commit only `hq/` files (and what the owner asks), conventional commits.

## Status (2026-10-24) — read before continuing

Built (all committed, `main` 747f140, deployed to the droplet — services `joya-hq` (:4300, User=twit, secrets in
`hq/.env`) and `joya-runner` (root, needs the logged-in `claude` CLI), nginx site + TLS for hq.allegrogruppo.com,
`/api/joya/ai/runner/` blocked from the internet):
- All source data from the admin Local Data API (`src/services/source.js`, 5-min memory cache). Menu and
  reservations from the API are postponed (owner).
- Locations: no Joya table — a location id IS the Allegro branch id; branches, names and companies come from
  Allegro `/branches`, "active" from `/status` (Beecomm orders in the last 60 days). Top bar: one picker (company, its restaurants indented; a question uses the choice, `request.scope`);
  demo restaurants in the "חברת דמו" company (from the fake API); inactive (closed) branches hidden from the picker.
- **Schema simplified (2026-10-24, owner): 27 → 10 tables.** In this phase: manpower plans, stock & purchasing,
  payroll checks. Tasks, inquiries and CSV imports were dropped. Config lists (roles, role aliases, staffing rules,
  per-location shifts + baseline) are JSON documents in `joya_settings`; a plan's / list's proposal, lines and edits
  are JSON columns on its row; recipes are `joya_menu_items.recipe_json`; learned patterns are computed when asked.
  Rule: a real column only where we query on it. README → "Tables".
- Main menu = three chat areas: מלאי ורכש (`/stock`), כח אדם (`/people`), ביצועים (`/performance`)
  (`client/pages/Area.js`, chat context `AREA` 1/2/3, suggestions while typing). Other pages keep their routes but
  are not in the menu. Settings is at the bottom for a chain admin.
- Manpower forecast (`src/lib/shiftModel.js`, calcs `shift_profile` + `staffing_forecast_week`): diners and
  deliveries per weekday × shift over 8 weeks (EMA, span 4 — owner 2026-10-24) (morning < 17:00 ≤ evening), per-role "diners per person" learned
  from the branch's own shifts (owner: learn the numbers, do not use fixed ones), kitchen roles count 1 delivery as
  1 diner, round to the nearest. Staff per shift comes from the admin's `/shifts/by-shift` (Tabit clock times, read
  daily from the Tabit Shift API since 2026-10-24; Jul–Oct 2026 loaded). Ratios per weekday when learned; rare
  roles (< minPresence) are not forecast; trainees count as staff (owner).
- Past shifts (calc `staffing_actual`, 2026-10-26): diners per person per role and shift from the Tabit clock times,
  and people vs "needed" by the branch's learned ratio (over / under-staffed shifts). Owner: use the Tabit shift data
  wherever it helps (forecast, waiters per diners…). Labor hours (`labor_summary`) already come from Tabit `/shifts/raw`.
- Payments (calc `payments_summary`, 2026-10-26): the Beecomm payments report (דוח תשלומים) per type and card brand,
  from the admin's `/beecomm/payments/stored` (table `bcom_payments_daily`, created on production 2026-10-26,
  backfilled from 2026-01-01, daily job `scripts/server/analoader/bcom_payments.js`). Days not loaded are missing, not 0.
  `brands` (VISA/MASTERCARD/AMEX/DINERS) = the owner's weekly credit card forecast: the previous Sunday–Saturday week.
- Bank (main-menu area BANK = context AREA 4, calcs `bank_summary` / `bank_transactions`, `src/services/bank.js`,
  2026-10-26): **chain admin only** (menu, route and calcs). Data = the bank files uploaded on the admin Upload page
  (`bank_transactions`), read from `/bank/transactions/stored`. An account belongs to a **company**
  (`shared/restaurants.json` `bank_accounts`; owner: Hapoalim 12-584-136663 = פסטה לינה). Some Hebrew in `details`
  is stored in reverse letter order by the bank file (the WRITE prompt reads it the right way).
- **Data map** (README → "Data map"): table → admin endpoint → AI calc. Card / Wolt income has two sources and the
  question's words decide (owner, 2026-10-26): sold at the register = Beecomm payments (`payments_summary`); received
  in the account = the bank. The menu area sets the default: PERFORMANCE → Beecomm, BANK → the bank (explicit words
  override); no area and unclear, or a comparison → both, given apart. Rules: PLAN prompt "Which source".
- **Weeks run Sunday–Saturday, always** (owner, 2026-10-27). "Last week" = the previous Sunday–Saturday week, "this
  week" = Sunday up to today; only "the last 7 days" is rolling (PLAN prompt, Dates). Code uses `getUTCDay() === 0`.
- Beecomm "credit card" = VISA + MASTERCARD + AMEX + DINERS only; every other brand of the credit type = "members club"
  (owner, 2026-10-26). `payments_summary` returns `creditCards` / `membersClub` (+ `…Total`); never call the whole
  אשראי type "credit card".
- Employees and wages (calc `employees`, 2026-10-26): names, location, roles, wage type, wage and the hourly rate per
  role (same chain as the admin Shifts page: role wage → employee wage → legacy `hourly_wage`; `hourly_min_*` / -1 = the
  minimum wage, `MIN_HOURLY_WAGE` or 35.4), read live from the admin's `/employees`. Users with payroll access only
  (admin and restMngr, their own locations). No national ids or phones.
- Users: only the admin's `users.json` (admin → chain admin, restMngr → its `restaurants`; payroll for both).
- Planner eval 37/37 (`joya-hq-1+9638d0b5`; 3 of its cases are INQUIRY, a context that no longer exists — remove
  them with the prompt's `draft` field at the next prompt change). Unit 25, runner 8, smoke 63 + 1 known failure ("the raised quantity
  moves the next recommendation" — a weighted median of 8 lists cannot move on one raised list; test/design
  mismatch, not a bug).

Open, in order:
1. **Production tables**: `hq/sql/add-joya.sql` (the simplified 10 tables) on the `allegro` DB. Ask the owner
   first; only `CREATE TABLE IF NOT EXISTS` / `INSERT IGNORE`. Then log in at
   https://hq.allegrogruppo.com with an admin e-mail and check `/api/joya/me`.
2. **Manpower forecast on real data** (by-shift wired; Tabit clock data Jul–Oct 2026 loaded; diners = EMA span 4
   over 8 weeks). Check the answers with the owner — some shifts are still 2–5 above the usual headcount.
3. Next manpower tasks with the owner (the chat is the main interface; prefer prompt fixes in
   `runner/hq-analyst.js` over new pages; run `npm run eval` after each prompt change).
4. The admin login security problems (root `CLAUDE.md`) before managers get the link.

Local development: the PRODUCTION DB from the root `.env` (like the admin), the Allegro admin on :3021
(`npm run adminDev` at the root), Joya HQ
`npm start` / `npm run dev`, AI runner `npm run runner`. The runner must run or chat questions fail after 6 minutes.
Stop a process by its PID: `pkill -f "node server.js"` also matches your own shell.
