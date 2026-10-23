// File imports and manual entry, for what Allegro does not have: the menu (until it comes from
// the API — postponed), recipes and old order lists. Sales, employees, attendance and payroll are
// read from the Allegro API (./source.js) and cannot be imported. Every import is a
// joya_import_batches row: who, when, which file, which mapping, how many rows were accepted and
// why others were not.
import { q, one, err, audit, parseJson } from '../db.js';
import { assertLocation } from '../access.js';
import { parseCsv } from '../lib/csv.js';
import { KINDS, applyMapping, suggestMapping } from '../lib/fields.js';
import { resolveIngredient } from './master.js';

const MAX_ROWS = 200_000;
// lib/fields.js still describes the other kinds (its parsers are tested); they are not importable
export const IMPORTABLE = ['MENU', 'RECIPES', 'ORDER_HISTORY'];
function kindSpec(kind) {
  if (!IMPORTABLE.includes(kind)) throw err('BAD_REQUEST', KINDS[kind] ? `${kind} comes from the Allegro API, it is not imported` : `unknown kind ${kind}`);
  return KINDS[kind];
}

export function describeKinds(access) {
  return Object.entries(KINDS)
    .filter(([key]) => IMPORTABLE.includes(key))
    .filter(([, k]) => !k.payroll || access.payroll)
    .map(([key, k]) => ({ kind: key, sources: k.sources, needsLocation: k.needsLocation, oneOf: k.oneOf || [], fields: k.fields.filter((f) => !f.payroll || access.payroll) }));
}

/** Step 1: read the file, return its columns, a sample, and a suggested (or saved) mapping. */
export async function preview(access, { kind, source, csv }) {
  const spec = kindSpec(kind);
  if (spec.payroll && !access.payroll) throw err('FORBIDDEN', 'payroll access only');
  const { headers, rows } = parseCsv(csv);
  if (!headers.length) throw err('BAD_REQUEST', 'the file is empty');
  const saved = await one(`SELECT mapping_json FROM joya_import_mappings WHERE source=:s AND kind=:k`, { s: source, k: kind });
  const savedMap = parseJson(saved?.mapping_json);
  const usable = savedMap && Object.values(savedMap).every((col) => !col || headers.includes(col));
  return { headers, rowCount: rows.length, sample: rows.slice(0, 5), mapping: usable ? savedMap : suggestMapping(kind, headers), mappingFrom: usable ? 'saved' : 'suggested' };
}

/**
 * Step 2: import with the confirmed mapping.
 * @param {object} p { kind, source, locationId?, csv?, rows?, mapping, dateOrder?, fileName?, saveMapping? }
 *        `rows` (already keyed by target field names, mapping = identity) is the manual-entry path.
 */
export async function runImport(access, p) {
  const { kind, source = 'MANUAL', locationId = null, mapping = {}, dateOrder = 'DMY', fileName = null, saveMapping = true } = p;
  const spec = kindSpec(kind);
  if (!spec.sources.includes(source)) throw err('BAD_REQUEST', `${kind} cannot come from ${source}`);
  if (spec.payroll && !access.payroll) throw err('FORBIDDEN', 'payroll access only');
  if (spec.needsLocation) {
    if (!locationId) throw err('BAD_REQUEST', 'choose the location this file belongs to');
    assertLocation(access, locationId);
  } else if (!access.isAdmin && !locationId) {
    throw err('BAD_REQUEST', 'choose a location');
  }

  let rows;
  let map = mapping;
  if (Array.isArray(p.rows)) {
    rows = p.rows;
    map = Object.fromEntries(spec.fields.map((f) => [f.key, f.key]));
  } else {
    rows = parseCsv(p.csv || '').rows;
  }
  if (!rows.length) throw err('BAD_REQUEST', 'no rows');
  if (rows.length > MAX_ROWS) throw err('BAD_REQUEST', `too many rows (${rows.length}); split the file (max ${MAX_ROWS})`);
  const { records, rejected } = applyMapping(kind, rows, map, { dateOrder });

  const batchId = (
    await q(
      `INSERT INTO joya_import_batches (source, kind, location_id, file_name, mapping_json, created_by) VALUES (:s, :k, :l, :f, :m, :by)`,
      { s: source, k: kind, l: locationId, f: fileName, m: JSON.stringify(map), by: access.username },
    )
  ).insertId;

  const ctx = { access, source, locationId, batchId, rejected };
  const writer = WRITERS[kind];
  const result = await writer(records, ctx);
  const dates = records.map((r) => r.business_date || r.list_date || (r.period ? `${r.period}-01` : null)).filter(Boolean).sort();
  await q(
    `UPDATE joya_import_batches SET row_count=:n, rejected_count=:r, errors_json=:e, period_from=:a, period_to=:b WHERE id=:id`,
    { id: batchId, n: result.written, r: rejected.length, e: JSON.stringify(rejected.slice(0, 50)), a: dates[0] || null, b: dates[dates.length - 1] || null },
  );
  if (saveMapping && !Array.isArray(p.rows)) {
    await q(`INSERT INTO joya_import_mappings (source, kind, mapping_json, updated_by) VALUES (:s, :k, :m, :by) ON DUPLICATE KEY UPDATE mapping_json=VALUES(mapping_json), updated_by=VALUES(updated_by)`, {
      s: source,
      k: kind,
      m: JSON.stringify(map),
      by: access.username,
    });
  }
  await audit(access.username, 'IMPORT', 'import_batch', batchId, locationId, { kind, source, written: result.written, rejected: rejected.length, fileName });
  return { batchId, written: result.written, rejected: rejected.length, errors: rejected.slice(0, 50), notes: result.notes || [] };
}

export async function listBatches(access, { locationIds, limit = 50 }) {
  const rows = await q(
    `SELECT * FROM joya_import_batches ORDER BY id DESC LIMIT ${Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200)}`,
  );
  return rows
    .filter((r) => r.location_id == null ? access.isAdmin : locationIds.includes(r.location_id))
    .filter((r) => r.kind !== 'PAYROLL' || access.payroll)
    .map((r) => ({
      id: r.id,
      source: r.source,
      kind: r.kind,
      locationId: r.location_id,
      fileName: r.file_name,
      rows: r.row_count,
      rejected: r.rejected_count,
      errors: parseJson(r.errors_json) || [],
      from: r.period_from ? r.period_from.toISOString().slice(0, 10) : null,
      to: r.period_to ? r.period_to.toISOString().slice(0, 10) : null,
      isDemo: !!r.is_demo,
      by: r.created_by,
      at: r.created_at,
    }));
}

/** Undo an import: delete the rows it wrote (source data only; decisions stay). */
export async function deleteBatch(access, batchId) {
  const b = await one(`SELECT * FROM joya_import_batches WHERE id=:id`, { id: batchId });
  if (!b) throw err('NOT_FOUND', 'import not found');
  if (b.location_id) assertLocation(access, b.location_id);
  else if (!access.isAdmin) throw err('FORBIDDEN', 'chain admin only');
  if (b.kind === 'PAYROLL' && !access.payroll) throw err('FORBIDDEN', 'payroll access only');
  const tables = { MENU: 'joya_menu_items' };
  const t = tables[b.kind];
  if (!t) throw err('BAD_REQUEST', `an import of ${b.kind} cannot be undone here; edit the data instead`);
  if (b.kind === 'MENU') {
    // the dishes go, with their recipe lines (sales in Allegro keep their dish id and lose the link)
    await q(`DELETE r FROM joya_recipe_lines r JOIN joya_menu_items m ON m.id = r.menu_item_id WHERE m.import_batch_id=:id`, { id: batchId });
  }
  const r = await q(`DELETE FROM ${t} WHERE import_batch_id=:id`, { id: batchId });
  await q(`UPDATE joya_import_batches SET row_count=0, errors_json=JSON_ARRAY('undone') WHERE id=:id`, { id: batchId });
  await audit(access.username, 'IMPORT_UNDONE', 'import_batch', batchId, b.location_id, { kind: b.kind, deleted: r.affectedRows });
  return { deleted: r.affectedRows };
}

// ---------------------------------------------------------------- writers, one per kind

const WRITERS = {
  async MENU(records, { locationId, batchId }) {
    let written = 0;
    for (const r of records) {
      await q(
        `INSERT INTO joya_menu_items (location_id, external_code, name, category, active, import_batch_id) VALUES (:l, :c, :n, :cat, :a, :b)
         ON DUPLICATE KEY UPDATE name=VALUES(name), category=VALUES(category), active=VALUES(active)`,
        { l: locationId, c: r.item_code, n: r.name, cat: r.category, a: r.active === false ? 0 : 1, b: batchId },
      );
      written++;
    }
    return { written };
  },

  async RECIPES(records, { locationId, rejected }) {
    let written = 0;
    for (const [i, r] of records.entries()) {
      const m = await one(`SELECT id FROM joya_menu_items WHERE location_id=:l AND external_code=:c`, { l: locationId, c: r.item_code });
      if (!m) {
        rejected.push({ line: i + 2, field: 'item_code', reason: `no menu item with code ${r.item_code} at this location — import the menu first` });
        continue;
      }
      const ing = await resolveIngredient({ code: r.ingredient_code, name: r.ingredient_name, unit: r.ingredient_unit }, { create: !!r.ingredient_name });
      if (!ing) {
        rejected.push({ line: i + 2, field: 'ingredient_code', reason: `unknown ingredient code ${r.ingredient_code}` });
        continue;
      }
      await q(`INSERT INTO joya_recipe_lines (menu_item_id, ingredient_id, qty, unit) VALUES (:m, :i, :q, :u) ON DUPLICATE KEY UPDATE qty=VALUES(qty), unit=VALUES(unit)`, {
        m: m.id,
        i: ing.id,
        q: r.qty,
        u: r.unit,
      });
      written++;
    }
    return { written };
  },




  async ORDER_HISTORY(records, { access, locationId, rejected }) {
    // One HISTORICAL_IMPORT list per date: learning examples from before this system.
    const byDate = new Map();
    for (const r of records) {
      if (!byDate.has(r.list_date)) byDate.set(r.list_date, []);
      byDate.get(r.list_date).push(r);
    }
    let written = 0;
    for (const [date, lines] of byDate) {
      const exists = await one(`SELECT id FROM joya_order_lists WHERE location_id=:l AND list_date=:d AND origin='HISTORICAL_IMPORT'`, { l: locationId, d: date });
      if (exists) {
        rejected.push({ line: 0, reason: `a historical list for ${date} already exists (list ${exists.id}) — skipped` });
        continue;
      }
      const finalLines = [];
      for (const r of lines) {
        const ing = await resolveIngredient({ code: r.ingredient_code, name: r.ingredient_name, unit: r.unit }, { create: !!r.ingredient_name });
        if (!ing) continue;
        finalLines.push({ ingredientId: ing.id, name: ing.name, qty: r.qty, unit: r.unit || ing.unit });
      }
      const listId = (
        await q(
          `INSERT INTO joya_order_lists (location_id, list_date, origin, status, final_json, ordered_json, created_by, approved_by, approved_at, ordered_by, ordered_at)
           VALUES (:l, :d, 'HISTORICAL_IMPORT', 'ORDERED', :f, :f, :by, :by, NOW(), :by, NOW())`,
          { l: locationId, d: date, f: JSON.stringify(finalLines), by: access.username },
        )
      ).insertId;
      for (const fl of finalLines) {
        await q(`INSERT INTO joya_order_list_lines (list_id, ingredient_id, qty, unit, origin, updated_by) VALUES (:id, :i, :q, :u, 'ADDED', :by)`, { id: listId, i: fl.ingredientId, q: fl.qty, u: fl.unit, by: access.username });
      }
      written += finalLines.length;
    }
    return { written, notes: [{ code: 'PATTERNS_REFRESH' }] };
  },
};
