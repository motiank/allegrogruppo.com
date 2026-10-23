// Replenishment: recommendation → manager edits → approved final list → marked as ordered.
// The learning is in ../lib/recommend.js; this file loads its inputs and stores its outputs.
//
// Kept apart, all on the joya_order_lists row (see sql/add-joya.sql):
//   recommendation_json  the system's proposal, never changed
//   lines_json           the working list the manager edits
//   edits_json           every change (who, when, before/after, UI or chat)
//   final_json           frozen at approval;  ordered_json  when marked ordered
import { q, one, tx, err, audit, parseJson, ymd, inList, getSettings, todayLocal, lockRow, nextId } from '../db.js';
import { assertLocation } from '../access.js';
import { recommend, convert, addDays, daysBetween, RECOMMENDER_VERSION } from '../lib/recommend.js';
import * as source from './source.js';
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
    const rec = l.origin === 'RECOMMENDATION' ? (parseJson(l.recommendation_json) || []).filter((r) => r.section === 'SUGGESTED').map((r) => r.ingredientId) : null;
    out.push({
      listId: l.id,
      date: ymd(l.list_date),
      status: l.status,
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
  const menu = await q(`SELECT id, name, recipe_json FROM joya_menu_items WHERE location_id=:l AND active=1 AND recipe_json IS NOT NULL`, { l: locationId });
  const lines = menu.flatMap((m) => (parseJson(m.recipe_json) || []).map((r) => ({ ...r, ingredientId: Number(r.ingredientId), menuItemId: m.id, dish: m.name })));
  const ids = [...new Set(lines.map((l) => l.ingredientId))];
  const ingUnit = ids.length ? new Map((await q(`SELECT id, unit FROM joya_ingredients WHERE id IN (${ids.join(',')})`)).map((i) => [Number(i.id), i.unit])) : new Map();
  const byIng = new Map();
  for (const r of lines) {
    if (!ingUnit.has(r.ingredientId)) continue;
    if (!byIng.has(r.ingredientId)) byIng.set(r.ingredientId, []);
    byIng.get(r.ingredientId).push({ menuItemId: r.menuItemId, dish: r.dish, qty: r.qty == null ? null : Number(r.qty), unit: r.unit || ingUnit.get(r.ingredientId) || null });
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
  const demo = await source.isDemoLocation(locationId);
  const recommendation = result.lines.map((l, i) => ({ id: i + 1, ingredientId: l.ingredientId, section: l.section, qty: l.qty, unit: l.unit, method: l.method, confidence: l.confidence, basis: l.basis }));
  const lines = recommendation
    .filter((r) => r.section !== 'NOT_DUE')
    .map((r, i) => ({ id: i + 1, ingredientId: r.ingredientId, itemText: null, qty: r.qty, unit: r.unit, origin: 'RECOMMENDED', recLineId: r.id, removed: false, note: null, updatedBy: access.username }));
  const listId = (
    await q(
      `INSERT INTO joya_order_lists (location_id, list_date, origin, status, params_json, recommendation_json, lines_json, edits_json, is_demo, created_by)
       VALUES (:l, :d, 'RECOMMENDATION', 'DRAFT', :p, :r, :x, '[]', :demo, :by)`,
      {
        l: locationId,
        d: asOf,
        p: JSON.stringify({ recommenderVersion: RECOMMENDER_VERSION, settings: result.settings, examplesUsed: result.examplesUsed }),
        r: JSON.stringify(recommendation),
        x: JSON.stringify(lines),
        demo: demo ? 1 : 0,
        by: createdBy || access.username,
      },
    )
  ).insertId;
  await audit(access.username, 'ORDER_LIST_GENERATED', 'order_list', listId, locationId, { lines: result.lines.length, examples: result.examplesUsed.length });
  return { listId, existing: false };
}

export async function createManual(access, locationId, date) {
  assertLocation(access, locationId);
  const id = (await q(`INSERT INTO joya_order_lists (location_id, list_date, origin, status, lines_json, edits_json, created_by) VALUES (:l, :d, 'MANUAL', 'DRAFT', '[]', '[]', :by)`, { l: locationId, d: date || todayLocal(), by: access.username })).insertId;
  await audit(access.username, 'ORDER_LIST_CREATED', 'order_list', id, locationId, { origin: 'MANUAL' });
  return { listId: id };
}

export async function listLists(access, { locationIds, status, limit = 60 }) {
  if (!locationIds.length) return [];
  const st = status ? String(status).split(',').filter((s) => ['DRAFT', 'APPROVED', 'ORDERED', 'REJECTED'].includes(s)) : null;
  const locs = inList('loc', locationIds);
  const names = await source.locationNames();
  const rows = await q(
    `SELECT l.id, l.location_id, l.list_date, l.origin, l.status, l.lines_json, l.is_demo, l.created_by, l.approved_by, l.approved_at, l.ordered_by, l.ordered_at
       FROM joya_order_lists l
      WHERE l.location_id IN (${locs.sql}) ${st?.length ? `AND l.status IN (${st.map((s) => `'${s}'`).join(',')})` : ''}
      ORDER BY l.list_date DESC, l.id DESC LIMIT ${Math.min(Math.max(parseInt(limit, 10) || 60, 1), 300)}`,
    locs.params,
  );
  return rows.map((r) => ({
    id: r.id,
    locationId: r.location_id,
    locationName: names.get(r.location_id) ?? null,
    date: ymd(r.list_date),
    origin: r.origin,
    status: r.status,
    lines: (parseJson(r.lines_json) || []).filter((x) => !x.removed).length,
    isDemo: !!r.is_demo,
    createdBy: r.created_by,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at,
    orderedBy: r.ordered_by,
    orderedAt: r.ordered_at,
  }));
}

const ingredientNames = async (ids) => {
  const list = [...new Set(ids.filter((x) => x != null).map(Number))];
  return list.length ? new Map((await q(`SELECT id, name, unit FROM joya_ingredients WHERE id IN (${list.join(',')})`)).map((i) => [Number(i.id), i])) : new Map();
};
const SECTION_ORDER = ['SUGGESTED', 'CHECK', 'NOT_DUE'];

export async function getList(access, id) {
  const l = await one(`SELECT * FROM joya_order_lists WHERE id=:id`, { id });
  if (!l) throw err('NOT_FOUND', 'list not found');
  assertLocation(access, l.location_id);
  const lines = parseJson(l.lines_json) || [];
  const recs = parseJson(l.recommendation_json) || [];
  const ings = await ingredientNames([...lines.map((x) => x.ingredientId), ...recs.map((r) => r.ingredientId)]);
  const recById = new Map(recs.map((r) => [r.id, r]));
  const shaped = lines.map((x) => {
    const rec = x.recLineId ? recById.get(x.recLineId) : null;
    const ing = x.ingredientId != null ? ings.get(Number(x.ingredientId)) : null;
    return {
      id: x.id,
      ingredientId: x.ingredientId ?? null,
      name: ing?.name || x.itemText,
      freeText: x.ingredientId == null,
      qty: x.qty == null ? null : Number(x.qty),
      unit: x.unit || ing?.unit || null,
      origin: x.origin,
      removed: !!x.removed,
      note: x.note,
      recommended: rec ? { qty: rec.qty == null ? null : Number(rec.qty), section: rec.section, method: rec.method, confidence: rec.confidence } : null,
      changed: rec ? !!x.removed || Number(rec.qty ?? NaN) !== Number(x.qty ?? NaN) : true,
      updatedBy: x.updatedBy,
    };
  });
  shaped.sort((a, b) => Number(a.removed) - Number(b.removed) || String(b.origin).localeCompare(String(a.origin)) || String(a.name).localeCompare(String(b.name)) || a.id - b.id);
  return {
    list: {
      id: l.id,
      locationId: l.location_id,
      locationName: (await source.locationNames()).get(l.location_id) ?? null,
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
    lines: shaped,
    recommendation: recs
      .map((r) => ({ id: r.id, ingredientId: r.ingredientId, name: ings.get(Number(r.ingredientId))?.name ?? null, section: r.section, qty: r.qty == null ? null : Number(r.qty), unit: r.unit, method: r.method, confidence: r.confidence, basis: r.basis }))
      .sort((a, b) => SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section) || String(a.name).localeCompare(String(b.name))),
    edits: parseJson(l.edits_json) || [],
  };
}

/**
 * Change one list row inside a transaction under a row lock: fn(row, { lines, addEdit }) may change
 * `lines` and call addEdit({ lineId?, action, before?, after?, note? }); returns the extra columns to set.
 */
async function updateList(access, listId, { via = 'UI' } = {}, fn) {
  await tx(async (c) => {
    const row = await lockRow(c, 'joya_order_lists', listId);
    if (!row) throw err('NOT_FOUND', 'list not found');
    const lines = parseJson(row.lines_json) || [];
    const edits = parseJson(row.edits_json) || [];
    const addEdit = (e) => edits.push({ id: nextId(edits), lineId: null, before: null, after: null, note: null, ...e, via, by: access.username, at: new Date().toISOString() });
    const set = (await fn(row, { lines, addEdit })) || {};
    const cols = { ...set, lines_json: JSON.stringify(lines), edits_json: JSON.stringify(edits) };
    await c.q(`UPDATE joya_order_lists SET ${Object.keys(cols).map((k) => `${k}=:${k}`).join(', ')} WHERE id=:id`, { ...cols, id: listId });
  });
}

const lineSnap = (x) => (x ? { ingredientId: x.ingredientId ?? null, itemText: x.itemText ?? null, qty: x.qty == null ? null : Number(x.qty), unit: x.unit, removed: !!x.removed, note: x.note } : null);

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
  await updateList(access, listId, { via }, (row, { lines, addEdit }) => {
    if (row.status !== 'DRAFT') throw err('CONFLICT', `the list is ${row.status}; reopen it to edit`);
    for (const o of checked) {
      if (o.op === 'add') {
        const id = nextId(lines);
        lines.push({ id, ingredientId: o.ingredientId, itemText: o.ingredientId ? null : o.name, qty: o.qty, unit: o.unit, origin: 'ADDED', recLineId: null, removed: false, note: o.note, updatedBy: access.username });
        addEdit({ lineId: id, action: 'ADD', after: { ingredientId: o.ingredientId, name: o.name, qty: o.qty, unit: o.unit }, note: o.note });
        continue;
      }
      const line = lines.find((l) => l.id === o.lineId);
      if (!line) throw err('BAD_REQUEST', `line ${o.lineId} is not on this list`);
      const before = lineSnap(line);
      if (o.op === 'set_qty') Object.assign(line, { qty: o.qty, removed: false });
      if (o.op === 'remove') line.removed = true;
      if (o.op === 'restore') line.removed = false;
      if (o.op === 'note') line.note = o.note;
      line.updatedBy = access.username;
      const action = { set_qty: 'SET_QTY', remove: 'REMOVE', restore: 'RESTORE', note: 'NOTE' }[o.op];
      addEdit({ lineId: o.lineId, action, before, after: lineSnap(line), note: o.op === 'note' ? null : o.note });
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
  await updateList(access, listId, {}, (row, { addEdit }) => {
    if (row.status !== 'DRAFT') throw err('CONFLICT', `the list is ${row.status}`);
    addEdit({ action: 'APPROVE', after: { lines: final.length }, note: note || null });
    return { status: 'APPROVED', final_json: JSON.stringify(final), approved_by: access.username, approved_at: new Date(), note: note || row.note };
  });
  await audit(access.username, 'ORDER_LIST_APPROVED', 'order_list', listId, list.locationId, { lines: final.length });
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
  await updateList(access, listId, {}, (row, { addEdit }) => {
    if (row.status !== 'APPROVED') throw err('CONFLICT', 'only an approved list can be marked as ordered');
    addEdit({ action: 'MARK_ORDERED', after: { lines: ordered.length, changed: ordered.filter((x) => x.changedAtOrder).length }, note: note || null });
    return { status: 'ORDERED', ordered_json: JSON.stringify(ordered), ordered_by: access.username, ordered_at: new Date(), note: note || row.note };
  });
  await audit(access.username, 'ORDER_LIST_ORDERED', 'order_list', listId, list.locationId, { lines: ordered.length });
  return getList(access, listId);
}

export async function reject(access, listId, { note } = {}) {
  const { list } = await getList(access, listId);
  if (!['DRAFT', 'APPROVED'].includes(list.status)) throw err('CONFLICT', `the list is ${list.status}`);
  await updateList(access, listId, {}, (row, { addEdit }) => {
    addEdit({ action: 'REJECT', note: note || null });
    return { status: 'REJECTED', rejected_by: access.username, rejected_at: new Date(), note: note || row.note };
  });
  await audit(access.username, 'ORDER_LIST_REJECTED', 'order_list', listId, list.locationId, { note });
  return getList(access, listId);
}

export async function reopen(access, listId) {
  const { list } = await getList(access, listId);
  if (list.status !== 'APPROVED') throw err('CONFLICT', 'only an approved (not yet ordered) list can be reopened');
  await updateList(access, listId, {}, (row, { addEdit }) => {
    addEdit({ action: 'REOPEN', before: list.final });
    return { status: 'DRAFT', final_json: null, approved_by: null, approved_at: null };
  });
  await audit(access.username, 'ORDER_LIST_REOPENED', 'order_list', listId, list.locationId, {});
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

/** What was learned per item for one location, computed now from the final lists (nothing stored). */
export async function getPatterns(access, locationId) {
  assertLocation(access, locationId);
  const computedAt = new Date().toISOString();
  const res = recommend(await buildInputs(locationId, todayLocal()));
  const patterns = res.patterns.filter((p) => p.examples || p.suggestedCount);
  const ings = await ingredientNames(patterns.map((p) => p.ingredientId));
  return patterns
    .map((p) => ({ ingredientId: p.ingredientId, name: ings.get(Number(p.ingredientId))?.name ?? null, unit: ings.get(Number(p.ingredientId))?.unit ?? null, examples: p.examples, stats: p, computedAt }))
    .sort((a, b) => b.examples - a.examples || String(a.name).localeCompare(String(b.name)));
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
  const locs = inList('loc', locationIds);
  const names = await source.locationNames();
  const rows = await q(
    `SELECT s.*, i.name AS ing_name FROM joya_shortages s LEFT JOIN joya_ingredients i ON i.id = s.ingredient_id
      WHERE s.location_id IN (${locs.sql}) AND s.reported_date >= :a ORDER BY s.reported_date DESC, s.id DESC`,
    { ...locs.params, a: addDays(todayLocal(), -Math.min(Math.max(parseInt(days, 10) || 30, 1), 365)) },
  );
  return rows.map((r) => ({ id: r.id, locationId: r.location_id, locationName: names.get(r.location_id) ?? null, ingredientId: r.ingredient_id, name: r.ing_name || r.item_text, unmatched: !r.ingredient_id, date: ymd(r.reported_date), note: r.note, by: r.reported_by, isDemo: !!r.is_demo }));
}

export async function deleteShortage(access, id) {
  const s = await one(`SELECT * FROM joya_shortages WHERE id=:id`, { id });
  if (!s) throw err('NOT_FOUND', 'not found');
  assertLocation(access, s.location_id);
  await q(`DELETE FROM joya_shortages WHERE id=:id`, { id });
  await audit(access.username, 'SHORTAGE_DELETED', 'shortage', id, s.location_id, { ingredientId: s.ingredient_id, date: ymd(s.reported_date) });
}

export { daysBetween };
