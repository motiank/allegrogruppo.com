// Tlush (תלוש) — the payroll-software-converted representation of an employee's
// pay, "the way it gets printed". It is the SOURCE OF TRUTH for the export file:
// once saved it is what the Micpal/Shiklulit xlsx is rendered from.
//
// Shape (per employee):
//   { payrollSoft, employeeNumber, ID_nmbr, name,
//     components: [ { recordType?, code, label, quantity, wage } ],
//     micRows? }           // 1-2 wide Micpal rows, present only for payrollSoft "mic"
//
// - Shiklulit: `components` ARE the long-format rows (one per component); the
//   export rebuilds the rows from them 1:1 (tlushToShikRows).
// - Micpal: `components` is a friendly breakdown for display; the export uses the
//   stored `micRows` verbatim (tlushToMicRows, flatMapped) so the file round-trips
//   exactly. 2 rows (same employee number — Micpal sums them) when the employee
//   has a genuine second rate; see buildMicRows.

import {
  buildShikRowsForEmployee,
  SHIK_COMPONENTS,
} from "./ShikImportXL.js";

// Component labels keyed by `${recordType}:${componentCode}`.
const SHIK_COMPONENT_LABELS = {
  "1:1": "שכר יסוד שעתי",
  "1:31": "שכר שעתי בתעריף אחר",
  "1:33": "שכר מתלמד",
  "1:38": "שעות 125%",
  "1:39": "שעות 150%",
  "1:3": "נסיעות",
  "1:32": "בונוס",
  "2:21": "שווי ארוחות",
  "3:21": "מפרעה מטיפים",
  "4:4": "ימי עבודה משולמים",
  "4:7": "ימי עבודה בפועל",
  "4:5": "שעות עבודה בפועל",
};

const shikLabel = (recordType, code) =>
  SHIK_COMPONENT_LABELS[`${recordType}:${code}`] || `רכיב ${code}`;

const num = (v) => {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// נטו/ברוטו classification per component: the wage-rate components (base
// salary/role-rate variants, overtime, shabbat, holiday) are נטו only when
// the row's resolved wage type is exactly hourly_net or global_net —
// hourly_min_net does NOT count as נטו here (it's still shown as ברוטו).
// Everything else (travel, bonus, meals, prepayment, attendance) is always
// ברוטו. Codes are shared between the Micpal and Shiklulit component sets
// (1 base/global, 31 other role rate, 33 trainee, 38/39 overtime,
// "shabbat"/"holiday").
const WAGE_RATE_COMPONENT_CODES = new Set([1, 31, 33, 38, 39, "shabbat", "holiday"]);
const NET_WAGE_KINDS = new Set(["hourly_net", "global_net"]);
const componentNetGross = (code, isNet) =>
  WAGE_RATE_COMPONENT_CODES.has(code) ? (isNet ? "net" : "gross") : "gross";

// The subset of buildExportRow fields the Micpal exporter consumes (kept on the
// tlush so the export can be regenerated verbatim).
const MIC_ROW_FIELDS = [
  "keyName",
  "ID_nmbr",
  "vacation",
  "hourlyWage",
  "workdays",
  "hours100",
  "wage125",
  "hours125",
  "wage150",
  "hours150",
  "hoursSum",
  "shabbat",
  "holiday",
  "amount",
  "net",
  "travel",
  "completion",
  "bonus",
  "standardDays",
  "standardHours",
  "inAdvance",
  "meals",
  "mealWorth",
];

const pickMicRow = (row) => {
  const out = {};
  for (const k of MIC_ROW_FIELDS) out[k] = row[k];
  return out;
};

// Group a list of {rate, h100, h125, h150} entries by real rate, summed and
// sorted by total hours descending (most hours first).
function groupByRate(entries) {
  const byRate = new Map();
  for (const r of entries) {
    const key = r.rate == null ? "null" : String(r.rate);
    if (!byRate.has(key)) {
      byRate.set(key, { rate: r.rate, h100: 0, h125: 0, h150: 0 });
    }
    const g = byRate.get(key);
    g.h100 += Number(r.h100) || 0;
    g.h125 += Number(r.h125) || 0;
    g.h150 += Number(r.h150) || 0;
  }
  return [...byRate.values()].sort(
    (a, b) => b.h100 + b.h125 + b.h150 - (a.h100 + a.h125 + a.h150),
  );
}

// Split an employee's per-role hours (row.roleBreakdown) into up to 4 real,
// unblended rate groups: NET and GROSS can never share a Micpal row (one נטו
// flag per row), and only a role whose resolved wage type is exactly
// "hourly_net" counts as net (hourly_min_net does not — matches
// NET_WAGE_KINDS/componentNetGross below; everything non-wage-rate — travel,
// bonus, meals, מפרעה — is always gross regardless). Within EACH of the
// net/gross buckets, group by real rate and keep at most 2 (the real Micpal
// row format only has room for 2 rate slots per row) — any further distinct
// rate in a bucket is excluded and returned in `excludedRateGroups` for the
// caller to report (not paid through the automated export — needs manual
// handling). Shared by both the readable תלוש breakdown and the actual
// Micpal row builder (buildMicRows) so the two always show/pay the exact
// same numbers.
function splitRoleBreakdown(roleBreakdown) {
  const netGroups = groupByRate(roleBreakdown.filter((r) => r.isNet));
  const grossGroups = groupByRate(roleBreakdown.filter((r) => !r.isNet));
  const netKept = netGroups.slice(0, 2).map((g) => ({ ...g, isNet: true }));
  const grossKept = grossGroups.slice(0, 2).map((g) => ({ ...g, isNet: false }));
  const excludedRateGroups = [
    ...netGroups.slice(2).map((g) => ({ ...g, isNet: true })),
    ...grossGroups.slice(2).map((g) => ({ ...g, isNet: false })),
  ].map((g) => ({
    rate: g.rate,
    h100: g.h100,
    h125: g.h125,
    h150: g.h150,
    hours: g.h100 + g.h125 + g.h150,
    isNet: g.isNet,
  }));
  return { netKept, grossKept, excludedRateGroups };
}

// Micpal display breakdown — each meaningful column becomes a {code,label,
// quantity,wage} line. Mirrors the exporter's "blank cells are skipped" rule.
const decomposeMicComponents = (row) => {
  const comps = [];
  // Hour-based line: quantity = hours, wage = rate. Skipped when no hours.
  const addHours = (code, label, hours, rate, isNet) => {
    const q = num(hours);
    if (q == null || q === 0) return;
    comps.push({
      code,
      label,
      quantity: q,
      wage: num(rate) ?? 0,
      netGross: componentNetGross(code, isNet),
    });
  };
  // Amount line: quantity = count, wage = amount. Skipped when no amount.
  const addAmount = (code, label, quantity, amount, isNet = false) => {
    const w = num(amount);
    if (w == null || w === 0) return;
    comps.push({
      code,
      label,
      quantity: num(quantity) ?? 1,
      wage: w,
      netGross: componentNetGross(code, isNet),
    });
  };
  // Split by each role's OWN real rate AND net/gross status (row.roleBreakdown,
  // already computed for the Shiklulit exporter and now ALSO used verbatim by
  // the actual Micpal row builder, buildMicRows below — so this breakdown and
  // the real export always show/pay the exact same rates, never a blended
  // number). Within each net/gross bucket, the group with the most hours
  // keeps the "שכר יסוד שעתי" labels/codes; the next-most becomes the "extra"
  // group ("שכר נוסף שעתי" / "שעות נ. X%", code 31 like Shiklulit's "other
  // rate" convention). mixedRates flags when this employee needs more than
  // one row. A 3rd+ distinct rate within a bucket is excluded from both this
  // breakdown and the real export, returned as `excludedRateGroups` so the
  // caller can report it (needs manual handling).
  let mixedRates = false;
  let excludedRateGroups = [];
  if (row.isGlobal) {
    const isNet = NET_WAGE_KINDS.has(row.netKind);
    addAmount(1, "שכר גלובאלי", 1, row.amount, isNet);
  } else {
    const breakdown = Array.isArray(row.roleBreakdown) ? row.roleBreakdown : [];
    if (breakdown.length > 0) {
      const { netKept, grossKept, excludedRateGroups: excl } =
        splitRoleBreakdown(breakdown);
      excludedRateGroups = excl;
      mixedRates = netKept.length + grossKept.length > 1;

      const addGroup = (g, isFirstOfBucket, isNet) => {
        const code = isFirstOfBucket ? 1 : 31;
        const label = isFirstOfBucket ? "שכר יסוד שעתי" : "שכר נוסף שעתי";
        addHours(code, label, g.h100, g.rate, isNet);
        addHours(
          38,
          isFirstOfBucket ? "שעות 125%" : "שעות נ. 125%",
          g.h125,
          g.rate != null ? g.rate * 1.25 : null,
          isNet,
        );
        addHours(
          39,
          isFirstOfBucket ? "שעות 150%" : "שעות נ. 150%",
          g.h150,
          g.rate != null ? g.rate * 1.5 : null,
          isNet,
        );
      };
      netKept.forEach((g, i) => addGroup(g, i === 0, true));
      grossKept.forEach((g, i) => addGroup(g, i === 0, false));
    } else {
      // No per-role breakdown available — fall back to the merged totals.
      const isNet = NET_WAGE_KINDS.has(row.netKind);
      addHours(1, "שכר יסוד שעתי", row.hours100, row.hourlyWage, isNet);
      addHours(38, "שעות 125%", row.hours125, row.wage125, isNet);
      addHours(39, "שעות 150%", row.hours150, row.wage150, isNet);
    }
    // שבת/חג aren't tracked per role, so there's no per-hour net/gross split
    // available for them — always gross, same as travel/bonus/meals below.
    addHours("shabbat", "שבת", row.shabbat, row.hourlyWage, false);
    addHours("holiday", "חג", row.holiday, row.hourlyWage, false);
  }
  addAmount(3, "נסיעות", 1, row.travel);
  addAmount(32, "בונוס", 1, row.bonus);
  if (num(row.meals)) addAmount(21, "ארוחות", row.meals, row.mealWorth);
  return { comps, mixedRates, excludedRateGroups };
};

// Employee-level (non-role) fields that must appear on only ONE of an
// employee's Micpal rows — Micpal sums rows sharing a מס עובד (employee
// number), so putting these on every row would double-count them.
const MIC_ROW_SHARED_ONLY_FIELDS = [
  "vacation",
  "workdays",
  "shabbat",
  "holiday",
  "amount",
  "travel",
  "completion",
  "bonus",
  "standardDays",
  "standardHours",
  "inAdvance",
  "meals",
  "mealWorth",
];

// Build the actual Micpal row(s) for one employee — real, unblended rates
// only. Up to 4 rows are emitted (see splitRoleBreakdown: net/gross × up to
// 2 rates each), all carrying the SAME מס עובד/keyName; Micpal sums rows
// sharing an employee number, so a genuine second rate — or a net/gross
// split, which can never share Micpal's single נטו flag per row — becomes a
// genuine extra row instead of a synthetic blended rate or a wrongly-flagged
// net/gross mix. A 3rd+ distinct rate within a bucket is excluded here too
// (not exported at all — needs manual handling, reported via the tlush's own
// excludedRateGroups since it's computed from the same grouping).
//
// The employee-level fields (travel, bonus, meals, מפרעה, workdays,
// vacation, standard days/hours, שבת/חג) are always gross (only explicitly
// hourly_net wage-rate hours — or a global_net salary — are net), so they're
// only ever put on the FIRST GROSS row — or, for a purely net-paid employee
// with no gross-typed hours at all, a dedicated zero-hours gross row created
// just to carry them.
function buildMicRows(row) {
  const shared = pickMicRow(row);
  const blankShared = Object.fromEntries(
    MIC_ROW_SHARED_ONLY_FIELDS.map((k) => [k, ""]),
  );
  if (row.isGlobal) {
    if (shared.net !== "נ") return [shared];
    // Global NET salary (amount) can't share a row with the always-gross
    // shared fields (travel/meals/bonus/etc) — split into a net amount-only
    // row and a gross row for everything else.
    return [
      { ...shared, ...blankShared, amount: shared.amount, net: "נ" },
      { ...shared, amount: "", net: "" },
    ];
  }
  const breakdown = Array.isArray(row.roleBreakdown) ? row.roleBreakdown : [];
  if (breakdown.length === 0) return [shared];

  const { netKept, grossKept } = splitRoleBreakdown(breakdown);
  const rateRow = (g, isNet, carriesShared) => ({
    ...(carriesShared ? shared : { ...shared, ...blankShared }),
    hourlyWage: g?.rate ?? "",
    hours100: g?.h100 || "",
    wage125: g?.rate != null && g.h125 ? g.rate * 1.25 : "",
    hours125: g?.h125 || "",
    wage150: g?.rate != null && g.h150 ? g.rate * 1.5 : "",
    hours150: g?.h150 || "",
    hoursSum: g ? (g.h100 || 0) + (g.h125 || 0) + (g.h150 || 0) || "" : "",
    net: isNet ? "נ" : "",
  });

  const rows = netKept.map((g) => rateRow(g, true, false));
  if (grossKept.length > 0) {
    grossKept.forEach((g, i) => rows.push(rateRow(g, false, i === 0)));
  } else {
    // Purely net-paid employee — still need one gross row for travel/bonus/
    // meals/etc.
    rows.push(rateRow(null, false, true));
  }
  return rows;
}

// Build the tlush for one employee. `row` is a buildExportRow() result.
export function buildTlush(row, payrollSoft, { workMonth } = {}) {
  const employeeNumber = row.keyName ? Number(row.keyName) : null;
  const base = {
    payrollSoft,
    employeeNumber,
    ID_nmbr: row.ID_nmbr || "",
    name: row.name || "",
    // Gross pay from hourly-min (tip-based) roles at their real effective
    // rate (national minimum + bonus top-up) — shown in the תלוש view next
    // to the employee's total gross.
    hourlyMinGross: Number(row.hourlyMinGross) || 0,
  };

  if (payrollSoft === "shik") {
    const rows = buildShikRowsForEmployee(workMonth, {
      ...row,
      employeeNumber,
    });
    const isNet = NET_WAGE_KINDS.has(row.netKind);
    const components = rows.map((r) => ({
      recordType: r.recordType,
      code: r.componentCode,
      label: shikLabel(r.recordType, r.componentCode),
      quantity: r.quantity,
      wage: r.rate,
      netGross: componentNetGross(r.componentCode, isNet),
    }));
    return { ...base, components };
  }

  // Micpal
  const { comps, mixedRates, excludedRateGroups } = decomposeMicComponents(row);
  return {
    ...base,
    components: comps,
    // Whether this employee has a genuine second rate — now reflected as a
    // real second Micpal row (see micRows/buildMicRows), not just a display
    // split, so this is informational rather than a "won't be reflected"
    // warning.
    mixedRates,
    // Rate groups beyond the 2 supported slots (base + one other) — excluded
    // from both `comps` and the real Micpal export, reported here so the
    // caller can flag them for manual handling.
    excludedRateGroups,
    // 1 or 2 rows (same מס עובד on both when 2) — see buildMicRows.
    micRows: buildMicRows(row),
  };
}

// tlush → Shiklulit rows (consumed by ShikImportXL.generate-style writers).
export function tlushToShikRows(tlush, workMonth) {
  return (tlush.components || []).map((c) => ({
    workMonth,
    employeeNumber: tlush.employeeNumber,
    recordType: c.recordType,
    componentCode: c.code,
    rate: c.wage,
    quantity: c.quantity,
  }));
}

// tlush → Micpal wide row(s) (consumed by MicpImportXL.generate). 1 or 2 rows
// per employee (see buildMicRows) — callers should flatMap, not map.
export function tlushToMicRows(tlush) {
  return tlush.micRows || [];
}

export { SHIK_COMPONENT_LABELS, SHIK_COMPONENTS };
