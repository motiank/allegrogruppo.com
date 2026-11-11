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
  s18) the party's כרטסת (PDF / xlsx / csv) is attached with the paperclip → `POST /joya/ai/ask-file` → text in `meta_json.attachment` (`src/services/attachments.js`; PDF via `pdftotext` when
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
  Same day: the file is a summary tab + a tab per month (day sums, month total; years from today+2 one tab each —
  `chequeTabs`), and שקלפ without dates = today → the end of the third month ahead (`futureChequesRange`), read from
  `/cheques/all` so the post-dated Priority cheques count (README → "Future cheques by day").
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
- **Bank reconciliation report in Joya** (2026-11-07): page `/accounting/bank-recon` (not in the menu — the chat answers it (suggestion 9 of the accounting area) and the buttons under the answer open the page;
  admin) showing the admin's report through `/api/joya/finance/bank-recon?format=html|xlsx|json` (Finance API
  `/finance/bank/report`), and the calc `bank_recon_report` (24th finance calc; buttons under the answer in `AskBox.js`).
  README → "The detailed bank reconciliation report". Eval fixtures `f-bank-recon-report*`, `f-bank-recon-sections`.
  Cheque lines in every bank list (bank_transactions, bank_open_items, the report's section 1) carry `payee` / `payeeSource`
  from the admin (Hashavshevet); the analyst writes "שיק <no> – <payee>" and "לא נמצא בחשבשבת" for `missing`.
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
