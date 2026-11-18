# Legal API — `GET /local-api/v1/legal/*`

The court cases of the owners (papers downloaded from נט המשפט), served by the admin from the **legal archive in Google
Drive**. Read only, loopback only (same rule as the Local Data API — never add a reverse-proxy route). Built 2026-11-18
for Joya HQ's Legal area: browse every case and paper, download any paper, and give the AI the facts for questions such
as "what was the story with <a claimant>", "what was the verdict", "what is the last decision", "when is the next hearing".

Code: `admin/server/modules/legalArchive.js` (Drive reading + the pure rules), `admin/server/modules/legalApi.js` (the
routes), mounted in `admin/server/server.js` before the Local Data API. Tests: `node --test scripts/test_legal_archive.js`
(no Drive, no DB).

## Where the data comes from

The owner's machine keeps the archive in `~/legal/<person>/` (tools in `~/legal/_tools`, Node.js):

| Step | Tool | Result |
|---|---|---|
| Download the papers from the court site | the download tools in `<person>/_tools` | one folder per case, `index.json` |
| Text of every paper (OCR for scans) | `text.mjs` | `<case>/.text/<documentID>.txt` |
| AI description of the key papers | `describe.mjs` | cache in `~/legal/_cache/doc` |
| AI story of every case | `history.mjs` | cache in `~/legal/_cache/case` |
| Build the catalog | `catalog.mjs <person>` | `cases.json`, `<case>/case.json`, **`catalog.json`** |
| Copy to Drive | `drive_upload.mjs` | the Drive folder "legal" (only new / changed files) |

The admin reads **`<person>/catalog.json`** from Drive with the invoice agent's Google login (`INVOICE_DRIVE_CREDENTIALS`,
`INVOICE_DRIVE_TOKEN`; that login uploaded the files, so its `drive.file` scope sees them). Root folder:
`LEGAL_ARCHIVE_FOLDER` (default: the owner's "legal" folder). The catalogs stay 5 minutes in memory. Nothing is stored
in a database and nothing is written to Drive. After new downloads: run `catalog.mjs` for the person, then
`drive_upload.mjs` — the API shows the change within 5 minutes.

The stories, summaries, outcomes and descriptions were **written by AI from the papers**. The papers decide.

## Envelope

`{ "data": …, "meta": { "people": ["moti","itzik"], "builtAt": "…", "readAt": "…", … } }` or
`{ "error": { "code", "message" } }` — `400 bad_request`, `404 not_found`, `503 legal_archive_unavailable` (Drive not
configured / not reachable / no catalog).

## Endpoints

| Endpoint | What |
|---|---|
| `GET /people` | the person folders: `person`, `cases`, `saved` (cases with papers), `open`, `documents`, `builtAt` |
| `GET /cases?person=&q=&status=open\|closed&downloaded=1\|0&from=&to=&limit=` | the case list, without the papers |
| `GET /cases/:number?person=` | one case in full: details, story, `facts`, every paper |
| `GET /hearings?person=&from=&to=&cancelled=1` | the hearings ahead, over all cases |
| `GET /documents?person=&number=&q=&type=&key=1\|0&from=&to=&limit=` | papers by words, newest first |
| `GET /documents/:documentID/text?max=` | the plain text of one paper (default 40,000 characters: the start and the end) |
| `GET /files/:driveId?download=1` | the PDF itself (`inline`, or `attachment` with `download=1`) |

### A case

`caseID`, `number` ("68499-05-26"), `name` (claimant נ' defendant), `court`, `type`, `subject`, `status` ("פתוח" /
"סגור"), `opened`, `closed`, `folder`, `person`, `people` (a case that sits in two people's folders is ONE row; the copy
with more papers is used), `downloaded` (false = on the court site's list, papers not saved), `scope` (`all`, or
`claim_and_verdict`: for a closed case only the opening paper and the verdict were saved — owner 2026-11-17),
`complete`, `documents` (a count in the list, the papers in `/cases/:number`), `keyPapers`, `firstDate`, `lastDate`,
`summary` (1–2 sentences), `history` (the long story), `outcome`, `amount`, `parties` `[{ role, name }]`, `judges`,
`sittings` (the court's list, kept only for the cases read from the new court site), `missing` (papers the site
refuses).

In the list each row also has `verdictDate`, `lastDecisionDate`, `nextHearing`, `nextDateMentioned`, and `match` (the
score) when `q` is given.

`facts` (in `/cases/:number`):

- `verdict` — the last paper of type פסק דין / גזר דין / הכרעת דין: `documentID`, `date`, `type`, `description`, `result`, `file` (the Drive id).
- `lastDecision` — the last החלטה or verdict.
- `nextHearing` — the first sitting from today on that is not cancelled (בוטל) or moved (נדחה); `hearings` — all sittings.
- `datesMentioned` — future dates that the last four decisions mention, each with its sentence (a hearing **or a
  deadline** — for the cases with no sittings list).
- `hearingNotices` — the last three summons papers.

### A paper

`documentID`, `date`, `type`, `detail`, `by`, `kind` (`document` / `attachment`), `attachmentOf`, `file` (the file
name), `pages`, `hasText`, `textSource` (`pdf` / `ocr` / `copy`), `key` (a paper the AI read: claim, indictment, appeal,
defence, decision, verdict), `description`, `descriptionSource` (`ai`, or `rule` = type + detail + sender), `result`,
`amount`, `driveId`, `textDriveId`.

### Finding a case by words (`q`)

Every word must be found. Order of strength: the case number (also its first part, "68499") → a name of the case or of
a party, exact letters → the same name by its **consonant skeleton**, so another spelling or Latin letters still find it
("בלודמן" = "בלדמן" = "baldman" = "Bludman") → subject, court, type, judge → the summary and the story. Several
spellings can be given apart by `|`; the best one counts.

### `/hearings`

`source: "court"` = a sitting on the court's list (date, hour, kind, status, judge). `source: "decision"` = a future
date that a recent decision of an OPEN case mentions, with the sentence (`text`) — used only for cases that have no
sittings list. Without `from` the list starts today.

### `/files/:driveId`

Only Drive ids that a catalog lists are served; any other id answers 404. The caller needs no Drive access.

## Joya HQ

`hq/src/services/source.js` `legal()` / `legalFile()` → `hq/src/services/legal.js` (calcs `legal_cases`, `legal_case`,
`legal_hearings`, `legal_documents`, `legal_document`; chain admin only) and the routes `/api/joya/legal/*`
(`hq/src/routes.js`) behind the Legal page (`hq/client/pages/Legal.js`). See `hq/README.md` → "Legal".
