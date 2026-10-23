// Master data: locations, users, settings, roles, shifts, menu, ingredients, recipes, employees.
// Locations and employees come from Allegro (./source.js); a location id IS the Allegro branch id.
// Joya keeps how Allegro role names map to Joya roles.
import { q, one, err, audit, parseJson, clearSettingsCache, todayLocal, getConfig, updateConfig } from '../db.js';
import { addDays } from '../lib/recommend.js';
import { assertLocation, accessFor } from '../access.js';
import { loadUsers } from '../auth/session.js';
import { normTime } from '../lib/staffingRules.js';
import * as source from './source.js';

// ---------------------------------------------------------------- locations

/** The Allegro branches this user may see, as Joya locations (read from Allegro, nothing stored). */
export async function listLocations(access) {
  return (await source.locations())
    .filter((l) => access.locationIds.includes(l.id))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- users

/** Every Allegro admin user with their Joya access (from the Allegro role; read-only here — users are managed in the admin). */
export async function listUsers() {
  const known = (await source.locations()).map((l) => l.id);
  return loadUsers()
    .filter((u) => u.email)
    .map((u) => {
      const a = u.status === 'active' ? accessFor({ username: u.email, role: u.role, restaurants: Array.isArray(u.restaurants) ? u.restaurants : [] }, known) : null;
      return { username: u.email, allegroRole: u.role, allegroActive: u.status === 'active', role: a?.role ?? null, locationIds: a && !a.isAdmin ? a.locationIds : [], payroll: !!a?.payroll };
    })
    .sort((a, b) => (a.role || 'Z').localeCompare(b.role || 'Z') || a.username.localeCompare(b.username));
}

// ---------------------------------------------------------------- settings

// The numeric settings of the Settings page; the other joya_settings rows are config documents.
const NUMERIC_SETTINGS = ['replenishment', 'staffing', 'labor', 'dataQuality'];

export async function listSettings() {
  const rows = await q(`SELECT * FROM joya_settings WHERE name IN ('${NUMERIC_SETTINGS.join("','")}') ORDER BY name`);
  return Object.fromEntries(rows.map((r) => [r.name, parseJson(r.value_json)]));
}

export async function saveSetting(access, name, value) {
  if (!NUMERIC_SETTINGS.includes(name)) throw err('BAD_REQUEST', `unknown setting ${name}`);
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

const CODE_RE = /^[a-z][a-z0-9_]{0,39}$/;

/** The Joya roles (joya_settings 'roles'). */
export async function listRoles() {
  return [...(await getConfig('roles', []))].sort((a, b) => (a.sort ?? 100) - (b.sort ?? 100) || a.code.localeCompare(b.code));
}

export async function saveRole(access, { code, nameHe, nameEn, sort = 100, active = true }) {
  if (!CODE_RE.test(code || '')) throw err('BAD_REQUEST', 'code: lower-case letters, digits and _');
  if (!nameHe || !nameEn) throw err('BAD_REQUEST', 'names in Hebrew and English are required');
  const role = { code, nameHe, nameEn, sort: Number(sort) || 100, active: !!active };
  await updateConfig('roles', [], access.username, (roles) => [...roles.filter((r) => r.code !== code), role]);
  await audit(access.username, 'ROLE_SAVED', 'role', null, null, role);
}

/** A location's config document (joya_settings 'location:<id>'): its shifts and staffing baseline. */
export const locationConfigName = (locationId) => `location:${locationId}`;
export async function locationConfig(locationId) {
  const cfg = await getConfig(locationConfigName(locationId), {});
  return { shifts: cfg.shifts || [], baseline: cfg.baseline || [] };
}
export async function updateLocationConfig(access, locationId, fn) {
  return updateConfig(locationConfigName(locationId), { shifts: [], baseline: [] }, access.username, async (cfg) => fn({ shifts: [], baseline: [], ...cfg }));
}

// A shift's id is its code (unique within the location).
const shapeShift = (locationId, s) => ({ id: s.code, locationId: String(locationId), code: s.code, name: s.name, days: s.days || [], start: s.start, end: s.end, active: s.active !== false });

export async function listShifts(locationIds) {
  const out = [];
  for (const loc of locationIds) out.push(...(await locationConfig(loc)).shifts.map((s) => shapeShift(loc, s)));
  return out.sort((a, b) => a.locationId.localeCompare(b.locationId) || a.start.localeCompare(b.start));
}

/** Create or change a shift. `id` (the old code) renames it when `code` differs. */
export async function saveShift(access, { id, locationId, code, name, days, start, end, active = true }) {
  assertLocation(access, locationId);
  if (!CODE_RE.test(code || '')) throw err('BAD_REQUEST', 'code: lower-case letters, digits and _');
  if (!Array.isArray(days) || !days.length || days.some((d) => !(d >= 0 && d <= 6))) throw err('BAD_REQUEST', 'days must be a list of 0..6 (0 = Sunday)');
  const s = normTime(start);
  const e = normTime(end);
  if (!s || !e) throw err('BAD_REQUEST', 'start and end must be HH:MM');
  const shift = { code, name: name || code, days: [...new Set(days.map(Number))].sort(), start: s, end: e, active: !!active };
  await updateLocationConfig(access, locationId, (cfg) => {
    if (id && !cfg.shifts.some((x) => x.code === id)) throw err('NOT_FOUND', 'shift not found');
    if (code !== id && cfg.shifts.some((x) => x.code === code)) throw err('CONFLICT', `shift ${code} already exists`);
    return { ...cfg, shifts: [...cfg.shifts.filter((x) => x.code !== (id || code)), shift] };
  });
  await audit(access.username, 'SHIFT_SAVED', 'shift', null, locationId, shift);
  return shapeShift(locationId, shift);
}

// ---------------------------------------------------------------- menu, ingredients, recipes

const recipeOf = (m) => (Array.isArray(parseJson(m.recipe_json)) ? parseJson(m.recipe_json) : []);

export async function listMenu(locationId) {
  const rows = await q(`SELECT * FROM joya_menu_items WHERE location_id = :loc ORDER BY active DESC, category, name`, { loc: locationId });
  return rows.map((r) => {
    const recipe = recipeOf(r);
    return { id: r.id, locationId: r.location_id, code: r.external_code, name: r.name, category: r.category, active: !!r.active, isDemo: !!r.is_demo, ingredients: recipe.length, ingredientsWithoutQty: recipe.filter((l) => l.qty == null).length };
  });
}

export async function saveMenuItem(access, { id, locationId, code, name, category = null, active = true }) {
  assertLocation(access, locationId);
  if (!code || !name) throw err('BAD_REQUEST', 'code and name are required');
  if (id) {
    const prev = await one(`SELECT location_id FROM joya_menu_items WHERE id=:id`, { id });
    if (!prev || prev.location_id !== String(locationId)) throw err('NOT_FOUND', 'menu item not found');
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

/** How many dishes use each ingredient, over every menu item's recipe_json. */
async function dishCounts() {
  const counts = new Map();
  for (const m of await q(`SELECT recipe_json FROM joya_menu_items WHERE recipe_json IS NOT NULL`)) {
    for (const id of new Set(recipeOf(m).map((l) => Number(l.ingredientId)))) counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
}

export async function listIngredients({ search } = {}) {
  const rows = await q(`SELECT * FROM joya_ingredients ${search ? 'WHERE name LIKE :s OR code LIKE :s' : ''} ORDER BY active DESC, category, name`, search ? { s: `%${search}%` } : {});
  const counts = await dishCounts();
  return rows.map((r) => ({ ...shapeIngredient(r), dishes: counts.get(Number(r.id)) || 0 }));
}
export const shapeIngredient = (r) => ({ id: r.id, code: r.code, name: r.name, unit: r.unit, category: r.category, active: !!r.active, isDemo: !!r.is_demo });

export async function saveIngredient(access, { id, code = null, name, unit = null, category = null, active = true }) {
  if (!name) throw err('BAD_REQUEST', 'name is required');
  const p = { id, code: code || null, name: String(name).trim(), unit: unit || null, cat: category || null, a: active ? 1 : 0 };
  if (id) await q(`UPDATE joya_ingredients SET code=:code, name=:name, unit=:unit, category=:cat, active=:a WHERE id=:id`, p);
  else id = (await q(`INSERT INTO joya_ingredients (code, name, unit, category, active) VALUES (:code, :name, :unit, :cat, :a)`, p)).insertId;
  await audit(access.username, 'INGREDIENT_SAVED', 'ingredient', id, null, { code, name, unit, active });
  return shapeIngredient(await one(`SELECT * FROM joya_ingredients WHERE id=:id`, { id }));
}

export async function getRecipe(access, menuItemId) {
  const m = await one(`SELECT * FROM joya_menu_items WHERE id=:id`, { id: menuItemId });
  if (!m) throw err('NOT_FOUND', 'menu item not found');
  assertLocation(access, m.location_id);
  const recipe = recipeOf(m);
  const ings = recipe.length ? new Map((await q(`SELECT id, name, unit FROM joya_ingredients WHERE id IN (${recipe.map((l) => Number(l.ingredientId)).join(',')})`)).map((i) => [Number(i.id), i])) : new Map();
  return {
    item: { id: m.id, locationId: m.location_id, code: m.external_code, name: m.name, category: m.category, isDemo: !!m.is_demo },
    lines: recipe
      .map((l) => ({ ingredientId: Number(l.ingredientId), name: ings.get(Number(l.ingredientId))?.name ?? null, qty: l.qty ?? null, unit: l.unit ?? null, ingredientUnit: ings.get(Number(l.ingredientId))?.unit ?? null }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name))),
  };
}

/** Replace a dish's ingredient list. qty is optional per line. */
export async function saveRecipe(access, menuItemId, lines) {
  const m = await one(`SELECT * FROM joya_menu_items WHERE id=:id`, { id: menuItemId });
  if (!m) throw err('NOT_FOUND', 'menu item not found');
  assertLocation(access, m.location_id);
  if (!Array.isArray(lines)) throw err('BAD_REQUEST', 'lines must be a list');
  const byIng = new Map();
  for (const l of lines) {
    const ingredientId = Number(l.ingredientId);
    if (!Number.isFinite(ingredientId)) throw err('BAD_REQUEST', 'every line needs ingredientId');
    const qty = l.qty === '' || l.qty == null ? null : Number(l.qty);
    if (qty != null && !(qty > 0)) throw err('BAD_REQUEST', 'qty must be > 0 or empty');
    byIng.set(ingredientId, { ingredientId, qty, unit: l.unit || null });
  }
  const clean = [...byIng.values()];
  if (clean.length) {
    const known = new Set((await q(`SELECT id FROM joya_ingredients WHERE id IN (${clean.map((l) => l.ingredientId).join(',')})`)).map((r) => Number(r.id)));
    const missing = clean.filter((l) => !known.has(l.ingredientId));
    if (missing.length) throw err('BAD_REQUEST', `unknown ingredient ${missing.map((l) => l.ingredientId).join(', ')}`);
  }
  await q(`UPDATE joya_menu_items SET recipe_json=:r WHERE id=:id`, { r: JSON.stringify(clean), id: menuItemId });
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
  const saved = await getConfig('roleAliases', {});
  const names = new Set([...seen.keys(), ...Object.keys(saved)]);
  return [...names]
    .map((alias) => ({ alias, roleCode: saved[alias] ?? null, employees: seen.get(alias) || 0 }))
    .sort((a, b) => b.employees - a.employees || a.alias.localeCompare(b.alias));
}

export async function saveRoleAlias(access, { alias, roleCode = null }) {
  const a = String(alias || '').trim().replace(/\s+/g, ' ');
  if (!a || a.length > 80) throw err('BAD_REQUEST', 'alias is required (at most 80 characters)');
  if (roleCode != null && roleCode !== '' && !(await listRoles()).some((r) => r.code === roleCode)) throw err('BAD_REQUEST', `unknown role ${roleCode}`);
  await updateConfig('roleAliases', {}, access.username, (map) => ({ ...map, [a]: roleCode || null }));
  source.clearAliasCache();
  await audit(access.username, 'ROLE_ALIAS_SAVED', 'role_alias', null, null, { alias: a, roleCode: roleCode || null });
}
