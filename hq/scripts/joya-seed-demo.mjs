// Demonstration records for Joya Headquarter: Joya's OWN records only (shifts, menu, recipes, rules,
// baseline, past order lists, a shortage) for the demo branches.
// The source data of the demo branches (orders, dish sales, employees, clock rows, payroll) is
// served by the fake Allegro API, scripts/fake-allegro.mjs — Joya never stores source data.
// EVERY row written here has is_demo = 1 or a demo location id (or a 'demo:' rule note); the locations are named "(דמו)".
//
//   node scripts/joya-seed-demo.mjs              create (or re-create) the demo records
//   node scripts/joya-seed-demo.mjs --remove     delete every demo row
//   add --allow-remote to run against a DB that is not on this machine (production!)
import '../lib/env.js';
import { executeSql, getDbPool } from '../lib/dbpool.js';
import { BRANCHES, INGREDIENTS, dishesOf, today as todayOf, addDays, weekday as wd, seeded } from './demo-defs.mjs';

const args = process.argv.slice(2);
const host = process.env.DB_HOST || '';
if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !args.includes('--allow-remote')) {
  console.error(`DB_HOST is ${host} — not this machine. Add --allow-remote if you really want demo rows there.`);
  process.exit(1);
}
const q = async (sql, p = {}) => (await executeSql(sql, p))[0];
const saveDoc = (name, value) =>
  q(`INSERT INTO joya_settings (name, value_json, updated_by) VALUES (:n, :v, 'seed') ON DUPLICATE KEY UPDATE value_json=VALUES(value_json), updated_by='seed'`, { n: name, v: JSON.stringify(value) });
const rnd = seeded(20261012);
const today = todayOf();

async function remove() {
  // the demo locations are the fake API's branches (a location id is the Allegro branch id)
  const locs = BRANCHES.map((b) => b.id);
  const L = locs.map((id) => `'${id}'`).join(',');
  const del = [
    `DELETE FROM joya_attendance_corrections WHERE location_id IN (${L})`,
    `DELETE FROM joya_payroll_issues WHERE location_id IN (${L})`,
    `DELETE FROM joya_menu_items WHERE location_id IN (${L})`,
    `DELETE FROM joya_order_lists WHERE location_id IN (${L})`,
    `DELETE FROM joya_shortages WHERE location_id IN (${L})`,
    `DELETE FROM joya_staffing_plans WHERE location_id IN (${L})`,
    `DELETE FROM joya_ai_requests WHERE location_id IN (${L})`,
    `DELETE FROM joya_ingredients WHERE is_demo=1`,
    // the demo locations' shifts + baseline documents
    ...locs.map((id) => `DELETE FROM joya_settings WHERE name = 'location:${id}'`),
  ];
  for (const s of del) await q(s);
  // demo staffing rules live in the shared staffingRules document: keep only the others
  const row = (await q(`SELECT value_json FROM joya_settings WHERE name='staffingRules'`))[0];
  const rules = row ? (typeof row.value_json === 'string' ? JSON.parse(row.value_json) : row.value_json) : [];
  await saveDoc('staffingRules', rules.filter((r) => !locs.includes(r.locationId) && !String(r.note || '').startsWith('demo:')));
  console.log(`removed demo data (${locs.length} demo locations)`);
}

async function create() {
  await remove();
  const ing = {};
  for (const [code, name, unit, cat] of INGREDIENTS) ing[code] = (await q(`INSERT INTO joya_ingredients (code, name, unit, category, is_demo) VALUES (:c, :n, :u, :cat, 1)`, { c: code, n: name, u: unit, cat })).insertId;

  const made = [];
  const demoLocs = [];
  for (const L of BRANCHES) {
    const loc = L.id;
    demoLocs.push(loc);
    made.push(`${L.code} (location ${loc})`);
    // ---- shifts, and the staffing baseline (what the restaurant staffed before) for the bartender
    await saveDoc(`location:${loc}`, {
      shifts: [
        { code: 'morning', name: 'בוקר', days: [0, 1, 2, 3, 4, 5], start: '07:30:00', end: '16:00:00', active: true },
        { code: 'evening', name: 'ערב', days: [0, 1, 2, 3, 4, 6], start: '16:00:00', end: '23:30:00', active: true },
      ],
      baseline: [0, 1, 2, 3, 4, 6].map((w) => ({ shiftCode: 'evening', weekday: w, roleCode: 'bartender', headcount: w >= 4 ? 2 : 1, note: null })),
    });

    // ---- the menu, by Beecomm dish id (the fake API sells the same ids), with ingredient lists
    for (const [code, name, cat, , , recipe] of dishesOf(L)) {
      const r = recipe.map(([ic, qty, unit]) => ({ ingredientId: ing[ic], qty, unit }));
      await q(`INSERT INTO joya_menu_items (location_id, external_code, name, category, recipe_json, is_demo) VALUES (:l, :c, :n, :cat, :r, 1)`, { l: loc, c: code, n: name, cat, r: JSON.stringify(r) });
    }

    // ---- historical final order lists, twice a week, last 6 weeks
    const usual = [['DM-TOM', 14], ['DM-CUC', 8], ['DM-ONI', 4], ['DM-EGG', 10], ['DM-MLK', 24], ['DM-FET', 5], ['DM-BRD', 40], ['DM-PST', 6], ['DM-COF', 4], ['DM-CHK', 9], ['DM-LEM', 3], ['DM-HRB', 12]];
    if (L.code === 'DEMO-TLV') usual.push(['DM-SAL', 6]);
    const def = (c) => INGREDIENTS.find((x) => x[0] === c);
    for (let d = addDays(today, -42); d < today; d = addDays(d, 1)) {
      if (![0, 3].includes(wd(d))) continue;
      const lines = usual.filter(() => rnd() > 0.12).map(([c, base]) => ({ ingredientId: ing[c], name: def(c)[1], qty: Math.max(1, Math.round(base * L.scale * (0.85 + rnd() * 0.3))), unit: def(c)[2] }));
      if (rnd() < 0.3) lines.push({ ingredientId: ing['DM-OIL'], name: 'שמן זית', qty: 3, unit: 'l' });
      if (rnd() < 0.2) lines.push({ ingredientId: ing['DM-NAP'], name: 'מפיות', qty: 1, unit: 'קרטון' });
      const working = lines.map((x, i) => ({ id: i + 1, ingredientId: x.ingredientId, itemText: null, qty: x.qty, unit: x.unit, origin: 'ADDED', recLineId: null, removed: false, note: null, updatedBy: 'seed' }));
      const final = lines.map((x, i) => ({ lineId: i + 1, ...x, origin: 'ADDED', recommendedQty: null, note: null }));
      await q(
        `INSERT INTO joya_order_lists (location_id, list_date, origin, status, lines_json, edits_json, final_json, ordered_json, is_demo, created_by, approved_by, approved_at, ordered_by, ordered_at)
         VALUES (:l, :d, 'MANUAL', 'ORDERED', :x, '[]', :f, :f, 1, 'seed', 'seed', :d, 'seed', :d)`,
        { l: loc, d, x: JSON.stringify(working), f: JSON.stringify(final) },
      );
    }
    await q(`INSERT INTO joya_shortages (location_id, ingredient_id, reported_date, note, is_demo, reported_by) VALUES (:l, :i, :d, 'נגמר באמצע משמרת ערב', 1, 'seed')`, { l: loc, i: ing['DM-FET'], d: addDays(today, -1) });
  }

  // ---- demo staffing rules, on each demo location only (never chain-wide: they would apply to the
  //      real branches too); marked 'demo:' so --remove deletes them
  const rules = [];
  const R = async (role, type, unit, params, extra = {}) => {
    for (const l of demoLocs) {
      rules.push({ locationId: l, shiftCode: extra.shift ?? null, days: extra.days ?? null, roleCode: role, type, unit, params, roleStart: extra.roleStart ?? null, roleEnd: extra.roleEnd ?? null, mandatory: !!extra.mandatory, active: true, note: `demo: ${extra.note || ''}`, updatedBy: 'seed', updatedAt: new Date().toISOString() });
    }
  };
  await R('cook', 'STEPS', 'ORDERS_PEAK_HOUR', { steps: [{ above: 0, count: 2 }, { above: 12, count: 3 }, { above: 22, count: 4 }] }, { note: 'cooks by orders in the busiest hour' });
  await R('cook', 'MIN', null, { count: 2 }, { mandatory: true, note: 'never fewer than 2 cooks' });
  await R('waiter', 'RATIO', 'DINERS_PER_SHIFT', { per: 30 }, { note: '1 waiter per 30 diners in the shift' });
  await R('waiter', 'MIN', null, { count: 2 }, { mandatory: true, note: 'at least 2 waiters' });
  await R('waiter', 'PEAK_EXTRA', 'DINERS_PEAK_HOUR', { above: 40, count: 1, start: '12:00', end: '15:00' }, { shift: 'morning', note: 'lunch peak' });
  await R('runner', 'STEPS', 'DINERS_PEAK_HOUR', { steps: [{ above: 0, count: 1 }, { above: 45, count: 2 }] }, { note: 'runners by peak-hour diners' });
  await R('checker', 'FIXED', null, { count: 1 }, { mandatory: true, shift: 'morning', note: 'one checker in the morning' });
  await R('checker', 'FIXED', null, { count: 1 }, { shift: 'evening', note: 'one checker in the evening' });
  await R('barista', 'FIXED', null, { count: 1 }, { mandatory: true, shift: 'morning', note: 'one barista in the morning' });
  await R('bartender', 'RATIO', 'CONCURRENT_DINERS_PEAK', { per: 35 }, { shift: 'evening', roleStart: '17:00', note: 'bartenders by diners seated at once, from 17:00' });
  const row = (await q(`SELECT value_json FROM joya_settings WHERE name='staffingRules'`))[0];
  const kept = row ? (typeof row.value_json === 'string' ? JSON.parse(row.value_json) : row.value_json) : [];
  let next = kept.reduce((m, r) => Math.max(m, r.id || 0), 0);
  await saveDoc('staffingRules', [...kept, ...rules.map((r) => ({ id: ++next, ...r }))]);

  console.log(`demo records created: ${made.join(', ')}`);
  console.log('The source data comes from the fake Allegro API:  node scripts/fake-allegro.mjs  (+ ALLEGRO_API_URL=http://localhost:4399/local-api/v1)');
  console.log('Users: the Allegro admin users (users.json); an admin sees the demo locations too.');
}

try {
  if (args.includes('--remove')) await remove();
  else await create();
} finally {
  await getDbPool().end();
}
