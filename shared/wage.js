// Shared wage helpers for employee- and role-level wages.
//
// Pure ESM, no dependencies — imported by BOTH the admin server
// (admin/server/modules/payroll.js) and the admin client (Employees.js /
// Shifts.js) so the wage model is defined in exactly one place.
//
// Wage model (the "new" / compound format), used identically at the employee
// level and per role:
//   { new_wage_type: <one of WAGE_TYPE_VALUES | null>, wage: <amount | null> }
//
// Legacy role format was a bare numeric `wage` with no type. normalizeRoleWage()
// upgrades it: a positive number → hourly_gross, the legacy -1 sentinel →
// hourly_min_gross (national minimum).

export const WAGE_TYPE_OPTIONS = [
  { value: "global_gross", label: "Global · Gross" },
  { value: "global_net", label: "Global · Net" },
  { value: "hourly_gross", label: "Hourly · Gross" },
  { value: "hourly_net", label: "Hourly · Net" },
  // Minimum wage per hour + a bonus up to the employee's wage (paid from tips).
  { value: "hourly_min_gross", label: "Tip based" },
  // Removed from the list (owner, 2026-11-02; its employees moved to Tip based). Still a valid value so
  // old saved data reads; the wage dialog offers it only to a row that still has it.
  { value: "hourly_min_net", label: "Hourly min · Net (old)", legacy: true },
];

export const WAGE_TYPE_VALUES = WAGE_TYPE_OPTIONS.map((o) => o.value);

const TYPE_SET = new Set(WAGE_TYPE_VALUES);

export const isValidWageType = (t) => TYPE_SET.has(t);

export const wageTypeLabel = (t) =>
  WAGE_TYPE_OPTIONS.find((o) => o.value === t)?.label || "";

// Normalize one role entry to the compound shape { role, new_wage_type, wage },
// accepting the legacy shape { role, wage:<number> } (no type):
//   • a positive numeric wage → hourly_gross (product decision)
//   • the legacy -1 sentinel  → hourly_min_gross ("national minimum")
//   • no usable wage          → type stays null
// `wage` is preserved as a string|number|null so callers control formatting,
// except the -1 sentinel which is dropped (it carried no real amount).
export function normalizeRoleWage(r) {
  if (!r || typeof r !== "object") return r;
  const role = r.role;
  let new_wage_type = isValidWageType(r.new_wage_type) ? r.new_wage_type : null;
  let wage = r.wage;
  if (!new_wage_type) {
    const n =
      wage === "" || wage == null || !Number.isFinite(Number(wage))
        ? null
        : Number(wage);
    if (n === -1) {
      new_wage_type = "hourly_min_gross";
      wage = null;
    } else if (n != null) {
      new_wage_type = "hourly_gross";
    }
  }
  return { role, new_wage_type, wage };
}

export const normalizeRoles = (roles) =>
  Array.isArray(roles) ? roles.map(normalizeRoleWage) : [];

// Effective hourly rate implied by a compound wage entry, mirroring the
// employee-level logic in payroll.js buildExportRow:
//   • hourly_min_*  → the national minimum
//   • hourly_*      → the wage as-is (gross AND net are paid at the wage rate;
//                     net-ness is conveyed by a separate net flag, not by a
//                     reduced rate)
//   • global_*      → null (no hourly rate; handled as a fixed amount elsewhere)
// Also accepts a legacy bare-number entry (-1 → minimum).
// Returns a finite number, or null when no rate can be derived.
export function effectiveHourlyRate(entry, opts = {}) {
  const minHourlyWage = Number(opts.minHourlyWage) || 35.4;
  const t = entry && entry.new_wage_type;
  const w = entry && entry.wage;
  let num = w === "" || w == null || !Number.isFinite(Number(w)) ? null : Number(w);
  // -1 is the "minimum wage" sentinel — valid for any hourly wage (and legacy
  // bare numbers), so resolve it to the national minimum before anything else.
  if (num === -1) num = minHourlyWage;
  if (t && t.startsWith("hourly_min_")) return minHourlyWage;
  if (t && t.startsWith("hourly_")) return num;
  if (t && t.startsWith("global_")) return null;
  // legacy bare number (no type)
  return num;
}

// Human-readable cell text for a compound wage entry: "120 · Hourly · Gross",
// just the label when there is no amount, or "—" when there is no type.
export function formatWage(entry) {
  const t = entry && entry.new_wage_type;
  if (!t) return "—";
  const label = wageTypeLabel(t);
  const w = entry.wage;
  return w !== "" && w != null ? `${w} · ${label}` : label;
}

// Tip-based pay (hourly_min_*: minimum wage + a bonus from tips) is for these roles only (owner, 2026-11-03).
export const TIP_ROLES = ["מלצר", "בר", "ראנר"];
export const isTipRole = (role) => TIP_ROLES.includes(String(role || "").trim());
export const isTipWageType = (t) => !!t && String(t).startsWith("hourly_min_");
// Roles that can be paid either way (בלת"מ — an unplanned shift): never "wrong wage type".
export const ANY_WAGE_TYPE_ROLES = ['בלת"מ'];

// A role "has its own wage" when its entry gives the pay without the employee's wage: a tip-based or global
// type, or an hourly type with an amount. Otherwise the payroll uses the employee's wage for it.
const hasOwnRoleWage = (r) => {
  const t = r && r.new_wage_type;
  if (!t) return false;
  if (isTipWageType(t) || t.startsWith("global_")) return true;
  return r.wage !== "" && r.wage != null && Number.isFinite(Number(r.wage));
};

// The roles of an employee that use the employee's wage while it is the wrong kind for them: a tip role with a
// default that is not tip based, or another role (e.g. מוקדן) with a tip-based default. Not checked: no
// default wage (that is "missing wage"), a global default (the pay is the global amount, not per hour) and the
// ANY_WAGE_TYPE_ROLES.
// emp: { new_wage_type, roles: [{ role, new_wage_type, wage }] }. Returns [{ role, tipRole }].
export function wrongWageTypeRoles(emp) {
  const def = emp && emp.new_wage_type;
  if (!def || def.startsWith("global_")) return [];
  const defTip = isTipWageType(def);
  return (Array.isArray(emp.roles) ? emp.roles : [])
    .filter((r) => r && String(r.role || "").trim() && !hasOwnRoleWage(r))
    .filter((r) => !ANY_WAGE_TYPE_ROLES.includes(String(r.role).trim()))
    .filter((r) => isTipRole(r.role) !== defTip)
    .map((r) => ({ role: String(r.role).trim(), tipRole: isTipRole(r.role) }));
}
