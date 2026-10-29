# CLAUDE.md — allegrogruppo.com

The Allegro group's web systems. One repo, one root `package.json` (except `hq/`), several separate services:

| Service | Folder | Port | Production |
|---|---|---|---|
| Order system (customer ordering sites) | `order_sys/` | 3020 | allegrogruppo.com |
| Admin (payroll, Beecomm, uploads, Local Data API) | `admin/` | 3021 | https://admin.allegrogruppo.com — `allegro-admin.service` |
| Events pages (SSR, read-only) | `events/` | 3023 | events.allegrogruppo.com |
| **Joya HQ** (the restaurants' AI headquarters) | `hq/` (own `package.json`, AI runner `hq/runner/`) | 4300 | https://hq.allegrogruppo.com — `joya-hq.service` + `joya-runner.service` |

Read the service's own docs first: `README.md` (repo), `local_api_readme.md` (the admin's Local Data API),
`events/README.md`, `hq/CLAUDE.md` + `hq/README.md`.

## Language rules (always follow)

The owner is a Hebrew speaker. In every response and document: clear, simple English (CEFR B1), common words, no
jargon or idioms; never change facts, dates, names, numbers or obligations; explain a needed technical term the
first time it appears.

## Rules

- JavaScript only, ES modules, JSX inside `.js` files (Vite + esbuild). No TypeScript, no Babel.
- **The root `.env` points at the PRODUCTION MySQL** (`allegro` DB on DigitalOcean). Any write to it is a production
  change — ask the owner first. Joya HQ develops against a local MySQL through `hq/.env.local`.
- Users and their rights live only in the root **`users.json`** (JSON files, not the DB — owner's decision).
- Admin client changes go live only after the root `npm run build` (→ `dist/`); the server serves the prebuilt files.
- Payroll calculation changes must stay in sync between the UI (`admin/client/pages/Shifts.js`) and the export path
  (`payroll.js`, `tlush.js`, the Micpal/Shiklulit import files). Ask before implementing such a change.
- Do not strip Tabit's " - role" suffix from stored employee names blindly.
- The Local Data API (`/local-api/v1`) is loopback-only. Never add a reverse-proxy route to it.
- Commits: conventional (`feat(scope): …`, `fix(scope): …`). Commit only the files of your task — other work may be
  uncommitted in the same working copy.

## Production server

Droplet `ssh root@157.245.241.116`, repo `/root/dvlp/allegrogruppo.com`, branch `main` (pull with
`git pull --ff-only origin main`). Node 18.19. nginx + certbot. DNS is at Namecheap (the owner adds records).
The same droplet also runs the owner's tradewit services — leave those alone. Back up `dist/` before a root build
(`/root/allegro-dist-backup-*`).

## Status (2026-10-24)

- `main` = `747f140`, deployed. It brought to production: the Upload files page, the Local Data API and a Beecomm
  fix (were on `feat/local-api`), and Joya HQ (`hq/`, moved here from the tradewit repo that day).
- **Open — production tables** (owner's permission needed; all `CREATE TABLE IF NOT EXISTS` / `INSERT IGNORE`):
  `scripts/utils/create_bcom_orders_table.sql` (only tables that do not exist yet), `hq/sql/add-joya.sql`. Until
  then Joya HQ login fails. (`file_uploads`, `tabit_shifts`, `bank_transactions` exist on prod — checked 2026-10-26.)
- **Open — admin work in progress, uncommitted** in the working copy: `GET /shifts/by-shift` (people and clock
  hours per date × shift × role from `tabit_shifts`; spec from the Joya side), and payroll edits in `Shifts.js`,
  `payroll.js`, `tlush.js`. Joya HQ already reads `/shifts/by-shift` (it says "not available yet" until it exists).
- **Tabit detailed reports come from the Tabit Shift API** (`admin/server/uploads/tabitShift.js`, the web app's
  internal calls — can change): daily 06:30 in the admin where `TABIT_SHIFT_AUTO=1` (server only), login
  `TABIT_SHIFT_*` in `.env`, branch → Tabit apps in `shared/restaurants.json` `tabit_shift` (Raanana = kitchen +
  floor, merged). By hand: `node scripts/tabit_shift_fetch.js --month YYYY-MM [--apply]` (dry run without
  `--apply`). Jul–Oct 2026 imported 2026-10-24. The Upload page still takes the Excel file.
  The same job saves the full report JSON in `tabit_shift_reports` (`tabit_shifts` has only clock pairs; table
  created on prod and filled Jul–Oct 2026 on 2026-10-24). **Shifts page, step 1**: the month dropdown lists the
  saved payroll months and the Tabit months. A saved month opens its payroll (step 4); a Tabit-only month becomes a
  new payroll (`/payroll/extract-tabit`, same calculation as the Excel: `extractEmployeesFromTabitReports` in
  `payroll-summary/payroll_summary.js`) → step 3. "Update from Tabit" (step 4) reads the month from Tabit again
  (`refresh`) and keeps the saved מפרעה (`keepSaved`; one person = the saved rows with one ID number). "New payroll
  from Excel files…" still goes to the step 2 upload. Test: `node scripts/test_payroll_tabit.js`.
- **Tabit Shift employee list** (2026-10-29): the same 06:30 job also reads `/api/employees/` of each Tabit app
  (`syncTabitShiftEmployees` in `payroll.js`) = the Shift loader without the Excel file: only ACTIVE people (the API
  also returns everyone who left, and Tabit reuses their clock ids); new → `shift_employees`, changed name → update,
  a CONFLICT is not applied (it waits for the Shift loader) and is logged; then the phones → `employees.phone`.
  By hand: `node scripts/tabit_shift_fetch.js --employees [--apply]`.
- **Tabit Shift work plan** (סידור עבודה, the Rota page; 2026-10-29) → `tabit_rota` (one row per slot: date × shift ×
  role × employee, planned times, published; open slots have no employee; no usernames/phones). API: `/api/rotas/?date=
  <Sunday>` → `/api/cells/?rota__in=…` + `/api/shifts/`, `/api/roles/`; same login. A fetch replaces that week of the
  branch. By hand only (not in the daily job yet): `node scripts/tabit_rota_fetch.js [--week YYYY-MM-DD] [--apply]`.
  Table created on prod 2026-10-29 (`scripts/utils/create_tabit_rota_table.sql`); week 2026-10-25 loaded.
- **Bank Hapoalim files** ("תנועות בחשבון", e.g. `excelNewTransactions.xlsx`) → Upload page → `bank_transactions`
  (admin only). A row is stored once: `row_key` = the row's fields without the running balance + its number among
  equal rows in the file; `UNIQUE` + `INSERT IGNORE`. Test: `node scripts/test_bank_hapoalim.js`.
- **Open — security problems in the admin login** (reported, not fixed): plaintext passwords in `users.json`, which
  is tracked in git; `POST /auth/login` and `GET /auth/login` return the password and authKey; `POST /auth/register`
  writes `users.json` without a login; the cookie key and a static IV are hardcoded; `getUserKey` logs the key.
  Fix at least `/auth/register` and the password leak before sharing hq.allegrogruppo.com with managers.
