# Joya Legal — the נט המשפט update extension

A small Chrome extension (owner 2026-11-19). It brings new court papers from נט המשפט into the legal archive that
Joya HQ shows in its Legal area. It is started only from the Joya HQ **System** page ("עדכון משפטי – נט המשפט").

## How an update works

1. Joya HQ → System → "עדכן מנט המשפט" (the card shows only in a Chrome that has this extension — never on a phone).
2. The extension opens נט המשפט in a normal tab. **You log in yourself** (government login, phone approval). The
   extension never reads or fills the login.
3. For every OPEN case of the chosen archive it opens the case's paper folder, reads the paper list, and asks the
   site for each paper the archive does not hold — the same request the "הורדת מסמך" icon sends. Nothing is saved on
   this computer; the PDF goes straight to Joya HQ through the open Joya page (keep that page open).
4. Joya HQ keeps the papers in an inbox until the legal agent on the owner's computer (`~/legal/_tools/sync_agent.mjs`,
   cron) files them, reads their text (OCR), writes the descriptions, rebuilds the catalog and copies them to Drive.
   The System page shows the state: בהורדה → ממתין לעיבוד → בעיבוד → הושלם.

Not covered yet: closed cases, and cases that are not in the archive's list at all (a brand new case).

## Install (once per computer)

1. Copy the folder `legal-extension/` to the computer (or use the repo's folder).
2. Chrome → `chrome://extensions` → turn on "Developer mode" → "Load unpacked" → choose the folder.
3. Reload the Joya HQ page. The System page now shows the update card.

## Files

- `manifest.json` — permissions: the court site, the court's file storage (Amazon S3, Israel region), and the Joya pages.
- `hq.js` — inside the Joya page: marks "installed", passes start / stop, sends the papers to Joya with the page's login.
- `court.js`, `court_main.js` — inside the נט המשפט page: search a case, open its paper folder, read the list.
- `background.js` — the manager of a run.

Server side: `hq/src/services/legalSync.js` (inbox + agent routes), `hq/client/LegalUpdate.js` (the card), admin
Legal API `GET /legal/sync/plan`. Site facts: the paper list is an ag-Grid (`presentDocumentGrid.gridApi`, older pages
`presentDocumentGridOptions.api`); a paper request is a form postback `_ctl0:btnDownloadDocument` with
`<caseID>&<documentID>&1`, answered by a redirect to a short-lived S3 address — a page script cannot follow it
(CORS), an extension with the host permission can.
