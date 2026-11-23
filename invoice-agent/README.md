# invoice-agent

Finds invoices in Gmail, reads them with Claude, and files them in Google Drive.
One run reads up to 20 emails and exits. Cron starts it every 15 minutes.

Claude runs through the `claude` CLI on your subscription (like `hq/runner`). There is no API key.

## What it does

For each new email that the Gmail search finds:

1. It reads the attachments: PDF, Excel (xlsx, xls, csv) and images.
2. Claude decides: invoice, not an invoice, or "the invoice is behind a link".
3. If it is behind a link, the code downloads the link and Claude reads the result (up to 3 rounds).
4. The file is saved in Drive with the invoice number as its name, and `index.json` gets one new row.
5. The email is marked as read in `data/state.json`. It is not read again. Nothing changes in Gmail.

Drive structure:

```
Invoices/
  <company>/
    index.json
    income/<customer>/<invoice number>.pdf
    expense/<supplier>/<invoice number>.pdf
  _unmatched/     invoices that are not from or to any company in config/companies.json
```

Each row in `index.json`: from, to, tax ids, number, type, total including VAT, currency, date,
מספר הקצאה (empty if there is none), file path, Drive file id, Gmail message id.

**The `books` flag (2026-11-08).** The Allegro admin reads these index files with this same Google login
(`admin/server/modules/invoiceDrive.js`, Finance API `GET /finance/invoices/drive-check`, daily at 06:45 and whenever
Joya HQ is asked), matches every invoice with the Hashavshevet books and writes the result into the row:
`books: { matched: true|false, status: booked | pending | not_booked | amount_differs | no_account, checkedAt, booksUpTo,
accountKey, year, transId, type, date, amount, reference, allocationNumber }`. This script never sets `books`; when it
writes `index.json` it copies the flags from the current copy in Drive, so they are not lost (`filing.js`).

## Setup

Needs Node 18.19 or newer and a logged-in `claude` CLI (run `claude` once, as the same user as the cron job).

```
npm install
cp .env.example .env
cp config/companies.example.json config/companies.json     # then fill it in
```

`config/companies.json` lists **your** companies. This is how the script knows income from expense.
Tax ids (ח.פ.) are the safest match. `aliases` are other names printed on invoices.

### Several mailboxes, several Drive folders (2026-11-22)

Three files in `config/` (examples next to them; without `targets.json` and `mailboxes.json` everything works as before):

- **`mailboxes.json`** — the mailboxes to read. Exactly one has `"main": true`: its saved login (`data/token.json`) reads
  its mail and writes ALL Drive files. Each mailbox has `"login"`:
  - `"saved"`: every normal run reads it. Save the login of an extra mailbox with `npm run auth -- --mailbox a@b.c`
    (read-only mail, `data/token-<email>.json`). If such a login ends, the run skips that mailbox and goes on.
  - `"ask"`: read only by `npm run backfill`, with an approval in the browser each time; no login is kept.
- **`targets.json`** — the Drive folders. `{ "name", "folderName" }` = a folder found by name in the main login's Drive.
  `{ "name", "folderId" }` = an existing folder, also in another person's Drive: **share it with the main mailbox as
  Editor** (the id is the last part of the folder's link). The first target is the default; it also gets `_unmatched`.
- **`companies.json`** — a company with `"target": "<name>"` is filed in that target; the rest go to the first target.
  `"taxIdOnly": true` = match by tax id only (the name is also a branch name of another company).

Every mailbox files into every target: the company on the invoice decides the folder, not the mailbox.
A row filed from a mailbox that is not the main one has `gmail_account` in `index.json`.

Now: mailboxes accountant@allegrogruppo.com (main, saved) and the owner's Gmail (ask). Targets: `main` = `Invoices` in
the accountant's Drive (the restaurant companies), `owner` = a folder in the owner's Drive (אן-קור, ניוראל לוגיק,
ווסט פרונט, אבוקדו פלאנט).

**Adding a company later.** Add it to `config/companies.json`, then run `npm run rematch` (`--dry-run` first): it moves
that company's invoices from `_unmatched` into the company's folders and `index.json`, in the company's target. It reads the rows only — no
Gmail, no Claude. A running backfill must be started again to see the new company.

### Google setup (one time)

1. Go to https://console.cloud.google.com and create a project.
2. "APIs & Services" → "Library": enable **Gmail API** and **Google Drive API**.
3. "Google Auth Platform" (OAuth consent screen): fill in the app name and your email.
   - Google Workspace account: choose **Internal**.
   - Normal gmail.com account: choose **External**, then press **Publish app** ("In production").
     Do not stay in "Testing": there, Google ends the login after 7 days and the cron job stops.
     Google will show an "unverified app" warning. This is your own app: press Advanced → Continue.
4. "Clients" → "Create client" → type **Desktop app**. Download the JSON file.
5. Save it in this folder as `credentials.json`.

This is already done for our account: Google project `allegro-invoice-agent`, app published, privacy page
`public/policies/invoice-agent-privacy.html`. The mailbox is accountant@allegrogruppo.com (Google Workspace).
If its login is refused, a Workspace admin must allow the app in admin.google.com → Security → Access and data
control → API controls.

### Connect

```
npm run auth
```

This opens the browser. Choose the Gmail account and approve. The login is saved in `data/token.json`.

The rights are small on purpose:
- `gmail.readonly`: the script can read mail, but cannot change, delete or send it.
- `drive.file`: the script sees only what it created. It creates the `Invoices` folder itself. You can move
  that folder in Drive. Files you add to it by hand are not seen by the script.

## Run

```
npm run dry       # real emails and real Claude, but saves nothing. Use this first.
npm run scan      # one real run
npm run status    # counts, and the emails that need a person
npm run latest    # the latest invoices the agent found, newest found first (not by invoice date); -- --n 50, --days 3, --company <name>, --json
npm test
```

Cron, every 15 minutes (`crontab -e`). Cron has a short PATH, so give it the folder of `node` and `claude`:

```
*/15 * * * * cd /home/moti/dvlp/allegrogruppo.com/invoice-agent && PATH=/home/moti/.nvm/versions/node/v24.16.0/bin:/usr/bin:/bin npm run -s scan >> data/cron.log 2>&1
```

Settings are in `.env`: model, limits, Gmail search, start date, Drive folder name.

## Another mailbox, from time to time (backfill)

```
npm run backfill                          # the last 2 years of another mailbox
npm run backfill -- --after 2025/01/01    # from a date
npm run backfill -- --dry-run --max 20    # a test: real emails and real Claude, nothing saved
```

Reads the invoices of a second mailbox (for example the owner's own Gmail) and files them in the **same Drive** as the
normal run (the Drive of the main mailbox, `data/token.json`). Used by hand, when needed.

- **The login of that mailbox is not kept** (owner's decision, 2026-11-20). The browser opens at the start; choose the
  mailbox and approve. The right is read-only mail, no Drive. The token lives only in the memory of the process and is
  cancelled at Google when the process ends (also on Ctrl+C or `kill`). So every backfill starts with one approval.
- It is one long process, with no limit per run. When the Claude plan limit is reached it waits 15 minutes and tries
  the same email again (up to 24 hours). Failed emails are tried again at the end (3 passes).
- The emails already read are in `data/state-<mailbox>.json`. A backfill that was stopped continues from there.
- It takes the run lock only while it writes one invoice to Drive, so the 15-minute job keeps working next to it.
- An invoice already filed from the main mailbox is a `duplicate` (same folder and number). A row filed from the other
  mailbox has `gmail_account` in `index.json`. Invoices that are not from or to our companies go to `_unmatched`.
- Choosing the main mailbox by mistake is refused (its login is never cancelled).

For a long run, start it apart from the terminal:

```
setsid nohup node src/backfill.js >> data/backfill.log 2>&1 < /dev/null &
tail -f data/backfill.log
pkill -f src/backfill.js      # stop; the login is cancelled at Google
```

## Email status

| Status | Meaning |
|---|---|
| `filed` | Saved in Drive |
| `duplicate` | This invoice number is already in that folder |
| `ignored` | Not an invoice |
| `needs_review` | A person must look: page needs a login, PDF has a password, number or total not readable |
| `error` | Failed; tried again in the next runs, after 3 failures it becomes `needs_review` |

If the subscription limit is reached or the CLI is not logged in, the run stops and no email is marked.
The next run continues from the same place. An email too big for the model ("Prompt is too long") is the email's
fault: it fails like any other email and becomes `needs_review` after 3 runs (until 2026-11-20 it stopped every run).

## Limits

- Form 101 emails (טופס 101 in the subject or a file name) are skipped without Claude, unless the subject, text or a file name also says חשבונית or invoice.
- The Gmail search takes every email with an attachment, and emails with an invoice word. So payslips and employee files reach the model too (owner's decision: no invoice may be missed). An email with no attachment and no invoice word is not found.
- The limits are checked after each email. An email with several invoices can take a run a little over the invoice limit.
- Links are read without a browser. Pages that need JavaScript or a login end as `needs_review`.
- A plain Israeli קבלה, a quote, a pro forma and חשבון עסקה are ignored on purpose (see `SYSTEM_PROMPT` in `src/agent.js`).
- An invoice whose only copy is the email text (no file, no link) ends as `needs_review`.

## Security

Emails come from outside, so they are treated as data that may attack:

- Claude has no tools: no files, no shell, no web. It only reads what we send and answers JSON.
- Claude cannot give a web address. It answers with a link number (L3) from the list, and the code downloads that.
- The downloader opens public addresses only, never this machine or its network (checked at connect time and after
  each redirect). It has size and time limits. It sends no login.
- Unsubscribe links are removed before Claude sees the list.
- `credentials.json`, `.env` and `data/` are not in git. `data/token.json` gives access to your mail: keep it private.

## Files

| File | Job |
|---|---|
| `src/run.js` | One run: limits, lock, state |
| `src/process.js` | One email from start to end |
| `src/agent.js` | The prompt, the answer format, the link loop |
| `src/model.js` | The `claude -p` call |
| `src/gmail.js`, `src/drive.js`, `src/google.js`, `src/authCli.js`, `src/approve.js` | Google |
| `src/backfill.js` | Another mailbox, by hand; its login is not kept |
| `src/targets.js` | Which Drive folder gets which company |
| `src/rematch.js` | Moves invoices out of `_unmatched` after a company is added |
| `src/files.js` | PDF, Excel and images for the model |
| `src/download.js` | Safe link download |
| `src/filing.js` | Income or expense, folders, `index.json`, duplicates |
| `src/state.js` | Which emails were read; the run lock |
