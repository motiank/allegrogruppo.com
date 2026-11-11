# Joya HQ

The AI headquarters of the **Allegro group restaurants** (built 2026-10-12 in the tradewit repo, moved here to the
Allegro repo on 2026-10-24). It analyses restaurant data, makes recommendations (ordering lists, weekly staffing),
lets managers edit and approve them, and learns from what they approved and what really happened. Address:
**https://hq.allegrogruppo.com** (planned; the admin is https://admin.allegrogruppo.com).

**A separate service in this repo**, like `admin/`, `order_sys/` and `events/`: own Express server (`server.js`,
port 4300), own phone app, own `package.json`, own systemd unit. It shares with the admin:
- **the users** — the Allegro admin users (`users.json` at the repo root, managed in the admin). The password is
  checked with the admin's own method (`admin/server/auth` `userApi.getUserKey`); Joya keeps its own session cookie.
- **the data** — read on demand from the admin **Local Data API** (`../local_api_readme.md`), never copied:
  `src/services/source.js` (client `lib/allegro.js`, answers kept in memory for 5 minutes). The API answers on
  its own machine only, which is why Joya runs on the same server as the admin.
- **the database server** — Joya's own records (decisions, edits, rules, notes, chat) are 10 tables
  `joya_*` (`sql/add-joya.sql`) in `DB_NAME` (the `allegro` DB; `JOYA_DB_NAME` overrides it). A real column only
  where we query on it; config lists and the lines/edits of a plan or list are JSON (see "Tables" below).

The AI runner is `runner/` (it talks to this service over HTTP).

## Run

```bash
cd hq
npm install
npm run build              # client/ → prod/ (the phone app)
npm start                  # :4300 (JOYA_HQ_PORT), host 127.0.0.1 (JOYA_HQ_HOST)
npm run runner             # the AI runner (answers the chat); needs Joya HQ running
npm run dev                # nodemon; with `npm run dev:client` (Vite :5175, proxies /api to :4300)
```

Env (`lib/env.js`, later files win): the repo-root `.env` (the DB of every Allegro service — **production**),
then `hq/.env` (Joya's secrets on the server), then `hq/.env.local` (development settings; no `DB_*`, so
development uses the production DB too). Example: `env.joya-hq.example`. Needs `JOYA_SESSION_SECRET` (the server refuses to
start without it) and, in production, `JOYA_API_KEY` (the runner's key) and `NODE_ENV=production` (secure cookie).
The chat needs the AI runner running, and all data needs the Allegro admin running (port 3021).

| Part | Where |
|---|---|
| Server | `server.js` — `/health`, `/api/session|login|logout`, `/api/joya/*`, the built app from `prod/` |
| Env, log, DB pool | `lib/env.js`, `lib/log.js` (pino), `lib/dbpool.js` |
| Logins, runner key | `src/auth/session.js`, `src/auth/machineKey.js`, `src/sessionRoutes.js` |
| API routes | `src/routes.js` |
| Permissions | `src/access.js` |
| Logic (pure, unit-tested) | `src/lib/` — `recommend.js`, `staffingRules.js`, `demand.js`, `fields.js`, `csv.js` |
| Source data (Allegro API) | `lib/allegro.js` (HTTP + 5-min memory cache), `src/services/source.js` (the only reader of source data) |
| Services (DB) | `src/services/` — replenishment, staffing, demand, analytics, payroll, quality, work (overview), master, ai |
| Phone app | `client/` — `index.js`, `App.js` (login or app), `Login.js`, `JoyaApp.js` (shell + routes), `pages/*`, `AskBox.js`, `i18n/` (provider `index.js` + dictionaries) |
| AI runner | `runner/` (`npm run runner`) — `claude -p` on the Claude subscription, no API key |
| Tests | `npm test` (logic) · end to end on the local mirror: `node scripts/fake-allegro.mjs 4399`, then `ALLEGRO_API_URL=http://localhost:4399/local-api/v1 JOYA_HQ_PORT=4360 node server.js`, then `node scripts/joya-smoke.mjs http://localhost:4360`, both with `ALLEGRO_USERS_FILE=<a test file>` (the smoke test writes its own users there) · `npm run test:runner` · planner eval (real model): `npm run eval`; its contexts: `node scripts/joya-eval-context.mjs` (local DB + fake API) |
| Demo | `scripts/fake-allegro.mjs` serves made-up source data of two demo branches (`demo-tlv`, `demo-hfa`) in the API's shapes; `node scripts/joya-seed-demo.mjs` (`--remove`) writes Joya's own demo records for them (menu, rules, past lists…), every row `is_demo = 1`. Both use `scripts/demo-defs.mjs`; dates are relative to the day they run |
| Logins and rights | only the Allegro admin users (`users.json`, added and changed in the admin); Settings → Users only shows them |

## What is kept apart

1. **Source data** — in Allegro, never copied here: Beecomm orders (`/beecomm/orders/stored`, a check = a closed
   order, amount = `netTotal − serviceAmount`), dish sales (`/beecomm/items/stored`), employees (`/employees`), Tabit
   clock rows (`/shifts/raw`), the saved payroll month (`/payroll`, `/shifts/summary`) and its daily payslip gross
   (`/labor/daily`). Entered here: the menu (`joya_menu_items`, by Beecomm dish id — from the API later, postponed)
   with its recipe (`recipe_json`), ingredients, shortages.
2. **Recommendations** — `joya_order_lists.recommendation_json`, `joya_staffing_plans.proposal_json`. Never edited.
3. **Manager edits** — `lines_json` (the working copy) and `edits_json` (who, when, before/after, `UI` or `CHAT`) on
   the list / plan row, `joya_attendance_corrections` (by Allegro raw shift id, with the raw times copied in; the raw
   row is never changed).
4. **Approved decisions** — `joya_order_lists.final_json`, `joya_staffing_plans.final_json`, frozen at approval.
5. **Execution / outcome** — `joya_order_lists.ordered_json` + `ordered_by/at` (marked as really ordered, separate
   from approved); actual demand and worked hours, computed from the source data ("planned vs actual").

Ids: a location id **is** the Allegro branch id (every `location_id` column is `VARCHAR(64)`). Joya keeps no locations
table: the list of branches, their names and companies come from `/branches` (the admin's `shared/restaurants.json`),
and a location is active when its branch had Beecomm orders in the last 60 days (`/status`); an inactive one (for
example a closed branch) is hidden from the picker. When Allegro cannot be reached, the last list read since the
server started is used. An employee id is Allegro's `employeeId`; an
attendance id is Allegro's raw shift id. The `roleAliases` config maps Allegro role names ('מלצר', 'פס חם'…) to Joya
role codes (Settings → Role names; unmapped names are listed on the data page). National ids and phones from Allegro are
never kept or shown.

`joya_audit_log` records every action with the user. `is_demo = 1` marks demonstration rows; the app shows a banner.

### Tables (2026-10-24: 27 → 10)

| Table | Holds |
|---|---|
| `joya_settings` | One JSON document per name: the numbers of the Settings page (`replenishment`, `staffing`, `labor`, `dataQuality`), `roles`, `roleAliases`, `staffingRules`, and per location `location:<id>` = its `shifts` and staffing `baseline`. Read whole, cached 30 s, written under a row lock (`db.js` `getConfig` / `updateConfig`). A shift's id is its code. |
| `joya_staffing_plans` | One row per location and week; `proposal_json`, `lines_json`, `edits_json`, `final_json`, `forecast_json`, `rules_json`. Line and edit ids are numbered inside the row. |
| `joya_order_lists` | One row per location and date; `recommendation_json`, `lines_json`, `edits_json`, `final_json`, `ordered_json`. |
| `joya_ingredients`, `joya_menu_items` (+ `recipe_json`), `joya_shortages` | Stock master data and reported shortages. |
| `joya_payroll_issues`, `joya_attendance_corrections` | Payroll checks (by period / status) and documented clock corrections (by raw shift id). |
| `joya_ai_requests` | The chat queue the runner polls by status. |
| `joya_payments` | The planned bank transfers of a company (the Payments area, 2026-11-07): payee, amount, a day or a week-of-month window, a monthly series (the head row holds `repeat_json`, the instances point to it by `series_id`), status PLANNED / PAID / CANCELLED, the bank line that paid it (`bank_tx_key`, unique). PAID comes only from the bank file. |
| `joya_audit_log` | Who did what. |

Dropped for this phase (owner, 2026-10-24): tasks, Instagram/Google inquiries, and CSV imports (menu, recipes and
order history are entered in the app). "What the system learned" is computed when asked, not stored.

## Integrations — what is real

**Allegro admin Local Data API** — live and read-only, for everything above. `ALLEGRO_API_URL` (default
`http://localhost:3021/local-api/v1`); the API answers **only on its own machine** (loopback, no proxy headers,
`Host: localhost`), so joya-hq must run next to the Allegro admin or reach it through an SSH tunnel. When it cannot be
reached, the pages say so (data page: `ALLEGRO_UNREACHABLE`; routes answer 502) — nothing is shown from a copy.
`/status` tells "not loaded yet" apart from days without sales (counted only up to Allegro's last loaded day).
**Days without sales are closed days** (owner 2026-10-27: the data is the real work — weekly closed days, holidays,
closed branches): sums, averages and the labor cost stand as they are; the AI may name these days but never calls them
missing data, and the data page shows them as a LOW note.
**Files in the chat** (owner 2026-10-31): a file dropped on a chat area (or picked with 📎) is read by the Allegro
admin's Upload files code (Allegro `POST /files/recognize`), the card shows what it is, and "Import" writes it to the
Allegro tables (`POST /files/import`, `client/FileDrop.js`, routes `/joya/files/*`). Joya keeps nothing. Rights: the
chain admin = every file; a manager = the Tabit reports of their branches, no bank files; the accountant = only the
bank files of their companies' accounts. Employee lists and Micpal / Shiklulit files link to the admin page.

**The shifts themselves** (owner 2026-10-30): the `clock_rows` calculation lists every clock row of the Tabit report
(date, name, role, morning/evening, in, out, hours) for a person, a date or a shift. `employees` gives only totals.

**Attendance reports** (דיווחי נוכחות, owner 2026-10-30) = the Tabit Shift clock report only (`attendance_report`
calculation, `attendanceReport` in `src/services/attendance.js`). Its problems: open shifts (an entry without an exit,
an exit without an entry), no-shows (in the Tabit work plan that day, no clock times) and people who clocked in on a day
they were not in the plan. The plan comes from Allegro `/shifts/plan`; a day that was not over when the report was read
is not checked.

**A new employee** (owner 2026-10-29) = worked in the period and has no employee number in Micpal (= has not handed in
form 101 yet); employees marked as a contractor (עובד קבלן) are never new; the `employees` calculation with from/to marks them (`newEmployee`, `newEmployees`). The number comes
from the admin's `payroll_soft_ix` (linked by ID number); HQ gets only `hasPayrollNumber`. Settings → Connections checks the API; Settings → Locations (read-only) → "Read Allegro again now" clears the cache.

### Data map — table → admin API → AI calculation

Every number the AI gives comes from one AI calculation (`src/services/ai.js` CALCS), which reads one admin endpoint
(`src/services/source.js`), which reads one table in the `allegro` DB. Joya stores none of these (only its own `joya_*`).

| Topic | Table (allegro DB) | Filled by | Admin endpoint | AI calculation(s) |
|---|---|---|---|---|
| Sales: revenue, checks, diners, shifts | `bcom_orders` | Beecomm API, daily job | `/beecomm/orders/stored` | `sales_summary`, `sales_daily`, `sales_by_shift`, `sales_anomalies`, `shift_profile`, `shift_demand_recent` |
| Dishes sold | `bcom_items_daily` | Beecomm API, daily job | `/beecomm/items/stored` | `sales_by_dish` |
| **Income by payment method** (credit card + brand, cash, Wolt, 10bis, Sodexo…), tips, refunds | `bcom_payments_daily` | Beecomm payments report, daily job | `/beecomm/payments/stored` | `payments_summary` |
| Z reports, daily cash summary | `bcom_z_reports`, `bcom_cash` | Beecomm | `/beecomm/z-reports/stored`, `/beecomm/daily` | (data quality, labor %) |
| **Bank account**: money in/out, balance, deposits, checks (a cheque row carries the beneficiary from Hashavshevet: `payee` / `payeeSource`), transfers | `bank_transactions` | bank file on the Upload page | `/bank/transactions/stored` | `bank_summary`, `bank_transactions`, `cards_vs_bank` (with Beecomm payments) |
| Employees, roles, wages | `employees` | admin Employees page | `/employees` | `employees` |
| Clock times (who worked when) | `tabit_shifts` | Tabit Shift API, daily 06:30 / Upload page | `/shifts/raw`, `/shifts/by-shift` | `staffing_actual`, `staffing_forecast_week`, `labor_summary` (hours) |
| Payroll, labor cost | `payroll` (+ `tabit_shifts`, `bcom_cash`) | admin Shifts page (saved payroll) | `/payroll`, `/shifts/summary`, `/labor/daily` | `labor_summary`, `payroll_issues` |
| Branches, companies | `branches` + `shared/restaurants.json` | admin | `/branches` | the picker, `context.locations` |
| **The books** (Hashavshevet copy, `allegro_finance` DB): P&L, cash, suppliers, debts, trial balance, account cards, journal, bank reconciliation, invoices, cheques, VAT in the books, withholding, allocation numbers, exceptions, change history | `allegro_finance.*` (hash-sync, nightly) | hash-sync | `/finance/*` (`../finance_api_readme.md`) | `finance_status`, `pnl`, `cash_position`, `branch_costs`, `sales_vs_books`, `spending`, `aging`, `intercompany`, `trial_balance`, `account_card`, `journal_search`, `bank_reconciliation`, `bank_recon_report`, `bank_open_items`, `bank_match_suggestions`, `customer_invoices`, `account_statement`, `cheques`, `priority_cheques` (the Priority cheque file, before Hashavshevet), `vat_summary`, `withholding`, `allocation_numbers`, `missing_invoices` (invoices not booked yet, channel by channel — first channel: the invoice agent's Drive index, flag written back into Drive), `payroll_check`, `exceptions`, `change_history` (`src/services/finance.js`) — chain admin only |

**Credit card vs members club (Beecomm, owner 2026-10-26).** "Credit card" = only **VISA, MASTERCARD, AMEX and DINERS** (and ISRACARD, DISCOVER, MAESTRO — owner, 2026-11-03) of
the credit type (אשראי). Every other brand of that type (PRIVATE LABEL BRAND - חבר…) is the
**members club** (מועדון חברים), except **Mishloha** ("אשראי - MISHLOHA", online orders paid by card): its own group
(owner, 2026-11-03). `payments_summary` always returns all three: `creditCards` / `membersClub` / `mishloha` per
location and `creditCardsTotal` / `membersClubTotal` / `mishlohaTotal`.

**Weekly and monthly sums.** The model never adds numbers itself, so a table per week or month comes from one
calculation with `group: "week"` (Sunday–Saturday) or `"month"`: `payments_summary` (`byPeriod`, `byPeriodTotal`) and
`bank_summary` (`byPeriod`). **`cards_vs_bank`** follows how the card companies really pay (checked on Pasta Lina, Jun–Oct 2026):
- **Max** pays **VISA** (merchant numbers `002…`) and **MASTERCARD** (`007…`) every **Wednesday** for the Sunday–Saturday
  week before. Over 19 weeks the bank was **1.6% under** Beecomm = Max's fee. One week can be ±10–30% for one restaurant
  (a day paid a week late or early); the next week evens it out. Max's `008…` numbers pay once a month (28th), something else.
- **American Express** pays about twice a month (2nd and 8th) for the month before → compared **by month** (1.5–4.8% under).
- Not compared: the members club (חבר משרתי קבע / מועדון חבר, monthly, ~65–75% of Beecomm's club card), Isracard debits
  (fees, many small ones and a bigger one around the 2nd), Diners (no payer seen in the bank).
- `bankNotComplete` = the bank file does not cover those payouts yet.

**`card_income_week`** = the card money expected in a Sunday–Saturday week (default this week), from Beecomm and the pay
rules, in two parts: **credit cards** (VISA + MASTERCARD + DINERS of the week before, Max pays on Wednesday) and
**American Express** (owner, 2026-10-27: sales received on the 1st–15th are paid on the **2nd** of the next month, the
16th–end on the **8th**; a Saturday pay day moves to Sunday). Gross, before fees.

**Money that has two sources.** Card (and Wolt / 10bis) income is in Beecomm AND in the bank; the words of the
question decide, and the **menu area sets the default** (owner, 2026-10-26; rules in `runner/hq-analyst.js`,
"Which source"):
- **Performance** area → Beecomm by default; the bank only when the question says "in the bank / the account / deposited".
- **Bank** area → the bank by default; Beecomm only when the question says "at the register / sold / sales", a card
  brand, tips or the card forecast.
- **Manpower** → employees, clock times, payroll. **Stock** → order lists and items.
- **Accounting** (הנהלת חשבונות, owner 2026-10-31) → the register matched with the bank: card, Wolt and other money sold
  at the register vs what arrived in the bank, and the fees (`cards_vs_bank`, `payments_summary` + `bank_*`). For
  the chain admin and the accountant. **Since 2026-11-07 also the books** (below): profit and loss, suppliers, debts,
  trial balance, account cards, cheques, VAT in the books… — the chain admin only (owner's decision 1).
- No area (a page's chat):
  - **sold / charged at the register** (by brand, tips, refunds) = **Beecomm payments**
    (`payments_summary`): the day of the sale, gross.
  - **received in the bank account** (deposited by Max / Isracard / Amex / Wolt, when the money arrived) = **the bank**
    (`bank_transactions` / `bank_summary`): days later, in batches, after fees.
  - **not clear which** → **both**.
- **A comparison** (card sales vs what arrived in the bank) → both, in any area. The answer gives the two numbers
  apart and explains the difference (timing and fees), never their sum.
- **Revenue** = `sales_summary` (Beecomm orders). Money in the bank is not revenue.
- **Wages** (the rate per person or role) = `employees`; **labor cost** in money over a period = `labor_summary`.

The staffing plan is exported as a **CSV for Tabit**. Nothing is sent to a supplier, Tabit, Instagram or Google.


**Monthly VAT report (owner, 2026-11-03)** — calc `vat_report` (`analytics.vatReport`), from the Beecomm payments
(`/beecomm/payments/stored`): income = all payments in the Z, paid − refunded (Beecomm's "סה״כ"). It has no tips:
the card tips are inside the card rows, but the workers get them in cash from the register, so the cash row is lower by
them — never subtract `service` again (it was, until the fix of 2026-11-03). Then (owner, 2026-11-09): the הקפה
payments (`hakafa`, payment type 5, Beecomm's "סה״כ הקפה") are taken out — a customer who pays later gets a tax invoice
from us, so that money is reported for VAT through the invoice, not through the register; and 20% of the payments of
חבר (`hever`: the credit brands "PRIVATE LABEL BRAND - חבר" AND "PRIVATE LABEL BRAND" — both are חבר, owner 2026-11-09)
is deducted — Hever's commission, which Hever does not invoice; only חבר, מולטיפס is not (owner, 2026-11-03, changed
the first version); income for VAT = income − hakafa − deduction; VAT = 18/118 of it. Per month, per restaurant, per
company, in total. Rules in `hq/src/lib/vatRules.js` (pure, tested in `test/test_joya_lib.mjs`). Owner's answers:
מועדון חברים = חבר (no other club brand is deducted); without tips; show the VAT. Checked 2026-11-03 against Beecomm's
payments report: פסטלינה רמת החייל, August 2026 income = 736,391, same as Beecomm's "סה״כ".
**The books (owner 2026-11-07)** — the accountant's bookkeeping in Hashavshevet, copied nightly by `hash-sync` into the
`allegro_finance` database and served by the admin's **Finance API** (`/local-api/v1/finance/*`, `../finance_api_readme.md`,
built and deployed 2026-11-07). Joya reads it through `source.finance()` / `source.financeCompanies()` and the
calculations in `src/services/finance.js`, **per company** (a finance company is linked to an Allegro company key by
`/finance/companies`; today only Pastalina is loaded — the other companies answer "no finance data yet"). Nothing is
stored or computed here: every number is the admin's. **Chain admin only** (decision 1; the accountant may get them later
by adding them to `ACCOUNTANT_CALCS`). The default source for accounting words in the הנהלת חשבונות area, and the
source in any area when the question says "בספרים" / "from the books"; "הכנסות" alone stays Beecomm. Every result has
`companies[].warnings` from the admin, `high` first: no salary expense in 2026, income not posted after August 2026, a bank
gap of 6.16 million, supplier balances that look wrong, "not checked by the accountant yet" — the writer puts a `high`
warning as a "⚠" line next to the numbers it affects (WRITE prompt, "The books"). **Supplier invoices as the books hold
them** (owner 2026-11-09, calc `supplier_invoices`, `GET /finance/invoices?side=supplier`): the invoice date, the entry
date (`entryDate`, the day the bookkeeper keyed it in), supplier, number (the last digits, as Hashavshevet keeps it),
amount with VAT (a credit note minus), the expense account and the batch — "חשבוניות ספקים / הוצאה שבספרים", "תאריך
הזנה ותאריך הוצאה"; never `missing_invoices` for it (that one compares Drive with the books). Amounts are without VAT except supplier
invoices, customer invoices and cheques. `vat_summary` (the books) is not `vat_report` (Beecomm). An account named by
text (`q`) that matches several accounts comes back `ambiguous` with the matches, and the answer asks which one. The
accounting menu suggests 8 more questions for the chain admin (`joya.area.accounting.s9`–`s16`). **Missing invoices
(owner 2026-11-08)**: `missing_invoices` — "which invoices are not booked yet" is one question with several CHANNELS to
look in, and the answer is one part per channel (`channels[]`, each with its title); the user asks about missing
invoices, never about a channel. First channel `drive` → `/finance/invoices/drive-check`: the invoices the invoice agent
filed in the accountant's Google Drive (every invoice that reached the mailbox) against the books — counts and totals
per status (booked / pending / not_booked / amount_differs / no_account), the rows asked for, and the match written back
into Drive (`books.matched`) by the admin. More channels later (`otherChannels`: bank debits with no invoice in the
books, supplier statements) are added in `INVOICE_CHANNELS` of `src/services/finance.js`. Eval fixtures `f-drive-*`,
`f-missing-*`. Eval fixtures `f-*`
(kind `ACCOUNTING`, 21 questions) + `f-pnl-general-area`; the fake API serves made-up finance shapes
(`scripts/fake-allegro.mjs` `FIN_ROUTES`: companies, status, pnl, cash, aging, trial-balance, ledger, bank/report).

**The detailed bank reconciliation report** (דוח התאמת בנק מפורט, owner 2026-11-07: "I want it in the Joya HQ") is the
admin's report (`admin/server/modules/bankRecon.js`, Hebrew RTL HTML + Excel) served to Joya by the Finance API
(`/finance/bank/report?company&account&from&to&format=json|html|xlsx`, `/finance/bank/report/accounts`). Two ways in,
chain admin only: the page `/accounting/bank-recon` (not in the menu: asked in free language in the accounting chat, suggestion "תכין לי דוח התאמת בנק מפורט לחודש שעבר", and opened from the buttons under the answer; picks the
account and dates, shows the admin's HTML in a frame, offers the Excel and a print tab — Joya routes
`/api/joya/finance/bank-recon[/accounts]`, `source.financeBankReport*`), and the calc `bank_recon_report` in the chat
("תכין לי דוח התאמת בנק מפורט לאוקטובר"): the summary that ties the bank balance to the book balance, the biggest rows of
each section, and the buttons "פתח את הדוח המלא" / Excel under the answer (`AskBox.js` `BankReconFiles`). Nothing is
computed or stored in Joya.

**Payments (תשלומים, owner 2026-11-07: "a new section on the main menu … pay to someone now / in the future, see the
payments for today / week / upcoming to feed the bank, move a payment, later side by side with the cash flow").** The
only Joya-owned finance data: the planned **bank transfers** of a company (`joya_payments`, `src/services/payments.js`),
chain admin only. Main-menu area `/payments` (`client/pages/Payments.js`): the board on top (tabs היום / השבוע / 30 יום /
הכל; groups overdue → today → this week → later → paid → cancelled with totals; the company when there are several;
"the bank file is loaded up to …") and the area's chat under it (context `AREA` 6, suggestions `joya.area.payments.s1`–`s6`).
The board is read-only: everything is said in the chat, in any area — "תשלם לאבי כהן 5,000 ₪ ב-15 בנובמבר", "תעביר
עכשיו …", "בשבוע השני של דצמבר תשלם לבעל הבית 20,000", "כל חודש ב-10 לחודש …", "שלם לאימפורט 20 אלף ב-5 תשלומים בשבוע
ה-3 בכל חודש" (= 5 payments of 4,000, `repeat.count`; the series closes after the 5th: `until`), "תזיז את תשלום #12
ל-20.11", "תשנה את הסכום של תשלום #12 ל-6,000", "תבטל את תשלום #12" → the planner's `payments` list
(`CHANGE_FORMATS.PAYMENTS`: add / move / amount / cancel; dates look forward, "now" = today, a day without a month = the
next such day) → `checkOps`
(a past day or week is refused; a known payee in another spelling takes the known spelling, `context.payees`) → proposal
`PAYMENT_OPS` with one text line per change → **Apply** → `applyOps` (audit `PAYMENT_ADDED / MOVED / AMOUNT / CANCELLED`).
A "week of the month" is a window: week 1 = days 1–7, 2 = 8–14, 3 = 15–21, 4 = 22–end. A monthly series is made
`HORIZON_MONTHS` (12) ahead and topped up when the board is read; "scope: series" moves the rule / changes the amount /
ends the series from that month. Reading: calc `payments_due` (from, to, status) → "מה צריך לשלם היום / השבוע?".
**Paid only from the bank file**: when the board or the calc is read, `matchWithBank` takes the company's debit lines
from the admin (`/bank/transactions/stored`, operation codes 485 transfers and 515 standing orders, never 473 fees),
and a PLANNED payment becomes PAID when a line of the same amount, dated 7 days before the due day to 21 days after
the window, carries its payee's name after "לטובת:" (or a standing order's action text) — else when it is the only
such line of the only such payment; two payments of one amount with unnamed lines stay open and the board shows
"יש בבנק שורה בסכום הזה — זה התשלום הזה?" with a confirm button (`POST /joya/payments/:id/match`). A bank line pays one
payment only (`bank_tx_key` unique). OVERDUE = a planned payment whose window passed with no bank line. The company:
the picker's, the one the question names (`companyKey`), or the one company with a bank account. Routes (admin):
`GET /joya/payments?company&from&to&status`, `GET /joya/payments/payees`, `POST /joya/payments`, `PATCH /joya/payments/:id`,
`POST /joya/payments/:id/cancel|match` — the same `checkOps → applyOps` path as the chat. The board is a grid with a free
`side` slot: **the cash-flow panel will sit next to the payments there** (owner: remember it for the cash-flow work).
Tests: `test/test_payments.mjs` (windows, month ends, series, name matching, the two-pass bank match, the ops); eval
fixtures `p-*` (kind `PAYMENTS`, context `contexts.json` → PAYMENTS with `payees`; `expect.payments`).

## Permissions

- Login = an Allegro admin user (e-mail + the admin password, status `active`). The session is a JWT in the
  httpOnly cookie `joya_session` (7 days), signed with `JOYA_SESSION_SECRET` and audience `joya-hq`, so a token
  of another app never passes. A user made inactive in the admin loses Joya access at the next request.
- The AI runner calls `/api/joya/ai/runner/*` with `X-Joya-Key` = `JOYA_API_KEY`; with no key set, only loopback
  callers pass.
- Joya access comes from the Allegro role: `admin` → `CHAIN_ADMIN` (all locations, settings, chain-wide and
  mandatory rules, users), `restMngr` → `LOCATION_MANAGER` of the user's `restaurants` (Allegro branch ids, `*` =
  all); both with payroll access (wages, payroll lines, labor cost in money). `accountant` → `ACCOUNTANT` of the
  user's `restaurants`: only the Accounting area — its chat (`/joya/me`, `/joya/locations`, `/joya/ai/ask|requests`;
  every other route is 403, `limitAccountant`) and only its calculations (sales, payments, the bank of those
  companies); no payroll. In the Allegro admin this role has no handler, so it sees no admin data. Any other role: no access. Users
  and rights are kept **only** in that JSON file (owner, 2026-10-24) — no Joya table or file of users. Every route checks the location it touches; lists are filtered to the user's locations; the AI
  calculations run with the asking user's access.
- The top bar has one picker: each company, with its restaurants indented below it. Each location's company is the
  Allegro branch's `company` (from `/branches`, not stored). An admin may pick "all companies" (when there are
  several) or a company line (all its restaurants), and a page then covers those locations; for a manager the
  company lines are headings only.
- A chat question carries the picker choice: `locationId`, or `companyKey` (kept in `joya_ai_requests.meta_json.scope`).
  The runner sees it as `request.scope` and the planner uses it unless the question names other restaurants; a
  calculation with no location of its own runs on it too (`scopeIds` in `ai.js` `compute`).

## Replenishment — how the recommendation learns

Not perpetual inventory: the system never knows current stock and never says it does.

**Learning examples** are the location's *final* order lists (newest `historyLists`, default 8): `ORDERED` lists
weigh 1, approved-but-not-marked-ordered weigh `approvedOnlyWeight` (0.5), and newer lists weigh
more (half-life `halfLifeLists` = 4 lists). A final list includes the manager's changes and added items, so every
edit becomes part of the next recommendation — no model retraining. Learning is **per location**.

Per item, `lib/recommend.js` keeps plain numbers (computed from the final lists when asked, shown on "What the
system learned"): times ordered, median days between orders, weighted median quantity, the
**sales ratio** (quantity ordered ÷ units sold of the dishes linked to the item since the previous order — only
when every day of that window has POS data), and how often the manager removed it when suggested.

Quantity, first that applies: `SALES_RATIO` (≥ 3 ratios: ratio × linked dish units sold since the last order) →
`HISTORY_MEDIAN` (≥ 2 past quantities) → `RECIPE_ESTIMATE` (only when every linked dish has a recipe quantity in a
convertible unit; always LOW confidence, labelled an estimate) → `NONE` (quantity left empty for the manager).
Due: a shortage reported since the last order, or days since the last order ≥ `dueFraction` (0.8) × median
interval. A shortage raises the quantity by `shortageBumpPct` (15 %). An item removed in ≥ 75 % of the lists that
suggested it moves to "check". Sections: `SUGGESTED`, `CHECK` (decision or quantity for the manager), `NOT_DUE`.
Every line stores its basis (reasons, calculation, examples with weights) and the page shows it.

What it does **not** assume: a final list is how this manager orders, not proof of consumption; no shortage report
does not mean the order was right (no quantity is ever lowered for that); ingredients without recipe quantities
link dishes to items but never produce a "consumption" number. With too little history the list is partial and the
manager completes it; approval is refused while a kept line has no quantity.

All numbers above are in `joya_settings.replenishment` (Settings page).

## Staffing — rules, demand units, proposal

Demand units (`lib/demand.js`), from Bikum checks. An **order = one POS check**, counted when it is *opened*:
`DINERS_PER_SHIFT`, `DINERS_PEAK_HOUR` (busiest clock hour of the shift), `CONCURRENT_DINERS_PEAK` (most diners
seated at once, sampled every 15 min, needs check close times), `ORDERS_PER_SHIFT`, `ORDERS_PEAK_HOUR`. More than
20 % of checks without a diner count → diner units are unknown, not 0.

Forecast: median of the same weekday and shift over the previous `historyWeeks` (8); days without POS data are
left out and listed. Rules (`lib/staffingRules.js`): `FIXED`, `MIN`, `MAX`, `RATIO`, `STEPS`, `PEAK_EXTRA` (extra
people for a window when peak demand passes a threshold), each with a demand unit, scope (location / shift / days),
optional role start/end times and a `mandatory` flag. The most specific rule of each type wins; RATIO and STEPS →
the larger. Unknown demand → the minimum only, never "0 staff". Roles no rule covers use the **baseline** (existing
staffing examples). The output is roles, headcounts and hours — no names.

**Learning from edits** never changes a rule: when the approved plans differ from the proposals in the same slot in
the same direction in ≥ 3 of the last 4 plans, the proposal applies the median change and says so ("you added 1
in 3 of the last 4 weeks; rule result 2"), never below the mandatory minimum. Manager edits below a mandatory
minimum are refused (422 `MANDATORY_MIN`); chain-wide and mandatory rules are changed only by the chain admin.

### Learned staffing (no plan, no rules) — `src/lib/shiftModel.js`, `services/shiftModel.js`

The chat's "how many employees per shift next week" (`staffing_forecast_week`) and "what does an average
shift look like" (`shift_profile`) need no plan and no stored rule. From the last `profileWeeks` (8) weeks:
- **Profile:** per weekday × shift, the diners (sit-down checks, order type 1) and deliveries (every other
  check) as an exponential moving average (EMA) over the weeks, span `profileEmaWeeks` (4): each newer week
  weighs α = 2 / (span + 1) = 0.4, so the profile follows the season quickly. Morning = checks opened before `shiftSplit` (17:00), evening = from it (after midnight = the
  evening of the business date).
- **Ratios:** per Allegro role name and shift, diners ÷ people, from the shifts that have both sales and staff
  (Allegro `/shifts/by-shift`, computed by the Allegro admin from the Tabit clock times). Kitchen roles
  (`kitchenRoles`, or a role mapped to `cook`) count 1 delivery as `deliveryAsDiners` (1) diners. A role
  with ≥ `minWeekdayShifts` (3) shifts on a weekday also gets that weekday's own ratio (a busy Friday serves
  more diners per person than a quiet Monday). Every Tabit role counts, trainees too; Rosh Pina has no roles
  in Tabit, so its forecast is one total (`בלת"מ`).
- **Forecast:** people = profile load ÷ ratio (the weekday's when learned), rounded to the nearest, at least 1
  — only for roles that worked in ≥ `minPresence` (50 %) of those weekday shifts (a rare role's ratio comes
  from its few shifts, so it would add a person to every shift). The result lists the usual headcount next to it.
Settings (`joya_settings` 'staffing', all optional): `profileWeeks`, `profileEmaWeeks`, `shiftSplit`, `deliveryAsDiners`,
`minPresence`, `minWeekdayShifts`, `minHoursInShift`, `kitchenRoles`. Without `/shifts/by-shift` (older Allegro) or with no clock
times, the answer gives the expected diners only and says why.

**Past shifts** (`staffing_actual`, `actualStaffing`): "how many diners per waiter did we have", "were we over-staffed
last week". For a past period (up to 92 days) per date × shift and role: the people and hours from the Tabit clock
times, diners per person (kitchen roles + deliveries), and `needed` = the load ÷ the role's usual ratio, learned the
same way from the `profileWeeks` weeks ending at the period's end (at least the period itself); `diff` = people −
needed. Always a summary per role × shift (diners per person, min/max, shifts over/under) and the 10 shifts most over
and most under; the shift-by-shift detail only for periods up to 14 days. An optional `role` keeps one role.

## Asking in words

`POST /api/joya/ai/ask` → the runner plans calculations from `services/ai.js` `CALCS` (sales, labor, demand,
plans, lists, quality, payroll issues…), **joya-hq** runs them with the user's access, the runner writes the answer
from the results, and numbers in the answer not found in the results are listed (`meta.unverifiedNumbers`, shown as
a warning). Arithmetic the writer shows in brackets — "4,000 ₪ (= 20,000 ÷ 5)" — is checked and then counts as found
(owner 2026-11-08: "calculate when it is needed", the first hard rule; see below). A change request becomes a validated proposal (same checks as the UI) that is saved only on **Apply**,
logged `via = 'CHAT'`. "Recalculate with …" is a what-if: the stored rules do not change.

The main menu (since 2026-10-23) has three areas, each one a chat: **מלאי ורכש** (`/stock`), **כח אדם** (`/people`),
**ביצועים** (`/performance`) — `client/pages/Area.js`. A question asked there is a request with context `AREA` and
context id 1 / 2 / 3 (`ai.js` `AREAS`), so each area keeps its own
history. While the user types, the chat box suggests questions of that area (strings `joya.area.<area>.sN`) and
the user's own past questions. The detailed pages keep their routes but are not in the menu; Settings is at the
bottom of the menu for a chain admin.

**Chat paging (owner, 2026-11-04).** A chat area opens with its newest 10 questions; scrolling to the top loads the
10 before (`GET /api/joya/ai/requests?…&limit=10&beforeId=<oldest shown id>`), up to 100. The server keeps only the
newest 100 of a chat (`ai.js` `CHAT_KEEP`, `pruneChat` after each new question; one still being answered or with a
change waiting for Apply is kept).

**Chat history (2026-11-04).** Each question gets the earlier questions of the same chat as `<history>` (the same
user and chat; GENERAL also the same restaurant): up to `HISTORY_MAX` = 3 answered questions of the last
`HISTORY_HOURS` = 3 hours, oldest first, with their calcs + params; the writer also gets their answers, cut to 1,200
characters (`ai.js` `chatHistory`, `runner.js` `historyBlock`). So a short follow-up ("and last year?", "ובחיפה?",
"per day") keeps its period, restaurants and topic and runs the calcs again; a question that stands alone ignores it.
Numbers are never taken from history. A deleted question leaves the history.

**Live chat sessions (2026-11-08).** On top of that, the runner keeps each chat's conversation alive in the model
(`runner/session.js`, see `runner/README.md`): the questions of one chat go to the same `claude` processes, so the
model remembers the whole chat — also a question 10 questions back ("explain the 298K debit" after a trial balance and
several other questions). `<history>` is now only the start of a new session (after 30 minutes with no question, a
deleted or re-asked question, a runner restart or a deploy).

**The performance menu (owner, 2026-11-04)** — the ביצועים area suggests only three reports:
- **Weekly performance report** → calc `month_vs_last_year` (`analytics.monthVsLastYear`): per restaurant and for the
  chain, this month's average income per day (up to yesterday) vs the same month last year, the change in %, and the
  income of both months (last year: the whole month). From `/beecomm/daily` (the admin's `bcom_cash`, since 2024; total
  = the Z total, no tips). Only days with income count (closed days are left out).
- **Waiter performance** → calc `waiter_performance`: per waiter (the Beecomm order's `creator`, who opened it) orders,
  income without tips, tips and tips %; Wolt / online orders have no waiter and are shown apart.
- **Daily dashboard** → calc `daily_dashboard`: per restaurant and in total the income (Z total), diners, income per
  diner (orders with diners ÷ their diners — as Beecomm counts it) and refunds (זיכויים). Today comes **live**
  (`/beecomm/z-reports`, `/beecomm/orders`); before anything is sold today, yesterday live. Live needs
  `BCOM_BO_API_KEY` + `BCOM_BO_REFRESH_TOKEN` in the admin's `.env` — **missing on the production server
  (2026-11-04)**; until they are added the dashboard shows the last stored day and says so.
Without `locationIds`, these three leave out the closed restaurants.

**The manpower menu (owner, 2026-11-04)** — the כח אדם area suggests only four items:
- **Active employees** → calc `employees` with this month (the 1st up to today): the people with clock times this month.
- **Employee wages** → the same calc: each person's wage type, wage and the rate per role.
- **Payslip Excel** and **Export to Micpal** → calc `payroll_files` (`ai.js` `payrollFiles`): per restaurant the last
  SAVED payroll month (a named month when one is asked; a month is saved only after it ends), the employees saved and
  when. The chat shows two download buttons under the answer (`AskBox.js` `PayrollFiles`) →
  `GET /api/joya/payroll/files/tlush.xlsx|import.xlsx?locationId=&month=` (payroll access + the location; audit
  `PAYROLL_FILE_DOWNLOADED`) → the admin's Local API `/payroll/tlush.xlsx` / `/payroll/import.xlsx`, which make the
  same files as the Shifts page's Export from the saved payroll (`admin/server/modules/payroll.js`
  `savedPayrollFile`). Nothing is kept in Joya.

**Tables in answers (2026-10-27).** When an answer has several rows of the same numbers (weeks, days, restaurants,
employees…), the writer puts them in a pipe table (`| a | b |` + `|---|---|`; rules in `runner/hq-analyst.js`). The chat
shows it as a table (`client/AskBox.js` → `AnswerBody`), and under every table a **Download Excel** link:
`GET /api/joya/ai/requests/:id/tables/:n.xlsx` (`src/services/answerExcel.js`, exceljs from the repo root; only the
asking user; numbers as numbers, the sheet right-to-left for Hebrew). One reader for both sides: `lib/answerTables.js`.

**Files to Drive (owner 2026-11-09).** The Excel link serves the table that is on the screen. When the user asks for a
FILE ("לאקסל", "ב-XL", "קובץ", "גיליון", "export"), for a whole list that is too big for the chat (more than ~150 rows:
"כל החשבוניות מתחילת השנה", "all the bank lines of the year") or for something to SHARE ("תשתף עם רואה החשבון", "a link
I can send"), the planner adds `"file": { "kind": "sheet", "title", "show", "columns"? }` to the plan (PLAN prompt →
"FILES"; `show` false = the user does not want the table in the chat; `columns` only when the user names the fields).
The hub (`ai.js` `compute`) then runs the same calculations in **export mode** (`params.export = true`: the finance lists
take every row the admin can give, `finance.js` `limitOf` / `EXPORT_MAX` 5000, instead of the chat's first rows), builds
one workbook from the results — every list of objects in them is a tab, nested objects flattened, a result with no
list becomes a key / value tab (`src/lib/sheetTabs.js` `tabsOf`, pure, tested) plus a last tab "Joya" with the
question and the calculations — and uploads it to the owner's Drive folder **with conversion to a Google Sheet**
(`src/services/sheets.js`, Drive API only, no Sheets API: the invoice agent's Google login, the accountant's account,
`INVOICE_DRIVE_CREDENTIALS` / `INVOICE_DRIVE_TOKEN`, scope drive.file; the folder id in `JOYA_SHEETS_FOLDER`, shared
with that account). The file stays with the request (`meta_json.file`: url, name, tabs, rows; `answer()` and the
client keep it), the chat shows **one link under the answer** (`AskBox.js` → `SheetFile`), and the writer gets `<file>`
(what is inside, how many rows) and writes 2–4 lines, no table when `show` is false, never a URL (WRITE prompt →
"FILE ANSWERS"); `<file_error>` (folder or login not set up: `FILE_UNAVAILABLE`; no rows: `NO_ROWS`) → one line and the
table as usual. `context.files.sheet` tells the planner whether files are possible. Works for any calculation in any
area. Eval `x-file-*`.

**Statement compare — השוואת כרטסת לקוח / ספק (owner 2026-11-10: "not a menu item, not a dialog — part of the chat").**
In the accounting chat (chain admin; the last suggestion of the area): the user attaches the statement a supplier or
a customer sent with the chat's paperclip or by dropping it (PDF with text, Excel .xlsx or CSV, up to 15 MB), may add
words ("מספק" / "מלקוח", the name in our books) and sends. In `ChatArea` a PDF anywhere, or an Excel / CSV in the
accounting chat, becomes the attachment of the NEXT question (a chip above the field; with no text the default
question is sent); every other file still goes to the admin's import flow (`FileDrop.js`). `POST /api/joya/ai/ask-file`
(multipart, multer from the repo root) turns the file into TEXT (`src/services/attachments.js`: Excel → tab-separated
lines per sheet with exceljs; PDF → `pdftotext -layout` when installed, else `pdf-parse`; a scanned PDF is refused)
and creates a normal chat request with `meta_json.attachment` { name, kind, chars, cut, text } — the file itself is not
kept, and the client never gets the text. The runner's context carries `attachment`; the PLAN prompt ("STATEMENT
COMPARE") makes the planner read it and extract every row ({ date, reference, description, debit, credit }), the
perspective, the party, the period and the balances, and plan one calc `statement_compare` (`fin.statementCompare`):
it pulls our account card from the Finance API `/ledger` (the party by `q` or `account`, every line of the period) and
`shared/statementCompare.js` compares — both sides as the same two kinds of events (charge = an invoice, payment = money
or a credit note; the column that is the charge depends on the side), one-to-one matching by amount + document number,
then amount + date (45 days), then a one-off amount at any date — and returns ONLY the differences: `onlyTheirs`,
`onlyOurs`, `amountDiffers`, the counts, and the balance gap in one direction (the debt), with how much of it the
listed differences explain. The writer (WRITE "Statement compare") shows one line of counts, one of balances and up to
three tables; several accounts fit the name → it lists them and asks. Follow-up questions stay in the same chat.
Tests: `node --test scripts/test_statement_compare.js`; eval `st-*` (fixtures carry an `attachment`).

**Priority cheques (owner 2026-11-11: "all the cheques created in Priority — use it when you need more info about cheques
and you don't have it in our books or the bank details; a constant file, our history; e.g. bank reconciliations").**
Pasta Lina wrote its cheques in Priority before Hashavshevet (April 2025 – March 2026). The owner's export became the
constant file `shared/priority_cheques.json` (`scripts/priority_cheques_import.js` from `scripts/data/priority-cheque.xlsx`;
2,678 cheques, one record per payment with the invoices it paid). Two uses: (1) every bank cheque line that Hashavshevet
does not know — the reconciliation report's section 1, `bank_open_items`, `bank_match_suggestions`, `bank_transactions` —
now gets its name from the file with `payeeSource: "priority"` ("שיק 10777 – מיט 2 איט (פריוריטי)"; the cheque still
has to be entered in Hashavshevet, the report counts them in a note apart from the missing ones;
`admin/server/modules/chequePayees.js`); (2) calc `priority_cheques` (Finance API `/cheques/priority`): "שיק 10777 של
מי?" plans `cheques` with `number` (Hashavshevet) AND `priority_cheques` with `cheque` (the history); "שיקים ישנים של
<ספק>", "בפריוריטי", a cheque the bank shows as "לא נמצא בחשבשבת" → `priority_cheques` alone (q, from–to on the date
on the cheque, amount). `net` is the amount on the cheque, `amount` is before withholding tax. Tests
`scripts/test_priority_cheques.js`, `scripts/test_cheque_payees.js`; eval `pc-*`.

**Fixed files in Drive (owner 2026-11-11: "merge into one table the Priority and Hashavshevet cheques, create an Excel on
the Drive and provide the link — a fixed file that is updated all the time").** `src/services/fixedSheets.js`: a Google
Sheet per key in the owner's Drive folder that keeps its id and link; the server rewrites it in place
(`upsertFixedSheet` in `sheets.js`: the file is found by `appProperties.joyaFixed = key`, which scope drive.file can
read because the app made it, then `files.update` with the new workbook) every `JOYA_FIXED_SHEETS_EVERY_MIN` minutes
(default 60; 0 = off; first run 2 minutes after start, `startFixedSheets()` in `server.js`) and on request. The link and
the last refresh live in `joya_settings` → `fixedSheets`, so the chat answers without Drive. Key `cheques` = "שיקים –
חשבשבת + פריוריטי · Joya": Finance API `/cheques/all` per finance company, one tab per company with Hebrew columns
(`CHEQUE_COLUMNS`, `chequeRowHe`), the last tab "Joya" says when it was refreshed and the counts. Calc `cheques_file`
(chain admin; `refresh: true` rebuilds now) returns the record and the chat shows the button "פתח את הקובץ הקבוע
בדרייב" under the answer (`SheetFile`, `meta.file.fixed`); the writer never writes the URL. Suggestion
`joya.area.accounting.s19`. Made 2026-11-11 from the owner's machine (4,343 rows, same file on refresh); eval `x-cheques-file*`.

**Future cheques by day (owner 2026-11-11: "when I ask to see future cheques, put them in a table grouped by day and sum
each day").** שקלפ = שיקים לפרעון = the future cheques (PLAN routing word → `cheques` state `future`). The `cheques`
result carries `byDay` (`chequesByDay` in `src/services/finance.js`: every cheque of the selection grouped by due date,
soonest first, with the day's count and sum — computed by the system, so the verifier knows the numbers), and the WRITE
rule "FUTURE CHEQUES" shows one table (תאריך | מוטב | מס' שיק | סכום) with a bold sum row after each day and the grand
total. Eval `f-shaklap`, `f-cheques`.

**Calculate when it is needed (owner, 2026-11-08, the first hard rule of both prompts).** The model separates DATA
(sales, hours, balances, bank lines — only from the system's calculations or the user's words, never guessed) from
ARITHMETIC on that data (a sum, a difference, a split into N payments, a share, an average, a per-unit value, a VAT
amount), which it must do itself whenever the question needs it, never answering "I don't calculate numbers myself".
It shows the inputs in brackets — "4,000 ₪ (= 20,000 ÷ 5)", "12.5% (= 2,500 ÷ 20,000)" — and `runner/verify.js`
evaluates the bracket: every input must be a known number (or a small count up to 12) and the result must be right;
then the result counts as verified. The planner fills the fields of an op the same way ("20 אלף ב-5 תשלומים" → a
series of 5 payments of 4,000, `repeat.count`).

**Table totals (owner, 2026-11-03, a lasting rule).** "When a table has a total and the system did not give it —
calculate it, don't invent it; missing numbers in the table are zero." The writer ends a table whose numbers add up
with one total row ("סה"כ" / "Total", the last row; "—" under dates, times, %, averages, rates, balances). The runner
then recalculates that row from the rows above it (`lib/answerTables.js` `fillTotals`, called in `runner/runner.js`
before the number check) and writes 0 in empty cells of number columns; the calculated totals count as verified.

**Money in whole shekels (owner 2026-11-04).** Money is shown without agorot, cut down (13,878.4 → 13,878):
`floorMoney` (`lib/answerTables.js`) changes numbers next to ₪ / ש"ח and cells of money columns (header with ₪ or a
money word: הכנסות, טיפים, עלות…). Percentages, hours and counts keep their decimals. It runs in the runner before
`fillTotals`, and again when the chat shows an answer and in the Excel download, so older answers look the same.
Number cells align like the text (right in Hebrew).

**Payments (2026-11-07).** The planned bank transfers are added, moved and cancelled in the chat (planner field
`payments`, proposal `PAYMENT_OPS`, saved on Apply) and listed with `payments_due`; see "Payments" in the data map.

**Team rules (2026-11-01).** The chain admin teaches the AI team in the chat: "מעכשיו …", "כלל חדש: …", "from now
on …" → the planner returns `rule: { op: add | edit | remove, text, area, id? }`, the hub checks it (`ai.js`
`checkRule`: chain admin only, at most 60 rules of 600 characters) and shows it as a proposal (`TEAM_RULE`); it is
saved only on **Apply** (`joya_settings` 'teamRules' = `[{ id, text, area, by, at }]`, audit `TEAM_RULE_CHANGED`).
`area` = one of `AREAS` (the area the rule was given in, by default) or null = all areas. Every later request gets the
rules of its area (`context.teamRules`; a page chat with no area gets all of them); the runner puts them in a
`<team_rules>` block of the PLAN and WRITE prompts, apart from `<context>` (which stays data only), and stores their
ids in `meta.teamRules`. A rule never overrides the hard rules (no computed numbers, no saved changes, nothing sent).
"Show the rules" → calc `team_rules`. Eval: fixtures `r-*`.

## Other functions

Sales (`analytics.js`): summary vs the previous period with the change split into **volume** and **average spend**
(ΔR = (C₂−C₁)·A₁ + (A₂−A₁)·C₂), daily, by shift, by dish, anomalies (same weekday, median ± 3 MAD and ≥ 20 %).
Labor: hours from the Tabit clock rows (+ corrections), sales per labor hour; with payroll access the **labor cost
from the Allegro admin** (`/labor/daily`, owner 2026-10-27: "calculate with the business logic" — HQ never prices
hours itself): `laborCost` = the restaurant's labor cost (hours after the break rule at 100/125/150% × the role's wage; a tip-based
role — minimum wage + tips — counts only its completion (השלמה), owner 2026-10-28; monthly salary ÷ days) and `payslipGross` = the payslip (tlush) gross, each with its %
of the admin's daily revenue. A month without a saved payroll is built by the admin from the Tabit reports exactly
like a new payroll on the Shifts page (`tabitMonthPayroll` in `admin/server/modules/payroll.js`, nothing saved;
`payrollMonths[].payroll` = saved | tabit | none). Hours with no wage in the admin are counted and named
(`peopleWithoutWage`, `inEmployees`); over 2% of the hours (`complete: false`) the cost is not the real labor cost.
No employer cost (Allegro has none); `employerCostFactorEstimate` is no longer used. Payroll checks (`payroll.js`): missing clock times, duplicates,
overlaps, long shifts, Tabit names Allegro could not match, payroll hours (after the rules) above the clocked hours;
each is accepted, dismissed or corrected with a required note.
Final payroll approval stays in the payroll system. Data quality (`quality.js`): stale and missing data, unknown POS
codes, unmatched Tabit names, unmapped role names, checks without diners/close time. What waits for a decision: `work.js`.

## Deploy (the Allegro admin's server, hq.allegrogruppo.com)

Not done yet — ask the owner before each step that touches the server.
1. Apply `sql/add-joya.sql` to the `allegro` DB (new `joya_*` tables only, `CREATE TABLE IF NOT EXISTS` +
   `INSERT IGNORE` defaults; single-quoted strings, ANSI_QUOTES-safe).
2. `hq/.env` (mode 600) from `env.joya-hq.example`: a new `JOYA_SESSION_SECRET`, a new `JOYA_API_KEY`,
   `NODE_ENV=production`, `ALLEGRO_API_URL=http://localhost:3021/local-api/v1`. The DB comes from the root `.env`.
3. `cd hq && npm install && npm run build`.
4. Two services next to the admin's (the same way the admin is kept running): `node server.js` and
   `node runner/index.js`, working directory `hq/`. The runner needs a logged-in `claude` CLI for its user.
5. DNS `hq.allegrogruppo.com` → the server, and a site in the web server in front of the admin: TLS, proxy to
   127.0.0.1:4300. Never proxy `/local-api` (the admin's data API stays private).
6. Users need nothing: the admin users log in with their admin e-mail and password; rights follow their admin role.
Do not seed demo records on production; they only make sense with the fake API.
