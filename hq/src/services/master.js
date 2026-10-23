// Master data: locations, users, settings, roles, shifts, menu, ingredients, recipes, employees.
// Locations and employees come from Allegro (./source.js); Joya keeps the link rows, which
// locations are active here, and how Allegro role names map to Joya roles.
import { q, one, err, audit, parseJson, inList, clearSettingsCache, hms, todayLocal } from '../db.js';
import { addDays } from '../lib/recommend.js';
import { assertLocation, accessFor } from '../access.js';
import { loadUsers } from '../auth/session.js';
import { normTime } from '../lib/staffingRules.js';
import * as source from './source.js';

// ---------------------------------------------------------------- locations

/** The Allegro branches this user may see, as Joya locations (link rows are made on first sight). */
export async function listLocations(access) {
  const rows = await q(`SELECT * FROM joya_locations WHERE allegro_branch_id IS NOT NULL ORDER BY active DESC, name`);
  const companies = await source.branchCompanies();
  return rows.filter((r) => access.isAdmin || access.locationIds.includes(r.id)).map((r) => shapeLocation(r, companies));
}
// company: the Allegro company the branch belongs to (null when Allegro cannot be reached).
// The demo restaurants are not real Allegro branches, so they always sit in the demo company
// (the same one scripts/demo-defs.mjs gives the fake API).
export const DEMO_COMPANY = { key: 'demo', label: 'חברת דמו' };
const shapeLocation = (r, companies) => ({
  id: r.id,
  code: r.code,
  name: r.name,
  branchId: r.allegro_branch_id,
  active: !!r.active,
  isDemo: !!r.is_demo,
  company: r.is_demo ? DEMO_COMPANY : (companies?.get(r.allegro_branch_id) ?? null),
});

/** Names and branches come from Allegro; here the admin only says whether Joya works with a location. */
export async function upsertLocation(access, { id, active = true }) {
  const prev = id ? await one(`SELECT * FROM joya_locations WHERE id=:id AND allegro_branch_id IS NOT NULL`, { id }) : null;
  if (!prev) throw err('BAD_REQUEST', 'locations come from the Allegro branches; only an existing location can be switched on or off');
  await q(`UPDATE joya_locations SET active=:a WHERE id=:id`, { id, a: active ? 1 : 0 });
  await audit(access.username, 'LOCATION_SAVED', 'location', id, id, { active });
  return shapeLocation(await one(`SELECT * FROM joya_locations WHERE id=:id`, { id }), await source.branchCompanies());
}

// ---------------------------------------------------------------- users

/** Every Allegro admin user with their Joya access (from the Allegro role; read-only here — users are managed in the admin). */
export async function listUsers() {
  const linked = await q(`SELECT id, allegro_branch_id FROM joya_locations WHERE allegro_branch_id IS NOT NULL`);
  return loadUsers()
    .filter((u) => u.email)
    .map((u) => {
      const a = u.status === 'active' ? accessFor({ username: u.email, role: u.role, restaurants: Array.isArray(u.restaurants) ? u.restaurants : [] }, linked) : null;
      return { username: u.email, allegroRole: u.role, allegroActive: u.status === 'active', role: a?.role ?? null, locationIds: a && !a.isAdmin ? a.locationIds : [], payroll: !!a?.payroll };
    })
    .sort((a, b) => (a.role || 'Z').localeCompare(b.role || 'Z') || a.username.localeCompare(b.username));
}

// ---------------------------------------------------------------- settings

export async function listSettings() {
  const rows = await q(`SELECT * FROM joya_settings ORDER BY name`);
  return Object.fromEntries(rows.map((r) => [r.name, parseJson(r.value_json)]));
}

export async function saveSetting(access, name, value) {
  const known = ['replenishment', 'staffing', 'labor', 'dataQuality'];
  if (!known.includes(name)) throw err('BAD_REQUEST', `unknown setting ${name}`);
  if (!value || typeof value !== 'object') throw err('BAD_REQUEST', 'value must be an object');
  for (const [k, v] of Object.entries(value)) if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw err('BAD_REQUEST', `${k} must be a number ≥ 0`);
  await q(`INSERT INTO joya_settings (name, value_json, updated_by) VALUES (:n, :v, :by) ON DUPLICATE KEY UPDATE value_json=VALUES(value_json), updated_by=VALUES(updated_by)`, {
    n: name,
    v: JSON.stringify(value),
    by: access.username,
  });
  clearSettingsCache();
  await audit(access.username, 'SETTING_SAVED', 'setting', null, null, { name, value });
}

// ---------------------------------------------------------------- roles and shifts

export async function listRoles() {
  return (await q(`SELECT * FROM joya_staff_roles ORDER BY sort, code`)).map((r) => ({ code: r.code, nameHe: r.name_he, nameEn: r.name_en, sort: r.sort, active: !!r.active }));
}

export async function saveRole(access, { code, nameHe, nameEn, sort = 100, active = true }) {
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(code || '')) throw err('BAD_REQUEST', 'code: lower-case letters, digits and _');
  if (!nameHe || !nameEn) throw err('BAD_REQUEST', 'names in Hebrew and English are required');
  await q(
    `INSERT INTO joya_staff_roles (code, name_he, name_en, sort, active) VALUES (:c, :he, :en, :s, :a)
     ON DUPLICATE KEY UPDATE name_he=VALUES(name_he), name_en=VALUES(name_en), sort=VALUES(sort), active=VALUES(active)`,
    { c: code, he: nameHe, en: nameEn, s: sort, a: active ? 1 : 0 },
  );
  await audit(access.username, 'ROLE_SAVED', 'role', null, null, { code, nameHe, nameEn, active });
}

export const shapeShift = (r) => ({ id: r.id, locationId: r.location_id, code: r.code, name: r.name, days: parseJson(r.days_json) || [], start: hms(r.start_time), end: hms(r.end_time), active: !!r.active });

export async function listShifts(locationIds) {
  if (!locationIds.length) return [];
  const l = inList('l', locationIds);
  return (await q(`SELECT * FROM joya_shift_defs WHERE location_id IN (${l.sql}) ORDER BY location_id, start_time`, l.params)).map(shapeShift);
}

export async function saveShift(access, { id, locationId, code, name, days, start, end, active = true }) {
  assertLocation(access, locationId);
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(code || '')) throw err('BAD_REQUEST', 'code: lower-case letters, digits and _');
  if (!Array.isArray(days) || !days.length || days.some((d) => !(d >= 0 && d <= 6))) throw err('BAD_REQUEST', 'days must be a list of 0..6 (0 = Sunday)');
  const s = normTime(start);
  const e = normTime(end);
  if (!s || !e) throw err('BAD_REQUEST', 'start and end must be HH:MM');
  const p = { id, loc: locationId, code, name: name || code, days: JSON.stringify([...new Set(days.map(Number))].sort()), s, e, a: active ? 1 : 0 };
  if (id) {
    const prev = await one(`SELECT location_id FROM joya_shift_defs WHERE id=:id`, { id });
    if (!prev) throw err('NOT_FOUND', 'shift not found');
    assertLocation(access, prev.location_id);
    await q(`UPDATE joya_shift_defs SET code=:code, name=:name, days_json=:days, start_time=:s, end_time=:e, active=:a WHERE id=:id`, p);
  } else {
    id = (await q(`INSERT INTO joya_shift_defs (location_id, code, name, days_json, start_time, end_time, active) VALUES (:loc, :code, :name, :days, :s, :e, :a)`, p)).insertId;
  }
  await audit(access.username, 'SHIFT_SAVED', 'shift', id, locationId, { code, days, start: s, end: e, active });
  return shapeShift(await one(`SELECT * FROM joya_shift_defs WHERE id=:id`, { id }));
}

// ---------------------------------------------------------------- menu, ingredients, recipes

export async function listMenu(locationId) {
  const rows = await q(
    `SELECT m.*, (SELECT COUNT(*) FROM joya_recipe_lines r WHERE r.menu_item_id = m.id) AS ing_count,
            (SELECT COUNT(*) FROM joya_recipe_lines r WHERE r.menu_item_id = m.id AND r.qty IS NULL) AS ing_no_qty
       FROM joya_menu_items m WHERE m.location_id = :loc ORDER BY m.active DESC, m.category, m.name`,
    { loc: locationId },
  );
  return rows.map((r) => ({ id: r.id, locationId: r.location_id, code: r.external_code, name: r.name, category: r.category, active: !!r.active, isDemo: !!r.is_demo, ingredients: Number(r.ing_count), ingredientsWithoutQty: Number(r.ing_no_qty) }));
}

export async function saveMenuItem(access, { id, locationId, code, name, category = null, active = true }) {
  assertLocation(access, locationId);
  if (!code || !name) throw err('BAD_REQUEST', 'code and name are required');
  if (id) {
    const prev = await one(`SELECT location_id FROM joya_menu_items WHERE id=:id`, { id });
    if (!prev || prev.location_id !== Number(locationId)) throw err('NOT_FOUND', 'menu item not found');
    await q(`UPDATE joya_menu_items SET external_code=:code, name=:name, category=:cat, active=:a WHERE id=:id`, { id, code, name, cat: category, a: active ? 1 : 0 });
  } else {
    id = (
      await q(
        `INSERT INTO joya_menu_items (location_id, external_code, name, category, active) VALUES (:loc, :code, :name, :cat, :a)
         ON DUPLICATE KEY UPDATE name=VALUES(name), category=VALUES(category), active=VALUES(active), id=LAST_INSERT_ID(id)`,
        { loc: locationId, code, name, cat: category, a: active ? 1 : 0 },
      )
    ).insertId;
  }
  await audit(access.username, 'MENU_ITEM_SAVED', 'menu_item', id, locationId, { code, name, active });
  return id;
}

export async function listIngredients({ search } = {}) {
  const rows = await q(
    `SELECT i.*, (SELECT COUNT(*) FROM joya_recipe_lines r WHERE r.ingredient_id = i.id) AS dish_count
       FROM joya_ingredients i ${search ? 'WHERE i.name LIKE :s OR i.code LIKE :s' : ''} ORDER BY i.active DESC, i.category, i.name`,
    search ? { s: `%${search}%` } : {},
  );
  return rows.map(shapeIngredient);
}
export const shapeIngredient = (r) => ({ id: r.id, code: r.code, name: r.name, unit: r.unit, category: r.category, active: !!r.active, isDemo: !!r.is_demo, dishes: r.dish_count == null ? undefined : Number(r.dish_count) });

export async function saveIngredient(access, { id, code = null, name, unit = null, category = null, active = true }) {
  if (!name) throw err('BAD_REQUEST', 'name is required');
  const p = { id, code: code || null, name: String(name).trim(), unit: unit || null, cat: category || null, a: active ? 1 : 0 };
  if (id) await q(`UPDATE joya_ingredients SET code=:code, name=:name, unit=:unit, category=:cat, active=:a WHERE id=:id`, p);
  else id = (await q(`INSERT INTO joya_ingredients (code, name, unit, category, active) VALUES (:code, :name, :unit, :cat, :a)`, p)).insertId;
  await audit(access.username, 'INGREDIENT_SAVED', 'ingredient', id, null, { code, name, unit, active });
  return shapeIngredient(await one(`SELECT * FROM joya_ingredients WHERE id=:id`, { id }));
}

/** Find an ingredient by code, then by exact name; create it when allowed. */
export async function resolveIngredient({ code, name, unit }, { create = true, isDemo = 0 } = {}) {
  if (code) {
    const r = await one(`SELECT * FROM joya_ingredients WHERE code=:c`, { c: code });
    if (r) return r;
  }
  if (name) {
    const r = await one(`SELECT * FROM joya_ingredients WHERE name=:n ORDER BY id LIMIT 1`, { n: String(name).trim() });
    if (r) return r;
  }
  if (!create || !name) return null;
  const id = (await q(`INSERT INTO joya_ingredients (code, name, unit, is_demo) VALUES (:c, :n, :u, :d)`, { c: code || null, n: String(name).trim(), u: unit || null, d: isDemo })).insertId;
  return one(`SELECT * FROM joya_ingredients WHERE id=:id`, { id });
}

export async function getRecipe(access, menuItemId) {
  const m = await one(`SELECT * FROM joya_menu_items WHERE id=:id`, { id: menuItemId });
  if (!m) throw err('NOT_FOUND', 'menu item not found');
  assertLocation(access, m.location_id);
  const lines = await q(
    `SELECT r.*, i.name, i.unit AS ing_unit FROM joya_recipe_lines r JOIN joya_ingredients i ON i.id = r.ingredient_id WHERE r.menu_item_id=:id ORDER BY i.name`,
    { id: menuItemId },
  );
  return {
    item: { id: m.id, locationId: m.location_id, code: m.external_code, name: m.name, category: m.category, isDemo: !!m.is_demo },
    lines: lines.map((l) => ({ id: l.id, ingredientId: l.ingredient_id, name: l.name, qty: l.qty == null ? null : Number(l.qty), unit: l.unit, ingredientUnit: l.ing_unit })),
  };
}

/** Replace a dish's ingredient list. qty is optional per line. */
export async function saveRecipe(access, menuItemId, lines) {
  const m = await one(`SELECT * FROM joya_menu_items WHERE id=:id`, { id: menuItemId });
  if (!m) throw err('NOT_FOUND', 'menu item not found');
  assertLocation(access, m.location_id);
  if (!Array.isArray(lines)) throw err('BAD_REQUEST', 'lines must be a list');
  const clean = [];
  for (const l of lines) {
    const ingId = Number(l.ingredientId);
    if (!Number.isFinite(ingId)) throw err('BAD_REQUEST', 'every line needs ingredientId');
    const qty = l.qty === '' || l.qty == null ? null : Number(l.qty);
    if (qty != null && !(qty > 0)) throw err('BAD_REQUEST', 'qty must be > 0 or empty');
    clean.push({ ingId, qty, unit: l.unit || null });
  }
  await q(`DELETE FROM joya_recipe_lines WHERE menu_item_id=:id`, { id: menuItemId });
  for (const l of clean) {
    await q(`INSERT INTO joya_recipe_lines (menu_item_id, ingredient_id, qty, unit) VALUES (:m, :i, :q, :u) ON DUPLICATE KEY UPDATE qty=VALUES(qty), unit=VALUES(unit)`, {
      m: menuItemId,
      i: l.ingId,
      q: l.qty,
      u: l.unit,
    });
  }
  await audit(access.username, 'RECIPE_SAVED', 'menu_item', menuItemId, m.location_id, { lines: clean.length });
  return getRecipe(access, menuItemId);
}

// ---------------------------------------------------------------- employees (Allegro)

/** Employees of the locations, from Allegro. Wages only with payroll access. Edited in Allegro, not here. */
export async function listEmployees(access, locationIds) {
  return (await source.employees(locationIds)).map((e) => ({
    id: e.id,
    name: e.name,
    locationId: e.locationId,
    roleCode: e.roleCode,
    roleNames: e.roleNames,
    hourlyWage: access.payroll ? e.hourlyWage : undefined,
    wageType: access.payroll ? e.wageType : undefined,
    contractor: e.contractor,
    active: e.active,
    isDemo: false,
    externalIds: [{ source: 'ALLEGRO', externalId: String(e.id) }],
  }));
}

/** Tabit clock rows of the last 35 days that Allegro could not match to an employee (by name). */
export async function unmatchedEmployeeIds(locationIds) {
  const to = todayLocal();
  const from = addDays(to, -35);
  const groups = new Map();
  for (const loc of locationIds) {
    for (const r of (await source.rawShifts(loc, from, to)).filter((x) => x.employeeId == null)) {
      const k = `${loc}|${r.employeeName}`;
      const g = groups.get(k) || { source: 'TABIT', externalId: r.employeeName, locationId: loc, rows_: 0, first_: r.date, last_: r.date };
      g.rows_++;
      if (r.date < g.first_) g.first_ = r.date;
      if (r.date > g.last_) g.last_ = r.date;
      groups.set(k, g);
    }
  }
  return [...groups.values()];
}

// ---------------------------------------------------------------- role names (Allegro → Joya)

/** Every Allegro role name seen in the employees of the locations, with its Joya role (null = not mapped). */
export async function listRoleAliases(locationIds) {
  const seen = new Map();
  for (const e of await source.employees(locationIds)) for (const n of e.roleNames) seen.set(n, (seen.get(n) || 0) + 1);
  const saved = new Map((await q(`SELECT * FROM joya_role_aliases`)).map((r) => [r.alias, r]));
  const names = new Set([...seen.keys(), ...saved.keys()]);
  return [...names]
    .map((alias) => ({ alias, roleCode: saved.get(alias)?.role_code ?? null, employees: seen.get(alias) || 0, updatedBy: saved.get(alias)?.updated_by ?? null }))
    .sort((a, b) => b.employees - a.employees || a.alias.localeCompare(b.alias));
}

export async function saveRoleAlias(access, { alias, roleCode = null }) {
  const a = String(alias || '').trim().replace(/\s+/g, ' ');
  if (!a || a.length > 80) throw err('BAD_REQUEST', 'alias is required (at most 80 characters)');
  if (roleCode != null && roleCode !== '' && !(await one(`SELECT code FROM joya_staff_roles WHERE code=:c`, { c: roleCode }))) throw err('BAD_REQUEST', `unknown role ${roleCode}`);
  await q(`INSERT INTO joya_role_aliases (alias, role_code, updated_by) VALUES (:a, :r, :u) ON DUPLICATE KEY UPDATE role_code=VALUES(role_code), updated_by=VALUES(updated_by)`, { a, r: roleCode || null, u: access.username });
  source.clearAliasCache();
  await audit(access.username, 'ROLE_ALIAS_SAVED', 'role_alias', null, null, { alias: a, roleCode: roleCode || null });
}
