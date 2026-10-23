# Joya HQ AI runner

Answers the questions and change requests written in the Joya HQ app (`hq/`, see `../README.md`). It talks to
Joya HQ over HTTP only. `npm run runner` in `hq/`. No dependencies, no API key: model calls go through `claude -p`
on the subscription login (`model.js`: no tools, safe mode, empty working dir). Env: `../env.joya-hq.example`
(it loads the same env files as the server, `../lib/env.js`).

Flow for one request (`runner.js`):
1. `GET /api/joya/ai/runner/pending` → ids; `POST …/:id/claim`.
2. `GET …/:id/context` → the question, today, the user's locations/roles/shifts, the list of calculations, the
   object in view (order list, staffing plan, inquiry) and the change formats.
3. **Plan** (model, `hq-analyst.js` `PLAN_PROMPT`) → JSON `{ calcs, ops, whatIf, draft }`.
4. `POST …/:id/compute` → **joya-hq** runs the calculations with the asking user's access and validates the
   changes (same checks as the app). The model never computes a number.
5. **Write** (model, `WRITE_PROMPT`) the answer from the results, in the user's language, with period and source.
6. `verify.js` lists numbers in the answer that are not in the results (rounding, thousands, %, dates allowed).
7. `POST …/:id/answer` with `meta.unverifiedNumbers` and `meta.instructionsVersion` (a hash of both prompts,
   so every answer can be traced to the prompt that wrote it). A proposal waits for the user's Apply in the app.

At most `context.limits.maxCalcs` calculations run per request (`MAX_CALCS` in joya-hq `services/ai.js`, 6).
Extra ones come back as errors, so the answer can say what was left out.

Env (`env.joya.example`): `JOYA_HQ_URL` (default `http://localhost:4300/api`), `JOYA_API_KEY` (sent as
`X-Joya-Key`, same value as in joya-hq's env; with none joya-hq accepts loopback only), `JOYA_MODEL` (sonnet),
`JOYA_POLL_MS`, `JOYA_CONCURRENCY`. A request not answered in 6 minutes fails on joya-hq.

Measured 2026-10-12 on the demo data (sonnet, thinking off): 8–16 s per request, 4 of 4 answered with no
unverified numbers.

Measured again 2026-10-14 against the separate joya-hq service: 2 of 2 answered in about 9 s, no unverified numbers.

Test: `npm run test:runner` (fake model, fake Joya HQ).

Eval (real model, costs subscription usage): `npm run eval` (`scripts/eval.mjs`, `--only=`, `--model=`).
It runs the 37 labelled questions of `eval/fixtures.json` through the planner, against the fixed contexts in
`eval/contexts.json`, and grades the plan: calculations, dates, locations, params, changes, what-if, draft,
and one injected customer text. Nothing is sent to joya-hq; the writer is not graded. Report:
`state/eval-*.json`. Re-capture the contexts on a local DB after a demo re-seed or a context change:
`node scripts/joya-eval-context.mjs` in `hq/` (note: the AREA context was added by hand on 2026-10-23). Run the eval after every prompt change.

Measured 2026-10-21 (sonnet): `joya-hq-1+2fd33e7b` 31/32 (it ran `sales_summary` again on the month before,
although `sales_summary` already compares with it); after one prompt line on that, `joya-hq-1+8cbeb756` 32/32, median 5.2 s per plan. 2026-10-23: `joya-hq-1+9638d0b5` 37/37 (5 manpower questions added).
On the server it runs as a service next to Joya HQ (`node runner/index.js`, working directory `hq/`), started
after it, as a user with a logged-in `claude` CLI.
