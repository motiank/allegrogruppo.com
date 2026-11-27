# Joya Update — the browser extension (נט המשפט + בנק הפועלים)

A small Chrome extension (owner 2026-11-19, bank part 2026-11-22). It is started only from the Joya HQ **System**
page, and it does two jobs:

- **Legal update** ("עדכון משפטי – נט המשפט"): brings new court papers from נט המשפט into the legal archive that Joya
  HQ shows in its Legal area.
- **Bank update** ("עדכון מהבנק – בנק הפועלים"): brings the new moves of every configured bank account (`shared/
  restaurants.json` → `bank_accounts`) and the pictures of the paid cheques the Drive archive does not hold yet from
  the Bank Hapoalim business site into the admin.

In both jobs **you log in yourself** in a normal tab; the extension never reads or fills a login, never clicks a
button of the site, and saves nothing on this computer.

## The legal update

1. Joya HQ → System → "עדכן מנט המשפט" (the card shows only in a Chrome that has this extension — never on a phone).
2. The extension opens נט המשפט in a normal tab. You log in (government login, phone approval).
3. For every OPEN case of the chosen archive it opens the case's paper folder, reads the paper list, and asks the
   site for each paper the archive does not hold — the same request the "הורדת מסמך" icon sends. The PDF goes straight
   to Joya HQ through the open Joya page (keep that page open).
4. Joya HQ keeps the papers in an inbox until the legal agent on the owner's computer (`~/legal/_tools/sync_agent.mjs`,
   cron) files them, reads their text (OCR), writes the descriptions, rebuilds the catalog and copies them to Drive.
   The System page shows the state: בהורדה → ממתין לעיבוד → בעיבוד → הושלם.

Not covered yet: closed cases, and cases that are not in the archive's list at all (a brand new case).

## The bank update

1. Joya HQ → System → "עדכן מהבנק". Joya asks the admin for the plan: per configured account the last stored bank day
   (the site is asked from 7 days before it, to today; an account with nothing stored starts at 2025-01-01).
2. The extension opens the Poalim business site (`www.bankhapoalim.biz` → `biz2.bankhapoalim.co.il`) in a normal tab.
   You log in (code, password). Logged in = the site's own account service answers JSON.
3. Per account: the extension finds the site's own id of the account (the account list, else the ids the page itself
   used in its calls, with the last number replaced), reads the moves with the site's transactions service in 10-day
   parts (`/ServerServices/current-account/transactions?…&accountId=…`), and hands the rows to Joya. The admin maps
   them to the same row shape as the Excel file of the Upload page and stores only what is new (`bank_transactions`;
   the Upload history gets a row "bank-site <account> <from>..<to>").
4. Per account: Joya asks the admin which paid cheques have no picture in the Drive cheque archive; the extension asks
   the site for each one (`/ServerServices/current-account/cheques/<number>?view=paying&originalEventDate=…&chequeAmount=…`)
   and hands the front picture to Joya → the admin files it in Drive (`<company>/cheques/<payee or _unknown>/<number>.jpg`
   + `index.json`), the payee from the books / Priority; the name is read from the picture later, as before.
   A cheque the bank itself has no picture of (no picture link, or the link answers an empty body — the bank's own page shows
   nothing either; owner 2026-11-28) gets a PLACEHOLDER row in the archive (`POST …/cheque-no-image`) and is never asked again;
   the run counts them (`imagesEmpty`) and the card says how many, the first time only.
5. Done: the System page shows per account the new rows and the pictures. If the bank session ends in the middle (the
   site logs out after some minutes), the extension asks you to log in again and continues.

Not covered yet: the transaction status file (סטטוס עסקאות — the transfers' payees); upload it on the Upload page.
The payee read from the cheque picture is still a separate step.

## The Beecomm update

Beecomm's API gateway refuses the production server's address (403 Forbidden since about 25/11/2026), while a browser in Israel
gets through. So (owner 2026-11-28) the extension can do the Beecomm calls:

1. Joya HQ → System → "עדכן דרך הדפדפן" on the Beecomm card (a Chrome with this extension, version 1.1+). No tab opens and
   there is no login: the server mints a one-hour Beecomm token from its own back-office login.
2. The extension asks Joya for the plan (`POST /api/joya/beecomm/sync/ext/plan`): the admin runs its loader in "plan" mode, which
   only records the requests the nightly load would make (Z reports, orders, items per day, payments per branch per day) for the
   days after the last loaded one, and returns them with the token. "Nothing to load" ends the run at once.
3. The extension POSTs every request to Beecomm from this browser (`beecomm-run.js`; a 401/403 once → a fresh token from Joya) and
   hands each answer to Joya → the admin keeps it for the replay (`…/answer`).
4. `…/finish`: the admin runs the same loader in "replay" mode on the answers — the same saving code as the nightly job — and the
   run shows in the card's list as "דרך הדפדפן". Nothing is saved on this computer. Stop in the middle = nothing is loaded.

## Install (once per computer)

1. Copy the folder `joya-extension/` to the computer (or use the repo's folder).
2. Chrome → `chrome://extensions` → turn on "Developer mode" → "Load unpacked" → choose the folder. (If the old
   `legal-extension` is still loaded, remove it first — this one replaces it.)
3. Reload the Joya HQ page. The System page now shows the update cards (legal, bank, and the browser button on the Beecomm card).
   After every "reload" of the extension in `chrome://extensions`, refresh the Joya page too — an open page keeps a dead link to
   the old extension and the buttons do nothing (the cards say so after 6 seconds).

## Files

- `manifest.json` — permissions: the court site, the court's file storage (Amazon S3, Israel region), the bank sites,
  and the Joya pages.
- `hq.js` — inside the Joya page: marks "installed", passes start / stop (with the job), sends what was fetched to
  Joya with the page's login.
- `court.js`, `court_main.js` — inside the נט המשפט page: search a case, open its paper folder, read the list.
- `bank.js` — inside the bank site: where the page is, the site's JSON services with the page's login, a picture's bytes.
- `background.js` — the manager of a run (one at a time, either job) and the legal run; `bank-run.js` — the bank run.

Server side: `hq/src/services/legalSync.js` (inbox + agent routes), `hq/client/LegalUpdate.js`; `hq/src/services/bankSync.js`
(pass-through to the admin), `hq/client/BankUpdate.js`, admin `admin/server/modules/bankSync.js` (Local Data API
`/bank/sync/*`, `local_api_readme.md`). Court site facts: the paper list is an ag-Grid (`presentDocumentGrid.gridApi`,
older pages `presentDocumentGridOptions.api`); a paper request is a form postback `_ctl0:btnDownloadDocument` with
`<caseID>&<documentID>&1`, answered by a redirect to a short-lived S3 address — a page script cannot follow it
(CORS), an extension with the host permission can.
