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
  boxes not tables. **The full window width with a small margin, and no horizontal scroll bar anywhere** (owner
  2026-11-28): no `maxWidth` on the shell or the chat; a table is `ui.js` `DataTable` (cells wrap, numbers never; a table
  still wider than its box becomes a card list by itself) — never a `nowrap` table in an `overflowX: auto` box. The main menu has three chat areas (stock and purchasing, manpower, performance).
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
  The weekly card forecast is `card_income_week` (credit cards = last week's VISA/MC/DINERS paid Wednesday; AMEX apart:
  1st–15th → the 2nd of the next month, 16th–end → the 8th; owner 2026-10-27).
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
- Weekly / monthly tables: `group: "week" | "month"` on `payments_summary` and `bank_summary`; `cards_vs_bank` = Beecomm
  VISA + MC per Sun–Sat week vs Max's payout the next Wednesday (002… = VISA, 007… = MC, fee ≈ 1.6%), and AMEX per month
  vs American Express's payouts the next month (README → Weekly and monthly sums; 2026-10-27). The planner
  must use one grouped calc, never one calc per week.
- **Tips are not income** (owner 2026-11-03, a GLOBAL rule — keep): every Beecomm income amount is without tips.
  Beecomm's totals ALREADY have no tips — never subtract `service` from them (fixed 2026-11-03, it was subtracted
  twice): order `netTotal` has no tips (`serviceAmount` is on top); in the payments report the card rows include the
  card tips but the workers get them in cash from the register, so the cash row is lower by them (can be negative)
  and Σ(paid − refunded) = the Z total = dish sales (checked all branches, Aug 2026). `paymentsSummary` charges =
  paid − refunded (Beecomm "סה״כ"), tips apart in `service` / `totalService`; `card_income_week` amount = card
  charges − card tips, `tips` apart; `cards_vs_bank` uses the card charges with their tips (the bank gets them).
- **Monthly VAT report** (2026-11-03, calc `vat_report`): Beecomm payments in the Z without tips, minus the הקפה payments
  (invoiced to the customer; owner 2026-11-09), minus 20% of חבר only (both "PRIVATE LABEL BRAND" brands; not מולטיפס,
  owner), VAT 18/118. Rules and rates in `src/lib/vatRules.js` (`VAT_RATE_PCT`, `VAT_DEDUCT_PCT`). README → Data map.
  Deployed 2026-11-09 (`91f0192`, with the `missing_invoices` per-channel answer of `23d11a7`).
- **Chat paging** (owner 2026-11-04): 10 questions per page, older on scroll up; a chat keeps its newest 100
  (`CHAT_KEEP`, older rows are DELETED on the next question). README → Asking in words.
- **Chat history** (2026-11-04, the owner felt "context is lost"): `buildContext` adds `history` (the last 3 answered
  questions of the same user + chat, last 3 hours; calcs + params, cut answers) → `<history>` in both prompts. Eval
  fixtures `h-*` take `history`. README → Asking in words.
- **Live chat sessions** (2026-11-08, owner: "keeping the session alive"): `runner/session.js`. Each chat (user +
  context kind + context id, GENERAL also + restaurant = `chat.key` from `chatOf` in `ai.js`) keeps one planner and
  one writer `claude -p --input-format stream-json` process alive; prompts go in on stdin, answers come back on
  stdout, turn after turn. Later turns send only the changed context (`sameAsBefore`), no `<history>`, and the
  planner gets `<previous_answer>`; the number check also accepts the session's earlier results. A session closes
  after 30 min idle, past 150K tokens, when the chat changed (`priorIds`: a question deleted / asked again /
  answered without it) or when a request fails; at most 6 live (~230 MB each process). Then the next question starts
  a new session from `<history>`. Env `JOYA_LIVE_SESSIONS` (0 = off), `JOYA_SESSION_IDLE_MIN`,
  `JOYA_SESSION_MAX_TOKENS`. Measured: first turn ~$0.09, later turns ~$0.005–0.02 and ~2 s per plan.
- **Performance menu** (owner 2026-11-04): only three suggestions — `month_vs_last_year`, `waiter_performance`,
  `daily_dashboard` (README → Asking in words). The dashboard is live only where the admin has the Beecomm backoffice
  key (`BCOM_BO_*`); the production server's `.env` does not have it yet → it shows the last stored day.
- **Manpower menu** (owner 2026-11-04): four suggestions — active employees and employee wages (`employees`, this
  month), the payslip Excel and the Micpal / Shiklulit file (`payroll_files`: last saved month, download buttons; files
  made by the admin's Local API `/payroll/tlush.xlsx`, `/payroll/import.xlsx`). README → Asking in words.
- **Calculate when it is needed** (owner 2026-11-08, the FIRST hard rule of both prompts, keep): the model never
  answers "אני לא מחשב סכומים בעצמי". DATA numbers come only from the calcs (never guessed); the ARITHMETIC on them
  (sum, difference, split "20 אלף ב-5 תשלומים" → 4,000, share, average, per unit, VAT) is the model's job, shown as
  "4,000 ₪ (= 20,000 ÷ 5)". `runner/verify.js` evaluates such brackets: all inputs known (or a count ≤ 12) and the
  result right → the result counts as verified; otherwise it is flagged as before. The planner fills op fields the
  same way (`repeat.count` for "N payments", amount = total ÷ count). Before this the model refused three times
  (requests #83, #90, #137). README → Asking in words.
- **Table totals** (owner 2026-11-03, keep): a table whose numbers add up ends with a "סה"כ" row; the system
  recalculates it from the rows (`fillTotals`), and a missing number in a table is 0. README → Asking in words.
- **Money in whole ₪** (owner 2026-11-04, keep): amounts are shown without agorot, cut down (`floorMoney` in
  `lib/answerTables.js`: runner before `fillTotals`, chat display, Excel). %, hours, counts keep decimals. Number
  cells in answer tables align like the text (right in Hebrew), not to the other side.
- **Team rules from the chat** (2026-11-01, owner: "instruct the chat for new rules to add to the team"): the chain
  admin writes a lasting rule in any chat → proposal `TEAM_RULE` → Apply → `joya_settings` 'teamRules' → given to the
  model in `<team_rules>` for every later request of that area (README → Asking in words). No new table.
- Answers may hold pipe tables → table component + Excel download per table (`lib/answerTables.js`,
  `/ai/requests/:id/tables/:n.xlsx`, owner 2026-10-27). Keep the table format in the WRITE prompt and the reader in sync.
- Beecomm "credit card" = VISA + MASTERCARD + AMEX + DINERS (+ ISRACARD, DISCOVER, MAESTRO, owner 2026-11-03) only; every other brand of the credit type = "members club"
  (owner, 2026-10-26) — except Mishloha ("אשראי - MISHLOHA"), its own group `mishloha` (owner, 2026-11-03: "it is
  not the same" as חבר). `payments_summary` returns `creditCards` / `membersClub` / `mishloha` (+ `…Total`); never call
  the whole אשראי type "credit card".
- Employees and wages (calc `employees`, 2026-10-26): names, location, roles, wage type, wage and the hourly rate per
  role (same chain as the admin Shifts page: role wage → employee wage → legacy `hourly_wage`; `hourly_min_*` / -1 = the
  minimum wage, `MIN_HOURLY_WAGE` or 35.4), read live from the admin's `/employees`. With `from`/`to`: only the people
  with Tabit clock times in the period (Allegro links a clock row to `employees` by clock id → roster phone → name),
  hours per role, and the clock names it could not link (`unlinkedClockNames`). Users with payroll access only
  (admin and restMngr, their own locations). No national ids or phones.
- Users: only the admin's `users.json` (admin → chain admin, restMngr → its `restaurants`; payroll for both).
- **The books** (2026-11-07, owner: admin only, in the existing הנהלת חשבונות area): 23 finance calcs in
  `src/services/finance.js` over the admin's Finance API `/finance/*` (`../finance_api_readme.md`; `source.finance()`),
  per company (only Pastalina is loaded), chain admin only (`FINANCE_CALCS` in `ai.js`), warnings shown beside the
  numbers (WRITE prompt "The books"). README → "The books". Eval 2026-11-07 (`joya-hq-1+d9d73484`): `f-*` 21/21, full run
  115 cases all pass (one real miss, labor % → `branch_costs`, fixed in the prompt; 15 cases failed once on a transient
  `claude` CLI update mid-run and passed on re-run). The INQUIRY fixtures and the prompt's `draft` line were removed. Open: the accountant's access (decision 1), the
  other companies' books (hash-sync), the accountant's check of the numbers (`not_validated`).
- **Statement compare** (2026-11-10, owner: "part of the chat", no menu item, no dialog): in the accounting chat (suggestion
  s18) the party's כרטסת (PDF / xlsx / csv) is attached with the paperclip (since 2026-11-14 only after the admin's recognizer
  said it is not one of the upload files — `FileDrop.js` `add({ forQuestion })`; deployed 2026-11-14, `b5ec42c`, hq build + `joya-hq` + `joya-runner`) → `POST /joya/ai/ask-file` → text in `meta_json.attachment` (`src/services/attachments.js`; PDF via `pdftotext` when
  installed, else `pdf-parse` — root dependency, Node 18 build) → the planner extracts the rows (PLAN "STATEMENT COMPARE")
  → calc `statement_compare` (`/ledger` + `shared/statementCompare.js`) → only the differences (WRITE "Statement compare").
  `ChatArea`: a PDF anywhere / an Excel in the accounting chat = the next question's attachment (chip), other files = the import flow. Tests `scripts/test_statement_compare.js`; eval `st-*`.
  Deployed 2026-11-10 (`7e38e6e`: poppler-utils installed on the droplet, root `npm install`, hq built, joya-hq + joya-runner restarted; the chat-only version `1c1ef3f` deployed the same day).
- **Priority cheques** (2026-11-11, owner: "a constant file, our history — use it when the books or the bank do not have the
  cheque's details, e.g. bank reconciliations"): `shared/priority_cheques.json` (from `scripts/data/priority-cheque.xlsx` by
  `scripts/priority_cheques_import.js`; 2,678 Pasta Lina cheques written in Priority, April 2025 – March 2026). The admin's
  cheque lookup names bank cheque lines from it when Hashavshevet has nothing (`payeeSource: "priority"`, report note), and
  calc `priority_cheques` (Finance API `/cheques/priority`; `cheques` got `number`) answers cheque questions; PLAN "A cheque
  by its NUMBER" plans both. README → "Priority cheques". Tests `scripts/test_priority_cheques.js`; eval `pc-*`. Deployed 2026-11-11 (`ff83715`, services restarted, no build).
- **Fixed files in Drive** (2026-11-11, owner: "one table of the Priority and Hashavshevet cheques, an Excel on the Drive, a fixed
  file updated all the time" → "no schedule, upon demand: a question about future cheques updates the file and gives the link"):
  `src/services/fixedSheets.js` + `upsertFixedSheet` (`sheets.js`) rewrite the same Google Sheet (found by
  `appProperties.joyaFixed`) on demand only — calc `cheques_file`, and every `cheques` calc with state future; record in
  `joya_settings.fixedSheets`; key `cheques` = Finance API `/cheques/all` (`admin/server/modules/chequesAll.js`). Button under
  the answer (`meta.file.fixed`), suggestion s19 (adminSuggestions 11). README → "Fixed files in Drive". Deployed 2026-11-11 (`0b74fba`, hq built, three services restarted).
  Same day: the file is a summary tab + a tab per month (day sums, month total — `chequeTabs`), and שקלפ without dates =
  today → the end of the third month ahead (`futureChequesRange`), read from `/cheques/all` so the post-dated Priority
  cheques count (README → "Future cheques by day"). Then: the file holds ONLY the future cheques of the asked window
  (`chequesWindow`; owner: "according to the user request, 3 months by default, only" — no history); name "שיקים לפרעון · Joya". Deployed 2026-11-12 (`3ffc85f`, joya-hq + joya-runner restarted, no build).
  2026-11-12 (owner): שקלפ always starts at the START of the current month, and every day carries the bank balance —
  real up to the last bank day (Finance API `/bank/balances`: the uploaded bank file, else Hashavshevet's bank lines;
  GREEN) and expected after it (the running balance minus the day's unpaid cheques and Joya's planned payments; RED):
  `futureChequesData` / `chequesByDay(rows, { balances, payments })` / `balanceSummary` in `finance.js`, shared by the
  `cheques` calc and the Drive file (`chequeTabs` with `byDay`, column יתרה, row `_tone`); the chat marks the cell with
  🟢 / 🔴 (`cellTone`, coloured in `AskBox.js` and the Excel download). README → "Future cheques by day, with the bank
  balance". Deployed 2026-11-13 (`0a229f0`: `allegro-admin` restarted, hq built, `joya-hq` + `joya-runner` restarted).
- **Files to Drive** (2026-11-09, owner): a plan `file` ({ kind: 'sheet', title, show, columns? }) when the user asks for a
  file, for a list too big for the chat (> ~150 rows) or for something to share → `compute` runs the calcs in export mode
  (`params.export`, `finance.js` `limitOf` / `EXPORT_MAX`), `src/services/sheets.js` builds a workbook from every list in
  the results (`src/lib/sheetTabs.js` `tabsOf`) and uploads it as a Google Sheet to the owner's folder `JOYA_SHEETS_FOLDER`
  with the invoice agent's login (accountant@, `INVOICE_DRIVE_*`); `meta_json.file` → one link under the answer
  (`SheetFile`); writer rules "FILE ANSWERS"; the table's Excel link stays as it was. Eval `x-file-*`. README → "Files to Drive".
  Deployed 2026-11-09 (`17809f0`: hq/.env on the droplet got the three settings, hq built, admin + joya restarted).
- **Supplier invoices from the books** (2026-11-09, owner): calc `supplier_invoices` (`fin.supplierInvoices`, Finance API
  `/invoices?side=supplier`: date, `entryDate`, supplier, expense account, credit notes minus) — "חשבוניות ספקים שבספרים",
  "תאריך הזנה ותאריך הוצאה"; the planner never uses `missing_invoices` for it. Eval `f-supplier-*`.
- **The latest invoices the agent found** (2026-11-22, owner: "I want to ask the agent: show me the latest invoices —
  not the date of creation"): calc `latest_invoices` (`fin.latestInvoices`, chain admin only, in `FINANCE_CALCS`) →
  the admin's `/finance/invoices/drive-latest`: the invoice agent's Drive rows of every folder (the restaurant
  companies, the owner's other companies in his own Drive folder, `_unmatched`), newest FOUND first (`foundLocal`,
  Israel time) — never sorted by the invoice date. Not per company (no `companyKeys`), not the books. Params: `limit`,
  `days`, `since` / `until` (found days), `company`, `direction`, `mailbox`, `unmatched`, `q`. PLAN rule "THE LATEST
  INVOICES THE AGENT FOUND" (never `supplier_invoices` / `missing_invoices` for it); WRITE rule "The latest invoices
  the agent found" (a table by found time, no Drive links unless asked). Eval `li-*`. No client change.
- **Missing invoices** (2026-11-08, owner): calc `missing_invoices` (`fin.missingInvoices`) = "which invoices are not
  booked yet", answered PER CHANNEL (`INVOICE_CHANNELS` in `finance.js`; the owner: Drive is the first channel, not the
  only one, and it must be transparent — the user asks about missing expense invoices and the Drive list is one part
  of the answer). Channel `drive` → the admin's `/finance/invoices/drive-check`: the invoice agent's Drive index matched
  with Hashavshevet by the admin (`shared/invoiceMatch.js`), flag `books.matched` written back into Drive (the owner:
  "access to the drive through the API on the admin"). PLAN routing (חשבוניות הוצאה שעדיין לא נרשמו / לא נקלטו / מהדרייב
  / מהמייל → missing_invoices, never customer_invoices / allocation_numbers); WRITE format "Missing invoices" (a part per
  channel, a closing line on the channels not connected yet). Eval `f-drive-*`, `f-missing-*`. The admin needs the
  agent's Google files (`INVOICE_DRIVE_CREDENTIALS`, `INVOICE_DRIVE_TOKEN`), else the channel answers "not available"
  with the reason. Deployed 2026-11-08 (`3cce655`; the rename to missing_invoices the same day).
- **System page** (2026-11-18, owner: "a system option in the main menu which displays this data" = the last update date of every
  source): main-menu item "מערכת" → `/system` (`client/pages/System.js`, chain admin) ← `GET /api/joya/system/freshness`
  (`routes.js`, `source.systemFreshness`) ← the admin's `GET /local-api/v1/system/freshness` (`admin/server/modules/dataFreshness.js`:
  Hashavshevet copy, bank files, Tabit, Beecomm, Drive indexes, Priority file; state ok / late / stale per expected cadence; Hebrew
  notes comparing the sources). Needs an hq client build on deploy.
  **App update** (same day, owner: "every 1 hour the app should check for a new version = a new build; if there is one, suggest a
  reload dialog; an app update button in the System page"): `vite.config.js` defines `__JOYA_BUILD__` (git sha + minute) and writes
  `prod/version.json`; `server.js` `GET /api/version` (public, no-store); `client/version.js` (`useUpdateCheck`, `checkForUpdate`,
  `reloadApp`), `client/UpdateDialog.js` in the shell, the version card + button in `pages/System.js`. A deploy = a new build id, so
  every open tab offers the reload within the hour.
- **Bank reconciliation report in Joya** (2026-11-07): page `/accounting/bank-recon` (not in the menu — the chat answers it (suggestion 9 of the accounting area) and the buttons under the answer open the page;
  admin) showing the admin's report through `/api/joya/finance/bank-recon?format=html|xlsx|json` (Finance API
  `/finance/bank/report`), and the calc `bank_recon_report` (24th finance calc; buttons under the answer in `AskBox.js`).
  README → "The detailed bank reconciliation report". Eval fixtures `f-bank-recon-report*`, `f-bank-recon-sections`.
  **Filters** (2026-11-13, owner: supplier, type of movement, a name — in the chat and on the page, done by the API to save
  AI tokens): calc params `kind`, `party`, `q`, `amount`, `sections` (`src/services/finance.js` `bankReconReport`, PLAN rule
  "FILTERS of bank_recon_report", WRITE rule "A FILTERED report"); the page's pickers "סוג תנועה" / "ספק / מוטב" read
  `/api/joya/finance/bank-recon/facets`; the chat's link carries the filters to the page. The rules live in the admin
  (`shared/bankReconFilter.js`, `finance_api_readme.md` → `/bank/report` "Filters"). Eval `f-bank-recon-filter-*`. Deployed
  2026-11-13 (`c77cd4e`: root build, `allegro-admin`, hq build, `joya-hq` + `joya-runner` restarted).
  The supplier picker (searchable, red count = the supplier's bank moves missing from the books) deployed 2026-11-13 (`43c3a18`).
  Cheque lines in every bank list (bank_transactions, bank_open_items, the report's section 1) carry `payee` / `payeeSource`
  from the admin (Hashavshevet); the analyst writes "שיק <no> – <payee>" and "לא נמצא בחשבשבת" for `missing`.
  **Section 3ג + export (2026-11-18):** the report's `chequesStale` (stale cheques, `suggestedAction`, `bounced`) is passed in
  `bank_recon_report` (`sections.chequesStale`, `summary.chequesStale`); the page's selection mode posts its export to the relative
  "export" = `POST /api/joya/finance/export` (`routes.js`, `source.financeBankReportExport` → the admin's `POST /finance/bank/report/export`).
  Planner WRITE rule: name the 3ג count and sum, point to "בחירה" on the page, never invent moves.
  **Cards (כרטסת, 2026-11-18):** the admin's report rows now carry the account to book each line on; `finance.js` passes `card` ("name (key)"),
  `cardSource` and `employeesCard` (the one card of all employees) on the bank and cheque rows (`bank_open_items` passes the raw
  `counterAccount` / `counterName` / `counterSource` / `counterEmployee`); the planner's WRITE rule says "כרטסת: עובד (450001)" after the payee,
  "כרטיס העובדים" for the shared card and "לבדיקה" for `employee_guess`.
- **Cheque archive** (2026-11-16, owner: use the Drive cheques folder's `index.json` to cut the "לא נמצא בחשבשבת" cases — all use
  cases): the admin reads the scanned-cheque archive (`admin/server/modules/chequeArchive.js`, root `CLAUDE.md` → "Cheque archive in
  Drive"). In Joya: `payeeSource` `image` ("(מהצ'ק)" — the name read from the picture) / `image_guess` ("? (מהצ'ק, לא ודאי)") on every bank
  cheque row and `image` / `hasImage` where a scan exists (WRITE rule in the bank-cheque paragraph; the report page shows 📷, the picture is
  proxied at `/api/joya/finance/cheque-image/:id` → Finance API `/cheques/image/:id`); calc `cheque_archive` (`fin.chequeArchive`, Finance
  API `/cheques/archive`: number, q, amount, books `missing` = the bookkeeper's work list, named false = the unsure / unnamed ones; PLAN
  rules "A cheque by its NUMBER" → three calcs, and "The scanned cheques … WORK LIST"); `statement_compare` adds `archiveCheque` to an
  onlyTheirs payment that a scanned cheque explains (same amount, within `days`); `/cheques/all` rows (the cheques file) may be
  `source` `archive` with `payeeGuess` / `image` (`fixedSheets.js` SOURCE_HE). Eval `ca-*`, `pc-number` (3 calcs). Deployed 2026-11-16 (`a046632`, no hq client build needed).
- **Legal** (משפטי, owner 2026-11-18: "a main menu item: legal; complete browsing and download of any file; the AI should address
  questions like what was the story with <name>, what was the verdict, the last decision, when is the next hearing"): main-menu area
  for the **chain admin only** (AREA 7 `LEGAL`; menu, routes and calcs). Data = the owners' court cases in the legal archive in Drive,
  through the admin's Legal API (`../legal_api_readme.md`; `source.legal()` / `source.legalFile()`); Joya keeps nothing. Page `/legal`
  (`client/pages/Legal.js`): tabs שאלות (the area's chat) / תיקים (search by a name in any spelling, a number or words; open / closed;
  whose archive) / דיונים (hearings ahead); `/legal/:number` = one case: story, verdict, last decision, hearings and every paper with
  Open / Download (`/api/joya/legal/files/:driveId[?download=1]`, proxied — no Drive access needed). Calcs (`src/services/legal.js`,
  `LEGAL_CALCS` in `ai.js`): `legal_case` (ONE case by `q` = a name or `number`: history, parties, verdict, lastDecision, nextHearing,
  key papers), `legal_cases` (the list), `legal_hearings`, `legal_documents`, `legal_document` (a paper's full text, by `documentId` or
  `number` + `which`). Prompts: PLAN "Legal" (one `legal_case` answers story + verdict + last decision + next hearing; a follow-up uses
  the case number), WRITE "Legal" (answer the question first, no legal opinion, one closing line that the summary was written from the
  papers; never write links — `LegalFiles` in `AskBox.js` shows the case and PDF buttons). The stories are AI-written from the papers; a
  closed case of Itzik holds only its opening paper and verdict (`partial`). Tests: `test/test_joya_lib.mjs` (access), admin
  `scripts/test_legal_archive.js`; eval `l-*` 10/10 (context kind `LEGAL`). Deployed 2026-11-18 (`313adb9`, hq build).
- **Bank update from the bank site** (2026-11-22, owner: "the same way we have with the legal"): a card on the System page
  (`client/BankUpdate.js`) for a Chrome with the Joya browser extension (`../joya-extension/`, one extension for the legal and the bank
  jobs — progress messages carry `job`); `src/services/bankSync.js` = a pass-through to the admin's `/local-api/v1/bank/sync/*` with the
  admin rights in the `X-Joya-*` headers + `runs.json` (`JOYA_BANK_SYNC_DIR`, default `~/.joya-bank-sync`); routes `/joya/bank/sync/*`
  (chain admin). Joya stores nothing: the admin writes `bank_transactions` and the Drive cheque archive. README → "Bank update from the
  bank site". Tests `test/test_bank_extension.mjs` (in `npm test`). Needs an hq client build on deploy. Deployed 2026-11-22 (`3ebc271`).
- **Beecomm update on demand** (2026-11-22, owner: "add the update button to the Beecomm as well — to initiate the update process on the
  server"): card `client/BeecommUpdate.js` on the System page → `/joya/beecomm/sync/{state,start}` (chain admin) →
  `src/services/beecommSync.js` → the admin's `/local-api/v1/beecomm/sync/*` (`admin/server/modules/beecommSync.js` runs the nightly
  loader `scripts/server/analoader/index.js` as a child process, one at a time, shared with the admin's 06:00 cron). The card polls while
  a run goes on and reloads the freshness table at its end. README → "Beecomm update on demand". Needs an hq client build on deploy.
  Found the same day: the production server never loaded Beecomm (no `BCOM_BO_*` in its `.env`, the cron failed every night) — the
  owner's machine did it at 06:00; the settings were added to the droplet on 2026-11-22 and the server loads from then on. Deployed 2026-11-22 (`cc69f61`: pull, hq build, `allegro-admin`, `joya-hq` + `joya-runner` restarted; `/beecomm/sync/state` answered on the droplet).
  **2026-11-28:** Beecomm's gateway refuses the server's address (403), so the server's load is off (`BEECOMM_SYNC=off`, the card says so,
  the owner's machine runs the nightly job) and the card got "עדכן דרך הדפדפן": the extension (1.1+) fetches Beecomm's answers in the
  browser with a one-hour token from the server and the admin loads them (`/api/joya/beecomm/sync/ext/*`, README → "Beecomm through the
  browser"). The card listens to window messages with job `beecomm` like the bank card.
- **Cheque pictures as cards** (2026-11-23, owner: "if I asked for cheque images, display them on a card list with the options
  to copy and share"): `client/ChequeCards.js` under the answer (`AskBox.js`), `lib/chequeCards.js` picks the pictures = every
  calc row with `imageId` (now passed on the bank rows, the report's cheque rows, the cheques file rows and `archiveCheque`),
  shown when calc `cheque_archive` ran or the question has picture words — since 2026-11-28 (owner: "when displaying bank pages add
  the cheque image when applicable") shown under EVERY answer with pictures, and the שקלפ page shows a thumbnail on a paid cheque
  line (`ChequeThumb`, icon mode = the small 📷 of the recon page). Copy = the PNG to the clipboard (else caption + link),
  Share = the share sheet with the file (else download), tap = full size. Prompt: PLAN "The scanned cheques" (the pictures of a
  payee → `cheque_archive` q), WRITE ("התמונות מוצגות למטה", never a link). Tests `test/test_cheque_cards.mjs`; eval
  `ca-pictures-*`. README → "The pictures as cards in the chat". Needs an hq client build on deploy. Deployed 2026-11-23 (`c69f7c5`: pull, hq build, `joya-hq` + `joya-runner` restarted; `/api/version` serves the new build).
- **The picker scope in the prompts** (2026-11-23, owner: "tell Claude that the prompt refers to this restaurant or company
  unless it is specified differently"): `runner/runner.js` `scopeLine(ctx)` → a `<scope>` block in the plan prompt (before
  `<context>`) and the write prompt (after `<request>`), every turn, also in live sessions: the restaurant (`scope.location`,
  new on `scopeOf` in `ai.js`) or company by name with its locationIds, and the rule; PLAN "Locations" rule and a WRITE rule
  (name it in the first line). Test in `runner/test/runner.test.js`; eval `g-scope-*`. README → "Asking in words" (the picker).
- **The bank lines page** (תנועות בנק, 2026-11-28, owner: "a small 📷 icon in the details column as on the bank reconciliation page; a
  bank page with filters by name (details), type of action and an extended date filter; totals of the in and out columns when filtered"):
  menu item → `/bank/lines` (`client/pages/BankLines.js`, chain admin) ← `GET /joya/bank/lines` (`src/services/bank.js` `bankLines` over
  the admin's stored bank rows; `lib/bankLines.js` facets / filters / totals). README → "The bank lines page". Tests
  `test/test_bank_lines.mjs`. Needs an hq client build on deploy.
- **The שקלפ page** (2026-11-22, owner: "a convenient UX for the שקלפ … list forward the daily cheques or expenses like known bank
  payments (הוראות קבע) by date; a click on the date opens a card with the cheques and orders of that day; move month by month"):
  menu item "שיקים לפרעון" → `/cheques` (`client/pages/Cheques.js`, chain admin): one month per view, a row per day, a card per
  day, ‹ / this month / ›. `GET /joya/cheques/month?company=&month=` → `chequesMonth` (`src/services/finance.js`; `futureChequesData`
  got `bankPayments: true`, `chequesByDay` passes `kind` / `paid` / `expected` / `late` on the payments). The **known bank payments**
  = `src/services/standingOrders.js`, learned from the bank file's 515 / 469 lines (≥ 2 of the last 4 months → expected on the usual
  day with the last amount; real lines where the bank covers the day; `late` when the day passed without a line, never deducted).
  The chat's future-cheques answer shows a button to the page (`AskBox.js` `ChequesPage`, WRITE rule). README → "The שקלפ page".
  Tests `test/test_standing_orders.mjs`. Needs an hq client build on deploy. Deployed 2026-11-22 (`cc9b78d`: pull, hq build, `joya-hq` + `joya-runner` restarted).
- **Payments** (תשלומים, owner 2026-11-07): a main-menu area for the chain admin — the planned bank transfers of a
  company in Joya's own table `joya_payments` (created on production 2026-11-07; `sql/add-joya.sql`). Page `/payments`
  (`client/pages/Payments.js`) = a read-only board (today / this week / 30 days / all, totals, "bank loaded up to") + the
  area's chat (AREA 6). Everything is said in the chat: planner field `payments` (add / move / amount / cancel,
  `CHANGE_FORMATS.PAYMENTS`; forward dates, week-of-month windows 1–7 / 8–14 / 15–21 / 22–end, monthly series) →
  `payments.checkOps` → proposal `PAYMENT_OPS` → Apply → `applyOps`; reading = calc `payments_due`. **PAID only from the
  bank file** (`matchWithBank`: 485 transfers / 515 standing orders, same amount, −7…+21 days, the payee's name after
  "לטובת:", else the only candidate; unclear → the board's confirm button). Transfers only, no cheques. The board's grid
  has a free `side` slot for the cash-flow panel (next). README → "Payments". Tests `test/test_payments.mjs` (20); eval `p-*`
  13/13; full run 131/133 at concurrency 2 (one JSON glitch passed on rerun; `f-bank-recon-sections` had drifted to
  bank_open_items ×2 → the report rule now says "both sides at once → bank_recon_report alone", 3/3 after). The planner
  writes `dueWeek` as numbers { year, month, week }: a quoted "YYYY-MM" inside the object lost its closing quote every time.
  Deployed 2026-11-08 (`63218b2`; hq build + joya-hq and joya-runner restarted); owner's click-through still open.
- Planner eval: see the books (2026-11-07) for the latest run. Unit 34, runner 12, smoke 63 + 1 known failure ("the raised quantity
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
