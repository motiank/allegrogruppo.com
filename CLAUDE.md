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
  `scripts/utils/create_file_upload_tables.sql`, `scripts/utils/create_bcom_orders_table.sql` (only tables that do
  not exist yet), `hq/sql/add-joya.sql`. Until then the Upload page fails and Joya HQ login fails on production.
- **Open — admin work in progress, uncommitted** in the working copy: `GET /shifts/by-shift` (people and clock
  hours per date × shift × role from `tabit_shifts`; spec from the Joya side), and payroll edits in `Shifts.js`,
  `payroll.js`, `tlush.js`. Joya HQ already reads `/shifts/by-shift` (it says "not available yet" until it exists).
- **Tabit detailed reports come from the Tabit Shift API** (`admin/server/uploads/tabitShift.js`, the web app's
  internal calls — can change): daily 06:30 in the admin where `TABIT_SHIFT_AUTO=1` (server only), login
  `TABIT_SHIFT_*` in `.env`, branch → Tabit apps in `shared/restaurants.json` `tabit_shift` (Raanana = kitchen +
  floor, merged). By hand: `node scripts/tabit_shift_fetch.js --month YYYY-MM [--apply]` (dry run without
  `--apply`). Sep + Oct 2026 imported 2026-10-24. The Upload page still takes the Excel file.
- **Open — security problems in the admin login** (reported, not fixed): plaintext passwords in `users.json`, which
  is tracked in git; `POST /auth/login` and `GET /auth/login` return the password and authKey; `POST /auth/register`
  writes `users.json` without a login; the cookie key and a static IV are hardcoded; `getUserKey` logs the key.
  Fix at least `/auth/register` and the password leak before sharing hq.allegrogruppo.com with managers.
