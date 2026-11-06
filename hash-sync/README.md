# hash-sync

Copies a Hashavshevet database (SQL Server) into `allegro_finance` (MySQL) without losing data. Hashavshevet stays the
master. Nothing else writes to these tables.

Status: `allegro_finance` is on the production MySQL server (8.0.45), loaded and verified on 2026-11-06 from a restored
backup (Pastalina, 2025–2026). **Not scheduled yet.** Local test database: `allegro_finance_dev`.

## How the data is stored

- **Clean tables** for what the use cases need: `accounts`, `journal_entries`, `journal_lines`, `bank_lines`,
  `bank_matches`, `ledger_matches`, `documents`, `document_lines`, `cheques`, `vat_lines`, `batches`, `account_groups`,
  `cost_centers`, `transaction_types`. See `src/mapping.js`.
- **`company_id` + `fiscal_year`** are in the primary key of every business table.
- **`extra` (JSON)** on each clean table holds every source column that has no column of its own. A NULL is left out.
- **`source_rows`** holds every row of all other source tables as JSON.
- **`source_columns`** lists every source column, including empty tables, and where it went.
- **`row_history`** keeps the old version of every row a sync changed. A row that left the source gets `deleted_at`. It
  is never deleted.
- **Not copied:** passwords and login tokens (`NOT_COPIED` in `src/mapping.js`; owner's decision, 2026-11-06). They stay
  in Hashavshevet and its backups. `source_columns` lists them with `target_table = 'not_copied'`. This is the only
  exception to "nothing is dropped".
- **Numbers in JSON** with more than 15 significant digits are stored as `{"$double": "..."}`, because MySQL's JSON
  parser can change the last digit. Use `unpackJson` in `src/lib.js`.

## The year of a record

| Records | Year |
|---|---|
| Journal entries, documents, VAT lines | `ValueDate` |
| Journal lines, document lines | Their parent |
| Bank lines | `DatF` |
| Bank and ledger matches | `RDate` (date of the match) |
| Cheques | `OriginalDate` (`due_date` can be years ahead) |
| Master data (`accounts`, groups, cost centers, types, batches) | One copy in each open year |
| `source_rows` | `--snapshot-year` |

Set `fiscal_years.status` to `closed` to stop updating master data of that year.

## IDs

We keep Hashavshevet's own IDs. A row is identified by company + year + ID, so the same ID can exist in two years or
two companies. A sync changes only the years its source holds. If a new Hashavshevet database restarts its IDs for a new
year, the old years are not touched. If a row's date moves it to another year of the same source, the row moves with its
history. Two sources of one company must not hold the same year: the second would replace the first.

## Use

Copy `.env.example` to `.env`, then:

```
npm install
npm run schema                                    # create the database, tables and views
node src/load.js --company pastalina --name Pastalina --snapshot-year 2026
node src/verify.js --company pastalina --snapshot-year 2026
```

Any target that is not localhost also needs `--production`. Without it the tools refuse to run.

`verify.js` reads every source row again, rebuilds it from the target and compares the two (without the `NOT_COPIED`
columns). Exit code 0 means no difference. A load can run again: an unchanged row is skipped.

`HASH_ENV_FILE=.env.production` uses another settings file. `.env` and `.env.*` are not in git.

## Scheduled run

`src/sync.js` runs the load and then the verify. A second run stops while the first is still working. Run it on the
machine that holds the SQL Server, at a quiet time: an entry posted between the load and the verify is reported as a
difference, and the next run clears it.

Linux cron, every night at 02:00:

```
0 2 * * * cd /path/to/hash-sync && HASH_ENV_FILE=.env.production node src/sync.js --company pastalina --name Pastalina --production >> sync.log 2>&1
```

Windows has no cron. Use Task Scheduler with the same command, and set `HASH_MSSQL_INSTANCE=WIZSOFT` (SQL Server
Browser must run), or use the instance's fixed port.

Without `--snapshot-year` the current year is used. On 1 January `source_rows` starts a new copy for the new year, and the
copy of the old year stays as it was. See `sync_runs` for each run and `sync_table_audit` for each table. A failed run
gives a non-zero exit code and writes to the log; nothing sends an alert yet.

## Reading the data

- Join clean tables on `company_id` and the id. A match can be in a different year from its bank line.
- `bank_matches.linked_id` is `journal_lines.line_id` when `side = 'book'`, not a `trans_id`.
- `accounts.stored_balance` is credit minus debit, for posted entries (`status = 1`) only. `signed_amount` is the other
  way round: debit is plus.
- mysql2 `query()` rounds DOUBLE values when it reads them. Use `execute()` if the exact value matters.
