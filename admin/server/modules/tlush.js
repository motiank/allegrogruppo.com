// Tlush (תלוש) — the payroll-software-converted representation of an employee's
// pay, "the way it gets printed". It is the SOURCE OF TRUTH for the export file:
// once saved it is what the Micpal/Shiklulit xlsx is rendered from.
//
// Shape (per employee):
//   { payrollSoft, employeeNumber, ID_nmbr, name,
//     components: [ { recordType?, code, label, quantity, wage } ],
//     micRow? }            // wide Micpal row, present only for payrollSoft "mic"
//
// - Shiklulit: `components` ARE the long-format rows (one per component); the
//   export rebuilds the rows from them 1:1 (tlushToShikRows).
// - Micpal: `components` is a friendly breakdown for display; the export uses the
//   stored `micRow` verbatim (tlushToMicRow) so the file round-trips exactly.

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

// Micpal display breakdown — each meaningful column becomes a {code,label,
// quantity,wage} line. Mirrors the exporter's "blank cells are skipped" rule.
const decomposeMicComponents = (row) => {
  const comps = [];
  const isNet = NET_WAGE_KINDS.has(row.netKind);
  // Hour-based line: quantity = hours, wage = rate. Skipped when no hours.
  const addHours = (code, label, hours, rate) => {
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
  const addAmount = (code, label, quantity, amount) => {
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
  // PREVIEW-ONLY rate grouping: Micpal's real xlsx (MicpImportXL.js) has
  // exactly one hourly-rate column set per employee — row.hours100/125/150
  // already sums every role into that one rate. Here, for the on-screen
  // breakdown only, split by each role's OWN rate (row.roleBreakdown, already
  // computed for the Shiklulit exporter): the group matching the row's own
  // default rate keeps the existing "שכר יסוד שעתי" labels/codes; every other
  // distinct rate becomes an "extra" group ("שכר נוסף שעתי" / "שעות נ. X%",
  // code 31 like Shiklulit's "other rate" convention). mixedRates flags when
  // this happened, so the caller can warn that the real Micpal file won't
  // reflect the split (it still exports the merged single-rate totals).
  let mixedRates = false;
  if (row.isGlobal) {
    addAmount(1, "שכר גלובאלי", 1, row.amount);
  } else {
    const breakdown = Array.isArray(row.roleBreakdown) ? row.roleBreakdown : [];
    if (breakdown.length > 0) {
      const byRate = new Map();
      for (const r of breakdown) {
        const key = r.rate == null ? "null" : String(r.rate);
        if (!byRate.has(key)) {
          byRate.set(key, { rate: r.rate, h100: 0, h125: 0, h150: 0 });
        }
        const g = byRate.get(key);
        g.h100 += Number(r.h100) || 0;
        g.h125 += Number(r.h125) || 0;
        g.h150 += Number(r.h150) || 0;
      }
      const defaultKey = row.hourlyWage == null ? "null" : String(row.hourlyWage);
      const primary = byRate.get(defaultKey) || null;
      byRate.delete(defaultKey);
      const extras = [...byRate.values()];
      mixedRates = extras.length > 0;

      addHours(1, "שכר יסוד שעתי", primary?.h100, row.hourlyWage);
      addHours(38, "שעות 125%", primary?.h125, row.hourlyWage != null ? row.hourlyWage * 1.25 : null);
      addHours(39, "שעות 150%", primary?.h150, row.hourlyWage != null ? row.hourlyWage * 1.5 : null);
      extras.forEach((g, i) => {
        const suffix = i === 0 ? "" : ` ${i + 1}`;
        addHours(31, `שכר נוסף שעתי${suffix}`, g.h100, g.rate);
        addHours(38, `שעות נ. 125%${suffix}`, g.h125, g.rate != null ? g.rate * 1.25 : null);
        addHours(39, `שעות נ. 150%${suffix}`, g.h150, g.rate != null ? g.rate * 1.5 : null);
      });
    } else {
      // No per-role breakdown available — fall back to the merged totals.
      addHours(1, "שכר יסוד שעתי", row.hours100, row.hourlyWage);
      addHours(38, "שעות 125%", row.hours125, row.wage125);
      addHours(39, "שעות 150%", row.hours150, row.wage150);
    }
    addHours("shabbat", "שבת", row.shabbat, row.hourlyWage);
    addHours("holiday", "חג", row.holiday, row.hourlyWage);
  }
  addAmount(3, "נסיעות", 1, row.travel);
  addAmount(32, "בונוס", 1, row.bonus);
  if (num(row.meals)) addAmount(21, "ארוחות", row.meals, row.mealWorth);
  return { comps, mixedRates };
};

// Build the tlush for one employee. `row` is a buildExportRow() result.
export function buildTlush(row, payrollSoft, { workMonth } = {}) {
  const employeeNumber = row.keyName ? Number(row.keyName) : null;
  const base = {
    payrollSoft,
    employeeNumber,
    ID_nmbr: row.ID_nmbr || "",
    name: row.name || "",
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
  const { comps, mixedRates } = decomposeMicComponents(row);
  return {
    ...base,
    components: comps,
    // The on-screen breakdown split this employee's hours by role rate, but
    // the real Micpal xlsx (micRow, below) has no second-rate column and
    // still exports everything merged into one rate.
    mixedRates,
    micRow: pickMicRow(row),
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

// tlush → Micpal wide row (consumed by MicpImportXL.generate). The exact row was
// stored at build time, so this is verbatim.
export function tlushToMicRow(tlush) {
  return tlush.micRow || {};
}

export { SHIK_COMPONENT_LABELS, SHIK_COMPONENTS };
