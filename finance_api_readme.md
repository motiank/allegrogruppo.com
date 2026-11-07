# Finance API (Local Data API, for Joya HQ)

A read-only JSON API that lets Joya HQ answer finance questions from the `allegro_finance` database on the production
MySQL server. It covers all 24 use cases on the
[Pastalina finance use cases page](https://claude.ai/artifact/Fuc2728rtXo45rWzj5RV6d).

**Status: built and deployed on 2026-11-07** (production answers at `http://localhost:3021/local-api/v1/finance` on the droplet). The admin side is done: 28 endpoints, every use case, a settings file
for the accounting rules, and a test that calls every endpoint against a copy of the real data
([section 11](#11-tests)). The Joya side (the chat calculations) is a separate task ([section 10](#10-joya-hq-side)).
**No number here has been checked against Hashavshevet's own reports.** Every answer carries the `not_validated`
warning until the accountant checks that endpoint.

- **Base URL:** `http://localhost:3021/local-api/v1/finance`
- **Code:** `admin/server/modules/financeApi.js`, mounted in `admin/server/server.js` before `localApi.js` (the Local
  Data API ends with a 404 catch-all). Connection pool: `admin/server/sources/financePool.js`.
- **Rules:** `shared/finance_map.json` ([section 5](#5-accounting-rules)).
- **Methods:** `GET` only. The API never writes to any database.
- **Auth:** the same as the Local Data API: this machine only, no login (`local_api_readme.md` → Access control)

---

## Contents

1. [How it fits together](#1-how-it-fits-together)
2. [Conventions](#2-conventions)
3. [Data warnings](#3-data-warnings)
4. [Use case coverage](#4-use-case-coverage)
5. [Accounting rules](#5-accounting-rules)
6. [Endpoints: reference](#6-endpoints-reference)
7. [Endpoints: management](#7-endpoints-management)
8. [Endpoints: accountant](#8-endpoints-accountant)
9. [Errors and limits](#9-errors-and-limits)
10. [Joya HQ side](#10-joya-hq-side)
11. [Tests](#11-tests)
12. [Open decisions](#12-open-decisions)

---

## 1. How it fits together

```
Hashavshevet (SQL Server)
   │  hash-sync, nightly
   ▼
allegro_finance (production MySQL)      allegro (production MySQL)
   │                                       │  Beecomm sales, payroll, labor cost
   └───────────────┬───────────────────────┘
                   ▼
   Admin Local Data API  /local-api/v1/finance/*     (this document)
                   │  localhost only
                   ▼
   Joya HQ  src/services/source.js  →  calculations in src/services/ai.js  →  chat answer
```

Why it is inside the admin Local Data API, and Joya does not read the database directly:

- `hq/CLAUDE.md`: source data reaches Joya only through the Local Data API, and Joya never keeps a copy.
- Use cases 5, 6 and 22 need finance data and admin data together, and the admin already has that data.
- The rule that the Local Data API has no public route also protects this data. **Never add a reverse-proxy route to it.**

**Database access.** The API has its own connection pool. Settings in the root `.env`:

| Variable | Meaning |
|---|---|
| `FINANCE_DB_HOST`, `FINANCE_DB_PORT`, `FINANCE_DB_USER`, `FINANCE_DB_PASSWORD`, `FINANCE_DB_SSL_CA` | The MySQL server of `allegro_finance`. When `FINANCE_DB_HOST` is **not set**, the pool uses the admin's own `DB_*` settings (the same server). |
| `FINANCE_DB_NAME` | Database name. Default `allegro_finance`. |
| `FINANCE_TODAY` | `YYYY-MM-DD`, fixes "today" (tests only). |

A MySQL user with `SELECT` on `allegro_finance` only is planned (decision 6). Creating it is a production change, so the
owner must approve it; until then the admin's user is used.

---

## 2. Conventions

### Response

The same shape as the Local Data API, with two additions to `meta`:

```json
{
  "data": [ ],
  "meta": {
    "company": "pastalina",
    "from": "2026-01-01",
    "to": "2026-08-31",
    "count": 8,
    "sync": { "lastRunAt": "2026-11-06 22:07:13", "status": "done", "dataUpTo": "2026-11-05" },
    "warnings": [ ]
  }
}
```

- `meta.sync` is the last run in `sync_runs`. `lastRunAt` is the MySQL server's own time, as stored (no time zone).
  `dataUpTo` is the date of the newest bank line.
- `meta.warnings` lists the data problems that affect this answer, `high` first. See [section 3](#3-data-warnings).
- `meta.count` is there when `data` is a list. Lists with paging also have `meta.total`.

### Parameters

| Parameter | Format | Notes |
|---|---|---|
| `company` | `pastalina` | **Required everywhere** except `/companies`. `companies.code`. |
| `branch` | Allegro branch id | Comma-separated list; `none` = the rows without a branch. See [Branch rules](#branch-rules). |
| `from`, `to` | `YYYY-MM-DD` | Inclusive. `to` defaults to today, so entries dated in the future are left out. |
| `asOf` | `YYYY-MM-DD` | Balance at the end of that day. Default: today. |
| `account` | `account_key`, e.g. `500059` | Comma-separated list. Unknown → 404. |
| `q` | text | Search in account names (or the exact key). On `/ledger` and `/statement` it replaces `account`: one match → the answer; several → `data: null`, `meta.ambiguous: true` and `meta.accounts` with the matches, so Joya can ask which one; none → 404. |
| `includeUnposted` | `1` | Also count unposted entries. Default: posted only (`status = 1`). |
| `limit`, `offset` | numbers | Lists only. Default 500, maximum 5,000. `meta.total` is the full count. |

### Numbers and dates

- **Money** is in ILS, as a plain number with 2 decimals. The API does not round to whole shekels. Joya does that when it shows the amount.
- **Reports use natural signs:** income and expenses are both plus, and `profit = income − expenses`.
- **Ledger data shows both `debit` and `credit`.** Its `balance` has debit as plus.
- **`accounts.stored_balance` has the opposite sign:** credit minus debit. The API does not return it.
- **Dates** are `YYYY-MM-DD`. The API filters by date, not by `fiscal_year`. A period can cross two years.
- **Every query** filters on `company_id` and `deleted_at IS NULL`.
- **Master data** (account names and groups) is read once per company from the newest year (`meta.masterYear` on
  `/accounts`) and cached for 5 minutes, like every per-company fact. Movement is always read live.
- **IDs repeat between years,** so a link to one entry always holds its year: `/journal/2026/18140`.
- **SQL** uses single-quoted strings (production has `ANSI_QUOTES`) and `execute()` (exact `DOUBLE` values).

---

## 3. Data warnings

The books have real gaps, and a clean-looking number can be wrong. So the API checks the data on each call and returns
warnings. **Joya must show every warning next to the number it affects.**

```json
{
  "code": "income_not_posted",
  "severity": "high",
  "message": "September 2026, October 2026 have almost no income in the books (under 20% of the months before)",
  "affects": ["2026-09", "2026-10"]
}
```

| Code | Rule | What is true today (2026-11-07) |
|---|---|---|
| `no_salary_expense` | A month in the range has income or purchases but no group 720 amount, and an earlier month has one | No salary expense from January 2026. 2025 has 5.56 million. Account 450001 (עובד) has a net debit of 3.88 million. |
| `income_not_posted` | A month before the current one has income under 20% of the average of the 6 months before it | September 2026: 47,075. October 2026: 31,190. A normal month is about 1.5–1.7 million. The last monthly register entry is 31 August 2026. |
| `before_data_start` | The range starts before the first month with income (`info`) | Income starts in April 2025. The first entry is 16 January 2025. |
| `branch_partial` | Part of the amount has no branch: `info` up to 10%, `high` above | See [Branch rules](#branch-rules). |
| `bank_gap` | Open items are more than 5% of the bank movement | Bank 121,642.83 on production (145,338.11 on the local copy, see the next row), books −6,036,913.90, a gap of 6.16 million. |
| `bank_running_balance_differs` | The bank lines added up differ from Hashavshevet's running balance on the last line (`info`) | Production: no. Local copy (after its third sync run): 145,338.11 against 121,642.83, because bank line 3167 (23,695.28 in, dated 2026-01-01) is kept twice by hash-sync, once in year 2024. |
| `bank_matched_differs` | Matched bank lines and matched book lines do not add up to the same amount (`/bank/reconciliation`) | Production: they tie at 103,933.95. Local copy: 127,629.23 against 103,933.95, the same line. |
| `supplier_balances_suspect` | Suppliers in total show a debit balance | 148 suppliers show 13.96 million debit, and 70 show 2.83 million credit. Normally we owe suppliers. Many of the largest are group companies. |
| `unposted_entries` | The range has unposted entries (`info`) | 20 entries, in batches 258 and 259 (March and September 2026). |
| `trial_balance_unbalanced` | Debit and credit of the full trial balance differ | They tie. |
| `other_company_missing` | The answer needs a company that is not loaded (`info`) | Only Pastalina is loaded. |
| `stale_sync` | The last finished run is over 36 hours old (`info`), or the last run failed or none exists (`high`) | |
| `not_validated` | The endpoint's numbers are not yet checked by the accountant (`info`) | On all endpoints. Remove it per endpoint by adding the path to `validated` in `shared/finance_map.json`. |

Severity is `high` when the number should not be used for a decision, and `info` otherwise.

---

## 4. Use case coverage

All endpoints are built and run by the test in [section 11](#11-tests) on the real data (a local copy of
`allegro_finance`, data up to 5 November 2026). "Limit today" says what the data or an open decision still holds back.

| # | Use case | Endpoint | Limit today |
|---|---|---|---|
| 1 | Monthly P&L | `/pnl` | No 2026 salaries; no income after August 2026 |
| 2 | P&L per branch | `/pnl?by=branch` | February–May 2026 income has no branch |
| 3 | Month compared with last month and last year | `/pnl?compare=` | Same gaps as 1 |
| 4 | Cash today and in 30, 60, 90 days | `/cash` | Bank gap; incoming money is unreliable |
| 5 | Food cost % and labor cost % per branch | `/branch-costs` | Payroll data from April 2026 (saved) and July 2026 (Tabit); food accounts = all of group 800 until the accountant's list |
| 6 | Sales system compared with income in the books | `/sales-vs-books` | Beecomm is the sales source (decision 4) |
| 7 | Top suppliers and spending changes | `/spending` | Invoice type `ת` added (decision 7) |
| 8 | Debts, with age | `/aging` | Totals tie, but supplier balances look wrong |
| 9 | Loans and money between group companies | `/intercompany` | One side only; the owner's account list is not confirmed |
| 10 | Questions in plain language | Joya HQ, see [section 10](#10-joya-hq-side) | Not built |
| 11 | Trial balance on any date | `/trial-balance` | |
| 12 | Account card | `/ledger` | |
| 13 | Journal entries | `/journal` | |
| 14 | Bank reconciliation | `/bank/reconciliation`, `/bank/open` | |
| 15 | Suggested bank matches | `/bank/suggestions` | One-to-one only: 44 of 758 open lines within 30 days |
| 16 | Customer invoices, credit notes, receipts | `/invoices`, `/statement` | |
| 17 | Supplier card, open invoices, payments | `/statement` | Only 75 of 250 suppliers use matching |
| 18 | Issued cheques | `/cheques` | "Returned" cannot be found yet |
| 19 | VAT check and the 874 report | `/vat`, `/vat/issues` | Book totals; 874 data is not understood yet |
| 20 | Tax deducted at source, certificates | `/withholding` | |
| 21 | Allocation numbers | `/allocation-numbers` | The legal limits per date are not confirmed |
| 22 | Salary entries compared with payroll | `/payroll-check` | No 2026 salaries in the books; payroll data from April 2026 |
| 23 | Exceptions | `/exceptions` | "Wrong account" has no rule yet |
| 24 | Change history | `/changes` | Hashavshevet logs account changes, not journal edits |

---

## 5. Accounting rules

These rules live in one settings file, `shared/finance_map.json`, per company code. The accountant can correct them
without a code change. A rule marked `"confirmed": false` still waits for the owner or the accountant.

| Block | What it holds |
|---|---|
| `allegroKey` | The company's key in `shared/restaurants.json` (its branches, used by use cases 5, 6, 22). |
| `vatRate` | 0.18. Beecomm totals include VAT and the books do not. |
| `reportLines` | Account groups of each P&L line (below). |
| `balanceGroups` | Groups of cash, customers, register customers, suppliers, VAT, payroll and tax, fixed assets, shareholders. |
| `groupLabels` | Names for the groups that have no name in Hashavshevet. |
| `foodCostAccounts` | `null` = every account of group 800. The accountant's list of food accounts goes here. |
| `invoiceTypes` | Entry types: supplier invoices, customer invoices, customer credit notes, the withholding payment type. |
| `vatAccounts` | Sales, input, fixed-asset and settlement VAT accounts. |
| `withholdingAccounts` | The accounts that hold tax deducted at source. |
| `branches` | The branch table (below). |
| `intercompany` | Accounts of group companies, loans and shareholders. |
| `allocationNumber` | The legal limit per date for use case 21. |
| `validated` | Endpoint paths checked by the accountant; they stop carrying `not_validated`. |

### Account groups

`accounts.group_code` decides the report line.

| Group | Name | Report line |
|---|---|---|
| 700 | הכנסות | Income |
| 800 | קניות | Purchases (food cost) |
| 720 | הוצ' שכר | Salaries |
| 900 | הנהלה וכלליות | General expenses |
| 100, 110, 130 | קופות, בנקים, bank deposit | Cash and bank |
| 200, 210 | לקוחות, לקוחות קופה רושמת | Customers |
| 500 | ספקים | Suppliers |
| 400 | מע"מ | VAT |
| 410, 420, 450, 510 | Tax, employee institutions, employees, pension funds | Payroll and tax liabilities |
| 300 | רכוש קבוע | Fixed assets |
| 490 | בעלי מניות | Shareholders |

Groups 0, 105, 130, 250, 510 and 550 have no name in Hashavshevet. Their labels come from `groupLabels`.

- `800` holds food and kitchen supplies together. The account names separate them: `קניות`, `קניות ירקות`, `קניות מוצרי מטבח`. The food cost line needs the accountant's list of what counts (`foodCostAccounts`).
- `720008 טיפים` looks like a salary account, but it is in group 450, so it isn't in the salaries line. The accountant should confirm this.

### Entry types

| Type | Name in Hashavshevet | Used as |
|---|---|---|
| `ח18`, `תצ`, `ת23`, `חק` | Input VAT invoices | Supplier invoice |
| `ת` | *(not in Hashavshevet's type table)* | Supplier invoice. 1,628 entries, nearly all in 2025: expense account + supplier + input VAT, like `ח18`. Added on 2026-11-07; the accountant should confirm (decision 7). |
| `ע` | מס עסקאות | Customer invoice |
| `חז` | זיכוי | Customer credit note |
| `0` | ניכוי במקור מספ | A payment entry (debit the supplier, credit the bank). The tax deducted at source is its credit line on `410001`; 3,270 entries carry one, nearly always 0. |
| *(empty)* | | Every other entry: bank, cash, register, payroll and transfer entries (9,087 entries). |

### Branch rules

A branch is found by the first rule that works. Each row returns `branchSource`, so the method is visible.

1. **`cost`:** `journal_entries.cost_code`, after trimming (it can hold spaces).
2. **`account`:** the account itself: its own `cost_code` (the 720 salary accounts have one), the branch's `accounts` list in `finance_map.json`, or one of the branch's `words` in the account name, such as `800003 קניות - רעננה`. `GET /branches` lists the result.
3. **`description`:** the entry's description names the branch, such as `רושמת ראש פינה 08-26`. This is the weakest rule.
4. **`none`:** shown as "No branch" and never spread over the branches.

| Cost code | Name in Hashavshevet | Allegro branch | Allegro id | Words |
|---|---|---|---|---|
| 101 | רמת החייל | רמת החיל | `6012624f0d491ef6429e127c` | רמת החייל, רמת החיל |
| 102 | ראש פינה | ראש פינה | `655ef6eb9df0c279bbfb7482` | ראש פינה |
| 103 | רעננה | רעננה | `5ff419934676f0fddabaef3a` | רעננה |
| 104 | גויה הרצליה | הרצליה (decision 5, not confirmed) | `5fd7030f4f421bfe0e2e13bd` | הרצליה |

The design test used text matching for rules 2 and 3. These were the results, in ILS:

| Line | 2025 with a branch | 2026 with a branch |
|---|---|---|
| Income | 99.9% | 51% (January and June–August only) |
| Purchases | 86% | 98% |
| General expenses | 80% | 75% |
| Salaries | 95% | none posted |

February–May 2026 income has no branch in its entries (`הכנסות 2.26`), so the books cannot split it. For those months,
`/branch-costs` uses Beecomm sales and returns `revenueSource: "beecomm"`.

### Open items and age of debt

- A line is **matched** when `ledger_matches.journal_line_id` points to it, the match was made by `asOf`, and every line of that match is dated by `asOf` (else its partner is missing from the picture). In the test, the open items of every customer and supplier added up to the account's balance.
- Only 10 customers and 75 suppliers use matching (`method: "matched"`). For the others, the API applies payments to the oldest invoices first (`method: "oldest_first"`). A payment larger than the invoices stays as one open item with a minus (`unapplied: true`).
- Partial matches: when the matched lines of an account do not net to zero, the remainder is one open item (`residual: true`), so the open items always tie to the balance.
- The age is counted from `due_date`, and from `value_date` if there is no due date. Open items with a minus (unmatched payments) sit in the bucket of their own date.
- Buckets: `current` (not yet due), `1-30`, `31-60`, `61-90`, `90+`.

---

## 6. Endpoints: reference

### `GET /finance/companies`

Companies in `allegro_finance`, their years, and their link to `shared/restaurants.json`. No `company` parameter.

```json
{ "code": "pastalina", "name": "Pastalina", "taxId": null, "allegroKey": "pastaLina", "allegroLabel": "פסטה לינה", "years": [2024, 2025, 2026], "rules": true }
```

(On production `years` is `[2025, 2026]`. The local copy also has 2024: one entry and one bank line are kept in that year by hash-sync; see `bank_running_balance_differs`.)

### `GET /finance/status?company=`

How complete and how fresh the data is. Joya should read this before a finance answer.

```json
{
  "lastRun": { "at": "2026-11-06 22:07:13", "status": "done", "changedRows": 1, "error": null },
  "dataUpTo": "2026-11-05", "dataStart": "2025-04", "firstEntry": "2025-01", "years": [2024, 2025, 2026], "masterYear": 2026,
  "banks": [ { "accountKey": "110011", "name": "בנק הפועלים 584-136663", "bankBalance": 145338.11, "lastRunningBalance": 121642.83,
               "bookBalance": -6036913.90, "bankOpen": 17708.88, "bookOpen": -6140847.85, "openBankLines": 758, "openBookLines": 943 } ],
  "suppliers": { "debitCount": 148, "debitTotal": 13955101.77, "creditCount": 70, "creditTotal": 2827511.80 },
  "months": [
    { "month": "2026-08", "income": 1740679.31, "purchases": 499504.12, "salaries": 0, "general": 400167.83, "unposted": 0, "entries": 1131, "warnings": ["no_salary_expense"], "complete": false },
    { "month": "2026-09", "income": 47075.38, "purchases": 429982.44, "salaries": 0, "general": 255288.23, "unposted": 19, "entries": 819, "warnings": ["no_salary_expense", "income_not_posted", "unposted_entries"], "complete": false }
  ]
}
```

(Real figures.) `complete` is `false` when a month has a `high` warning. Months end at the current month.

### `GET /finance/accounts?company=[&group=][&q=][&includeBank=1][&asOf=]`

Accounts with their group, line, branch and balance up to `asOf`. `group` is a comma-separated list.
`includeBank=1` adds supplier bank details. Leave it off unless the user asked for them. Employee details are personal data.

```json
{ "accountKey": "500059", "name": "וואלט אנטרפריזס ישראל בע\"מ", "group": 500, "groupName": "ספקים", "line": null,
  "branch": null, "branchName": null, "branchSource": null, "costCode": null, "taxFileNum": "515887156", "isGroupCompany": false,
  "debit": 0, "credit": 1421109.86, "balance": -1421109.86 }
```

(Real figures: Wolt's account has only credits, 1.42 million.)

### `GET /finance/branches?company=`

The table from [Branch rules](#branch-rules), with the accounts rule 2 gives to each branch and `confirmed`.
`meta.allegroBranches` lists the company's branches in `shared/restaurants.json`.

---

## 7. Endpoints: management

### `GET /finance/pnl?company=&from=&to=[&by=month|year|branch|account][&branch=][&compare=prev_period|prev_year][&includeUnposted=1]`

Use cases 1, 2, 3. Posted lines of the report groups. `by` defaults to `month`; empty months are kept with zeros.

Real numbers, `from=2026-08-01&to=2026-08-31&compare=prev_year`:

```json
{
  "period": "2026-08",
  "income": 1740679.31, "purchases": 499504.12, "salaries": 0, "general": 400167.83, "profit": 841007.36,
  "compare": {
    "period": "2025-08",
    "income": 1894955.08, "purchases": 1012758.28, "salaries": 654536.89, "general": 770252.79, "profit": -542592.88,
    "change": { "previous": -542592.88, "change": 1383600.24, "changePct": 255 }
  }
}
```

This answer carries `no_salary_expense`. Without the warning, the example shows a profit of 841,007 for August 2026,
which is false.

- `meta.totals` has the whole range; with `compare`, `meta.compare` has the compare range and its totals.
- `compare=prev_period`: the same number of whole months before `from` (or the same number of days).
- `by=branch`: one row per branch for the whole range, and "No branch" as its own row (`branch: null`). Each row has
  `branchName`, `costCode` and `branchSource` = the amount found by each rule (`cost`, `account`, `description`).
  The answer carries `branch_partial`.
- `by=account`: `accountKey`, `name`, `group`, `line`, `amount` (and `compare` per account).
- `branch=` filters the lines by their resolved branch; `none` keeps the lines without one.

### `GET /finance/cash?company=[&asOf=]`

Use case 4. Real numbers from the local copy, for 7 November 2026 (production gives `bankBalance: 121642.83`):

```json
{
  "bankBalance": 145338.11, "bankBalanceDate": "2026-11-05", "lastRunningBalance": 121642.83, "bookBankBalance": -6036913.90,
  "banks": [ { "accountKey": "110011", "name": "בנק הפועלים 584-136663", "balance": 145338.11, "date": "2026-11-05" } ],
  "chequesOut": {
    "next30": { "count": 66, "amount": 677134.05 },
    "days31to60": { "count": 34, "amount": 398503.38 },
    "days61to90": { "count": 21, "amount": 181251.38 },
    "later": { "count": 176, "amount": 1276449.84 }
  },
  "chequesDueNotCleared": { "count": 126, "amount": 438503.05 },
  "expectedIn": { "overdue": 6483888.25, "next30": 0, "days31to60": 0, "days61to90": 0, "later": 0 },
  "projected": { "day30": -970298.99, "day60": -1368802.37, "day90": -1550053.75 }
}
```

- `bankBalance` is the bank lines added up (`bank_lines`), **not the books**. `lastRunningBalance` is Hashavshevet's own running balance on the last line (only for `asOf` at the data end). On production the two agree (121,642.83); on the local copy they differ by one line, see `bank_running_balance_differs`.
- `chequesOut` uses `cheques.due_date` after `asOf`. The dates run to 2036, because of a real monthly series.
- `chequesDueNotCleared`: due by `asOf` and not matched to the bank. `expectedIn`: open invoices of real customers (group 200, not the register accounts) by due date; credit card money is left out, because `100020 קופת אשראי` isn't reliable yet. Nearly all of it is overdue, and `overdue` is **not** in `projected`.
- `projected.day30 = bankBalance + expectedIn.next30 − chequesDueNotCleared − chequesOut.next30`, and so on.
- The result always has `bank_gap` and `supplier_balances_suspect` while those rules are true.

### `GET /finance/branch-costs?company=&from=&to=[&branch=]`

Use case 5. Per branch per month, for the company's Allegro branches. Up to 400 days: it reads the admin's labor data
per branch-month (the same as `/labor/daily`), which is slow.

```json
{ "branch": "5ff419934676f0fddabaef3a", "branchName": "רעננה", "month": "2026-08", "revenue": 672225.42, "revenueSource": "books",
  "beecommNet": 692922.94, "booksIncome": 672225.42, "foodCost": 192873.10, "foodPct": 28.69,
  "laborCost": 156122.26, "laborPct": 23.22, "laborSource": "saved", "payrollGross": 225226.68, "salariesBooks": 0, "employees": 72 }
```

(Real figures, Raanana, August 2026.)

- `revenue`: the branch's income in the books; when a month has none (February–May 2026), Beecomm's total without VAT (`revenueSource: "beecomm"`). `beecommNet` is always shown for comparison.
- `foodCost`: group 800 lines with that branch (or the `foodCostAccounts` list). `laborCost`: the restaurant's labor cost of the admin (`/labor/daily` → `laborCost`), `payrollGross` its payslip gross, `laborSource` = `saved` payroll, `tabit`, or `none`.
- `meta.noBranch` lists the income, purchases and salaries per month that have no branch.

### `GET /finance/sales-vs-books?company=&from=&to=[&branch=]`

Use case 6. Per month and branch: Beecomm sales without VAT, income in the books, and the difference. Up to 400 days.
Each month also has a company total row (`branch: null`) that adds the income without a branch (`booksNoBranch`).

```json
{ "month": "2026-08", "branch": "5ff419934676f0fddabaef3a", "branchName": "רעננה", "salesSystem": 692922.94, "salesDays": 31,
  "books": 672225.42, "difference": -20697.52, "differencePct": -2.99 }
{ "month": "2026-08", "branch": null, "branchName": "Company total", "salesSystem": 1774569.08, "books": 1740679.31, "booksNoBranch": 17610.67,
  "difference": -33889.77, "differencePct": -1.91 }
```

(Real figures.) The page says "Tabit", but in this repo Beecomm holds the sales and Tabit holds shifts (decision 4).
August 2026 ties within 2%; in September 2026 the books have 47,075 against 1.33 million of sales (`income_not_posted`).

### `GET /finance/spending?company=&from=&to=[&by=supplier|account|group][&branch=][&top=20][&compare=prev_period|prev_year]`

Use case 7. By supplier: credit lines on group 500 accounts in entries of a supplier invoice type, with VAT. By account
or group: expense lines (groups 800, 720, 900) without VAT. `top=0` returns all rows. `branch=` keeps the lines of those
branches only.

Real numbers, 2026 until today:

```json
[
  { "accountKey": "500059", "name": "וואלט אנטרפריזס ישראל בע\"מ", "group": 500, "groupName": "ספקים", "amount": 894372.06, "entries": 174 },
  { "accountKey": "500082", "name": "גמלא הראל עסקה משותפת", "group": 500, "groupName": "ספקים", "amount": 573196.44, "entries": 15 },
  { "accountKey": "500001", "name": "אימפורט פור יו בע\"מ", "group": 500, "groupName": "ספקים", "amount": 521191.00, "entries": 196 }
]
```

With `compare`, each row also has `previous`, `change` and `changePct`. `meta.total` is the sum of all rows before `top`.

### `GET /finance/aging?company=&side=customers|suppliers[&asOf=][&account=][&excludeGroupCompanies=1]`

Use case 8. See [Open items and age of debt](#open-items-and-age-of-debt). Plus = owed: for suppliers, the company
owes the supplier; for customers, the customer owes the company. Accounts with a zero balance and no open items are
left out.

```json
{ "accountKey": "500059", "name": "וואלט אנטרפריזס ישראל בע\"מ", "group": 500, "isGroupCompany": false, "balance": 1421109.86, "openTotal": 1421109.86,
  "openCount": 227, "oldest": "2025-07-20", "buckets": { "current": 0, "1-30": 81250.32, "31-60": 51256.45, "61-90": 101984.83, "90+": 1186618.26 },
  "method": "matched", "tie": true }
```

(Real figures.) `meta.totals` has the same buckets, `meta.methods` counts the two methods, `meta.untied` lists accounts
whose open items do not add up to the balance (none today). The supplier side always has `supplier_balances_suspect`
while the rule is true.

### `GET /finance/intercompany?company=[&asOf=][&from=]`

Use case 9. Balances up to `asOf` and movement (from `from`, default: all) of the accounts listed under `intercompany`
in `shared/finance_map.json`. Plus = debit (they owe the company).

The largest supplier debit balances are group companies or related parties. These are candidates, and the owner must
confirm the list (`confirmed: false`):

| Account | Name | Debit balance |
|---|---|---|
| 500084 | חצרי א.ב ארזים בע"מ | 2,027,583 |
| 500115 | פרימיום איטליה | 1,940,172 |
| 500064 | ג'ויה רום בע"מ | 1,881,861 |
| 500117 | אלגרו גרופו בע"מ | 703,333 |

Also listed: `200040 אלגרו גרופו בע"מ` (credit 590,800), `105001 הלוואה חצרי א.ב. - ראש פינה` (zero), and group 490
(`490002 אן קור שירותי`, credit 2,282,000; `490003`, zero). Each answer has `other_company_missing`, because only
Pastalina's side is loaded.

---

## 8. Endpoints: accountant

### `GET /finance/trial-balance?company=[&asOf=][&from=][&group=][&includeUnposted=1]`

Use case 11. Debit, credit and balance per account, up to `asOf`. With `from`, `debit` and `credit` are the movement of
that period and `opening` the balance before it (`opening + debit − credit = balance`).

```json
{ "accountKey": "110011", "name": "בנק הפועלים 584-136663", "group": 110, "groupName": "בנקים", "debit": 36479379.57, "credit": 42480605.77, "balance": -6001226.20, "lines": 8591 }
```

(Real figures as of today. Two posted entries are dated after today, so the bank's balance of all entries, −6,036,913.90,
needs `asOf=2026-12-31`.) `meta.totals` shows debit equal to credit (`meta.balanced`); the full list carries
`trial_balance_unbalanced` if not. Balances run across years: in the design test, the posted lines of all years together
matched Hashavshevet's stored balance for 411 of 411 accounts.

### `GET /finance/ledger?company=&account=|q=&from=&to=[&includeUnposted=1][&limit=][&offset=]`

Use case 12. The account card (כרטסת).

```json
{ "date": "2026-09-20", "dueDate": "2026-09-20", "year": 2026, "transId": 16268, "lineId": 38232, "batch": 225, "type": "ח18", "reference": 0,
  "description": "וואלט אנטרפריזס ישראל בע\"מ", "details": null, "costCode": null, "counterAccount": "900021", "counterName": "עמלות - רמת החייל",
  "debit": 0, "credit": 16802.37, "runningBalance": -1306296.66, "posted": true, "matched": false, "matchKind": null, "chequeId": null, "documentId": null }
```

(Real line.) `meta.openingBalance`, `closingBalance`, `debit`, `credit` and `total` are always there. `runningBalance`
is worked out from the start of the account, not from `offset`. `matched` is a ledger match or, on a bank account, a
bank match (`matchKind`).

### `GET /finance/journal?company=[&batch=][&reference=][&from=][&to=][&account=][&type=][&q=][&posted=0|1][&limit=][&offset=]`

### `GET /finance/journal/:year/:transId?company=`

Use case 13. A list of entries (every filter optional; `reference` also matches `reference2` and `reference3`; `q`
searches the description, details and account names), or one entry with its `lines`, `document` (with its lines) and
`cheque`. An entry can have many lines; in the list, `lineCount` shows how many. 3,039 lines are one-sided
(`Changable = 7`). They net to zero overall, so an entry's own lines may not balance (`balanced` on the single entry).
Show them as they are.

### `GET /finance/bank/reconciliation?company=[&account=]`

Use case 14. Per bank account, all years together, with the age of the open items.

Real numbers from the local copy (production: `bankBalance` 121,642.83, `bankMatched` = `bookMatched` = 103,933.95, `gap` 6,158,556.73):

```json
{
  "accountKey": "110011", "name": "בנק הפועלים 584-136663",
  "bankBalance": 145338.11, "lastRunningBalance": 121642.83, "lastLineDate": "2026-11-05", "bookBalance": -6036913.90,
  "bankOpen": 17708.88, "bookOpen": -6140847.85, "openBankLines": 758, "openBookLines": 943,
  "bankMatched": 127629.23, "bookMatched": 103933.95, "gap": 6182252.01,
  "openAge": {
    "bank": { "0-30": { "count": 107, "amount": 632757.40 }, "31-90": { "count": 79, "amount": -280822.77 }, "91+": { "count": 572, "amount": -334225.75 } },
    "book": { "0-30": { "count": 224, "amount": -1674581.31 }, "31-90": { "count": 102, "amount": -626154.09 }, "91+": { "count": 617, "amount": -3840112.45 } }
  }
}
```

`bankMatched` should equal `bookMatched`; if not, the answer carries `bank_matched_differs` (`high`). On the local copy
they differ by bank line 3167 (23,695.28). Bank side: money in is plus. Book side: debit is plus.

### `GET /finance/bank/open?company=&side=bank|book[&account=][&minAge=][&from=][&to=][&includeUnposted=1][&limit=][&offset=]`

Use case 14. The open lines, oldest first. Bank line `direction` is `in` or `out`; a book line has `side`,
`counterAccount` and `chequeId`. `meta.total` and `meta.amount` cover the whole selection.

- `is_matched = 1` with `match_num` means a bank line is matched.
- `bank_matches.linked_id` with `side = 'book'` is a `journal_lines.line_id`, not a `trans_id`.

### `GET /finance/bank/suggestions?company=[&account=][&days=30][&minAmount=][&limit=][&offset=]`

Use case 15. Suggestions only: nothing is matched, and the accountant does the match in Hashavshevet. One open bank line
to one open book line with the same amount and direction (money in = a debit on the bank account), up to `days` apart.

```json
{ "bankLineId": 208, "account": "110011", "bankDate": "2025-05-12", "reference": 10213, "details": "שיק", "direction": "out", "amount": 416,
  "candidates": [ { "lineId": 9844, "year": 2025, "transId": 3242, "date": "2025-05-30", "reference": 832, "description": "שיק", "amount": 416, "daysApart": 18 } ],
  "confidence": "single" }
```

(Real line.) `confidence` is `single` with one candidate, and `many` with more. `meta` counts the open lines of both
sides and the single/many answers.

**One-to-one matching won't solve this alone.** Today, within 30 days: 44 of 758 open bank lines get a suggestion (26
single, 18 many). The next step is many-to-one matching, where several book lines add up to one bank line. Credit card
deposits are the likely case, but this is not built.


### `GET /finance/bank/report?company=[&account=][&from=][&to=][&format=json|html|xlsx]` and `GET /finance/bank/report/accounts`

The detailed bank reconciliation report (דוח התאמת בנק מפורט) of the admin menu, `admin/server/modules/bankRecon.js`,
for Joya HQ (page `/accounting/bank-recon`, calc `bank_recon_report`). Not a JSON envelope with warnings like the
other endpoints: `format=json` → `{ data: report, meta: { company, account, from, to } }`; `html` → the Hebrew RTL page
(`shared/bankReconHtml.js`); `xlsx` → the Excel file (`Content-Disposition: attachment`). `to` defaults to today,
`from` to 1 January of `to`'s year, `account` to the company's first bank account. The report, as of `to`: `summary`
(bankBalance = Hashavshevet's running balance after the last line ≤ `to`; bookBalance; bankOpen, bookOpen,
chequesOpen, bookFutureMatched, chequesCleared with counts and totals; expectedBookBalance; unexplained), `notes`
(Hebrew), and the rows `bankOpen`, `bookOpen` (cheques excluded), `bookFutureMatched`, `chequesCleared` (clearing
date in the period; status cleared / cleared_group), `chequesOpen` (past_due / not_due / cleared_unmatched). "Open" =
no `bank_matches` row with `matched_on` ≤ `to`. Money into the bank is plus on both sides. `/bank/report/accounts` →
`{ data: [{ code, name, banks: [{ key, name, from, dataUpTo, lines }] }], meta: { today } }`. Test:
`node --test scripts/test_bank_recon.js`.

### `GET /finance/invoices?company=&from=&to=[&account=][&q=][&type=invoice|credit][&includeUnposted=1][&limit=][&offset=]`

Use case 16: "all income invoices from X in the last year". Entries of the customer invoice types. A credit note is
minus. `amount` includes VAT. Posted and dated in 2026 until October: 129 documents (128 of fiscal year 2026, and one
dated 2026 that hash-sync keeps in year 2024), 14.6 million.

Many of these are monthly register entries, not invoices to a real customer. `kind` shows which: `register` for
accounts in group 210, and `customer` for the others.

```json
{ "year": 2026, "transId": 11792, "docNumber": 50093, "date": "2026-05-12", "dueDate": "2026-05-12", "kind": "customer", "accountKey": "200033",
  "customerName": "פייזר פרמצבטיקה ישראל בע\"מ", "type": "invoice", "typeCode": "ע", "amount": 1223.66, "posted": true, "description": null, "documentId": 32, "allocationNumber": null }
```

(Real entry.) `documents` has only 65 rows, so most invoices have no item lines. `meta.amount` is the total of the selection.

### `GET /finance/statement?company=&account=|q=[&from=][&to=]`

Use cases 16, 17. One customer or supplier: `account` (with `side`), `invoices`, `credits`, `payments`, `others`,
`openItems` (with `ageDays`, `bucket`, `unapplied`, `residual`), `balance`, `openingBalance` (with `from`), `totals`
and `buckets`. Plus = owed, as in `/aging`. `to` is also the `asOf` of the open items.

| `kind` | Rule |
|---|---|
| `invoice` | An entry type of the invoice list (suppliers: `ח18`, `תצ`, `ת23`, `חק`, `ת`; customers: `ע`) |
| `credit` | A customer credit note (`חז`) |
| `other` | A line on the invoice side without an invoice type (the register's monthly income entries, `הוצ'` entries without a type) |
| `payment` | Every other line |

The accountant should confirm this rule. `meta.method` is as in `/aging`. An account that is neither a customer nor a
supplier gets `side: "other"` and no open items.

### `GET /finance/cheques?company=[&state=future|due|cleared|not_cleared|returned][&account=][&from=][&to=][&limit=][&offset=]`

Use case 18. Source: `cheques`, linked to `journal_entries.cheque_id`. `from`/`to` filter the due date.

`cheques.status` can't be used: all 1,665 rows have the value 3. So the state is worked out:

| State | Rule | Today |
|---|---|---|
| `future` | `due_date` is after today | 297 cheques, 2,533,338.65 |
| `cleared` | The cheque's entry has a line on the bank account with a row in `bank_matches` | 1,242 cheques, 7,095,769.32 |
| `not_cleared` | Due, with no bank match | 126 cheques, 438,503.05 |
| `due` | `cleared` + `not_cleared` (a filter, not a state) | |
| `returned` | **Not available.** The accountant must say how a returned cheque is recorded. | `meta.notAvailable` |

All 1,665 cheques link to an entry. `meta.totals` counts every state regardless of the filter.

```json
{ "chequeId": 1445, "year": 2026, "account": "500201", "accountName": "אלון הרשקו עו\"ד", "payee": "אלון הרשקו עו\"ד", "amount": 4720, "paid": 4720, "deducted": 0,
  "dueDate": "2026-11-08", "issueDate": null, "originalDate": "2026-09-08", "reference": 17034, "bankAccount": "110011", "entry": { "year": 2026, "transId": 15516 }, "state": "future" }
```

### `GET /finance/vat?company=&from=&to=[&includeUnposted=1]`

Use case 19. Per month, from the books: `salesVat` (credit on `400001`), `inputVat` (debit on `400002`), `assetVat`
(debit on `400003`), `toPay = salesVat − inputVat − assetVat`, and the movement of the settlement account `400004`.

```json
{ "month": "2026-08", "salesVat": 313322.28, "inputVat": 145856.18, "assetVat": 0, "settlement": { "debit": 108031, "credit": 0 }, "toPay": 167466.10 }
```

(Real figures: sales VAT is 18% of the month's income.) `meta.totals` and `meta.balancesAtTo` (the four accounts' balances
at `to`) are always there.

### `GET /finance/vat/issues?company=[&from=][&to=]`

The 874 runs in `vat_lines`: per run (`issueId`) its period, line count, total and a breakdown by record type.
**Not ready for a VAT check:**

- 34 runs exist, and the same period can have up to 6 runs with different totals (January 2026: 817,359 to 975,394). Only the last run of a period should count, and the accountant must confirm this.
- The first check didn't match. January 2026 income of 1,555,299 at 18% is about 280,000, but the runs for January show 525,228–628,315 in record types `L` + `S`.
- The meaning of record types `K`, `L`, `S`, `T` and `Z` must be confirmed.

### `GET /finance/withholding?company=[&from=][&to=][&expiring=60][&account=]`

Use case 20. `data.deductions`: the payment entries of type `0` to supplier accounts, per supplier: `payments`, `paid`
(the debit on the supplier), `deducted` (the credit on `410001` inside those entries), `deductedPct`. The same entry type
to other accounts (salaries to `450001 עובד`) is counted apart in `meta.otherPayments`. `data.certificates`: suppliers
with a certificate (`deductionPct`, `validTo`, `certificate` = `valid` / `expiring` within `expiring` days / `expired`);
`data.noCertificate` counts the rest.

Of the 253 supplier accounts: 118 have a date before the year 2000, which is an empty default (`none`); the others end
between March 2026 and March 2027. In 2026, 7 suppliers had tax deducted (1% to 5%).

### `GET /finance/allocation-numbers?company=&from=&to=[&minAmount=][&missingOnly=1][&account=][&limit=][&offset=]`

Use case 21. Posted supplier invoices with their allocation number (`tax_alloc_number`): `status` = `ok` (5 digits or
more), `missing` (empty or 0) or `suspect` (anything else), `threshold` (the legal limit on that date from
`allocationNumber.thresholds`; `minAmount` replaces it) and `required` (amount at or over the limit). Without
`minAmount`, the list holds the required invoices and every invoice that has a value; `missingOnly=1` keeps the ones
without a real number. `meta.counts` counts everything in the range.

Of the filled values, only 294 posted supplier invoices (317 entries of all kinds) look like a real number. The
accountant must say what the others are (1,911 are the value `0`). The limits in `finance_map.json` (25,000 from May
2024, 20,000 from 2025, 10,000 from 2026) are **not confirmed** (`meta.thresholdsConfirmed`).

### `GET /finance/payroll-check?company=&month=[&branch=]`

Use case 22. Group 720 in the books against the payslip gross of the admin's labor data (`/labor/daily` → `gross`), per
branch, plus a "No branch" row. `payrollSource` is `saved`, `tabit` or `none`.

```json
{ "month": "2026-08", "branch": "5ff419934676f0fddabaef3a", "branchName": "רעננה", "books": 0, "payroll": 225226.68, "laborCost": 156122.26, "employees": 72,
  "difference": -225226.68, "differencePct": -100, "payrollSource": "saved" }
```

(Real figures: no salaries in the books in 2026.) `meta.booksByAccount` splits the books by salary account.

### `GET /finance/exceptions?company=[&type=][&from=][&to=][&limit=][&offset=]`

Use case 23. One list; each row has `type`. `from`/`to` default to the current year and apply to duplicates and missing
branches only.

| `type` | Rule | Found today |
|---|---|---|
| `unposted` | `status = 0` | 20 entries |
| `future_dated` | Posted, dated after today | 2 entries, 35,688 |
| `possible_duplicate` | Same accounts, amount and reference, posted, amount not 0 | 276 groups in 2026. This rule is too wide, so expect false alarms. |
| `missing_branch` | An expense line (groups 800, 720, 900) with branch `none` | 997 lines in 2026 |
| `wrong_account` | **No rule yet** | `meta.notAvailable`; the accountant must give the rules. |

`meta.counts` has the full count per type.

### `GET /finance/changes?company=&from=&to=[&account=][&kind=account|login|sync|vat_run][&limit=][&offset=]`

Use case 24. **The only endpoint that reads `source_rows`,** and it reads only the tables below. There is no general way
to read `source_rows`.

| `kind` | Source | Rows | What it shows |
|---|---|---|---|
| `account` | `AccItemsUpdateLog` | 2,775 | Field changes of accounts: `accountKey`, `field`, `oldValue`, `newValue`, `userId`, `userName` (from the `Users` table), `station` |
| `login` | `UsersLogDetails` | 557 | Probably logins to Hashavshevet: `loginName`, `result`, `station`. Not checked yet. |
| `vat_run` | `IssueLog` | 199 | Probably report runs: `text`, `documentId`. Not checked yet. |
| `sync` | `row_history` | From 6 November 2026 | What each night's sync changed, with a summary of the old row |

Hashavshevet doesn't log journal edits in these tables. `sync` shows them from now on, but only one change per day per
row, and it can't say who made it. `time` is the raw time value read as minutes after midnight (749 → 12:29); this is
not confirmed.

---

## 9. Errors and limits

The same errors as the Local Data API: `{ "error": { "code", "message" } }`.

| Status | `code` | When |
|---|---|---|
| 400 | `bad_request` | A missing or wrong parameter, `from` after `to`, a range over the limit, `q` with several accounts on an endpoint that takes one |
| 403 | `forbidden` | Not from this machine |
| 404 | `not_found` | Unknown endpoint, company, account, branch or entry; `q` with no match |
| 500 | `internal_error` | Anything else (logged) |
| 503 | `finance_db_unavailable` | `allegro_finance` can't be reached, or its tables are missing |

- A date range can be up to 800 days, as in the Local Data API; `/branch-costs` and `/sales-vs-books` up to 400 days.
- Lists use `limit`/`offset` (default 500, maximum 5,000). `/ledger` works out `runningBalance` from the start of the account, not from `offset`.
- Data changes once a night, so Joya's 5-minute memory cache is safe. The API itself caches master data and the warning facts per company for 5 minutes.

---

## 10. Joya HQ side

Joya's own rules still apply (`hq/CLAUDE.md`). **Built on 2026-11-07** (`hq/src/services/finance.js`, 23 calculations,
`hq/README.md` → "The books"): in the existing הנהלת חשבונות area, for the chain admin only (decision 1). The list
below was the plan; what differs is noted.

- **Reading:** add finance functions to `src/services/source.js` only. Never save the answers in a `joya_*` table.
- **Numbers:** each answer comes from a calculation in `src/services/ai.js`, never from the model. Suggested calculations: `finance_status`, `pnl`, `cash_position`, `spending`, `aging`, `trial_balance`, `account_card`, `journal_search`, `bank_reconciliation`, `bank_open_items`, `customer_invoices`, `account_statement`, `cheques`, `vat_summary`, `withholding`, `exceptions`.
- **Warnings:** a calculation passes `meta.warnings` to the answer, and the prompt in `runner/hq-analyst.js` must say that a `high` warning appears beside the number. Then run `npm run eval`.
- **Display:** whole shekels, cut down, and a "סה"כ" row. Every text in both `*.he.js` and `*.en.js`.
- **Names:** a customer or supplier name goes through `q`. If `meta.ambiguous` comes back, Joya asks which one, or lists `meta.accounts`.
- **Scope:** the top-bar picker gives `company` and `branch`. Map the company key (`allegroKey` in `/companies`) in the calculation. A company with no finance data gets a clear "not loaded yet" answer.
- **Rights:** decision 1 (owner 2026-11-07): the chain admin only; `FINANCE_CALCS` in `hq/src/services/ai.js`. The
  accountant role keeps the register-vs-bank calculations only, until the owner opens the books to it.
- **Area:** no new area (owner 2026-11-07): the books live in הנהלת חשבונות, with 8 more suggested questions for the admin.
- **Tests:** add the finance shapes to `scripts/fake-allegro.mjs`, with made-up data.

---

## 11. Tests

`scripts/test_finance_api.js` (Node's own test runner, no extra package):

```bash
node --test scripts/test_finance_api.js
node --test --experimental-test-coverage scripts/test_finance_api.js     # with a line-coverage report
```

- **Part 1** tests the pure rules with made-up data and no database: dates and compare ranges, the four branch rules, open items (both methods, unapplied payments, partial matches), age buckets, cheque states, allocation limits and statuses, every warning rule, the error mapping and the pool settings.
- **Part 2** starts the router on a loopback port and calls **every endpoint, every parameter and every error path** against the finance database. It checks the access rules (proxy header, foreign `Host`), the response shapes, the readme's numbers, and the accounting invariants: debit = credit in the trial balance, opening + movement = closing, the ledger's running balance and its closing balance against the trial balance, months add up to the year, branches add up to the company, accounts add up to groups, open items tie to every balance, age buckets add up, matched = balance − open, VAT about 18% of income, counts between endpoints.
- **Databases:** the finance DB is `FINANCE_DB_*`, by default the local hash-sync target (`allegro_finance_dev`, read from `hash-sync/.env`). The three mixed endpoints (`/branch-costs`, `/sales-vs-books`, `/payroll-check`) also read the admin DB of the root `.env` (read only); `FINANCE_TEST_SKIP_MIXED=1` skips them. `FINANCE_TODAY=2026-11-07` fixes "today", so the counts that depend on it stay stable while the local copy is not refreshed.
- **Result on 2026-11-07:** 51 tests, all pass, in about 10 seconds. Line coverage of `financeApi.js` 99.8%, branch coverage 88.8%; `financePool.js` 95.4% (the SSL file branch is not run locally).

After a new hash-sync load, numbers in the test that quote the data (for example 758 open bank lines) can change. They
are the readme's numbers; update both together. The test expects the local copy's bank figures (145,338.11); against
production (`FINANCE_DB_HOST` of the droplet) those two checks would read 121,642.83.

The real admin server was also started once with the production settings (`ADMIN_PORT=3031`), and `/finance/companies`,
`/finance/status` and the Local Data API's `/branches` answered; a request with `X-Forwarded-For` got 403.

---

## 12. Open decisions

**The owner:**

1. **Who can see finance data?** Proposal: `admin` only. A `restMngr` sees nothing at first, because this data shows the whole company, salaries and debts.
2. **A new chat area?** The menu has three areas. Proposal: a fourth, כספים.
3. **Which accounts are group companies, loans or shareholders?** See `/intercompany`; the list in `finance_map.json` is marked unconfirmed.
4. **Sales source for use case 6:** Beecomm, as built. The page says Tabit.
5. **Is cost code 104 (גויה הרצליה) the Allegro branch הרצליה?** Mapped so, marked unconfirmed.
6. **A read-only MySQL user** on production: yes or no. Until then the API uses the admin's `DB_*` user.

**The accountant:**

1. Why is there no salary expense in 2026, and no monthly income entry after August 2026?
2. Why do suppliers show 13.96 million debit? Are there missing invoices, or were opening balances never entered?
3. How is a returned cheque recorded?
4. Which 874 run counts for a period, and what do the record types mean?
5. What are the 1,911 allocation values of `0` and the other short values?
6. Which accounts in group 800 count as food cost (`foodCostAccounts`)?
7. Is entry type `ת` a supplier invoice (as built)? What are the rules for "wrong account" and for real duplicates?
8. The legal limits for allocation numbers per date (`allocationNumber.thresholds`).
9. *(hash-sync, not the accountant)* On the local copy, bank line 3167 (23,695.28, 1 January 2026) exists in year 2024 and its old copy `999999999` left the source; production does not have this. Check the year rule of hash-sync before the next production sync.
