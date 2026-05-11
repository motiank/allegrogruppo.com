# payroll-summary

Consolidate a folder of Hebrew time-tracking Excel exports into one payroll
workbook (`payroll_summary.xlsx`) with three sheets: **Payroll_Summary**,
**Raw_Extract**, and **Exceptions**.

## Install

```bash
cd payroll-summary
npm install
```

Requires Node.js 16+.

## Usage

```bash
node payroll_summary.js /path/to/folder
```

Where `/path/to/folder` contains one or more `.xlsx` exports. The script
writes `payroll_summary.xlsx` into the same folder.

Example:

```bash
node payroll_summary.js ~/Desktop/april-2026
```

### Optional config

If a file named `employees_config.xlsx` exists in the input folder, it is
loaded to enrich the output. Expected columns (header row first):

| שם | מספר עובד | מחיר לשעה | נטו/ברוטו | עובד גלובאלי | תפקיד ברירת מחדל | נסיעות | ימי עבודה | הערות |
|---|---|---|---|---|---|---|---|---|

The config supplies values that may be missing in the source workbooks:
employee number, default hourly rate, נטו/ברוטו label, the global flag
(`כן` / `yes` / `true` / `1`), default role, default travel allowance,
fallback work-days, and extra notes.

## Output sheets

### Payroll_Summary

**One row per employee.** All numeric fields come from the employee's
`סיכום כללי` row only — role-specific summary rows (`סיכום מלצר`,
`סיכום בר`, `סיכום אחמש`, …) are **not summed in**, because the source
already includes their values inside `סיכום כללי`. Role rows still appear
in `Raw_Extract` (audit trail) and contribute their role label to the
`תפקיד` column.

| שם | מספר עובד | תפקיד | ימי עבודה | שעות 100% | שעות 125% | שעות 150% | מחיר לשעה | נטו/ברוטו | טיפ | השלמה | נסיעות | עובד גלובאלי | סה"כ |

- `מספר עובד` — taken from the source sheet (label-adjacent value) or
  from `employees_config.xlsx`. If neither has it, the cell is blank and
  a `missing employee number` exception is raised.
- `תפקיד` — comma-separated list of all non-`כללי` roles found for the
  employee across all sheets (e.g. `מלצר, בר, אחמש`). The word `כללי` is
  never written here.

The `סה"כ` column is a **live Excel formula** so changing any input cell
updates the total. Each term is wrapped in `IF(ISNUMBER(..),..,0)` and the
whole expression in `IFERROR(..,0)`:

```
=IFERROR(
   IF(ISNUMBER(E2),E2,0)*IF(ISNUMBER(H2),H2,0)
 + IF(ISNUMBER(F2),F2,0)*IF(ISNUMBER(H2),H2,0)*1.25
 + IF(ISNUMBER(G2),G2,0)*IF(ISNUMBER(H2),H2,0)*1.5
 + IF(ISNUMBER(J2),J2,0)
 + IF(ISNUMBER(K2),K2,0)
 + IF(ISNUMBER(L2),L2,0)
, 0)
```

#### Aggregation rules

- Numeric fields (`שעות 100%`, `שעות 125%`, `שעות 150%`, `טיפ`, `השלמה`,
  `נסיעות`) are read from the `סיכום כללי` row of each sheet. Per-employee
  totals across multiple sheets/files are summed.
- `מחיר לשעה` takes the first non-null rate seen. If multiple distinct
  rates appear for the same employee, an exception lists them.
- `ימי עבודה` per sheet:
  - If a `תאריך`-style date column exists, work days = unique dates in
    non-summary rows.
  - Otherwise the `ימי עבודה` value on the `סיכום כללי` row is used and
    flagged as uncertain.
  - Per-sheet counts are summed across sheets to get the employee total.

#### Overtime normalization (שעות 150%)

`שעות 150%` is built per summary row from any of:

- explicit 150% column (`שעות 150%`, `150%`, `שעות נוספות 150`, …)
- `שבת` hours
- `חג` hours
- `שבת/חג` hours

Money columns, regular hours, 125% hours, tips, completion, travel and
totals are **never** mixed in.

When the explicit 150% header text already mentions שבת or חג
(e.g. `שעות 150% (כולל שבת/חג)`), the script trusts the source value as-is
and records the assumption in `normalization_note` — the שבת/חג columns
are not added on top.

`Raw_Extract` exposes the full provenance: `raw_150`, `raw_שבת`, `raw_חג`,
`raw_שבת_חג`, the derived `normalized_150`, and a free-text
`normalization_note` describing how it was built.

If the per-employee aggregated `שעות 150%` ends up larger than
`שעות 100% + שעות 125%`, an exception is raised so the row can be reviewed.

#### Empty-row cleanup

Within a sheet, a `סיכום כללי` row whose 100% / 125% / 150% / rate / tip /
completion / travel are all empty/zero is dropped from aggregation. It
still appears in `Raw_Extract` with
`skipped_reason = "empty general summary row"`. Role rows are tagged
`role-specific row (not used in Payroll_Summary)`.

### Raw_Extract

Every detected summary row (audit trail), including:

- file / sheet / employee name / employee number / summary label / role
- raw hours per source column (`raw_150`, `raw_שבת`, `raw_חג`, `raw_שבת_חג`)
- the derived `normalized_150` and `normalization_note`
- rate, נטו/ברוטו, tip, completion, travel, global, notes
- `skipped_reason` — non-empty when the row was excluded from aggregation

### Exceptions

Anything that needs human review:

- `missing employee name` / `missing employee number` / `missing work days`
- No summary row found
- `No "סיכום כללי" row in sheet …` (numerics can't be sourced)
- `Multiple "סיכום כללי" rows in sheet … — used the first`
- Hourly rate missing / Hours columns unclear
- Multiple distinct hourly rates for the same employee
- Possible global employee but not confirmed
- ימי עבודה derived from summary rows (no daily date column found)
- ימי עבודה could not be determined
- שעות 150% exceeds 100% + 125% (sanity check on normalization)

## Extraction strategy

The format of these exports is messy and varies between sheets, so the
script avoids hard-coded cell addresses entirely:

1. **Header row** — score each of the first 50 rows against a Hebrew
   synonym table (100% / 125% / 150% / שבת / חג / שבת/חג / מחיר לשעה /
   נטו/ברוטו / טיפ / השלמה / נסיעות / הערות / ימי עבודה / תאריך /
   מספר עובד). Highest-scoring row wins; each column may be claimed by at
   most one canonical field, with iteration-order priority preventing
   things like a "150% includes שבת" header being double-counted.
2. **Employee metadata** (extracted from the metadata block ABOVE the
   data table — the rows before the detected header row). Three required
   fields with a strict priority order:
   - `שם העובד` — labels: `שם העובד` / `שם עובד` (substring match) or
     exact `שם` / `עובד` (ambiguous → exact match only). **The sheet's
     tab name is never used as a fallback.**
   - `מספר עובד` — labels: `מספר עובד` / `מס' עובד` / `מס עובד` /
     `מס. עובד` / `מס"ע`.
   - `מספר ימי עבודה` — labels: `מספר ימי עבודה` / `ימי עבודה`.
     **Read from the header section, not recalculated from hours.**

   For each field: header → `employees_config.xlsx` → (work-days only)
   date-count fallback → exception. Each Raw_Extract row carries the
   extracted values plus an `extraction_source` string like
   `name=header, empnum=config, days=dates`.
3. **Summary rows** — any row whose first non-empty cell starts with
   `סיכום`. The trailing word becomes the role.
4. **Field extraction** — pull all numeric fields off each summary row
   using the header→column map. If the 100% column wasn't recognized we
   fall back to the first plausible numeric cell (>0, <1000).
5. **150% normalization** — see *Overtime normalization* above.
6. **Workday derivation** — unique-date count if a date column exists,
   else max of summary `ימי עבודה` values (uncertain).
7. **Global detection** — keyword in sheet, missing rate alongside hours,
   or config flag.
8. **Aggregation** — group all summary rows per employee across all sheets
   and files; sum numerics; pick first non-null for rate / employee number /
   נטו/ברוטו; merge notes.

## Assumptions

- Files starting with `~$` are Excel lock files and are skipped.
- The output file (`payroll_summary.xlsx`) and config
  (`employees_config.xlsx`) in the input folder are skipped during
  processing — re-running the script is safe and idempotent.
- Numbers may appear as plain numerics or as `H:MM` strings; both are
  handled.
- Hebrew text is preserved as-is; all output sheets are right-to-left.
- The script does not invent values — anything ambiguous is logged to the
  **Exceptions** sheet rather than guessed.
