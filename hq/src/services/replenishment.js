// Replenishment: recommendation → manager edits → approved final list → marked as ordered.
// The learning is in ../lib/recommend.js; this file loads its inputs and stores its outputs.
//
// Kept apart (see sql/add-joya.sql):
//   joya_order_recommendation_lines  the system's proposal, never changed
//   joya_order_list_lines            the working list the manager edits
//   joya_order_edits                 every change (who, when, before/after, UI or chat)
//   joya_order_lists.final_json      frozen at approval;  ordered_json  when marked ordered
import { q, one, tx, err, audit, parseJson, ymd, getSettings, todayLocal } from '../db.js';
import { assertLocation } from '../access.js';
import { recommend, convert, addDays, daysBetween, RECOMMENDER_VERSION } from '../lib/recommend.js';
import { dishSales } from './source.js';

// ---------------------------------------------------------------- inputs for the recommender

async function loadExamples(locationId, asOf, limit, excludeListId = null) {
  const lists = await q(
    `SELECT * FROM joya_order_lists
      WHERE location_id=:l AND list_date <= :d AND status IN ('APPROVED','ORDERED') ${excludeListId ? 'AND id <> :x' : ''}
      ORDER BY list_date DESC, id DESC LIMIT ${Number(limit) || 8}`,
    { l: locationId, d: asOf, x: excludeListId },
  );
  const out = [];
  for (const l of lists) {
    const final = parseJson(l.status === 'ORDERED' && l.ordered_json ? l.ordered_json : l.final_json) || [];
    const rec = l.origin === 'RECOMMENDATION' ? (await q(`SELECT ingredient_id FROM joya_order_recommendation_lines WHERE list_id=:id AND section='SUGGESTED'`, { id: l.id })).map((r) => r.ingredient_id) : null;
    out.push({
      listId: l.id,
      date: ymd(l.list_date),
      status: l.origin === 'HISTORICAL_IMPORT' ? 'HISTORICAL' : l.status,
      lines: final.filter((x) => x.ingredientId != null).map((x) => ({ ingredientId: x.ingredientId, qty: x.qty == null ? null : Number(x.qty) })),
      recommended: rec,
    });
  }
  return out;
}

/**
 * Dish sales by date for the location (Allegro /beecomm/items/stored, matched to the menu by the
 * Beecomm dish id), and which dates have any sales data at all. `to` is exclusive.
 */
async function loadSales(locationId, from, to) {
  const byItem = new Map();
  const dataDates = new Set();
  if (to <= from) return { byItem, dataDates };
  const menu = new Map((await q(`SELECT id, external_code FROM joya_menu_items WHERE location_id=:l`, { l: locationId })).map((m) => [m.external_code, m.id]));
  for (const r of await dishSales(locationId, from, addDays(to, -1))) {
    dataDates.add(r.business_date);
    const k = menu.get(r.code);
    if (k == null) continue;
    if (!byItem.has(k)) byItem.set(k, new Map());
    const m = byItem.get(k);
    m.set(r.business_date, (m.get(r.business_date) || 0) + r.qty);
  }
  return { byItem, dataDates };
}

async function loadRecipes(locationId) {
  const rows = await q(
    `SELECT r.ingredient_id, r.menu_item_id, r.qty, r.unit, i.unit AS ing_unit, m.name AS dish
       FROM joya_recipe_lines r JOIN joya_menu_items m ON m.id = r.menu_item_id JOIN joya_ingredients i ON i.id = r.ingredient_id
      WHERE m.location_id=:l AND m.active=1`,
    { l: locationId },
  );
  const byIng = new Map();
  for (const r of rows) {
    if (!byIng.has(r.ingredient_id)) byIng.set(r.ingredient_id, []);
    byIng.get(r.ingredient_id).push({ menuItemId: r.menu_item_id, dish: r.dish, qty: r.qty == null ? null : Number(r.qty), unit: r.unit || r.ing_unit || null });
  }
  return byIng;
}

function datesIn(from, to) {
  const out = [];
  for (let d = from; d < to; d = addDays(d, 1)) out.push(d);
  return out;
}

export async function buildInputs(locationId, asOf, excludeListId = null) {
  const settings = await getSettings('replenishment');
  const examples = await loadExamples(locationId, asOf, settings.historyLists || 8, excludeListId);
  const oldest = examples.length ? examples[examples.length - 1].date : asOf;
  const from = addDays(oldest < addDays(asOf, -(settings.coldStartDays || 7)) ? oldest : addDays(asOf, -(settings.coldStartDays || 7)), -60);
  const sales = await loadSales(locationId, from, asOf);
  const recipes = await loadRecipes(locationId);

  const linkedSales = (ingId, a, b) => {
    const dishes = recipes.get(ingId) || [];
    const days = datesIn(a, b);
    const daysMissing = days.filter((d) => !sales.dataDates.has(d)).length;
    if (!dishes.length) return { units: null, dishes: 0, days: days.length, daysMissing };
    let units = 0;
    for (const dish of dishes) {
      const m = sales.byItem.get(dish.menuItemId);
      if (m) for (const d of days) units += m.get(d) || 0;
    }
    return { units: Math.round(units * 1000) / 1000, dishes: dishes.length, days: days.length, daysMissing };
  };

  // Only when EVERY linked dish has a quantity in a unit we can convert, and the window is complete.
  const recipeEstimate = (ingId, a, b, toUnit) => {
    const dishes = recipes.get(ingId) || [];
    if (!dishes.length) return { qty: null, reason: 'no linked dishes' };
    if (dishes.some((d) => d.qty == null)) return { qty: null, reason: `${dishes.filter((d) => d.qty == null).length} of ${dishes.length} dishes have no quantity` };
    const days = datesIn(a, b);
    if (days.some((d) => !sales.dataDates.has(d))) return { qty: null, reason: 'sales data missing for some days' };
    let total = 0;
    const parts = [];
    for (const dish of dishes) {
      const m = sales.byItem.get(dish.menuItemId);
      let sold = 0;
      if (m) for (const d of days) sold += m.get(d) || 0;
      const per = convert(dish.qty, dish.unit, toUnit);
      if (per == null) return { qty: null, reason: `cannot convert ${dish.unit} to ${toUnit}` };
      total += sold * per;
      parts.push(`${sold}×${dish.qty}${dish.unit || ''}`);
    }
    return { qty: total, reason: `(${parts.join(' + ')}) = ${Math.round(total * 1000) / 1000}${toUnit || ''}` };
  };

  // shortages of the last 60 days; the recommender keeps those after each item's last order
  const sh = await q(`SELECT ingredient_id, reported_date FROM joya_shortages WHERE location_id=:l AND ingredient_id IS NOT NULL AND reported_date <= :d AND reported_date >= :a`, {
    l: locationId,
    d: asOf,
    a: addDays(asOf, -60),
  });
  const shortages = {};
  for (const s of sh) (shortages[s.ingredient_id] ||= []).push(ymd(s.reported_date));

  const ingIds = new Set([...examples.flatMap((e) => e.lines.map((l) => l.ingredientId)), ...recipes.keys(), ...Object.keys(shortages).map(Number)]);
  const ingredients = ingIds.size
    ? (await q(`SELECT id, name, unit FROM joya_ingredients WHERE id IN (${[...ingIds].map(Number).join(',')}) AND active=1`)).map((r) => ({ id: r.id, name: r.name, unit: r.unit }))
    : [];
  return { asOf, ingredients, examples, linkedSales, recipeEstimate, shortages, settings };
}

// ---------------------------------------------------------------- lists

export async function generate(access, locationId, date, { force = false, createdBy } = {}) {
  assertLocation(access, locationId);
  const asOf = date || todayLocal();
  if (!force) {
    const open = await one(`SELECT id FROM joya_order_lists WHERE location_id=:l AND list_date=:d AND status='DRAFT' ORDER BY id DESC LIMIT 1`, { l: locationId, d: asOf });
    if (open) return { listId: open.id, existing: true };
  }
  const inputs = await buildInputs(locationId, asOf);
  const result = recommend(inputs);
  const loc = await one(`SELECT is_demo FROM joya_locations WHERE id=:l`, { l: locationId });
  const listId = await tx(async (c) => {
    const id = (
      await c.q(
        `INSERT INTO joya_order_lists (location_id, list_date, origin, status, recommender_version, params_json, is_demo, created_by)
         VALUES (:l, :d, 'RECOMMENDATION', 'DRAFT', :v, :p, :demo, :by)`,
        { l: locationId, d: asOf, v: RECOMMENDER_VERSION, p: JSON.stringify({ settings: result.settings, examplesUsed: result.examplesUsed }), demo: loc?.is_demo ? 1 : 0, by: createdBy || access.username },
      )
    ).insertId;
    for (const l of result.lines) {
      const recId = (
        await c.q(
          `INSERT INTO joya_order_recommendation_lines (list_id, ingredient_id, section, qty, unit, method, confidence, basis_json)
           VALUES (:id, :i, :s, :q, :u, :m, :c, :b)`,
          { id, i: l.ingredientId, s: l.section, q: l.qty, u: l.unit, m: l.method, c: l.confidence, b: JSON.stringify(l.basis) },
        )
      ).insertId;
      if (l.section !== 'NOT_DUE') {
        await c.q(`INSERT INTO joya_order_list_lines (list_id, ingredient_id, qty, unit, origin, rec_line_id, updated_by) VALUES (:id, :i, :q, :u, 'RECOMMENDED', :r, :by)`, {
          id,
          i: l.ingredientId,
          q: l.qty,
          u: l.unit,
          r: recId,
          by: access.username,
        });
      }
    }
    return id;
  });
  await audit(access.username, 'ORDER_LIST_GENERATED', 'order_list', listId, locationId, { lines: result.lines.length, examples: result.examplesUsed.length });
  return { listId, existing: false };
}

export async function createManual(access, locationId, date) {
  assertLocation(access, locationId);
  const id = (await q(`INSERT INTO joya_order_lists (location_id, list_date, origin, status, created_by) VALUES (:l, :d, 'MANUAL', 'DRAFT', :by)`, { l: locationId, d: date || todayLocal(), by: access.username })).insertId;
  await audit(access.username, 'ORDER_LIST_CREATED', 'order_list', id, locationId, { origin: 'MANUAL' });
  return { listId: id };
}

export async function listLists(access, { locationIds, status, limit = 60 }) {
  if (!locationIds.length) return [];
  const st = status ? String(status).split(',').filter((s) => ['DRAFT', 'APPROVED', 'ORDERED', 'REJECTED'].includes(s)) : null;
  const rows = await q(
    `SELECT l.*, loc.name AS location_name,
            (SELECT COUNT(*) FROM joya_order_list_lines x WHERE x.list_id = l.id AND x.removed = 0) AS line_count
       FROM joya_order_lists l JOIN joya_locations loc ON loc.id = l.location_id
      WHERE l.location_id IN (${locationIds.map(Number).join(',')}) ${st?.length ? `AND l.status IN (${st.map((s) => `'${s}'`).join(',')})` : ''}
      ORDER BY l.list_date DESC, l.id DESC LIMIT ${Math.min(Math.max(parseInt(limit, 10) || 60, 1), 300)}`,
  );
  return rows.map((r) => ({
    id: r.id,
    locationId: r.location_id,
    locationName: r.location_name,
    date: ymd(r.list_date),
    origin: r.origin,
    status: r.status,
    lines: Number(r.line_count),
    isDemo: !!r.is_demo,
    createdBy: r.created_by,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at,
    orderedBy: r.ordered_by,
    orderedAt: r.ordered_at,
  }));
}

export async function getList(access, id) {
  const l = await one(`SELECT l.*, loc.name AS location_name FROM joya_order_lists l JOIN joya_locations loc ON loc.id = l.location_id WHERE l.id=:id`, { id });
  if (!l) throw err('NOT_FOUND', 'list not found');
  assertLocation(access, l.location_id);
  const lines = await q(
    `SELECT x.*, i.name AS ing_name, i.unit AS ing_unit FROM joya_order_list_lines x LEFT JOIN joya_ingredients i ON i.id = x.ingredient_id WHERE x.list_id=:id ORDER BY x.removed, x.origin DESC, i.name, x.id`,
    { id },
  );
  const recs = await q(
    `SELECT r.*, i.name AS ing_name FROM joya_order_recommendation_lines r JOIN joya_ingredients i ON i.id = r.ingredient_id WHERE r.list_id=:id ORDER BY FIELD(r.section,'SUGGESTED','CHECK','NOT_DUE'), i.name`,
    { id },
  );
  const edits = await q(`SELECT * FROM joya_order_edits WHERE list_id=:id ORDER BY id`, { id });
  const recById = new Map(recs.map((r) => [r.id, r]));
  return {
    list: {
      id: l.id,
      locationId: l.location_id,
      locationName: l.location_name,
      date: ymd(l.list_date),
      origin: l.origin,
      status: l.status,
      isDemo: !!l.is_demo,
      note: l.note,
      createdBy: l.created_by,
      createdAt: l.created_at,
      approvedBy: l.approved_by,
      approvedAt: l.approved_at,
      orderedBy: l.ordered_by,
      orderedAt: l.ordered_at,
      rejectedBy: l.rejected_by,
      rejectedAt: l.rejected_at,
      params: parseJson(l.params_json),
      final: parseJson(l.final_json),
      ordered: parseJson(l.ordered_json),
    },
    lines: lines.map((x) => {
      const rec = x.rec_line_id ? recById.get(x.rec_line_id) : null;
      return {
        id: x.id,
        ingredientId: x.ingredient_id,
        name: x.ing_name || x.item_text,
        freeText: !x.ingredient_id,
        qty: x.qty == null ? null : Number(x.qty),
        unit: x.unit || x.ing_unit || null,
        origin: x.origin,
        removed: !!x.removed,
        note: x.note,
        recommended: rec ? { qty: rec.qty == null ? null : Number(rec.qty), section: rec.section, method: rec.method, confidence: rec.confidence } : null,
        changed: rec ? !!x.removed || Number(rec.qty ?? NaN) !== Number(x.qty ?? NaN) : true,
        updatedBy: x.updated_by,
      };
    }),
    recommendation: recs.map((r) => ({
      id: r.id,
      ingredientId: r.ingredient_id,
      name: r.ing_name,
      section: r.section,
      qty: r.qty == null ? null : Number(r.qty),
      unit: r.unit,
      method: r.method,
      confidence: r.confidence,
      basis: parseJson(r.basis_json),
    })),
    edits: edits.map((e) => ({ id: e.id, lineId: e.line_id, action: e.action, before: parseJson(e.before_json), after: parseJson(e.after_json), note: e.note, via: e.via, by: e.username, at: e.created_at })),
  };
}

const lineSnap = (x) => (x ? { ingredientId: x.ingredient_id, itemText: x.item_text, qty: x.qty == null ? null : Number(x.qty), unit: x.unit, removed: !!x.removed, note: x.note } : null);

/**
 * Validate a change set without saving (the chat preview), or apply it.
 * ops: { op: 'add', ingredientId? | name?, qty?, unit?, note? } | { op: 'set_qty', lineId, qty }
 *      | { op: 'remove', lineId } | { op: 'restore', lineId } | { op: 'note', lineId, note }
 */
export async function checkOps(access, listId, ops) {
  const { list, lines } = await getList(access, listId);
  if (list.status !== 'DRAFT') throw err('CONFLICT', `the list is ${list.status}; reopen it to edit`);
  if (!Array.isArray(ops) || !ops.length) throw err('BAD_REQUEST', 'no changes');
  const out = [];
  for (const o of ops) {
    const line = o.lineId ? lines.find((l) => l.id === Number(o.lineId)) : null;
    if (['set_qty', 'remove', 'restore', 'note'].includes(o.op) && !line) throw err('BAD_REQUEST', `line ${o.lineId} is not on this list`);
    if (o.op === 'set_qty' || (o.op === 'add' && o.qty != null && o.qty !== '')) {
      const n = Number(o.qty);
      if (!(n > 0)) throw err('BAD_REQUEST', 'quantity must be more than 0 (remove the line instead)');
    }
    if (o.op === 'add') {
      let ing = null;
      if (o.ingredientId) ing = await one(`SELECT id, name, unit FROM joya_ingredients WHERE id=:id`, { id: o.ingredientId });
      else if (o.name) ing = await one(`SELECT id, name, unit FROM joya_ingredients WHERE name=:n ORDER BY id LIMIT 1`, { n: String(o.name).trim() });
      if (o.ingredientId && !ing) throw err('BAD_REQUEST', `unknown ingredient ${o.ingredientId}`);
      const dup = ing && lines.find((l) => l.ingredientId === ing.id && !l.removed);
      if (dup) {
        out.push({ op: 'set_qty', lineId: dup.id, qty: Number(o.qty), name: dup.name, before: dup.qty, note: o.note || null });
        continue;
      }
      out.push({ op: 'add', ingredientId: ing?.id ?? null, name: ing?.name ?? String(o.name || '').trim(), freeText: !ing, qty: o.qty == null || o.qty === '' ? null : Number(o.qty), unit: o.unit || ing?.unit || null, note: o.note || null });
      if (!ing && !String(o.name || '').trim()) throw err('BAD_REQUEST', 'an added item needs a name');
    } else if (['set_qty', 'remove', 'restore', 'note'].includes(o.op)) {
      out.push({ op: o.op, lineId: line.id, name: line.name, before: line.qty, qty: o.op === 'set_qty' ? Number(o.qty) : undefined, note: o.note ?? null });
    } else throw err('BAD_REQUEST', `unknown change "${o.op}"`);
  }
  return out;
}

export async function applyOps(access, listId, ops, { via = 'UI' } = {}) {
  const checked = await checkOps(access, listId, ops);
  await tx(async (c) => {
    for (const o of checked) {
      if (o.op === 'add') {
        const id = (
          await c.q(`INSERT INTO joya_order_list_lines (list_id, ingredient_id, item_text, qty, unit, origin, note, updated_by) VALUES (:l, :i, :t, :q, :u, 'ADDED', :n, :by)`, {
            l: listId,
            i: o.ingredientId,
            t: o.ingredientId ? null : o.name,
            q: o.qty,
            u: o.unit,
            n: o.note,
            by: access.username,
          })
        ).insertId;
        await c.q(`INSERT INTO joya_order_edits (list_id, line_id, action, after_json, note, via, username) VALUES (:l, :id, 'ADD', :a, :n, :via, :u)`, {
          l: listId,
          id,
          a: JSON.stringify({ ingredientId: o.ingredientId, name: o.name, qty: o.qty, unit: o.unit }),
          n: o.note,
          via,
          u: access.username,
        });
        continue;
      }
      const before = await c.one(`SELECT * FROM joya_order_list_lines WHERE id=:id AND list_id=:l FOR UPDATE`, { id: o.lineId, l: listId });
      if (o.op === 'set_qty') await c.q(`UPDATE joya_order_list_lines SET qty=:q, removed=0, updated_by=:u WHERE id=:id`, { q: o.qty, u: access.username, id: o.lineId });
      if (o.op === 'remove') await c.q(`UPDATE joya_order_list_lines SET removed=1, updated_by=:u WHERE id=:id`, { u: access.username, id: o.lineId });
      if (o.op === 'restore') await c.q(`UPDATE joya_order_list_lines SET removed=0, updated_by=:u WHERE id=:id`, { u: access.username, id: o.lineId });
      if (o.op === 'note') await c.q(`UPDATE joya_order_list_lines SET note=:n, updated_by=:u WHERE id=:id`, { n: o.note, u: access.username, id: o.lineId });
      const after = await c.one(`SELECT * FROM joya_order_list_lines WHERE id=:id`, { id: o.lineId });
      const action = { set_qty: 'SET_QTY', remove: 'REMOVE', restore: 'RESTORE', note: 'NOTE' }[o.op];
      await c.q(`INSERT INTO joya_order_edits (list_id, line_id, action, before_json, after_json, note, via, username) VALUES (:l, :id, :a, :b, :af, :n, :via, :u)`, {
        l: listId,
        id: o.lineId,
        a: action,
        b: JSON.stringify(lineSnap(before)),
        af: JSON.stringify(lineSnap(after)),
        n: o.op === 'note' ? null : o.note,
        via,
        u: access.username,
      });
    }
  });
  return getList(access, listId);
}

export async function approve(access, listId, { note } = {}) {
  const { list, lines } = await getList(access, listId);
  if (list.status !== 'DRAFT') throw err('CONFLICT', `the list is ${list.status}`);
  const active = lines.filter((l) => !l.removed);
  if (!active.length) throw err('BAD_REQUEST', 'the list is empty');
  const noQty = active.filter((l) => l.qty == null);
  if (noQty.length) throw Object.assign(err('BAD_REQUEST', `set a quantity or remove: ${noQty.map((l) => l.name).join(', ')}`), { details: { lineIds: noQty.map((l) => l.id) } });
  const final = active.map((l) => ({ lineId: l.id, ingredientId: l.ingredientId, name: l.name, qty: l.qty, unit: l.unit, origin: l.origin, recommendedQty: l.recommended?.qty ?? null, note: l.note || null }));
  await q(`UPDATE joya_order_lists SET status='APPROVED', final_json=:f, approved_by=:u, approved_at=NOW(), note=COALESCE(:n, note) WHERE id=:id AND status='DRAFT'`, {
    f: JSON.stringify(final),
    u: access.username,
    n: note || null,
    id: listId,
  });
  await q(`INSERT INTO joya_order_edits (list_id, action, after_json, note, username) VALUES (:l, 'APPROVE', :a, :n, :u)`, { l: listId, a: JSON.stringify({ lines: final.length }), n: note || null, u: access.username });
  await audit(access.username, 'ORDER_LIST_APPROVED', 'order_list', listId, list.locationId, { lines: final.length });
  await refreshPatterns(list.locationId).catch(() => {});
  return getList(access, listId);
}

/** The manager says the order was really placed. Optional final changes (what the supplier could give). */
export async function markOrdered(access, listId, { note, changes } = {}) {
  const { list } = await getList(access, listId);
  if (list.status !== 'APPROVED') throw err('CONFLICT', 'only an approved list can be marked as ordered');
  let ordered = list.final;
  if (Array.isArray(changes) && changes.length) {
    const byLine = new Map(changes.map((c) => [Number(c.lineId), c]));
    ordered = list.final
      .map((l) => {
        const c = byLine.get(l.lineId);
        if (!c) return l;
        if (c.remove) return null;
        const n = Number(c.qty);
        if (!(n > 0)) throw err('BAD_REQUEST', 'quantity must be more than 0');
        return { ...l, qty: n, changedAtOrder: true };
      })
      .filter(Boolean);
  }
  await q(`UPDATE joya_order_lists SET status='ORDERED', ordered_json=:o, ordered_by=:u, ordered_at=NOW(), note=COALESCE(:n, note) WHERE id=:id AND status='APPROVED'`, {
    o: JSON.stringify(ordered),
    u: access.username,
    n: note || null,
    id: listId,
  });
  await q(`INSERT INTO joya_order_edits (list_id, action, after_json, note, username) VALUES (:l, 'MARK_ORDERED', :a, :n, :u)`, {
    l: listId,
    a: JSON.stringify({ lines: ordered.length, changed: ordered.filter((x) => x.changedAtOrder).length }),
    n: note || null,
    u: access.username,
  });
  await audit(access.username, 'ORDER_LIST_ORDERED', 'order_list', listId, list.locationId, { lines: ordered.length });
  await refreshPatterns(list.locationId).catch(() => {});
  return getList(access, listId);
}

export async function reject(access, listId, { note } = {}) {
  const { list } = await getList(access, listId);
  if (!['DRAFT', 'APPROVED'].includes(list.status)) throw err('CONFLICT', `the list is ${list.status}`);
  await q(`UPDATE joya_order_lists SET status='REJECTED', rejected_by=:u, rejected_at=NOW(), note=COALESCE(:n, note) WHERE id=:id`, { u: access.username, n: note || null, id: listId });
  await q(`INSERT INTO joya_order_edits (list_id, action, note, username) VALUES (:l, 'REJECT', :n, :u)`, { l: listId, n: note || null, u: access.username });
  await audit(access.username, 'ORDER_LIST_REJECTED', 'order_list', listId, list.locationId, { note });
  if (list.status === 'APPROVED') await refreshPatterns(list.locationId).catch(() => {});
  return getList(access, listId);
}

export async function reopen(access, listId) {
  const { list } = await getList(access, listId);
  if (list.status !== 'APPROVED') throw err('CONFLICT', 'only an approved (not yet ordered) list can be reopened');
  await q(`UPDATE joya_order_lists SET status='DRAFT', final_json=NULL, approved_by=NULL, approved_at=NULL WHERE id=:id`, { id: listId });
  await q(`INSERT INTO joya_order_edits (list_id, action, before_json, username) VALUES (:l, 'REOPEN', :b, :u)`, { l: listId, b: JSON.stringify(list.final), u: access.username });
  await audit(access.username, 'ORDER_LIST_REOPENED', 'order_list', listId, list.locationId, {});
  await refreshPatterns(list.locationId).catch(() => {});
  return getList(access, listId);
}

/** A plain text of the final list, to paste into WhatsApp/e-mail for the supplier. Nothing is sent. */
export async function listText(access, listId) {
  const { list } = await getList(access, listId);
  const lines = list.ordered || list.final;
  if (!lines) throw err('CONFLICT', 'the list is not approved yet');
  return [`${list.locationName} — ${list.date}`, ...lines.map((l) => `${l.name}: ${l.qty}${l.unit ? ' ' + l.unit : ''}`)].join('\n');
}

// ---------------------------------------------------------------- learned patterns

/** Recompute and store what was learned per item for one location (after each approve/order). */
export async function refreshPatterns(locationId) {
  const asOf = todayLocal();
  const inputs = await buildInputs(locationId, asOf);
  const res = recommend(inputs);
  await q(`DELETE FROM joya_item_patterns WHERE location_id=:l`, { l: locationId });
  for (const p of res.patterns) {
    if (!p.examples && !p.suggestedCount) continue;
    await q(`INSERT INTO joya_item_patterns (location_id, ingredient_id, stats_json, examples) VALUES (:l, :i, :s, :n)`, { l: locationId, i: p.ingredientId, s: JSON.stringify(p), n: p.examples });
  }
  return res.patterns.length;
}

export async function getPatterns(access, locationId) {
  assertLocation(access, locationId);
  const rows = await q(
    `SELECT p.*, i.name, i.unit FROM joya_item_patterns p JOIN joya_ingredients i ON i.id = p.ingredient_id WHERE p.location_id=:l ORDER BY p.examples DESC, i.name`,
    { l: locationId },
  );
  return rows.map((r) => ({ ingredientId: r.ingredient_id, name: r.name, unit: r.unit, examples: r.examples, stats: parseJson(r.stats_json), computedAt: r.computed_at }));
}

// ---------------------------------------------------------------- shortages

export async function reportShortage(access, { locationId, ingredientId = null, itemText = null, date, note = null }) {
  assertLocation(access, locationId);
  if (!ingredientId && !String(itemText || '').trim()) throw err('BAD_REQUEST', 'choose an item or type its name');
  let ing = ingredientId ? await one(`SELECT id FROM joya_ingredients WHERE id=:id`, { id: ingredientId }) : null;
  if (!ing && itemText) ing = await one(`SELECT id FROM joya_ingredients WHERE name=:n ORDER BY id LIMIT 1`, { n: String(itemText).trim() });
  const id = (
    await q(`INSERT INTO joya_shortages (location_id, ingredient_id, item_text, reported_date, note, reported_by) VALUES (:l, :i, :t, :d, :n, :by)`, {
      l: locationId,
      i: ing?.id ?? null,
      t: ing ? null : String(itemText).trim(),
      d: date || todayLocal(),
      n: note,
      by: access.username,
    })
  ).insertId;
  await audit(access.username, 'SHORTAGE_REPORTED', 'shortage', id, locationId, { ingredientId: ing?.id ?? null, itemText });
  return { id, matched: !!ing };
}

export async function listShortages(access, { locationIds, days = 30 }) {
  if (!locationIds.length) return [];
  const rows = await q(
    `SELECT s.*, i.name AS ing_name, l.name AS location_name FROM joya_shortages s LEFT JOIN joya_ingredients i ON i.id = s.ingredient_id JOIN joya_locations l ON l.id = s.location_id
      WHERE s.location_id IN (${locationIds.map(Number).join(',')}) AND s.reported_date >= :a ORDER BY s.reported_date DESC, s.id DESC`,
    { a: addDays(todayLocal(), -Math.min(Math.max(parseInt(days, 10) || 30, 1), 365)) },
  );
  return rows.map((r) => ({ id: r.id, locationId: r.location_id, locationName: r.location_name, ingredientId: r.ingredient_id, name: r.ing_name || r.item_text, unmatched: !r.ingredient_id, date: ymd(r.reported_date), note: r.note, by: r.reported_by, isDemo: !!r.is_demo }));
}

export async function deleteShortage(access, id) {
  const s = await one(`SELECT * FROM joya_shortages WHERE id=:id`, { id });
  if (!s) throw err('NOT_FOUND', 'not found');
  assertLocation(access, s.location_id);
  await q(`DELETE FROM joya_shortages WHERE id=:id`, { id });
  await audit(access.username, 'SHORTAGE_DELETED', 'shortage', id, s.location_id, { ingredientId: s.ingredient_id, date: ymd(s.reported_date) });
}

export { daysBetween };
