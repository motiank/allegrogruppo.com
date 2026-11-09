# CLAUDE.md — allegrogruppo.com

The Allegro group's web systems. One repo, one root `package.json` (except `hq/` and `hash-sync/`), several separate services:

| Service | Folder | Port | Production |
|---|---|---|---|
| Order system (customer ordering sites) | `order_sys/` | 3020 | allegrogruppo.com |
| Admin (payroll, Beecomm, uploads, Local Data API) | `admin/` | 3021 | https://admin.allegrogruppo.com — `allegro-admin.service` |
| Events pages (SSR, read-only) | `events/` | 3023 | events.allegrogruppo.com |
| **Joya HQ** (the restaurants' AI headquarters) | `hq/` (own `package.json`, AI runner `hq/runner/`) | 4300 | https://hq.allegrogruppo.com — `joya-hq.service` + `joya-runner.service` |
| Hashavshevet sync (SQL Server → MySQL `allegro_finance`, every company and year in one DB, no data dropped) | `hash-sync/` (own `package.json`; Windows install package: `npm run package:windows` → `dist/`, guide `windows/INSTALL.md`) | none (by hand so far; nightly Task Scheduler job on the Hashavshevet Windows server once the package is installed) | `allegro_finance` on the production MySQL server (loaded 2026-11-06, Pastalina 2025–2026); dev = local `allegro_finance_dev`; source = local SQL Server 2025 Express, DB `PastaLina`; passwords and tokens not copied |

Read the service's own docs first: `README.md` (repo), `local_api_readme.md` (the admin's Local Data API),
`events/README.md`, `hq/CLAUDE.md` + `hq/README.md`, `hash-sync/README.md`.

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
  branch from today on; days that passed keep the plan stored before them (Tabit's plan is edited after the day;
  owner 2026-10-30; `--replace-past` in the script replaces them). The daily 06:30 job copies this week and next week; by hand: `node scripts/tabit_rota_fetch.js [--week
  YYYY-MM-DD] [--apply]`.
  Table created on prod 2026-10-29 (`scripts/utils/create_tabit_rota_table.sql`); week 2026-10-25 loaded.
- **Employment type** (2026-11-04): `employees.contractor` = 0 שכיר / 1 קבלן / 2 מוגבל שעות (dropdown on the
  Employees page). מוגבל שעות: the export (`buildExportRow` → תלוש, Micpal/Shiklulit files) pays at most 182h at
  100% and 45h at 150% a month (`capPayrollHours` in `shared/wage.js`); the saved payroll keeps every hour. Step 4
  flags them (clock icon, view "Exceeded cap"). Step 4 buttons: Save (payroll + labor cost, no file) and one Export
  dialog (format מיכפל / תלוש, employee numbers; `/payroll/export-file`, `/payroll/export-tlush-xlsx`).
- **Bank Hapoalim files** ("תנועות בחשבון", e.g. `excelNewTransactions.xlsx`) → Upload page → `bank_transactions`
  (admin only). A row is stored once: `row_key` = the row's fields without the running balance + its number among
  equal rows in the file; `UNIQUE` + `INSERT IGNORE`. Test: `node scripts/test_bank_hapoalim.js`.
- **Order system shut down permanently** (owner's order, 2026-11-02; reopen only when the owner says so):
  `PERMANENT_SHUTDOWN = true` in `order_sys/server/orderState.js` fixes the state to shutdown (a restart, the
  11:00–15:00 schedule and the admin cannot reopen it); the site stays online with "closed until further notice";
  card payments and coupon orders are refused (503). The admin top bar no longer shows/polls the order-system
  dropdown (`admin/client/components/Layout.js`). To reopen: set it to false, put the dropdown back, build, restart
  `allegro.service`.
- **Drive invoices against the books** (2026-11-08, owner): Finance API `GET /finance/invoices/drive-check`
  (`admin/server/modules/financeApi.js` + `invoiceDrive.js`, rules `shared/invoiceMatch.js`, `shared/finance_map.json` →
  `drive`): the admin reads the invoice agent's `index.json` files from the accountant's Google Drive with the agent's
  own login (`INVOICE_DRIVE_CREDENTIALS`, `INVOICE_DRIVE_TOKEN` in the admin `.env`), matches each invoice with a Hashavshevet
  entry (party account by ח.פ., total with VAT, date, reference) and writes the flag `books.matched` back into Drive; daily
  06:45 where `INVOICE_DRIVE_AUTO=1`. Joya calc `missing_invoices` (chain admin; "invoices not booked yet", one part per channel — Drive is the first channel, not the only one). Tests `scripts/test_invoice_match.js`,
  `scripts/test_finance_api.js`. The agent runs on the owner's machine (cron every 15 min, connected 2026-11-05, 611
  Pasta Lina invoices filed by 2026-11-08); its filing keeps the flags. Deployed 2026-11-08 (`3cce655`): the Google files live in `/home/twit/.secrets/invoice-drive/` on the droplet (the admin runs as user `twit`), `allegro-admin`, `joya-hq` and `joya-runner` restarted.
- **Files to Drive + supplier invoices from the books** (2026-11-09, owner): Joya makes a Google Sheet in the owner's Drive
  folder when the user asks for a file, for a list too big for the chat, or for something to share — any calculation, any
  area (`hq/src/services/sheets.js`, `hq/src/lib/sheetTabs.js`, plan `file`, hq README → "Files to Drive"); the Excel link
  under a chat table stays. Uses the invoice agent's Google login (accountant@allegrogruppo.com, `INVOICE_DRIVE_*`) and the
  folder id `JOYA_SHEETS_FOLDER` — both must be in `hq/.env` on the droplet (the admin's files are in
  `/home/twit/.secrets/invoice-drive/`; hq runs as `twit`). Finance API `GET /finance/invoices?side=supplier` (+ `entryDate`
  on both sides) and Joya calc `supplier_invoices`: the books' supplier invoices with the entry date. Tests
  `scripts/test_finance_api.js`, `hq/test/test_joya_lib.mjs`; eval `x-file-*`, `f-supplier-*`. Needs an hq client build on deploy.
- **Statement compare — השוואת כרטסת לקוח / ספק** (2026-11-10, owner: part of the chat, no menu item): in Joya's accounting
  chat (chain admin) the user attaches the party's כרטסת (PDF with text, .xlsx or CSV) with the paperclip, the server keeps only its text (`hq/src/services/attachments.js`:
  `pdftotext -layout` when installed on the server, else `pdf-parse` — new root dependency, `npm install` on deploy), the AI
  planner extracts the rows, calc `statement_compare` pulls our account card (`/finance/ledger`) and `shared/statementCompare.js`
  returns only the differences (missing on each side, amount differs, the balance gap). hq README → "Statement compare".
  Tests `scripts/test_statement_compare.js`; eval `st-*`. Needs an hq client build on deploy; `apt-get install poppler-utils`
  on the droplet is optional but gives better Hebrew PDF text.
- **Downloads page** (2026-11-07): admin menu "Downloads" (`/downloads`, admin role only; `admin/server/modules/downloads.js`,
  `admin/client/pages/Downloads.js`). `GET /admin/downloads` lists the install packages, `GET /admin/downloads/hash-sync-windows`
  builds the Hashavshevet sync Windows package from the deployed repo (`hash-sync/scripts/build-windows-package.js` + jszip,
  now a root dependency) and sends the zip; nothing is stored. Guide for the Windows side: `hash-sync/windows/INSTALL.md`
  (install.cmd → .env → check.cmd → sync-now.cmd → schedule.cmd = Task Scheduler 02:00 as SYSTEM). Deployed 2026-11-07 (`5d4db47`,
  root `npm install` + `npm run build`, `allegro-admin.service` restarted; checked with an admin login through the public URL).
- **Open — security problems in the admin login** (reported, not fixed): plaintext passwords in `users.json`, which
- **Finance API** (2026-11-07): `GET /local-api/v1/finance/*` in the admin (`admin/server/modules/financeApi.js`, rules in
  `shared/finance_map.json`, spec `finance_api_readme.md`) answers the 24 Pastalina finance use cases from `allegro_finance`
  (read only, loopback only, like the Local Data API). Its DB settings are `FINANCE_DB_*` in the root `.env` (default: the
  admin's `DB_*` server, database `allegro_finance`). Test: `node --test scripts/test_finance_api.js` (local
  `allegro_finance_dev` from `hash-sync/.env`; the mixed endpoints also read the production `allegro` DB). Deployed
  2026-11-07 (`4a88e42`, `allegro-admin.service` restarted). Joya side built the same day (`hq/src/services/finance.js`,
  chain admin only, in הנהלת חשבונות; `hq/README.md` → "The books"). Every number still carries the `not_validated` warning until the accountant checks it.
- **Bank reconciliation report** (דוח התאמת בנק מפורט, 2026-11-07): admin menu "Bank reconciliation" (`/bank-recon`, admin role
  only) → `GET /admin/bank-recon/report?company=&account=&from=&to=&format=json|html|xlsx` (`admin/server/modules/bankRecon.js`,
  Hebrew HTML in `shared/bankReconHtml.js`, shared by the server and the page; `bankReconBehavior` there adds the collapsible
  sections and the Google-Sheets-like column filters on פרטים / מוטב / חשבון נגדי, 2026-11-07). Reads `allegro_finance` only. Sections: open
  bank lines, open book lines (cheques excluded), cheques cleared (paired by cheque number + amount, else Hashavshevet's
  match group) and cheques not cleared; "open" = no Hashavshevet match up to `to`. Summary ties to 0 on the local copy.
  Test: `node --test scripts/test_bank_recon.js` (needs `FINANCE_DB_*`). Deployed 2026-11-07. Also in Joya HQ (page
  `/accounting/bank-recon` + chat calc `bank_recon_report`) through the Finance API `GET /finance/bank/report[/accounts]`.
  **Cheque beneficiaries** (2026-11-07): every bank cheque line shown (report section 1, `/finance/bank/open`, `/bank/suggestions`,
  the Local Data API `/bank/transactions/stored`, so also Joya's bank chat) gets `payee` / `payeeSource` from Hashavshevet at
  read time (`admin/server/modules/chequePayees.js`: `cheques` by number + amount, else the journal entry with that reference and amount,
  else `missing` = not in Hashavshevet yet). Test: `node --test scripts/test_cheque_payees.js`.
- **Payments in Joya HQ** (תשלומים, 2026-11-07): a Joya main-menu area (chain admin) for the planned bank transfers — said in
  the chat ("תשלם לאבי כהן 5,000 ₪ ב-15 בנובמבר", "כל חודש ב-10 …", "תזיז את תשלום #12 …"), listed today / this week / upcoming,
  and marked paid only by a matching line of the uploaded bank file (`bank_transactions` via the Local Data API). Joya's own
  table `joya_payments` (`hq/sql/add-joya.sql`, created on production 2026-11-07). `hq/README.md` → "Payments". The cash-flow
  view will sit next to the payments board (owner). Deployed 2026-11-08 (`63218b2`, hq build, joya-hq + joya-runner restarted).
- **Open — security problems in the admin login** (reported, not fixed): plaintext passwords in `users.json`, which
  is tracked in git; `POST /auth/login` and `GET /auth/login` return the password and authKey; `POST /auth/register`
  writes `users.json` without a login; the cookie key and a static IV are hardcoded; `getUserKey` logs the key.
  Fix at least `/auth/register` and the password leak before sharing hq.allegrogruppo.com with managers.
