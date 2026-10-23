# CLAUDE.md — hq/ (Joya HQ)

Joya HQ: the AI headquarters of the Allegro group's restaurants, https://hq.allegrogruppo.com (planned). A separate
service in the Allegro repo (port 4300, own `package.json`, own phone app), next to `admin/`, `order_sys/`, `events/`.
The AI runner is `runner/`. Moved here from the tradewit repo on 2026-10-24.

Read `README.md` first — layout, data model, learning rules, permissions, deploy.

Rules for this folder:
- **Never develop or test against the production DB.** The repo-root `.env` points at the production `allegro`
  DB; `hq/.env.local` must point `DB_*` at a local MySQL. The smoke test and the eval-context script refuse
  any other host.
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
  Allegro `/branches`, "active" from `/status` (Beecomm orders in the last 60 days). Top bar: company → restaurant;
  demo restaurants in the "חברת דמו" company (from the fake API); inactive (closed) branches hidden from the picker.
  The local DB was moved with `sql/joya-locations-from-allegro.sql` (2026-10-24).
- Main menu = three chat areas: מלאי ורכש (`/stock`), כח אדם (`/people`), ביצועים (`/performance`)
  (`client/pages/Area.js`, chat context `AREA` 1/2/3, suggestions while typing). Other pages keep their routes but
  are not in the menu. Settings is at the bottom for a chain admin.
- Manpower forecast (`src/lib/shiftModel.js`, calcs `shift_profile` + `staffing_forecast_week`): average diners and
  deliveries per weekday × shift over 13 weeks (morning < 17:00 ≤ evening), per-role "diners per person" learned
  from the branch's own shifts (owner: learn the numbers, do not use fixed ones), kitchen roles count 1 delivery as
  1 diner, round to the nearest. Staff per shift comes from the admin's `/shifts/by-shift` (not built yet).
- Users: only the admin's `users.json` (admin → chain admin, restMngr → its `restaurants`; payroll for both).
- Planner eval 37/37 (`joya-hq-1+9638d0b5`). Unit 25, runner 8, smoke 69 + 1 known failure ("the raised quantity
  moves the next recommendation" — a weighted median of 8 lists cannot move on one raised list; test/design
  mismatch, not a bug).

Open, in order:
1. **Production tables**: `hq/sql/add-joya.sql` on the `allegro` DB (with the admin's new tables, see the root
   `CLAUDE.md`). Ask the owner first; only `CREATE TABLE IF NOT EXISTS` / `INSERT IGNORE`. Then log in at
   https://hq.allegrogruppo.com with an admin e-mail and check `/api/joya/me`.
2. **`/shifts/by-shift` in the admin** (in progress, uncommitted) + **Tabit uploads** → then check Raanana's real
   forecast in the כח אדם chat ("כמה עובדים צריך בכל משמרת בשבוע הבא?").
3. Next manpower tasks with the owner (the chat is the main interface; prefer prompt fixes in
   `runner/hq-analyst.js` over new pages; run `npm run eval` after each prompt change).
4. The admin login security problems (root `CLAUDE.md`) before managers get the link.

Local development: MySQL schema `joya` on 127.0.0.1 (settings in `hq/.env.local`), the Allegro admin on :3021
(`npm run adminDev` at the root — it uses the PRODUCTION DB from the root `.env`, like always), Joya HQ
`npm start` / `npm run dev`, AI runner `npm run runner`. The runner must run or chat questions fail after 6 minutes.
Stop a process by its PID: `pkill -f "node server.js"` also matches your own shell.
