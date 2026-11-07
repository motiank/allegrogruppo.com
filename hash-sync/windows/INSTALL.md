# Hashavshevet sync — install on Windows

This package copies the Hashavshevet database (SQL Server) into the `allegro_finance` database on the production MySQL
server, every night. Hashavshevet stays the master: the sync only reads it. Nothing is deleted on the MySQL side; an
old version of a changed row is kept in `row_history`.

## What you need

- The Windows computer that runs the Hashavshevet SQL Server (the sync must run on that machine, or on one in the same
  network).
- Node.js 18 or newer (https://nodejs.org, the LTS version). `node -v` in a command window shows the version.
- A SQL Server login that can read the company database. Hashavshevet's `sa` login works. The SQL Server must allow
  "SQL Server authentication" (mixed mode) and the TCP/IP protocol must be enabled for the instance (SQL Server
  Configuration Manager). `check.cmd` tells you when one of these is missing.
- Internet access to the production MySQL server on port 25060, and the public IP address of this computer added to the
  "Trusted sources" of the database in the DigitalOcean panel. Without it the connection is refused.
- The MySQL host, user and password: copy them from `hash-sync/.env.production` on the development machine. The
  package does not contain passwords.

## Install

1. Unzip the package to `C:\hash-sync` (any folder works; avoid OneDrive folders).
2. Double-click `install.cmd`. It checks Node.js, installs the packages (`npm ci`, needs internet), creates the
   settings file `.env` from `.env.example` and opens it in Notepad.
3. Fill in `.env`:
   - `HASH_MSSQL_INSTANCE` — the instance name, usually `WIZSOFT`. The service "SQL Server Browser" must run.
     If the instance uses a fixed port, leave the instance empty and set `HASH_MSSQL_PORT`.
   - `HASH_MSSQL_PASSWORD` and `HASH_MSSQL_DATABASE` — the login password and the name of the company database.
     A password with `#`, spaces or quotes must be written in single quotes: `HASH_MSSQL_PASSWORD='pa#ss'`.
     Each SQL Server instance has its own `sa` password: use the instance (or port) that works with that password.
   - `TARGET_DB_HOST`, `TARGET_DB_USER`, `TARGET_DB_PASSWORD` — from `.env.production`.
   Save and close Notepad. The install then checks both connections and prints what it finds, with a hint for each
   problem. If the SQL Server database name is wrong, the check prints the list of databases on the server.
4. If something failed: open `.env` in Notepad, fix it, and double-click `check.cmd`.
5. `sync-now.cmd` runs the first sync. The first run copies everything and can take a long time. A second window
   shows the log. Exit code 0 means every row in MySQL matches Hashavshevet.
6. `schedule.cmd` creates the Windows task "Hashavshevet sync" that runs every night at 02:00 (it asks for
   administrator rights). `schedule.cmd 03:30` uses another time. The task runs as SYSTEM, also when nobody is logged
   in, and a run that was missed (computer off) starts when the computer is on again.

## Every day

- The log of each month is in `logs\sync-YYYY-MM.log`. The last line of a run says `Sync finished, no differences` or
  `Sync FAILED, exit code …`.
- The MySQL table `sync_runs` has one row per run (`done` or `failed` with the error text), `sync_table_audit` one row
  per table.
- If someone posts entries in Hashavshevet between the load step and the verify step, the verify reports a difference,
  and the next run clears it. This is why the task runs at night.
- A second run while the first still works stops at once (file `.sync.lock`).
- The sync copies the current year into `source_rows`. On 1 January it starts the new year by itself.

## Change, update, remove

- **Another time:** `schedule.cmd 04:00`.
- **Another company:** one folder = one Hashavshevet company database. Install a second copy of the folder (for example
  `C:\hash-sync-otherco`), set its `.env` to the other database and change `COMPANY` and `COMPANY_NAME` at the top of
  `run-sync.cmd`. Its `schedule.ps1` uses the same task name, so change `$name` there too.
- **New version of the package:** unzip it over the folder. It keeps `.env`, `logs` and `node-path.txt`. Run
  `install.cmd` again (it keeps `.env`).
- **Remove:** `schedule.cmd /remove`, then delete the folder. The data in MySQL stays.

## Files

| File | What it does |
|---|---|
| `install.cmd` / `install.ps1` | Install: Node.js check, `npm ci`, `.env`, connection check |
| `check.cmd` | Checks the two connections, changes nothing |
| `sync-now.cmd` | Runs one sync now and shows the log |
| `run-sync.cmd` | The command the nightly task runs (company name at the top) |
| `schedule.cmd` / `schedule.ps1` | Creates or removes the nightly task |
| `.env` | Your settings and passwords. Never send this file |
| `ca.crt` | The certificate of the MySQL server (public, not a secret) |
| `src\`, `sql\`, `README.md` | The sync program and its technical documentation |
