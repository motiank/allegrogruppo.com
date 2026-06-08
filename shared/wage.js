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
  { value: "hourly_min_gross", label: "Hourly min · Gross" },
  { value: "hourly_min_net", label: "Hourly min · Net" },
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
