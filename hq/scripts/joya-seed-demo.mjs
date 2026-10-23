// Demonstration records for Joya Headquarter: Joya's OWN records only (locations linked to the
// demo branches, shifts, menu, recipes, rules, past order lists, a shortage, tasks, inquiries).
// The source data of the demo branches (orders, dish sales, employees, clock rows, payroll) is
// served by the fake Allegro API, scripts/fake-allegro.mjs — Joya never stores source data.
// EVERY row written here has is_demo = 1 (or a 'demo:' note) and the locations are named "(דמו)".
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
const rnd = seeded(20261012);
const today = todayOf();

async function remove() {
  // the demo locations are the fake API's branches (a location id is the Allegro branch id)
  const locs = BRANCHES.map((b) => b.id);
  const L = locs.map((id) => `'${id}'`).join(',');
  const del = [
    `DELETE FROM joya_attendance_corrections WHERE location_id IN (${L})`,
    `DELETE FROM joya_payroll_issues WHERE location_id IN (${L})`,
    `DELETE r FROM joya_recipe_lines r JOIN joya_menu_items m ON m.id = r.menu_item_id WHERE m.location_id IN (${L})`,
    `DELETE FROM joya_menu_items WHERE location_id IN (${L})`,
    `DELETE e FROM joya_order_edits e JOIN joya_order_lists l ON l.id = e.list_id WHERE l.location_id IN (${L})`,
    `DELETE x FROM joya_order_list_lines x JOIN joya_order_lists l ON l.id = x.list_id WHERE l.location_id IN (${L})`,
    `DELETE x FROM joya_order_recommendation_lines x JOIN joya_order_lists l ON l.id = x.list_id WHERE l.location_id IN (${L})`,
    `DELETE FROM joya_order_lists WHERE location_id IN (${L})`,
    `DELETE FROM joya_item_patterns WHERE location_id IN (${L})`,
    `DELETE FROM joya_shortages WHERE location_id IN (${L})`,
    `DELETE e FROM joya_staffing_edits e JOIN joya_staffing_plans p ON p.id = e.plan_id WHERE p.location_id IN (${L})`,
    `DELETE x FROM joya_staffing_plan_lines x JOIN joya_staffing_plans p ON p.id = x.plan_id WHERE p.location_id IN (${L})`,
    `DELETE x FROM joya_staffing_proposal_lines x JOIN joya_staffing_plans p ON p.id = x.plan_id WHERE p.location_id IN (${L})`,
    `DELETE FROM joya_staffing_plans WHERE location_id IN (${L})`,
    `DELETE FROM joya_staffing_rules WHERE location_id IN (${L}) OR note LIKE 'demo:%'`,
    `DELETE FROM joya_staffing_baseline WHERE location_id IN (${L})`,
    `DELETE FROM joya_shift_defs WHERE location_id IN (${L})`,
    `DELETE FROM joya_tasks WHERE is_demo=1 OR location_id IN (${L})`,
    `DELETE FROM joya_inquiries WHERE is_demo=1 OR location_id IN (${L})`,
    `DELETE FROM joya_ai_requests WHERE location_id IN (${L})`,
    `DELETE FROM joya_import_batches WHERE is_demo=1 OR location_id IN (${L})`,
    `DELETE r FROM joya_recipe_lines r JOIN joya_ingredients i ON i.id = r.ingredient_id WHERE i.is_demo=1`,
    `DELETE FROM joya_ingredients WHERE is_demo=1`,
  ];
  for (const s of del) await q(s);
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
    await q(`INSERT INTO joya_shift_defs (location_id, code, name, days_json, start_time, end_time) VALUES (:l, 'morning', 'בוקר', '[0,1,2,3,4,5]', '07:30:00', '16:00:00')`, { l: loc });
    await q(`INSERT INTO joya_shift_defs (location_id, code, name, days_json, start_time, end_time) VALUES (:l, 'evening', 'ערב', '[0,1,2,3,4,6]', '16:00:00', '23:30:00')`, { l: loc });

    // ---- the menu, by Beecomm dish id (the fake API sells the same ids), with ingredient lists
    for (const [code, name, cat, , , recipe] of dishesOf(L)) {
      const mid = (await q(`INSERT INTO joya_menu_items (location_id, external_code, name, category, is_demo) VALUES (:l, :c, :n, :cat, 1)`, { l: loc, c: code, n: name, cat })).insertId;
      for (const [ic, qty, unit] of recipe) await q(`INSERT INTO joya_recipe_lines (menu_item_id, ingredient_id, qty, unit, is_demo) VALUES (:m, :i, :q, :u, 1)`, { m: mid, i: ing[ic], q: qty, u: unit });
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
      const lid = (
        await q(
          `INSERT INTO joya_order_lists (location_id, list_date, origin, status, final_json, ordered_json, is_demo, created_by, approved_by, approved_at, ordered_by, ordered_at)
           VALUES (:l, :d, 'HISTORICAL_IMPORT', 'ORDERED', :f, :f, 1, 'seed', 'seed', :d, 'seed', :d)`,
          { l: loc, d, f: JSON.stringify(lines) },
        )
      ).insertId;
      for (const x of lines) await q(`INSERT INTO joya_order_list_lines (list_id, ingredient_id, qty, unit, origin, updated_by) VALUES (:l, :i, :q, :u, 'ADDED', 'seed')`, { l: lid, i: x.ingredientId, q: x.qty, u: x.unit });
    }
    await q(`INSERT INTO joya_shortages (location_id, ingredient_id, reported_date, note, is_demo, reported_by) VALUES (:l, :i, :d, 'נגמר באמצע משמרת ערב', 1, 'seed')`, { l: loc, i: ing['DM-FET'], d: addDays(today, -1) });

    // ---- staffing baseline (what the restaurant staffed before) for the bartender
    for (const w of [0, 1, 2, 3, 4, 6]) await q(`INSERT INTO joya_staffing_baseline (location_id, shift_code, weekday, role_code, headcount, updated_by) VALUES (:l, 'evening', :w, 'bartender', :h, 'seed')`, { l: loc, w, h: w >= 4 ? 2 : 1 });

    // ---- tasks and inquiries
    await q(`INSERT INTO joya_tasks (location_id, title, owner_username, due_date, status, source_kind, is_demo, created_by) VALUES (:l, 'לבדוק את המקרר במטבח — טמפרטורה', NULL, :d, 'OPEN', 'MANUAL', 1, 'seed')`, { l: loc, d: addDays(today, -2) });
    await q(
      `INSERT INTO joya_inquiries (source, kind, location_id, author_name, content, rating, received_at, status, is_demo, created_by) VALUES
       ('GOOGLE', 'REVIEW', :l, 'דנה (דמו)', 'האוכל היה טעים אבל חיכינו 40 דקות לעיקריות ביום חמישי בערב.', 3, :d, 'NEW', 1, 'seed'),
       ('INSTAGRAM', 'MESSAGE', :l, 'yossi_demo', 'היי, אפשר להזמין שולחן ל-12 ביום שישי בבוקר?', NULL, :d, 'NEW', 1, 'seed')`,
      { l: loc, d: `${addDays(today, -1)} 21:15:00` },
    );
  }

  // ---- demo staffing rules, on each demo location only (never chain-wide: they would apply to the
  //      real branches too); marked 'demo:' so --remove deletes them
  const R = async (role, type, unit, params, extra = {}) => {
    for (const l of demoLocs) {
      await q(
        `INSERT INTO joya_staffing_rules (location_id, shift_code, days_json, role_code, rule_type, demand_unit, params_json, role_start, role_end, mandatory, note, updated_by)
         VALUES (:l, :s, :d, :r, :t, :u, :p, :rs, :re, :m, :n, 'seed')`,
        { l, s: extra.shift ?? null, d: extra.days ? JSON.stringify(extra.days) : null, r: role, t: type, u: unit, p: JSON.stringify(params), rs: extra.roleStart ?? null, re: extra.roleEnd ?? null, m: extra.mandatory ? 1 : 0, n: `demo: ${extra.note || ''}` },
      );
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
