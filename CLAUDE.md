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
(`/root/allegro-dist-backup-*`). A root build needs the devDependencies (vite): on 2026-11-13 `npm run build` printed
`sh: 1: vite: not found` and left the old `dist/` — check the build's output, and run `npm install` first when that happens.

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
  **Bank transaction status file** ("סטטוס עסקאות", e.g. `eventsStatus.xlsx`; owner 2026-11-13: "support this file through the upload
  page, a specific table, merge it with the bank sheet") → Upload page kind `BANK_EVENTS` → `bank_events` (created on prod
  2026-11-13; `scripts/utils/create_file_upload_tables.sql`): the orders given on the bank site — transfers with the payee's name
  and bank account, who submitted them, when, cancelled or not; standing-order authorizations; cheque cancellations. A stored
  row only gets its status refreshed; the export holds 1,000 events at most (upload regularly). The merge
  (`admin/server/modules/bankEvents.js`: same amount, executed on the line's day or up to 4 days before, the name must agree when
  the line has one): Local Data API `/bank/events` + `event` on the transfer rows of `/bank/transactions/stored`; Finance API
  `/bank/open` and the reconciliation report name the transfer lines (`payeeSource` `events`) and mark section-2 book lines paid by
  transfer (`kind` transfer + `event`) — the start of "a supplier paid by transfer has no instrument word in the books". Tests
  `node --test scripts/test_bank_events.js` (no DB). Deployed 2026-11-13 (`c77cd4e`: pull, root build, `allegro-admin`, hq build,
  `joya-hq` + `joya-runner` restarted); the owner uploads the file on the Upload page. Fix 2026-11-14 (`a278109`, `allegro-admin` restarted): the
  events read from the DB are Date objects — one formatter `stamp` for Date and string, else no transfer was ever named.
  **Money in named by the uploaded bank file** (2026-11-15, owner: the 50,000 FROM אן-קור of 10/4/26, reference 452606556, looked
  like the 50,000 TO אן-קור of the same day): `admin/server/modules/bankFileNames.js` — a bank line still without a name gets the
  other side from `bank_transactions` (same account, day, reference, signed amount): "המבצע: <name>" = `payeeRole` `from` (shown
  "מאת: …"), "לטובת: <name>" = `to`, `payeeSource` `bank_file`, `payeePurpose`; in the report, `/finance/bank/open` (`meta.bankFile`)
  and the Local Data API stored rows. Named 112 more section-1 lines on production, 103 of them money in. Tests in `test_bank_events.js`. Deployed 2026-11-15 (`7b7fdd0` + `935ddf3`: pull, root build, `allegro-admin`, hq build, `joya-hq` + `joya-runner`;
  `joya-hq` was down ~1 minute on `7b7fdd0` — an unescaped apostrophe in a single-quoted note string: run `node --check` on changed
  hq server files before a commit, the hq build checks only the client).
  **RTGS (זה"ב) orders** (2026-11-15, owner: unnamed lines with reference 12268 = Hashavshevet's bundle number of "העברת זה"ב נט"): the status
  file holds them as a type of their own, `העברת זה"ב` → `typeCode` `rtgs` (`EVENT_TYPES` in `parsers.js`; `type=transfer` on `/bank/events`
  includes them); the lookup takes both types and the instrument must agree (`isRtgsLine`: a זה"ב statement line takes only an RTGS
  order, a plain line only a plain order, a book line either). All 18 זה"ב lines of section 1 named on production (141 from the status file in all). Deployed 2026-11-15 (`34415c4` + `60adfc7`, `allegro-admin` restarted; `34415c4` alone named NO transfer on
  production — a Hebrew value with a double quote written inline in the SQL broke the server's mysql2 named-placeholder parser
  (ER_PARSE_ERROR) while the local one coped: always pass such values as parameters, and read the report's notes after a deploy).
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
- **Priority cheque file** (2026-11-11, owner: "all the cheques created in Priority… use it when you need more info about
  cheques and you don't have it in our books or the bank details; a constant file, our history, no updates; e.g. בהתאמות
  בנקים"): `shared/priority_cheques.json` (2,678 Pasta Lina cheques written in Priority, April 2025 – March 2026, with the
  invoices each paid) built by `node scripts/priority_cheques_import.js` from `scripts/data/priority-cheque.xlsx`. Read by
  `admin/server/modules/priorityCheques.js`: the cheque lookup's third source (`payeeSource` `priority` — the bank recon
  report, `/finance/bank/open`, `/bank/suggestions`, the Local Data API's stored bank rows, Joya's bank chat; on the local
  copy it names 1,002 of the 1,398 bank cheques Hashavshevet does not know) and the Finance API `GET /finance/cheques/priority`
  (+ `number=` on `/cheques`) behind Joya's calc `priority_cheques` ("שיק 10777 של מי?" asks Hashavshevet and Priority
  together). Tests `scripts/test_priority_cheques.js` (no DB), `scripts/test_cheque_payees.js`, `scripts/test_finance_api.js`;
  eval `pc-*`. No DB table. Deployed 2026-11-11 (`ff83715`: pull, `allegro-admin`, `joya-hq`, `joya-runner` restarted).
  **One table + a fixed Drive file** (same day, owner): Finance API `GET /finance/cheques/all` (`admin/server/modules/chequesAll.js`:
  Hashavshevet's cheques module + Priority, one row per cheque, joined by number + amount, `bankDate` from the statement) and
  Joya's fixed Google Sheet "שיקים – חשבשבת + פריוריטי · Joya" in the owner's temp folder, rewritten in place ON DEMAND
  (owner: no schedule) — by calc `cheques_file` and by every future-cheques question (`hq/src/services/fixedSheets.js`; record
  in `joya_settings`); the button is under the answer. hq README → "Fixed files in Drive". Deployed 2026-11-11 (`0b74fba`: hq
  built, `allegro-admin`, `joya-hq`, `joya-runner` restarted; the server's login rebuilt the same file, id `1TlHB1H0…h4E`).
  Owner's rules for שקלפ (future cheques, same day): no dates = today → the end of the third month ahead; the chat shows one
  table by day with a sum per day; the Drive file = a summary tab + a tab per month, day sums and a month total
  (`hq/src/services/fixedSheets.js` `chequeTabs`, `finance.js` `futureChequesRange`; hq README → "Future cheques by day").
  Deployed 2026-11-11 (`3996b9a`, joya-hq + joya-runner restarted, no build). Then (owner): the file shows ONLY the future
  cheques of the asked window (default 3 months), not the history — name "שיקים לפרעון · Joya", `chequesWindow`. Deployed 2026-11-12 (`3ffc85f`, joya-hq + joya-runner restarted, no build).
  **Bank balance per day in שקלפ** (2026-11-12, owner: "always from the start of the current month, not from today; add the bank
  account balance — until today from the bank sheet or Hashavshevet, the balance at the end of each day, and the expected
  balance deducting the cheques and payments; green = old, red = future"): Finance API `GET /finance/bank/balances` (the
  uploaded bank file `bank_transactions`, else Hashavshevet `bank_lines.running_balance`, one closing per day; a file day
  uploaded that same day is provisional and loses to Hashavshevet) + Joya `futureChequesData` / `chequesByDay` with balances
  and the planned payments (`hq/src/services/finance.js`): the default window is the start of this month → the end of the
  third month, every day of the chat table and the Drive file carries the balance (🟢 real / 🔴 expected in the chat,
  green / red rows in the sheet). Tests `scripts/test_finance_api.js`, `hq/test/test_joya_lib.mjs`; hq README → "Future
  cheques by day, with the bank balance". Deployed 2026-11-13 (`0a229f0`: pull, `allegro-admin` restarted, hq built, `joya-hq` + `joya-runner` restarted).
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
  **Filters** (2026-11-13, owner: "supplier, cheque / type of movement, a specific name (prompt only) — best support in the API
  to save AI tokens"): `shared/bankReconFilter.js` — `kind` (cheque, transfer, card, direct_debit, deposit, fee, authorities,
  salary, other; every row gets one), `party` (account key or part of the name), `q`, `amount`, `sections`, `facets=1` on
  `/admin/bank-recon/report` and `/finance/bank/report` (+ `/facets` for the pickers); the summary stays for the whole account,
  `filtered[section]` = kept of all. Pickers "סוג תנועה" / "ספק / מוטב" on the admin page and Joya's page; the chat puts
  the words in the calc params (planner rule "FILTERS of bank_recon_report"). Tests `scripts/test_bank_recon_filter.js` (no
  DB), `scripts/test_bank_recon.js`; eval `f-bank-recon-filter-*`. Deployed 2026-11-13 (`c77cd4e`). The supplier picker is a
  searchable list: each name shows its rows in the report and, in red brackets, its bank moves with no record in the books
  (section 1; `facetsOf` → `bankOpen`). Deployed 2026-11-13 (`43c3a18`: pull, root build, `allegro-admin`, hq build, `joya-hq` + `joya-runner`).
  **Noise toggle** (2026-11-15, owner: "a noise cancellation toggle button: de facto cancelled cheques (older than 60 days), two
  opposite moves with the same details (name and sum) on the books or the bank"): `shared/bankReconNoise.js` tags `noise.rule`
  `reversal` (sections 1 and 2: two opposite rows, same payee / reference on the bank side, same counter account on the books
  side, same amount, within 90 days); `report.noise` = counts per section. A cheque past due > 60 days and not cleared is NOT noise
  (owner, same day: "those lines should be handled"): `todo.rule` `stale_cheque`, `report.todo`, a red "לטיפול" box, never hidden.
  Deployed 2026-11-15 (`19fc9f0`: pull, root build, `allegro-admin`, hq build, `joya-hq` + `joya-runner`). Filter
  `noise=hide` (API, Joya calc param, planner rule "בלי רעשים"); the HTML starts with the noise rows hidden and a button shows
  them (the summary always includes them); Excel column "רעש". On production 2026: 239 noise rows (24 bank, 134 books, 81 cheques).
  Tests `scripts/test_bank_recon_filter.js`, `scripts/test_bank_recon.js`. Deployed 2026-11-15 (`62428e9`: pull, root build,
  `allegro-admin`, hq build, `joya-hq` + `joya-runner`).
  **Cheque beneficiaries** (2026-11-07): every bank cheque line shown (report section 1, `/finance/bank/open`, `/bank/suggestions`,
  the Local Data API `/bank/transactions/stored`, so also Joya's bank chat) gets `payee` / `payeeSource` from Hashavshevet at
  read time (`admin/server/modules/chequePayees.js`: `cheques` by number + amount, else the journal entry with that reference and amount,
  else the Priority cheque file = `priority` (2026-11-11), else the cheque archive in Drive = `image` / `image_guess` (2026-11-16), else `missing` = not in Hashavshevet yet). Test: `node --test scripts/test_cheque_payees.js`.
  **Cheque archive in Drive** (2026-11-16, owner: "load the index.json from the cheques folder in the drive and use it to extract names wherever
  needed to reduce the 'לא נמצא בחשבשבת' cases" → "all" seven use cases): the owner's machine files the scanned front of every cheque the bank
  paid in the Drive folder `CHEQUE_ARCHIVE_FOLDER` (default the owner's folder; `<company folder>/index.json` + `cheques/<payee>/<no>.jpg`; the
  payee of a cheque the books and Priority do not know is READ FROM THE PICTURE — 336 of 1,358 on 2026-11-16, 17 unsure guesses). The admin reads
  the index with the invoice agent's Google login (`admin/server/modules/chequeArchive.js`, 5-min cache, nothing stored; company by
  `shared/finance_map.json` → `chequeArchive.folder`). Uses: (1) the cheque lookup's fourth source — `payeeSource` `image` (name read from the
  picture, same number AND amount; shown "(מהצ'ק)") / `image_guess` ("? (מהצ'ק, לא ודאי)"), and `imageId` / `image` on EVERY cheque line that has a
  scan — so the report (section 1, Excel column "תמונת הצ'ק", notes and `summary.bankOpen.cheques.image / imageGuess / withImage`), `/finance/bank/open`,
  `/bank/suggestions`, the Local Data API stored rows and Joya's bank chat all get them; the 📷 link streams the picture through
  `/admin/bank-recon/cheque-image/:id` (admin page) or `/finance/cheques/image/:id` → Joya `/api/joya/finance/cheque-image/:id` (only ids in the
  index); (2) Finance API `GET /finance/cheques/archive` (`books=missing` = the bookkeeper's work list: name, amount, bank day, picture, and the
  account with that name) + Joya calc `cheque_archive`; (3) `/cheques/all` joins the scans and adds archive-only rows (`source` `archive`) — so Joya's
  cheques file too; (4) Joya `statement_compare`: an onlyTheirs payment gets `archiveCheque` when a scanned cheque has that amount near that date;
  (5) a cheque by number plans `cheques` + `priority_cheques` + `cheque_archive`. On the local copy, 2026 section 1: 29 named from the picture, 12
  guesses, 7 left. Tests `scripts/test_cheque_archive.js` (no DB), `test_cheque_payees.js`, `test_bank_recon.js`, `test_finance_api.js`
  (`/cheques/archive`, `/cheques/image`); eval `ca-*`, `pc-*`. Deployed 2026-11-16 (`a046632`: pull, root build, `allegro-admin`, `joya-hq` + `joya-runner` restarted; the agent's Google files were already on the droplet). On production that day, section 1 of 2026: 283 cheques named from the picture, 17 guesses, 19 missing (7 with a scan), 379 with a 📷.
  **The card (כרטסת) next to every line** (2026-11-18, owner: "I want the card index number next to each line to improve the process; complete
  every row. One card for all employees: make sure it is an employee by the admin's employees table or another way; no specific supplier or other
  role → the employee card, marked by color"): `admin/server/modules/bankLineAccounts.js` gives every section-1 bank line `counterAccount` /
  `counterName` / `counterSource` (`books`, `name` incl. `finance_map` `cardAliases`, `employee` = Priority's employees supplier 108 or the admin's
  employee tables, `history` = past journal entries with that name, `employee_guess` = a person's name with no card, to check, `text` = the bank
  text's past matches) / `counterBasis`, and `counterEmployee` for the one employees card (`finance_map` `employees.account` = 450001 "עובד");
  sections 2 and 3 carry the books' own. Shown as a "כרטסת" column (blue = employees card, lighter + "?" = a guess, tooltip = why) in the page,
  the Excel (3 columns, blue fill), `/finance/bank/open` (`meta.cards`), `/finance/bank/report` and Joya's chat (`card`, `cardSource`,
  `employeesCard`; rule in `hq-analyst.js`). On the local copy, 2026 section 1: a card for 643 of 758 lines (147 employees, 38 guesses, 115 without a card). Tests
  `scripts/test_bank_line_accounts.js` (no DB), `test_bank_recon.js`, `test_finance_api.js`. Deployed 2026-11-18 (`d2dad64`: pull, root build, `allegro-admin`, `joya-hq` + `joya-runner` restarted); on production that day, 2026 section 1: a card for 640 of 753 lines, 113 without.
- **Payments in Joya HQ** (תשלומים, 2026-11-07): a Joya main-menu area (chain admin) for the planned bank transfers — said in
  the chat ("תשלם לאבי כהן 5,000 ₪ ב-15 בנובמבר", "כל חודש ב-10 …", "תזיז את תשלום #12 …"), listed today / this week / upcoming,
  and marked paid only by a matching line of the uploaded bank file (`bank_transactions` via the Local Data API). Joya's own
  table `joya_payments` (`hq/sql/add-joya.sql`, created on production 2026-11-07). `hq/README.md` → "Payments". The cash-flow
  view will sit next to the payments board (owner). Deployed 2026-11-08 (`63218b2`, hq build, joya-hq + joya-runner restarted).
- **Open — security problems in the admin login** (reported, not fixed): plaintext passwords in `users.json`, which
  is tracked in git; `POST /auth/login` and `GET /auth/login` return the password and authKey; `POST /auth/register`
  writes `users.json` without a login; the cookie key and a static IV are hardcoded; `getUserKey` logs the key.
  Fix at least `/auth/register` and the password leak before sharing hq.allegrogruppo.com with managers.
