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
| **Bank account**: money in/out, balance, deposits, checks, transfers | `bank_transactions` | bank file on the Upload page | `/bank/transactions/stored` | `bank_summary`, `bank_transactions`, `cards_vs_bank` (with Beecomm payments) |
| Employees, roles, wages | `employees` | admin Employees page | `/employees` | `employees` |
| Clock times (who worked when) | `tabit_shifts` | Tabit Shift API, daily 06:30 / Upload page | `/shifts/raw`, `/shifts/by-shift` | `staffing_actual`, `staffing_forecast_week`, `labor_summary` (hours) |
| Payroll, labor cost | `payroll` (+ `tabit_shifts`, `bcom_cash`) | admin Shifts page (saved payroll) | `/payroll`, `/shifts/summary`, `/labor/daily` | `labor_summary`, `payroll_issues` |
| Branches, companies | `branches` + `shared/restaurants.json` | admin | `/branches` | the picker, `context.locations` |

**Credit card vs members club (Beecomm, owner 2026-10-26).** "Credit card" = only **VISA, MASTERCARD, AMEX and DINERS** of
the credit type (אשראי). Every other brand of that type (PRIVATE LABEL BRAND - חבר, Mishloha…) is the
**members club** (מועדון חברים). `payments_summary` always returns both: `creditCards` / `membersClub` per location
and `creditCardsTotal` / `membersClubTotal`.

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

## Permissions

- Login = an Allegro admin user (e-mail + the admin password, status `active`). The session is a JWT in the
  httpOnly cookie `joya_session` (7 days), signed with `JOYA_SESSION_SECRET` and audience `joya-hq`, so a token
  of another app never passes. A user made inactive in the admin loses Joya access at the next request.
- The AI runner calls `/api/joya/ai/runner/*` with `X-Joya-Key` = `JOYA_API_KEY`; with no key set, only loopback
  callers pass.
- Joya access comes from the Allegro role: `admin` → `CHAIN_ADMIN` (all locations, settings, chain-wide and
  mandatory rules, users), `restMngr` → `LOCATION_MANAGER` of the user's `restaurants` (Allegro branch ids, `*` =
  all); both with payroll access (wages, payroll lines, labor cost in money). Any other role: no access. Users
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
a warning). A change request becomes a validated proposal (same checks as the UI) that is saved only on **Apply**,
logged `via = 'CHAT'`. "Recalculate with …" is a what-if: the stored rules do not change.

The main menu (since 2026-10-23) has three areas, each one a chat: **מלאי ורכש** (`/stock`), **כח אדם** (`/people`),
**ביצועים** (`/performance`) — `client/pages/Area.js`. A question asked there is a request with context `AREA` and
context id 1 / 2 / 3 (`ai.js` `AREAS`), so each area keeps its own
history. While the user types, the chat box suggests questions of that area (strings `joya.area.<area>.sN`) and
the user's own past questions. The detailed pages keep their routes but are not in the menu; Settings is at the
bottom of the menu for a chain admin.

**Tables in answers (2026-10-27).** When an answer has several rows of the same numbers (weeks, days, restaurants,
employees…), the writer puts them in a pipe table (`| a | b |` + `|---|---|`; rules in `runner/hq-analyst.js`). The chat
shows it as a table (`client/AskBox.js` → `AnswerBody`), and under every table a **Download Excel** link:
`GET /api/joya/ai/requests/:id/tables/:n.xlsx` (`src/services/answerExcel.js`, exceljs from the repo root; only the
asking user; numbers as numbers, the sheet right-to-left for Hebrew). One reader for both sides: `lib/answerTables.js`.

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
