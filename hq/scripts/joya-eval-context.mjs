/**
 * Saves fixed contexts for the Joya runner's planner eval (hq/runner/scripts/eval.mjs):
 * one per context kind (GENERAL, ORDER_LIST, STAFFING_PLAN, INQUIRY), built from the demo data on
 * the LOCAL MIRROR with the same code the runner route uses (services/ai.js buildContext).
 *
 *   node scripts/joya-eval-context.mjs [out.json]     (default runner/eval/contexts.json)
 *
 * Needs the demo records (scripts/joya-seed-demo.mjs) and their source data from the fake Allegro API:
 * ALLEGRO_API_URL=http://localhost:4399/local-api/v1 with scripts/fake-allegro.mjs running.
 *
 * It creates one draft order list and one draft staffing plan for the demo Tel Aviv location, reads
 * them, and rejects both (note 'eval context'), so nothing stays open. Re-run it after a re-seed or a
 * change to the context shape, then re-run the eval.
 */
import '../lib/env.js';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { executeSql, endPool } from '../lib/dbpool.js';
import { buildContext } from '../src/services/ai.js';
import * as repl from '../src/services/replenishment.js';
import * as staffing from '../src/services/staffing.js';
import { todayLocal } from '../src/db.js';
import { addDays } from '../src/lib/recommend.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || path.join(here, '../runner/eval/contexts.json');
if (!['127.0.0.1', 'localhost'].includes(process.env.DB_HOST || '')) {
  console.error('refusing: this script writes draft rows to the DB; point it at the local mirror');
  process.exit(1);
}
const sql = async (s, p = {}) => (await executeSql(s, p))[0];

const locations = await sql(`SELECT id FROM joya_locations WHERE is_demo = 1 ORDER BY id`);
if (!locations.length) {
  console.error('no demo locations: run scripts/joya-seed-demo.mjs first');
  process.exit(1);
}
const access = { username: 'joya-eval', role: 'CHAIN_ADMIN', isAdmin: true, locationIds: locations.map((l) => l.id), payroll: true };
const loc = locations[0].id;
const row = (kind, contextId = null) => ({ id: 0, question: '', lang: 'he', context_kind: kind, context_id: contextId, location_id: kind === 'GENERAL' ? null : loc });

const list = await repl.generate(access, loc, todayLocal(), { force: true, createdBy: 'joya-eval' });
const { listId } = list;
const { planId } = await staffing.propose(access, loc, addDays(todayLocal(), 7), { force: true });
const inquiry = (await sql(`SELECT id FROM joya_inquiries WHERE location_id = :l ORDER BY id LIMIT 1`, { l: loc }))[0];

const contexts = {
  GENERAL: await buildContext(access, row('GENERAL')),
  ORDER_LIST: await buildContext(access, row('ORDER_LIST', listId)),
  STAFFING_PLAN: await buildContext(access, row('STAFFING_PLAN', planId)),
  ...(inquiry ? { INQUIRY: await buildContext(access, row('INQUIRY', inquiry.id)) } : {}),
};
await repl.reject(access, listId, { note: 'eval context' });
await staffing.reject(access, planId, { note: 'eval context' });

mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ capturedAt: new Date().toISOString(), contexts }, null, 1) + '\n');
for (const [k, c] of Object.entries(contexts)) console.log(`${k.padEnd(14)} today ${c.today}, ${c.object?.lines?.length ?? 0} lines`);
console.log(`→ ${out}`);
await endPool();
