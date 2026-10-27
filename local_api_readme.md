# Local Data API (admin service)

A read-only JSON API over the group's operational data: **branches, employees, shifts, payroll (salaries), labor cost and Beecomm sales**. It is part of the admin service (`admin/server`) and is reachable **only from the machine the admin server runs on**. It's meant for local scripts, reports, spreadsheets and agents.

- **Base URL:** `http://localhost:3021/local-api/v1`. The port is `ADMIN_PORT`: 3021 by default and in `npm run adminDev`, 3022 in `admin:test`.
- **Code:** `admin/server/modules/localApi.js`, mounted in `admin/server/server.js`.
- **Methods:** `GET` only. The API never writes to the DB or to Beecomm.
- **Auth:** no login. Access is limited to the local machine (see [Access control](#access-control)).

```bash
curl -s http://localhost:3021/local-api/v1/branches | jq
```

---

## Contents

1. [Conventions](#conventions)
2. [Access control](#access-control)
3. [Endpoint index](#endpoint-index)
4. [Reference: health, status, branches](#reference)
5. [Employees](#employees)
6. [Shifts](#shifts)
7. [Payroll (salaries)](#payroll-salaries)
8. [Daily labor cost](#daily-labor-cost)
9. [Beecomm (sales)](#beecomm-sales)
10. [Bank](#bank)
11. [Data sources](#data-sources)
12. [Errors](#errors)
13. [Configuration and limits](#configuration-and-limits)
14. [Examples](#examples)

---

## Conventions

### Response envelope

Every successful response has the same shape:

```json
{
  "data": [ ... ],
  "meta": { "branch": "5ff419934676f0fddabaef3a", "month": "2026-09", "count": 61 }
}
```

- `data` is the payload, usually an array of records (a single object for `/health` and `/employees/:id`).
- `meta` repeats the effective query parameters and adds `count` when `data` is an array. Some endpoints add more, e.g. `totals` on labor cost and `source: "beecomm-live"` on live Beecomm calls.

Failures return `{ "error": { "code", "message" } }` with an HTTP status (see [Errors](#errors)).

### Parameter formats

| Parameter | Format | Notes |
|---|---|---|
| `branch` | Beecomm branch id, e.g. `5ff419934676f0fddabaef3a` | Get ids from `GET /branches`. Most endpoints take an **optional comma-separated list** (`branch=id1,id2`; default: all branches). `/payroll/months` and `/payroll/labor-cost` take exactly one. |
| `month` | `YYYY-MM` | Payroll month (the work month, not the pay month). |
| `from`, `to` | `YYYY-MM-DD` | Inclusive. `to` defaults to `from` (a single day). |
| `employeeId` | positive integer | `employees.employee_id`. |
| `updatedSince` | ISO date or date-time, e.g. `2026-10-01` or `2026-10-20T06:00:00Z` | Only rows changed at or after this time (UTC if no offset). See [Incremental sync](#incremental-sync-updatedsince). |

### Incremental sync (`updatedSince`)

`/employees`, `/shifts`, `/shifts/summary`, `/payroll` and `/shifts/raw` take `updatedSince`, so a client can fetch only what changed:

1. Do a full fetch once and keep `meta.asOf` from the response.
2. On the next sync, send `updatedSince=<that asOf>` and keep the new `meta.asOf`.

`meta.asOf` is taken **before** the query runs, so a row changed during the request comes back again next time instead of being missed. Re-applying a row is safe; rows are keyed by `employeeId` (+ `branch`, `month`), or by `id` for raw shifts.

What counts as a change:
- **Employees:** any edit (`employees.updated_at`).
- **Payroll and shifts:** the employee's month was saved again (`payroll.updated_at`). The whole employee-month comes back.
- **Raw shifts:** rows loaded from a Tabit upload (`created_at`). A re-upload replaces an employee's month, so the new rows come back and the old ones are gone. **Deletions are not reported:** after a re-upload, replace that employee's month on your side rather than merging.

For `/shifts`, `/shifts/summary` and `/payroll`, a `month` or `updatedSince` is required (or both). For `/shifts/raw`, `from`/`to` or `updatedSince` is required.

### Data conventions

- **Times** are ISO-8601 UTC (`2026-10-01T16:29:04.312Z`). **Dates** are `YYYY-MM-DD` in local business days.
- **Money** is in ILS (₪), as plain numbers.
- **Hours** are decimal hours (`2.5` = 2h30m). Hour buckets: `h100` (regular), `h125` and `h150` (overtime rates).
- **Personal data:** employee endpoints return national ID numbers (`idNumber`) and phones. That's one reason the API is local-only. Don't publish or forward the output.

---

## Access control

The API has **no login**. Instead, every request must pass all three checks, or it gets `403 forbidden`:

1. **Loopback connection:** the TCP peer must be `127.0.0.1` / `::1`. Requests to the machine's LAN or public IP are refused.
2. **No proxy forwarding headers:** requests carrying `X-Forwarded-For`, `X-Real-IP` or `Forwarded` are refused. A reverse proxy (e.g. nginx) on the same server also connects from 127.0.0.1, so without this check public traffic relayed by the proxy would get through.
3. **Loopback `Host` header:** must be `localhost`, `127.0.0.1` or `[::1]`. This blocks DNS-rebinding attacks from a web page open in a local browser.

To use it from another machine, use an SSH tunnel rather than exposing it:

```bash
ssh -L 3021:localhost:3021 user@server   # then call http://localhost:3021/local-api/v1 locally
```

> Don't add a reverse-proxy route for `/local-api`. Check 2 would block it anyway, but the API is meant to stay private.

---

## Endpoint index

`GET /local-api/v1/` returns this list as JSON.

`[&branch=]` = optional, comma-separated list.

| Endpoint | Purpose | Source |
|---|---|---|
| `GET /health` | Service + DB check | DB |
| `GET /status[?branch=]` | Data freshness per branch: what is loaded, up to when | all tables |
| `GET /branches` | All branches with company and Beecomm ids | `shared/restaurants.json` + `branches` |
| `GET /employees[?branch=][&active=][&updatedSince=]` | Employees with wage config | `employees` |
| `GET /employees/:employeeId` | One employee | `employees` |
| `GET /shifts?month=\|updatedSince=[&branch=][&employeeId=]` | Daily shifts after payroll rules: one row per employee/day/role | `payroll` |
| `GET /shifts/summary?month=\|updatedSince=[&branch=][&employeeId=]` | Monthly hours/tips per employee and role | `payroll` |
| `GET /shifts/raw?from=&to=\|updatedSince=[&branch=][&employeeId=]` | Raw clock-in/out times from Tabit | `tabit_shifts` ¹ |
| `GET /shifts/by-shift?from=&to=[&branch=][&split=][&minHours=]` | People and clock hours per branch/date/shift/role | `tabit_shifts` ¹ |
| `GET /payroll/months?branch=` | Months that have saved payroll | `payroll` |
| `GET /payroll?month=\|updatedSince=[&branch=][&employeeId=]` | Saved payroll + payslip components (tlush) | `payroll` |
| `GET /payroll/labor-cost?branch=&month=` | Daily revenue vs. the stored labor cost | `bcom_cash` |
| `GET /labor/daily?from=&to=[&branch=]` | Per branch per day: revenue, hours, payslip gross, labor % | `payroll` + `employees` + `bcom_cash` |
| `GET /labor/daily/employees?from=&to=[&branch=][&employeeId=]` | The same per employee per day | `payroll` + `employees` |
| `GET /beecomm/daily?from=&to=[&branch=]` | Daily sales totals (stored) | `bcom_cash` |
| `GET /beecomm/z-reports?from=&to=[&branch=]` | Daily Z reports (live) | Beecomm API |
| `GET /beecomm/z-reports/stored?from=&to=[&branch=]` | Daily Z reports (stored) | `bcom_z_reports` ¹ |
| `GET /beecomm/orders?from=&to=[&branch=][&exceptions=1]` | Order headers, optionally with exceptions (live) | Beecomm API |
| `GET /beecomm/orders/stored?from=&to=[&branch=]` | Order headers (stored) | `bcom_orders` ¹ |
| `GET /beecomm/exceptions?from=&to=[&branch=]` | Exceptions report (live) | Beecomm API |
| `GET /beecomm/exceptions/summary?from=&to=[&branch=]` | Exceptions per branch per business day, by type (live) | Beecomm API |
| `GET /beecomm/items?from=&to=[&branch=][&hours=1\|&byDay=1]` | Dish sales: quantity, sales, cancels, discounts, category (live) | Beecomm API |
| `GET /beecomm/items/stored?from=&to=[&branch=][&group=day\|dish]` | Dish sales per business day, or per dish over the range (stored) | `bcom_items_daily` ¹ |
| `GET /beecomm/payments/stored?from=&to=[&branch=][&group=day\|type\|brand]` | Payments report (דוח תשלומים): charges, refunds, transactions and service per payment type and card brand, per business day or summed (stored) | `bcom_payments_daily` ¹ |
| `GET /bank/transactions/stored?from=&to=[&company=][&account=][&q=][&side=credit\|debit][&group=none\|day\|action\|details]` | Bank account transactions (uploaded bank files), per row, per day with the closing balance, or summed per action | `bank_transactions` |

¹ Filled by the daily loader plus a one-off backfill (see [Data sources](#data-sources)). On a DB where the table hasn't been created, the endpoint answers `503 not_loaded`.

---

## Reference

### `GET /health`

Checks that the service is up and the DB answers.

```json
{ "data": { "status": "ok", "db": "ok", "time": "2026-10-21T08:00:00.000Z" }, "meta": {} }
```

### `GET /status[?branch=]`

What is loaded for each branch, and up to when. Use it to tell **"no data"** apart from **"not loaded yet"**.

```json
{
  "branch": "5ff419934676f0fddabaef3a",
  "name": "רעננה",
  "beecomm": {
    "daily":    { "lastDate": "2026-10-07", "days": 544 },
    "zReports": { "lastDate": "2026-10-20", "lastLoadAt": "2026-10-21T09:23:06.000Z", "rows": 290 },
    "orders":   { "firstDate": "2026-01-01", "lastDate": "2026-10-20", "lastLoadAt": "2026-10-21T09:36:28.000Z", "rows": 28772 },
    "items":    { "firstDate": "2026-01-01", "lastDate": "2026-10-20", "lastLoadAt": "2026-10-21T09:49:20.000Z", "rows": 32459 }
  },
  "tabitShifts": [],
  "uploads": [],
  "payrollMonths": [ { "month": "2026-09", "employees": 61, "withTlush": 57, "updatedAt": "2026-10-08T10:18:13.000Z" } ],
  "employees": { "active": 113, "total": 113, "lastUpdatedAt": "2026-10-06T19:19:54.000Z" }
}
```

- A section is `null` or `[]` when the branch has nothing there.
- When a whole source is unavailable because its table hasn't been created yet, `meta.sources` says so, e.g. `{ "tabitShifts": { "available": false, "reason": "table tabit_shifts does not exist yet" } }`. Treat those sections as unknown, not empty.
- `beecomm.daily.lastDate` is the last day the 06:00 loader stored. If it's more than a day or two old, the loader is failing (usually an expired Beecomm refresh token).
- `uploads` counts files that weren't rejected (`status` OK or PARTIAL), grouped by recognized kind.
- `meta.bank`: one line per bank account (accounts are per company, not per branch):
  `{ company, bank, account, firstDate, lastDate, lastLoadAt, rows }`. `company` is `null` for an account not listed in `shared/restaurants.json`.

### `GET /branches`

All branches from `shared/restaurants.json`, each with its payroll company and its Beecomm restaurant id. The list is cached in memory until the admin server restarts.

```json
{
  "id": "5ff419934676f0fddabaef3a",
  "name": "רעננה",
  "company": {
    "key": "pastaLina",
    "label": "פסטה לינה",
    "companyId": "5fd7022862f93c0cf1df8b63",
    "payrollSoft": "mic"
  },
  "bcomRestaurantId": "5ff41825105007954144ed8d"
}
```

| Field | Meaning |
|---|---|
| `id` | Branch id. This is the `branch` parameter everywhere. |
| `company.payrollSoft` | Payroll software the company exports to: `mic` (Micpal) or `shik` (Shiklulit). |
| `bcomRestaurantId` | The Beecomm "restaurant" (account) the branch belongs to. Several branches can share one. |

---

## Employees

### `GET /employees[?branch=id1,id2][&active=1|0|all][&updatedSince=]`

Employees, sorted by branch and name. Without `branch`, all branches.

- `active=1` (default): active, non-duplicate employees (the set payroll uses).
- `active=0`: deactivated, non-duplicate employees.
- `active=all`: everything, including rows merged as duplicates (`duplicateOf` set).

```json
{
  "employeeId": 753,
  "branch": "5ff419934676f0fddabaef3a",
  "company": null,
  "name": "…",
  "idNumber": "2169…",
  "employeeNumber": null,
  "phone": "058…",
  "active": true,
  "contractor": false,
  "duplicateOf": null,
  "wageType": "hourly_min_gross",
  "wage": 50,
  "hourlyWage": -1,
  "travel": 11,
  "maxTravel": 149,
  "roles": [
    { "role": "מלצר", "new_wage_type": null, "wage": null },
    { "role": "התלמדות מלצר", "new_wage_type": "hourly_gross", "wage": "-1" }
  ],
  "createdAt": "2026-08-31T11:57:58.000Z",
  "updatedAt": "2026-10-03T03:15:02.000Z"
}
```

| Field | Meaning |
|---|---|
| `idNumber` | National ID (ת.ז). This is the key that matches employees across systems. |
| `employeeNumber` | Number in the payroll software (`mic_nmbr`), often empty. The authoritative number is in `payroll.tlush.employeeNumber`. |
| `wageType` | Employee-level wage type: `global_net`, `global_gross`, `hourly_net`, `hourly_gross`, `hourly_min_net`, `hourly_min_gross`. `hourly_min_*` = tip-based (minimum wage + top-up). |
| `wage` | Wage for `wageType` (monthly for `global_*`, hourly otherwise). |
| `hourlyWage` | Legacy hourly field. `-1` means "not set / use minimum wage". |
| `roles[]` | Per-role overrides. A `null` type or wage falls back to the employee-level values. |
| `contractor` | Contractors are excluded from payroll exports. |

### `GET /employees/:employeeId`

The same shape for one employee, or `404` if not found. Works for any branch, active or not.

---

## Shifts

There are two kinds of shift data:

- **`/shifts` and `/shifts/summary`: hours after the payroll rules.** Tabit hours as processed on the admin **Shifts → Create payroll** screen (breaks, overtime buckets, tips), stored per employee per month in `payroll.payroll_data` when the month is saved. There are no clock times, and **a month has nothing until its payroll is saved**.
- **`/shifts/raw`: raw clock-in/out times**, as loaded from the Tabit detailed report on the **Upload files** page. Available as soon as the report is uploaded, before payroll. **`/shifts/by-shift`** counts the same pairs per shift.

### `GET /shifts?month=YYYY-MM|updatedSince=[&branch=id1,id2][&employeeId=]`

One row per **employee × day × role**, sorted by branch, date and name.

```json
{
  "branch": "5ff419934676f0fddabaef3a",
  "month": "2026-09",
  "date": "2026-09-01",
  "employeeId": 732,
  "name": "…",
  "role": "אחמש",
  "hours": { "h100": 6, "h125": 0, "h150": 0, "total": 6 },
  "tip": 64,
  "completion": 0,
  "notes": []
}
```

| Field | Meaning |
|---|---|
| `hours.h100 / h125 / h150` | Hours at 100% / 125% / 150% after the payroll rules ran (breaks, daily overtime). Rounded to 2 decimals. |
| `tip` | Tips allocated to the employee for that shift (₪). |
| `completion` | Top-up to minimum wage for tip-based roles (השלמה), ₪. |
| `notes` | Manager notes entered for that date. |

`meta.employees` = number of employees with saved payroll that month.

### `GET /shifts/summary?month=YYYY-MM|updatedSince=[&branch=id1,id2][&employeeId=]`

Monthly totals per employee, broken down by role.

```json
{
  "branch": "5ff419934676f0fddabaef3a",
  "month": "2026-09",
  "employeeId": 753,
  "name": "…",
  "workdays": 8,
  "workDates": ["2026-09-03", "2026-09-04"],
  "totalHours": 35.5,
  "roles": [
    {
      "role": "מלצר",
      "hours": { "h100": 16.27, "h125": 0, "h150": 3.73, "total": 20 },
      "tip": 898.48,
      "completion": 213.78
    }
  ],
  "updatedAt": "2026-10-08T10:18:13.000Z"
}
```

### `GET /shifts/raw?from=&to=|updatedSince=[&branch=id1,id2][&employeeId=]`

One row per clock-in/out pair from the Tabit detailed report (`tabit_shifts`), sorted by branch, date, name and block. `from`/`to` filter on the work date.

```json
{
  "id": 1201,
  "branch": "5ff419934676f0fddabaef3a",
  "month": "2026-09",
  "date": "2026-09-01",
  "block": 1,
  "employeeId": 732,
  "matchedBy": "clock_id",
  "employeeName": "*ישראל ישראלי - אחמש",
  "clockId": "942",
  "role": "אחמש",
  "clockIn": "2026-09-01 11:02:00",
  "clockOut": "2026-09-01 17:05:00",
  "hours": 6.05,
  "note": null,
  "uploadId": 17,
  "loadedAt": "2026-10-02T09:12:00.000Z"
}
```

| Field | Meaning |
|---|---|
| `clockIn`, `clockOut` | **Israel local time**, `YYYY-MM-DD HH:MM:SS` (no timezone). A shift past midnight has a `clockOut` on the next day. `clockOut` is `null` when the employee didn't clock out. |
| `hours` | `clockOut − clockIn` in hours, raw: no break deduction, no overtime split. `null` without a clock-out. |
| `block` | Shift number within the day (1, 2… for split shifts). |
| `employeeName` | The name exactly as Tabit writes it, often with a leading `*` and a ` - role` suffix. |
| `employeeId` | `employees.employee_id`, or `null` when no employee matches safely. |
| `matchedBy` | How `employeeId` was found (below), `null` if not matched. |

**Matching to employees.** Tabit gives only a name and a clock id, so each row is matched within its branch, most reliable method first:
1. **`clock_id`:** clock id → Tabit employee list (`shift_employees`) → phone → `employees.phone`. If the phone doesn't match, the roster name is tried.
2. **`name`:** the exact name with Tabit's `*` removed.
3. **`base_name`:** the name without `*` and without the ` - role` suffix, and **only if exactly one employee in the branch has it**.

Rows nobody matches safely keep `employeeId: null`, and the API never guesses between two people. Tested on Raanana: 108 people matched by clock id and all 113 employees by base name, with no wrong matches. People in the Tabit list who aren't in `employees` (mostly former staff) stay unmatched.

`meta.unmatched` = rows without an `employeeId`. `meta.missingClockOut` = rows with a clock-in and no clock-out.

### `GET /shifts/by-shift?from=&to=[&branch=id1,id2][&split=HH:MM][&minHours=]`

How many people of each role really worked each shift, and how many clock hours, from the same Tabit clock pairs as `/shifts/raw`. One row per **branch × date × shift × role**, sorted by branch, date, shift (morning first) and role. `from` and `to` are both required and filter on the work date; up to 400 days.

```json
{
  "branch": "5ff419934676f0fddabaef3a",
  "date": "2026-09-04",
  "shift": "evening",
  "role": "מלצר",
  "people": 6,
  "hours": 31.5,
  "start": "2026-09-04 17:00:00",
  "end": "2026-09-05 06:00:00"
}
```

Every work date has two shifts:
- **`morning`**: from 00:00 of the work date up to `split` (default `17:00`).
- **`evening`**: from `split` up to 06:00 of the next day. Work after midnight belongs to the evening of the work date (business-day logic, as in Beecomm).

Each clock pair adds the hours that fall inside each window: with the split at 17:00, a pair from 11:00 to 21:00 gives 6 h morning and 4 h evening. Time after 06:00 of the next day isn't counted.

| Field | Meaning |
|---|---|
| `shift` | `morning` or `evening`. |
| `role` | The `role` of the clock rows, as in `/shifts/raw`. |
| `people` | Distinct people of this role with at least `minHours` (default `1`) in the shift, summed over their pairs. A person is the matched `employeeId`, or the Tabit name without `*` when unmatched. |
| `hours` | Sum of all their clock hours inside the window: raw clock time, before payroll rules, 2 decimals. Hours of people under `minHours` still count. |
| `start`, `end` | The shift window, Israel local time. |

- A date with no clock rows for a branch has **no rows**, not rows with zero. Use `/status` (`tabitShifts`) to tell "no shifts" from "not uploaded".
- Pairs without a clock-out are left out and counted in `meta.missingClockOut`. `meta.unmatched` = pairs with no `employeeId` that were counted by name.
- No names, phones or national ids in the output.

`meta`: `{ branches, from, to, split, minHours, asOf, count, missingClockOut, unmatched }`.

The calculation is `shiftsByShift` in `localApi.js`; `node scripts/test_local_api_by_shift.js` checks it (a pair crossing the split, one past midnight).

---

## Payroll (salaries)

### `GET /payroll/months?branch=<id>`

Months with saved payroll for the branch, newest first.

```json
{ "month": "2026-09", "employees": 61, "withTlush": 57, "updatedAt": "2026-10-08T10:18:13.000Z" }
```

`withTlush` = employees whose payslip components were computed and exported. The gap from `employees` is mostly contractors and employees missing a payroll number or wage.

### `GET /payroll?month=YYYY-MM|updatedSince=[&branch=id1,id2][&employeeId=]`

The saved payroll for each employee (with `branch` and `month` on each row). The **`tlush`** object is the payslip input exactly as exported to the payroll software (Micpal / Shiklulit).

```json
{
  "employeeId": 753,
  "name": "…",
  "idNumber": "2169…",
  "workdays": 8,
  "isGlobal": true,
  "netGross": null,
  "inAdvance": 1202,
  "roleExtras": { "מלצר": { "rate": null, "travel": 0, "manualCompletion": 0 } },
  "tlush": {
    "payrollSoft": "mic",
    "employeeNumber": 1141,
    "components": [
      { "code": 1,  "label": "שכר יסוד שעתי", "wage": 35.4,  "quantity": 27.55, "netGross": "gross" },
      { "code": 39, "label": "שעות 150%",     "wage": 53.1,  "quantity": 7.95,  "netGross": "gross" },
      { "code": 3,  "label": "נסיעות",        "wage": 88,    "quantity": 1,     "netGross": "gross" }
    ],
    "hourlyMinGross": 190,
    "mixedRates": false,
    "excludedRateGroups": []
  },
  "updatedAt": "2026-10-08T10:18:13.000Z"
}
```

| Field | Meaning |
|---|---|
| `inAdvance` | Advance already paid (מפרעה), ₪. Deducted by the payroll software. |
| `roleExtras` | Per-role manual overrides entered on the payroll screen (rate, travel, manual completion). |
| `tlush` | `null` if the month was saved before tlush storage existed (before 2026-06), or if the employee wasn't exportable. |
| `tlush.components[]` | Payslip lines: `code` (payroll-software component code), `label`, `wage` (rate), `quantity`, `netGross`. The line amount is `wage × quantity`. |
| `tlush.hourlyMinGross` | Gross of the tip-based (hourly-min) roles at their real effective rate. |
| `tlush.mixedRates` | `true` if the employee had several hourly rates that Micpal merges into one. |
| `tlush.excludedRateGroups` | Rate groups beyond the two supported slots. They're left out of the export and need manual handling. |

> **Don't sum `components` into a "salary" without care.** Some lines are benefits-in-kind that are taxed but not paid in cash, e.g. `שווי ארוחות` (meal worth). The payroll software computes the actual gross and net. The calculation rules are in `payroll_calc_rules.md`.

### `GET /payroll/labor-cost?branch=<id>&month=YYYY-MM`

Daily revenue (Beecomm) against labor cost (entered on the payroll screen), the same numbers as the admin labor-cost view.

```json
{ "date": "2026-09-01", "revenue": 15145.14, "laborCost": 8205.6, "laborPct": 54.18 }
```

`meta.totals` = `{ revenue, laborCost, laborPct }` for the month. `laborCost` is `null` on days without an entry. `laborPct` is `laborCost / revenue × 100`.

This is the **stored** figure only, and it has gaps (see below). For the restaurant's daily gross use `/labor/daily`.

---

## Daily labor cost

The restaurant's daily labor cost, computed from what the admin manages: the payroll month (hours per employee per day per role) and the employees' wages. A branch-month with a **saved payroll** uses it. A month **without** one is built from the stored Tabit Shift reports (`tabit_shift_reports`) exactly like a new payroll on the Shifts page (`/payroll/extract-tabit`, then the tlush of `/payroll/tlush-preview`) — nothing is saved, and the numbers can still change until the payroll is saved. Each row says which (`payrollSource`: `saved` | `tabit`; `coverage.fromTabit` per day; `meta.payrollMonths` per branch-month). Each day carries three figures, so they can be compared:

| Figure | What it is |
|---|---|
| `gross` | **Payslip gross.** The employee's saved tlush for the month (wage lines + travel + bonus), spread over the days they worked in proportion to weighted hours (100% + 125% × 1.25 + 150% × 1.5). For an employee-month without a tlush (`source: "estimate"`), hours × current wage instead. This is the number to use as "total daily gross". |
| `adminCost` | The admin Shifts page's own daily formula: per role entry, tip + completion when there is any, otherwise weighted hours × wage. Monthly-salary employees: salary ÷ days worked. |
| `storedCost` | `bcom_cash.labor_cost`: the `adminCost` the Shifts page saved when the month was extracted. A snapshot; `null` on days it never saved. |

Wages are resolved like the Shifts page: the role's wage type, then the employee's, then the legacy `hourly_wage` (−1 = minimum). Minimum wage is `MIN_HOURLY_WAGE` (env, default 35.4), returned in `meta.minHourlyWage`. Wages are the **current** ones in `employees`, so `wageCost`/`adminCost` for an old month change if a wage was edited since; the tlush-based `gross` doesn't.

### `GET /labor/daily?from=&to=[&branch=]`

One row per branch per day (days with revenue or payroll). Up to 800 days.

```json
{
  "branch": "5ff419934676f0fddabaef3a",
  "date": "2026-09-01",
  "revenue": 15145.14,
  "hours": { "h100": 120.47, "h125": 0, "h150": 3, "total": 123.47 },
  "gross": { "total": 8426.76, "wages": 8044.12, "travel": 128.97, "bonus": 253.67, "netWages": 126.02, "meals": 66.57 },
  "wageCost": 8056.96,
  "tip": 640, "completion": -4.33,
  "adminCost": 8205.6,
  "storedCost": 8205.6,
  "laborPct": { "gross": 55.64, "adminCost": 54.18, "storedCost": 54.18 },
  "coverage": { "employees": 20, "estimated": 2, "globalSalary": 2, "unpricedHours": 14.78 }
}
```

| Field | Meaning |
|---|---|
| `revenue` | Beecomm daily total (`bcom_cash.total`, before discounts). `null` when not loaded. |
| `gross.total` | `wages + travel + bonus`, all gross. |
| `gross.netWages` | Wage lines paid **net** (net-wage employees). Not in `total`: their gross is higher and only the payroll software computes it. |
| `gross.meals` | Meal benefit value (שווי ארוחות). Not in `total`. |
| `wageCost` | Weighted hours × current wage (monthly salary ÷ days for salaried staff). |
| `tip`, `completion` | From the payroll month, for tip-based roles. |
| `laborPct` | Cost ÷ revenue × 100 for each figure. `null` for a day with no payroll rows. |
| `coverage.employees` | Employees with hours that day. |
| `coverage.estimated` | Of them, how many have no tlush, so `gross` is hours × wage. |
| `coverage.globalSalary` | Of them, how many are on a monthly salary. |
| `coverage.unpricedHours` | Hours of roles with no wage set. They add nothing to `wageCost`/`adminCost` (and to `gross` when estimated). |

`meta.totals` sums the days **that have payroll rows** (so branches whose payroll isn't in the admin don't dilute the %): `{ revenue, gross, adminCost, storedCost, days, daysWithoutRevenue, laborPct }`.

### `GET /labor/daily/employees?from=&to=[&branch=][&employeeId=]`

The rows behind each day: one per employee per worked day, with `month`, `employeeId`, `name`, `globalSalary`, `hours`, `gross` (plus `gross.source`: `tlush` or `estimate`), `wageCost`, `tip`, `completion`, `adminCost`, `unpricedHours` and `payrollUpdatedAt`.

### What the numbers showed (October 2026)

- **Raanana, June–September:** payslip gross is 28–31% of revenue.
- **The port matches the admin:** where the stored cost exists, `adminCost` equals it (e.g. 1 Sep: ₪8,205.60 both).
- **Stored cost has gaps:** `bcom_cash.labor_cost` for Raanana is missing from 18 July and from 16 September to month end, so the stored % for those months (12–17%) is wrong.
- **Missing wages:** Rosh Pina's June has 2,539 of 2,677 hours on roles with no wage, so its cost is near zero. Raanana's September has 432 such hours (`gross` is still right where a tlush exists).
- **The admin formula vs. payslip:** for tip-based roles `adminCost` counts tips + completion, which can be well above the payslip gross for that day (e.g. ₪523 vs ₪463 for one waiter on 5 Sep). Over a month they differed by up to 18% (Raanana, September: ₪240k vs ₪203k).

---

## Beecomm (sales)

There are two kinds of Beecomm data:

- **Stored** (`/beecomm/daily`, `/z-reports/stored`, `/orders/stored`, `/items/stored`, `/payments/stored`): loaded into the DB every day at 06:00 by the analoader cron (`meta.source: "db"`). It's fast and gives long history (up to 800 days per call), but it's at most a day behind. `/status` shows how far each branch is loaded.
- **Live** (`/beecomm/z-reports`, `/orders`, `/exceptions`, `/exceptions/summary`, `/items`): fetched from the Beecomm backoffice API on every call (`meta.source: "beecomm-live"`). It's always current but slower, and the range is capped at **93 days**. The code is in `scripts/server/analoader/bcom_api_loader.js`.

Stored rows use **business days** (`businessDate`, the day of the Z the order or Z belongs to), so an order after midnight counts on the evening it started. Stored times are **Israel local time** (`YYYY-MM-DD HH:MM:SS`). Live rows keep Beecomm's UTC ISO times.

All Beecomm endpoints take an optional `branch` list (`branch=id1,id2`). Without it they query every branch.

### `GET /beecomm/daily?from=&to=[&branch=]`

```json
{
  "branch": "5ff419934676f0fddabaef3a",
  "date": "2026-10-01",
  "total": 29814.56,
  "service": 2818.71,
  "discount": 1682,
  "diners": 187,
  "laborCost": null
}
```

The per-restaurant total rows (`branchId 900`) are left out unless you ask for that branch explicitly.

### `GET /beecomm/z-reports?from=&to=[&branch=]`

Beecomm Z reports, one per branch per business day, **plus one `branchId: "900"` total row ("סהכ") per Beecomm restaurant**. Skip those rows when summing. These fields are added: `restaurantId`.

Main fields: `branchId`, `branchName`, `startTs`/`endTs`, `totalIncome`, `brutoIncom`, `netoIncom`, `serviceTotal`, `discountTotal`, `dinnersCount`, `dinnerAvg`, `ordersCount`, `orderAvg`, `orderCancelsCount`, `totalItemCancels`, `totalPaymentRefund`, `taxAmount`, `paymentTypes[]`.

### `GET /beecomm/z-reports/stored?from=&to=[&branch=]`

Z reports saved by the daily loader (`bcom_z_reports`), one per branch per business day, without the `900` total rows. `from`/`to` filter on `businessDate`.

```json
{
  "zId": "6abe051aa7da3d00029eadb1",
  "restaurantId": "5ff41825105007954144ed8d",
  "branch": "5ff419934676f0fddabaef3a",
  "zNumber": 549,
  "businessDate": "2026-10-01",
  "openedAt": "2026-10-01 10:00:00",
  "closedAt": "2026-10-01 22:54:52",
  "netIncome": 23000.5, "vat": 3910.1, "service": 2818.71,
  "totalIncome": 29814.56, "brutoIncome": 29814.56,
  "discounts": 1682, "refunds": 900, "itemCancels": 741,
  "cancelledOrders": 2, "cancelledItems": 11,
  "diners": 187, "cancelledDiners": 1, "orders": 121,
  "payments": [ { "type": 1, "name": "אשראי", "charged": 20000, "refunded": 0, "net": 20000, "transactions": 90, "brands": [ ... ] } ],
  "loadedAt": "2026-10-02T03:00:12.000Z"
}
```

`brutoIncome` equals `/beecomm/daily` `total`. `netIncome` is without tips and VAT. The `payments` net is `charged − refunded`, as in Beecomm's cash report.

### `GET /beecomm/orders?from=&to=[&branch=][&exceptions=1]`

One **order header** per order: totals, discount, service, table, diners, delivery source. Dish lines aren't included (that would need a separate Beecomm endpoint). These fields are added: `restaurantId`, `branchName`.

```json
{
  "id": "6abe7f69b782a40e59548e07",
  "orderNumber": 57932,
  "orderDailyNumber": 90,
  "branchId": "5ff419934676f0fddabaef3a",
  "branchName": "ג'ויה רעננה",
  "openedAt": "2026-10-01T15:42:33.791Z",
  "closedAt": "2026-10-01T16:29:04.312Z",
  "orderType": 1,
  "tableNumber": 12,
  "dinnersCount": 2,
  "creator": "…",
  "total": 346,
  "netTotal": 346,
  "discount": 0,
  "discountAmount": 0,
  "service": 0.15,
  "serviceAmount": 51.9,
  "totalItems": 8,
  "totalCanceled": 0,
  "orderExceptions": 0,
  "status": 2,
  "zId": "6abe051aa7da3d00029eadb1",
  "externalCompanyName": null,
  "externalOrderId": null,
  "ccOrderNumber": null,
  "clientName": "",
  "clientPhoneNumber": "",
  "restaurantId": "5ff41825105007954144ed8d"
}
```

| Field | Meaning |
|---|---|
| `total` / `netTotal` | Before / after order discount (₪). |
| `discount`, `service` | Rates (0.15 = 15%). `discountAmount`, `serviceAmount` are the ₪ values. |
| `orderType` | Observed values: `1` dine-in, `2` and `3` delivery/takeaway via a platform (check `externalCompanyName`: `wolt`, `10Bis`…), `9` not yet identified. |
| `orderExceptions` | Number of exceptions on the order (see below). |
| `orderNumber` | **Unique per branch only.** Join on `branchId` + `orderNumber`. |

Known quirk: for some delivery orders Beecomm returns the client name and phone duplicated (`"0526…0526…"`). The API passes them through as-is.

**`exceptions=1`** adds an `exceptions` array to every order: the matching rows of the exceptions report, joined on `branchId + orderNumber`, or `[]` if there are none. On every order checked, the array length equals `orderExceptions`.

### `GET /beecomm/orders/stored?from=&to=[&branch=]`

The same order headers, saved by the daily loader (`bcom_orders`). `from`/`to` filter on `businessDate`. Field names are camel-cased and slightly different from the live call; client name and phone are not stored.

```json
{
  "orderId": "6abe7f69b782a40e59548e07",
  "restaurantId": "5ff41825105007954144ed8d",
  "branch": "5ff419934676f0fddabaef3a",
  "orderNumber": 57932,
  "dailyNumber": 90,
  "businessDate": "2026-10-01",
  "zId": "6abe051aa7da3d00029eadb1",
  "openedAt": "2026-10-01 18:42:33",
  "closedAt": "2026-10-01 19:29:04",
  "orderType": 1,
  "status": 2,
  "tableNumber": 12,
  "diners": 2,
  "total": 346, "netTotal": 346,
  "discountRate": 0, "discountAmount": 0,
  "serviceRate": 0.15, "serviceAmount": 51.9,
  "totalItems": 8, "totalCanceled": 0,
  "exceptionsCount": 0,
  "source": null,
  "externalOrderId": null,
  "creator": "…",
  "loadedAt": "2026-10-02T03:00:40.000Z"
}
```

- **Revenue from orders:** sum `netTotal − serviceAmount` over orders with `status = 2` (closed). That matches the Z's `brutoIncome` (Raanana, September 2026: ₪662,287 vs ₪662,518). `total` and `netTotal` include the service charge (tips), which the Z excludes, and `status = 1` are cancelled orders (their count equals the Z's `cancelledOrders`).
- `discountRate` / `serviceRate` are usually fractions (`0.12` = 12%). A few orders (about 1 in 1,500) hold a fixed ₪ amount there instead, equal to the `…Amount` field, so use `discountAmount` / `serviceAmount` for money and treat a rate above 1 as "fixed amount".

History before the table existed is loaded with the backfill script (see [Data sources](#data-sources)).

### `GET /beecomm/exceptions?from=&to=[&branch=]`

The Beecomm exceptions report: discounts, refunds, cancellations and price changes, with who requested and who approved each one. These fields are added: `restaurantId`.

```json
{
  "action": "orderDiscount",
  "amount": 13,
  "discountAmount": 26,
  "orderNumber": 57918,
  "orderTotal": 26,
  "zNumber": 549,
  "branchId": "5ff419934676f0fddabaef3a",
  "branchName": "ג׳ויה רעננה",
  "dishName": null,
  "itemQuantity": null,
  "requester": "…",
  "authorizer": "…",
  "justificationText": "נכנס לעסקית",
  "eventTimeStamp": "2026-10-01T14:52:18.071Z"
}
```

`action` values seen: `cancelItem`, `orderDiscount`, `itemDiscount`, `cancelOrder`, `paymentRefund`, `itemPriceChange`, `orderOptimization`, `OTH`.

### `GET /beecomm/exceptions/summary?from=&to=[&branch=]`

The exceptions report rolled up per branch per business day (one Z), with a count and ₪ sum per action. Meant for anomaly checks. Built from the live report, so the same 93-day cap applies.

```json
{
  "branch": "5ff419934676f0fddabaef3a",
  "branchName": "ג׳ויה רעננה",
  "zNumber": 549,
  "date": "2026-10-01",
  "actions": {
    "cancelItem":    { "count": 9, "amount": 733 },
    "orderDiscount": { "count": 3, "amount": 635 },
    "paymentRefund": { "count": 3, "amount": 900 }
  },
  "total": { "count": 26, "amount": 2903 }
}
```

- `date` is the Israel-local day of the first exception in that Z, which is the business day except for a Z with only after-midnight exceptions.
- `amount` sums each row's `amount`. Its meaning depends on the action (cancelled item value, discount, refund…), so compare an action with itself over time rather than adding different actions together.

### Dish sales

Beecomm reports dish sales **as totals only** (its "items" analytics report). There are **no dish lines per order**, so questions like "which dishes are ordered together" or "dishes per waiter" can't be answered from Beecomm. What it does give, per branch and dish: quantity, sales, cancellations, discounts and the menu category, for any range of business days, optionally per hour.

Checked against the Z: one day's `totalSales` over all dishes equals that day's Z `brutoIncome` (within a few ₪), so it is **before** order discounts. Net dish revenue ≈ `totalSales − orderDiscountSum − discountSum`.

#### `GET /beecomm/items?from=&to=[&branch=][&hours=1|&byDay=1]`

Live. Without flags: one row per branch + dish, summed over the whole range (93-day cap).

- `hours=1`: one row per branch + dish + `hour` (Israel local hour, 0–23).
- `byDay=1`: one Beecomm call per business day; each row gets `businessDate`. Capped at **31 days** (it's one call per day per Beecomm restaurant). For longer daily history use `/items/stored`.

```json
{
  "dishId": "68d941e3e2c85114c1989c57",
  "branchId": "5ff419934676f0fddabaef3a",
  "branchName": "ג'ויה רעננה",
  "restaurantId": "5ff41825105007954144ed8d",
  "dishName": "1/2 סטלה",
  "isCombo": false,
  "hour": null,
  "quantity": 1,
  "totalSales": 36,
  "soldInCombo": 0,
  "cancelsCount": 0,
  "cancelsSum": 0,
  "orderDiscountSum": 0,
  "discountSum": 0,
  "mcTotalBenefits": 0,
  "depreciationPercentFromTotal": null,
  "catalogLevel0Name": "שתיה",
  "catalogLevel1Name": "בירה",
  "businessDate": "2026-10-20"
}
```

| Field | Meaning |
|---|---|
| `quantity`, `totalSales` | Units sold and their value before order discounts. Cancelled units are not included. |
| `isCombo`, `soldInCombo` | A combo/meal is its own row (`isCombo: true`). Its parts are separate rows, and `soldInCombo` says how many of their `quantity` were sold inside a combo, so don't add combo rows and part rows together for unit counts. |
| `cancelsCount`, `cancelsSum` | Cancelled units and their value. |
| `orderDiscountSum` | This dish's share of order-level discounts. |
| `discountSum` | Item-level discounts (including items given free). |
| `mcTotalBenefits` | Member-club benefits. |
| `catalogLevel0Name` … `catalogLevel2Name` | Menu category path, e.g. שתיה → יין → לבן כוסות. Missing levels are absent. |
| `dishName` | As in Beecomm; may have a leading space. |

#### `GET /beecomm/items/stored?from=&to=[&branch=][&group=day|dish]`

The same report, saved per business day by the 06:00 loader (`bcom_items_daily`). Field names are camel-cased: `category0..2` for the catalog levels, `memberBenefits` for `mcTotalBenefits`, and `branch` for `branchId`.

- `group=day` (default): one row per business day + branch + dish, with `businessDate` and `loadedAt`.
- `group=dish`: summed over the range per branch + dish, plus `days` (days it sold), `firstSold`, `lastSold` and `avgPrice` (`totalSales / quantity`). Sorted by sales. This is the closest thing to a menu Beecomm gives this API: everything that **sold** in the range, with its category and actual average price. Dishes on the menu that never sold don't appear.

#### `GET /beecomm/payments/stored?from=&to=[&branch=][&group=day|type|brand]`

The Beecomm payments report (דוח תשלומים, `getPaymentsReport`), saved per branch and business day by the 06:00 loader (`bcom_payments_daily`, one Beecomm call per branch per day). Each payment type (`paymentType`: 1 אשראי, 2 מזומן, 4 וולט, 5 הקפה, 10 Sodexo, 12 תן ביס, 14 הפקדת טיפים, 24 מולטיפס…) has a total row; credit, Sodexo and 10bis also have one row per card brand (VISA, MASTERCARD, AMEX, PRIVATE LABEL BRAND - חבר, פורטל תן ביס…). The report's section sums ("תשלומים", "תשלומים מחוץ לזד") and service footers are not stored — sum the type rows.

| Field | Meaning |
|---|---|
| `paymentType`, `paymentTypeName` | Beecomm's payment type id and Hebrew name. |
| `cardBrand` | `group=day`: `null` on the type's total row, else the brand. |
| `inZ` | `false` for payments outside the Z (e.g. הפקדת טיפים). |
| `totalCharges` | Charged, service (tips) included, in whole shekels. A day's type totals with `inZ` sum to the Z `totalIncome`. |
| `totalRefunded`, `refundTransactions` | Refunds and their count. |
| `transactions` | Number of payments. |
| `service` | Service (tips) inside the charges. |
| `noTips`, `noTipsNoTax` | Beecomm's `totalNoTips`: in the data it is charges minus refunds (service still in, despite the name); and that without VAT. |
| `taxAmount`, `hakafaReturns`, `serviceOnly` | As in Beecomm (`serviceOnly` only on brand rows). |

- `group=day` (default): every stored row with `businessDate` and `loadedAt`.
- `group=type`: the type total rows summed over the range per branch, with `days`. Sorted by charges.
- `group=brand`: the brand rows summed over the range per branch + type + `cardBrand`.

---

## Bank

### `GET /bank/transactions/stored?from=&to=[&company=a,b][&account=][&q=][&side=credit|debit][&group=none|day|action|details]`

The bank transactions uploaded on the admin **Upload files** page (`bank_transactions`; today Bank Hapoalim "תנועות בחשבון", `.xlsx`). A bank account belongs to a **company**, not a branch: `shared/restaurants.json` → the company's `bank_accounts` (`[{ bank, account }]`). Today: פסטה לינה (`pastaLina`) = Hapoalim `12-584-136663`.

| Parameter | Meaning |
|---|---|
| `company` | Company keys (`company.key` of `/branches`). A company with no bank account gives no rows. Unknown key → 404. Empty = all accounts. |
| `account` | One account number, as in the file (`12-584-136663`). |
| `q` | Text inside the action or the details, e.g. `WOLT`, `מקס`, `ביטוח לאומי`. |
| `side` | `credit` = money in (זכות), `debit` = money out (חובה). |

| Field | Meaning |
|---|---|
| `date` | The transaction date (תאריך). |
| `actionCode`, `action` | The bank's action code and name (קוד פעולה, הפעולה), e.g. 175 / מקס איט פיננסי, 493 / שיק. |
| `details` | פרטים. Often null (checks). Some Hebrew in it is stored in reverse letter order by the bank file (e.g. `הננער היו'ג` = ג'ויה רעננה). |
| `reference`, `bundle` | אסמכתא, צרור. |
| `credit`, `debit` | Money in / out, ₪ (one of them is null). |
| `balance` | The balance after this row (יתרה). |

- `group=none` (default): the rows, newest date first.
- `group=day`: per account and date: `credit`, `debit`, the number of each (`credits`, `debits`), and `closingBalance`: the balance at the end of the day. The bank file lists the newest row first, so this is the balance of the day's first row in the latest upload that has the day. `closingBalance` is `null` when `q` or `side` is given. Days with no transactions have no row.
- `group=action`: per account + action: `transactions`, `credit`, `debit`, `firstDate`, `lastDate`, biggest first. `group=details`: the same per action + details.
- The data is as fresh as the last uploaded bank file (`/status` → `meta.bank.lastDate`).

---

## Data sources

| Data | Where it comes from | Freshness |
|---|---|---|
| Branches | `shared/restaurants.json` + DB `branches` (Beecomm restaurant id) | Cached until admin restart |
| Employees | DB `employees` (edited on the admin employees screen, Micpal sync) | Live |
| Shifts (after rules), payroll | DB `payroll`, written when a month is saved / exported on the admin Shifts screen (Tabit import → payroll rules → tlush) | As of last save |
| Raw shifts | DB `tabit_shifts`, written by the admin **Upload files** page from the Tabit detailed report | As of last upload |
| Labor cost, Beecomm daily | DB `bcom_cash`, loaded daily 06:00 by `scripts/server/analoader` (labor cost entered in admin) | Previous day |
| Beecomm Z (stored) | DB `bcom_z_reports`, same 06:00 job (`bcom_z_details.js`) | Previous day |
| Beecomm orders (stored) | DB `bcom_orders`, same 06:00 job (`bcom_orders.js`) | Previous day |
| Beecomm dish sales (stored) | DB `bcom_items_daily`, same 06:00 job (`bcom_items.js`), one Beecomm call per day | Previous day |
| Beecomm payments report (stored) | DB `bcom_payments_daily`, same 06:00 job (`bcom_payments.js`), one Beecomm call per branch per day, at most the last 14 days per run | Previous day |
| Uploads log | DB `file_uploads`, written by the Upload files page | Live |
| Bank transactions | DB `bank_transactions`, written by the Upload files page from the bank file (account → company in `shared/restaurants.json` `bank_accounts`) | As of last upload |
| Beecomm Z / orders / exceptions / dish sales (live) | Beecomm backoffice API (`20cs5hma71…amazonaws.com/prod/api`) | Live |

### Tables and history

All tables exist on the production DB (created 21 Oct 2026). Beecomm history was backfilled from **1 Jan 2026**; from then on the 06:00 loader adds each day.

| Table | Created by | Backfill / reload a range |
|---|---|---|
| `tabit_shifts`, `file_uploads`, `bank_transactions`, `bcom_z_reports` | `scripts/utils/create_file_upload_tables.sql` | Z: `node scripts/server/analoader/bcom_z_details.js --from DD/MM/YYYY [--to DD/MM/YYYY]`. Raw shifts: upload Tabit detailed reports on the Upload files page (nothing uploaded yet). |
| `bcom_orders` | `scripts/utils/create_bcom_orders_table.sql` | `node scripts/server/analoader/bcom_orders.js --from DD/MM/YYYY [--to DD/MM/YYYY] [--pause ms]` (one week per call). Run it **after** the Z load for the same dates, so orders get their Z's business day. |
| `bcom_items_daily` | `scripts/utils/create_bcom_items_table.sql` | `node scripts/server/analoader/bcom_items.js --from DD/MM/YYYY [--to DD/MM/YYYY] [--pause ms]` (one call per day per Beecomm restaurant). Independent of the Z load. |
| `bcom_payments_daily` | `scripts/utils/create_bcom_payments_table.sql` | `node scripts/server/analoader/bcom_payments.js --from DD/MM/YYYY [--to DD/MM/YYYY] [--branch id1,id2] [--pause ms]` (one call per branch per day). Independent of the Z load. |

- Reloading is safe: Z and orders are upserted, and a reloaded dish-sales day replaces that day.
- **Don't run backfills in parallel or without `--pause`** (default 2 s). Thousands of fast calls got the Beecomm API blocked with `403 Forbidden` (CloudFront) for about 20 minutes on 21 Oct 2026. The block hits every caller from the same IP, including the backoffice in a browser.
- On a DB where a table is missing, its endpoints answer `503 not_loaded` and `/status` lists it in `meta.sources`.

### Data coverage (21 Oct 2026)

| Data | Branches | Range | Notes |
|---|---|---|---|
| Beecomm daily totals (`bcom_cash`) | all | to 7 Oct 2026 | **The 06:00 loader has failed since 8 Oct** (old token in production). Deploying the `BCOM_BO_*` `.env` lines fixes it; it catches up from the last day. |
| Z reports | all with Beecomm sales in 2026 | 1 Jan – 20 Oct 2026 | 2,437 reports |
| Orders | same | 1 Jan – 20 Oct 2026 | 208,994 orders, all linked to their Z |
| Dish sales | same | 1 Jan – 20 Oct 2026 | 226,375 rows; daily sums match the Z within 1% |
| Payroll | רעננה (to Sep 2026); ג'ויה, רמת החיל, ראש פינה (to Jun 2026) | per month | Other branches' payroll isn't managed in the admin. Payslips (tlush) from Jun 2026. |
| Raw Tabit shifts | none | — | No Tabit file uploaded since the table was created. |

Branches whose Beecomm data stops: ג'ויה and לה בראצ׳ה (28 Jul 2026), פיאמונטה (15 Jul), תל אביב (26 Feb), פסקרה and הרצליה (2025). Closed, or not visible to the backoffice user.

---

## Errors

| Status | `error.code` | When |
|---|---|---|
| 400 | `bad_request` | Missing or invalid parameter (bad `month`, bad dates, range over the limit, bad `employeeId`). |
| 403 | `forbidden` | Not a direct localhost request (see [Access control](#access-control)). |
| 404 | `not_found` | Unknown branch, employee or endpoint. |
| 503 | `not_loaded` | The table behind the endpoint hasn't been created yet; the message names the SQL file. |
| 502 | `upstream_error` | The Beecomm API failed, usually an expired refresh token. |
| 500 | `internal_error` | Anything else (DB error, bug). Details are in the admin server log, prefixed `local-api`. |

```json
{ "error": { "code": "bad_request", "message": "month must be YYYY-MM" } }
```

---

## Configuration and limits

| Setting | Where | Notes |
|---|---|---|
| `ADMIN_PORT` | env | Port of the admin server (default 3021). |
| `DB_*` | `.env` | Shared MySQL connection (`admin/server/sources/dbpool.js`). |
| `BCOM_BO_API_KEY`, `BCOM_BO_REFRESH_TOKEN` | `.env` | Beecomm backoffice login for the live endpoints. The refresh token is copied from a browser session on backoffice.beecommcloud.com and stops working if that user logs out or changes their password. Then copy a fresh one and restart. Access tokens are cached for ~55 min. |
| `MAX_BEECOMM_DAYS` | `localApi.js` | 93-day cap on live Beecomm ranges. |
| `MAX_STORED_DAYS` | `localApi.js` | 800-day cap on stored ranges (`/shifts/raw`, `/beecomm/*/stored`). |
| `MAX_ITEMS_DAYS_BY_DAY` | `localApi.js` | 31-day cap on `/beecomm/items?byDay=1`. |
| `MAX_BY_SHIFT_DAYS` | `localApi.js` | 400-day cap on `/shifts/by-shift`. |
| `MIN_HOURLY_WAGE` | env | Minimum hourly wage for `/labor/*` (default 35.4), same as the payroll export. |

- Live Beecomm calls make one request per Beecomm restaurant in range. Allow a few seconds for all branches over a month.
- No pagination: each response is complete. The largest are a month of `/beecomm/orders/stored` or `/beecomm/items/stored` for all branches (about 19k and 20k rows, ~1 s). Narrow with `branch` where you can.
- Slowest calls: `/beecomm/exceptions/summary` for all branches (~4.5 s for 20 days) and `/beecomm/items?byDay=1` (~2.5 s per branch-week).

---

## Examples

```bash
API=http://localhost:3021/local-api/v1
R=5ff419934676f0fddabaef3a   # ג׳ויה רעננה

# Which payroll months exist for the branch
curl -s "$API/payroll/months?branch=$R" | jq '.data[] | {month, employees}'

# Hours per employee for September
curl -s "$API/shifts/summary?branch=$R&month=2026-09" | jq '.data[] | {name, totalHours}'

# Raw shifts with no clock-out, all branches, September
curl -s "$API/shifts/raw?from=2026-09-01&to=2026-09-30" | jq '[.data[] | select(.clockIn and (.clockOut | not))]'

# Waiters per evening shift in September, split at 16:00
curl -s "$API/shifts/by-shift?branch=$R&from=2026-09-01&to=2026-09-30&split=16:00" \
  | jq '.data[] | select(.shift == "evening" and .role == "מלצר") | {date, people, hours}'

# What changed in employees since the last sync
curl -s "$API/employees?updatedSince=2026-10-20T06:00:00Z" | jq '.meta.asOf, (.data | length)'

# Is everything loaded?
curl -s "$API/status" | jq '.data[] | {name, beecomm: .beecomm.daily.lastDate, payroll: .payrollMonths[0].month}'

# Labor cost % for September
curl -s "$API/payroll/labor-cost?branch=$R&month=2026-09" | jq '.meta.totals'

# Daily gross and labor % for September, and the month totals
curl -s "$API/labor/daily?branch=$R&from=2026-09-01&to=2026-09-30" \
  | jq '.data[] | {date, revenue, gross: .gross.total, pct: .laborPct.gross}, .meta.totals'

# Who made 5 Sep expensive
curl -s "$API/labor/daily/employees?branch=$R&from=2026-09-05" \
  | jq '.data | sort_by(-.gross.total) | .[:10] | .[] | {name, hours: .hours.total, gross: .gross.total, adminCost}'

# Orders with exceptions on 1 Oct, only those that had any
curl -s "$API/beecomm/orders?branch=$R&from=2026-10-01&exceptions=1" \
  | jq '[.data[] | select(.exceptions | length > 0) | {orderNumber, total, exceptions: [.exceptions[] | {action, amount, requester}]}]'

# Top 10 dishes by sales in Raanana, September (stored)
curl -s "$API/beecomm/items/stored?branch=$R&from=2026-09-01&to=2026-09-30&group=dish" \
  | jq '.data[:10] | .[] | {dishName, quantity, totalSales, avgPrice}'

# Payments by type in Raanana, October (stored): credit, cash, Wolt, 10bis…
curl -s "$API/beecomm/payments/stored?branch=$R&from=2026-10-01&to=2026-10-24&group=type" \
  | jq '.data[] | {paymentTypeName, totalCharges, transactions, service}'

# Pasta Lina bank account: money in per action, October
curl -s "$API/bank/transactions/stored?company=pastaLina&from=2026-10-01&to=2026-10-25&group=action&side=credit" \
  | jq '.data[] | {action, transactions, credit}'

# Wine-by-the-glass sales per hour yesterday, all branches (live)
curl -s "$API/beecomm/items?from=2026-10-20&to=2026-10-20&hours=1" \
  | jq '[.data[] | select(.catalogLevel2Name // "" | test("כוסות"))] | group_by(.hour) | map({hour: .[0].hour, qty: (map(.quantity) | add)})'

# Comped items ("על חשבון הבית") across all branches, first week of October
curl -s "$API/beecomm/exceptions?from=2026-10-01&to=2026-10-07" \
  | jq '[.data[] | select(.justificationText == "על חשבון הבית")] | length'
```

```js
// Node 18+
const API = "http://localhost:3021/local-api/v1";
const get = async (path) => {
  const res = await fetch(API + path);
  const body = await res.json();
  if (!res.ok) throw new Error(`${body.error.code}: ${body.error.message}`);
  return body.data;
};

const shifts = await get("/shifts?branch=5ff419934676f0fddabaef3a&month=2026-09");
```
