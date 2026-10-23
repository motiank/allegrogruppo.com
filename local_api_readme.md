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
8. [Beecomm (sales)](#beecomm-sales)
9. [Data sources](#data-sources)
10. [Errors](#errors)
11. [Configuration and limits](#configuration-and-limits)
12. [Examples](#examples)

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

| Endpoint | Purpose | Source |
|---|---|---|
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
| `GET /payroll/labor-cost?branch=&month=` | Daily revenue vs. labor cost | `bcom_cash` |
| `GET /beecomm/daily?from=&to=[&branch=]` | Daily sales totals (stored) | `bcom_cash` |
| `GET /beecomm/z-reports?from=&to=[&branch=]` | Daily Z reports (live) | Beecomm API |
| `GET /beecomm/z-reports/stored?from=&to=[&branch=]` | Daily Z reports (stored) | `bcom_z_reports` ¹ |
| `GET /beecomm/orders?from=&to=[&branch=][&exceptions=1]` | Order headers, optionally with exceptions (live) | Beecomm API |
| `GET /beecomm/orders/stored?from=&to=[&branch=]` | Order headers (stored) | `bcom_orders` ¹ |
| `GET /beecomm/exceptions?from=&to=[&branch=]` | Exceptions report (live) | Beecomm API |
| `GET /beecomm/exceptions/summary?from=&to=[&branch=]` | Exceptions per branch per business day, by type (live) | Beecomm API |
| `GET /beecomm/items?from=&to=[&branch=][&hours=1\|&byDay=1]` | Dish sales: quantity, sales, cancels, discounts, category (live) | Beecomm API |
| `GET /beecomm/items/stored?from=&to=[&branch=][&group=day\|dish]` | Dish sales per business day, or per dish over the range (stored) | `bcom_items_daily` ¹ |

¹ The table must be created first (see [Data sources](#data-sources)). Until then the endpoint answers `503 not_loaded`.

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
    "zReports": { "lastDate": "2026-10-07", "lastLoadAt": "2026-10-08T03:00:12.000Z", "rows": 400 },
    "orders":   { "firstDate": "2026-01-01", "lastDate": "2026-10-07", "lastLoadAt": "2026-10-08T03:00:40.000Z", "rows": 61000 },
    "items":    { "firstDate": "2026-01-01", "lastDate": "2026-10-07", "lastLoadAt": "2026-10-08T03:01:30.000Z", "rows": 28000 }
  },
  "tabitShifts": [
    { "month": "2026-09", "shifts": 812, "employees": 64, "missingClockOut": 3, "lastUploadAt": "2026-10-02T09:12:00.000Z" }
  ],
  "uploads": [ { "kind": "TABIT_DETAILED", "files": 4, "lastUploadAt": "2026-10-02T09:12:00.000Z" } ],
  "payrollMonths": [ { "month": "2026-09", "employees": 61, "withTlush": 57, "updatedAt": "2026-10-08T10:18:13.000Z" } ],
  "employees": { "active": 113, "total": 113, "lastUpdatedAt": "2026-10-19T08:00:00.000Z" }
}
```

- A section is `null` or `[]` when the branch has nothing there.
- When a whole source is unavailable because its table hasn't been created yet, `meta.sources` says so, e.g. `{ "tabitShifts": { "available": false, "reason": "table tabit_shifts does not exist yet" } }`. Treat those sections as unknown, not empty.
- `beecomm.daily.lastDate` is the last day the 06:00 loader stored. If it's more than a day or two old, the loader is failing (usually an expired Beecomm refresh token).
- `uploads` counts files that weren't rejected (`status` OK or PARTIAL), grouped by recognized kind.

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

---

## Beecomm (sales)

There are two kinds of Beecomm data:

- **Stored** (`/beecomm/daily`, `/z-reports/stored`, `/orders/stored`, `/items/stored`): loaded into the DB every day at 06:00 by the analoader cron (`meta.source: "db"`). It's fast and gives long history (up to 800 days per call), but it's at most a day behind. `/status` shows how far each branch is loaded.
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
| Uploads log | DB `file_uploads`, written by the Upload files page | Live |
| Beecomm Z / orders / exceptions / dish sales (live) | Beecomm backoffice API (`20cs5hma71…amazonaws.com/prod/api`) | Live |

### Tables that must be created first

| Table | Create with | Then load history with |
|---|---|---|
| `tabit_shifts`, `file_uploads`, `bcom_z_reports` | `scripts/utils/create_file_upload_tables.sql` | Z: `node scripts/server/analoader/bcom_z_details.js --from DD/MM/YYYY [--to DD/MM/YYYY]`. Raw shifts: upload Tabit reports on the Upload files page. |
| `bcom_orders` | `scripts/utils/create_bcom_orders_table.sql` | `node scripts/server/analoader/bcom_orders.js --from DD/MM/YYYY [--to DD/MM/YYYY]` (one week per Beecomm call). Run it **after** the Z backfill for the same dates, so orders get their Z's business day. |
| `bcom_items_daily` | `scripts/utils/create_bcom_items_table.sql` | `node scripts/server/analoader/bcom_items.js --from DD/MM/YYYY [--to DD/MM/YYYY]` (one Beecomm call per day per restaurant, so a year takes a while). Independent of the Z backfill. |

Until a table exists, its endpoints answer `503 not_loaded` and `/status` lists it in `meta.sources`.

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

- Live Beecomm calls make one request per Beecomm restaurant in range. Allow a few seconds for all branches over a month.
- No pagination: each response is complete. The largest is `/beecomm/orders` for all branches: about 13k orders for the first 19 days of October 2026. Narrow it with `branch` where you can.

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

# Orders with exceptions on 1 Oct, only those that had any
curl -s "$API/beecomm/orders?branch=$R&from=2026-10-01&exceptions=1" \
  | jq '[.data[] | select(.exceptions | length > 0) | {orderNumber, total, exceptions: [.exceptions[] | {action, amount, requester}]}]'

# Top 10 dishes by sales in Raanana, September (stored)
curl -s "$API/beecomm/items/stored?branch=$R&from=2026-09-01&to=2026-09-30&group=dish" \
  | jq '.data[:10] | .[] | {dishName, quantity, totalSales, avgPrice}'

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
