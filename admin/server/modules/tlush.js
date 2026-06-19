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
  // Hour-based line: quantity = hours, wage = rate. Skipped when no hours.
  const addHours = (code, label, hours, rate) => {
    const q = num(hours);
    if (q == null || q === 0) return;
    comps.push({ code, label, quantity: q, wage: num(rate) ?? 0 });
  };
  // Amount line: quantity = count, wage = amount. Skipped when no amount.
  const addAmount = (code, label, quantity, amount) => {
    const w = num(amount);
    if (w == null || w === 0) return;
    comps.push({ code, label, quantity: num(quantity) ?? 1, wage: w });
  };
  if (row.isGlobal) {
    addAmount(1, "שכר גלובאלי", 1, row.amount);
  } else {
    addHours(1, "שכר יסוד שעתי", row.hours100, row.hourlyWage);
    addHours(38, "שעות 125%", row.hours125, row.wage125);
    addHours(39, "שעות 150%", row.hours150, row.wage150);
    addHours("shabbat", "שבת", row.shabbat, row.hourlyWage);
    addHours("holiday", "חג", row.holiday, row.hourlyWage);
  }
  addAmount(3, "נסיעות", 1, row.travel);
  addAmount(32, "בונוס", 1, row.bonus);
  if (num(row.meals)) addAmount(21, "ארוחות", row.meals, row.mealWorth);
  return comps;
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
    const components = rows.map((r) => ({
      recordType: r.recordType,
      code: r.componentCode,
      label: shikLabel(r.recordType, r.componentCode),
      quantity: r.quantity,
      wage: r.rate,
    }));
    return { ...base, components };
  }

  // Micpal
  return {
    ...base,
    components: decomposeMicComponents(row),
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
