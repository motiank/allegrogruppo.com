// Shiklulit (שיקלולית) import-format exporter.
//
// Long-format: one row per payroll component per employee. Header columns use
// the Hebrew field names from Tamal's import spec
// (ייבוא-נתוני-נוכחות-מאקסל-לשיקלולית), in this order:
//   חודש עבודה, מספר עובד, סוג רשומה, קוד רכיב, תעריף, כמות
//
// Record types:
//   1 = salary components
//   3 = voluntary deductions  (unused right now)
//   4 = absences / employment data
//
// All component codes live in SHIK_COMPONENTS so callers can read the mapping
// without touching the row-emitting code below.

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs");

// Column header labels, in order. Hebrew field names per Tamal's Shiklulit
// import spec. The data rows are written positionally (getCell(1..6)), so these
// strings only drive the displayed header row.
export const SHIK_HEADERS = [
  "חודש עבודה", // workMonth
  "מספר עובד", // employeeNumber
  "סוג רשומה", // recordType
  "קוד רכיב", // componentCode
  "תעריף", // rate
  "כמות", // quantity
];

export const SHIK_RECORD_TYPES = {
  SALARY: 1,
  VOLUNTARY_DEDUCTION: 3,
  EMPLOYMENT_DATA: 4,
};

export const SHIK_COMPONENTS = {
  baseHourly: { recordType: 1, componentCode: 1 }, // שכר יסוד שעתי (default wage)
  baseExtra: { recordType: 1, componentCode: 31 }, // שכר שעתי בתעריף אחר (non-default role rate)
  baseTrainee: { recordType: 1, componentCode: 33 }, // שכר מתלמד
  overtime125: { recordType: 1, componentCode: 38 }, // שעות 125%
  overtime150: { recordType: 1, componentCode: 39 }, // שעות 150%
  travel: { recordType: 1, componentCode: 3 }, // נסיעות
  bonus: { recordType: 1, componentCode: 32 }, // בונוס
  inAdvance: { recordType: 1, componentCode: 35 }, // מפרעה
  globalSalary: { recordType: 1, componentCode: 1 }, // שכר גלובאלי
  // recordType 4 = employment data. These codes are NOT salary components —
  // they are fixed attendance codes from Tamal's Shiklulit import spec.
  paidWorkDays: { recordType: 4, componentCode: 4 }, // ימי עבודה משולמים
  actualWorkDays: { recordType: 4, componentCode: 7 }, // ימי עבודה בפועל
  actualWorkHours: { recordType: 4, componentCode: 5 }, // שעות עבודה בפועל
};

const toFiniteNumber = (v) => {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Build the Siklulit rows for a single employee given the shared per-employee
// row shape produced by buildExportRow() in payroll.js (hourlyWage, h100, h125,
// h150, travelAmount, bonus, amount, workdays, isGlobal, ...).
//
// Empty/zero rows are dropped: each component is emitted only when it has a
// non-zero rate AND a non-zero quantity (mirrors the Micpal exporter's
// `... || ""` skips for empty cells).
export const buildShikRowsForEmployee = (workMonth, row) => {
  const employeeNumber = toFiniteNumber(row.employeeNumber);
  if (employeeNumber == null) {
    throw new Error(
      `missing employeeNumber for "${row.name || "(no name)"}" — file row will be dropped`,
    );
  }
  const out = [];
  const emit = (compKey, rate, quantity) => {
    const r = toFiniteNumber(rate);
    const q = toFiniteNumber(quantity);
    if (r == null || q == null) return;
    if (r === 0 && q === 0) return;
    const { recordType, componentCode } = SHIK_COMPONENTS[compKey];
    out.push({
      workMonth,
      employeeNumber,
      recordType,
      componentCode,
      rate: r,
      quantity: q,
    });
  };

  const hourlyWage = toFiniteNumber(row.hourlyWage);
  const h100 = toFiniteNumber(row.hours100);
  const h125 = toFiniteNumber(row.hours125);
  const h150 = toFiniteNumber(row.hours150);
  const travel = toFiniteNumber(row.travel);
  const bonus = toFiniteNumber(row.bonus);
  const amount = toFiniteNumber(row.amount);
  // Prefer the raw count (always populated). Falls back to row.workdays so
  // direct callers that don't go through buildExportRow still work.
  const workdays = toFiniteNumber(
    row.workdaysRaw != null ? row.workdaysRaw : row.workdays,
  );
  // recordType=4 employment data. actualWorkDays (distinct worked dates) and
  // actualWorkHours (clocked hours, NOT the paid 100/125/150 bands) come from
  // buildExportRow's derivation. A null here means the source data was absent,
  // so the value couldn't be calculated — reject it rather than silently
  // exporting a 0 (a real 0 stays a finite number and is just dropped below).
  const actualWorkDays = toFiniteNumber(row.actualWorkDays);
  const actualWorkHours = toFiniteNumber(row.actualWorkHours);
  if (actualWorkDays == null) {
    throw new Error(
      `cannot calculate actualWorkDays for "${row.name || "(no name)"}" — missing distinct-worked-dates source`,
    );
  }
  if (actualWorkHours == null) {
    throw new Error(
      `cannot calculate actualWorkHours for "${row.name || "(no name)"}" — missing actual-worked-hours source`,
    );
  }

  if (row.isGlobal) {
    if (amount != null && amount !== 0) emit("globalSalary", amount, 1);
  } else if (Array.isArray(row.roleBreakdown) && row.roleBreakdown.length > 0) {
    // Base 100% component per role:
    //   • role "מתלמד"                  → 33 (baseTrainee), per role
    //   • role rate == employee default → 1  (baseHourly), ALL merged into one
    //     line (hours summed; overtime merged too, at the default rate)
    //   • any other rate                → 31 (baseExtra), per role
    // Non-default overtime keeps codes 38/39 at the role's own rate.
    const defaultWage = toFiniteNumber(row.defaultWage);
    const sameRate = (a, b) =>
      a != null && b != null && Math.abs(a - b) < 0.001;

    // Accumulate the default-wage (non-trainee) roles into one bucket.
    let def = null; // { h100, h125, h150 }
    const others = [];
    for (const rb of row.roleBreakdown) {
      const rate = toFiniteNumber(rb.rate);
      if (rate == null) continue;
      const isTrainee = String(rb.role || "").trim() === "מתלמד";
      const rh100 = toFiniteNumber(rb.h100) || 0;
      const rh125 = toFiniteNumber(rb.h125) || 0;
      const rh150 = toFiniteNumber(rb.h150) || 0;
      if (!isTrainee && sameRate(rate, defaultWage)) {
        if (!def) def = { h100: 0, h125: 0, h150: 0 };
        def.h100 += rh100;
        def.h125 += rh125;
        def.h150 += rh150;
      } else {
        others.push({ isTrainee, rate, rh100, rh125, rh150 });
      }
    }

    // Merged default line(s) first.
    if (def && defaultWage != null) {
      if (def.h100 > 0) emit("baseHourly", defaultWage, def.h100);
      if (def.h125 > 0) emit("overtime125", defaultWage, def.h125);
      if (def.h150 > 0) emit("overtime150", defaultWage, def.h150);
    }
    // Then the per-role non-default lines (trainee → 33, other rate → 31).
    for (const o of others) {
      const baseComp = o.isTrainee ? "baseTrainee" : "baseExtra";
      if (o.rh100 > 0) emit(baseComp, o.rate, o.rh100);
      if (o.rh125 > 0) emit("overtime125", o.rate, o.rh125);
      if (o.rh150 > 0) emit("overtime150", o.rate, o.rh150);
    }
  } else if (hourlyWage != null) {
    // Legacy fallback: single aggregated base/OT at the employee wage.
    if (h100 != null && h100 > 0) emit("baseHourly", hourlyWage, h100);
    if (h125 != null && h125 > 0) emit("overtime125", hourlyWage, h125);
    if (h150 != null && h150 > 0) emit("overtime150", hourlyWage, h150);
  }
  if (travel != null && travel > 0) emit("travel", travel, 1);
  if (bonus != null && bonus > 0) emit("bonus", bonus, 1);
  // מפרעה (advance) — exported when it has any non-zero value. For employees
  // with an hourly_min role the value is computed (shikInAdvance) and overrides
  // any stored/manual in_advance; otherwise the stored value is used.
  const inAdvance =
    row.shikInAdvance != null
      ? toFiniteNumber(row.shikInAdvance)
      : toFiniteNumber(row.inAdvance);
  if (inAdvance != null && inAdvance !== 0) emit("inAdvance", inAdvance, 1);
  // Employment-data rows (recordType 4). Emitted in spec order: paid days,
  // actual days, actual hours. Zero quantities are dropped (emit's zero-row
  // skip), matching the existing paid-work-days behavior.
  if (workdays != null && workdays > 0) emit("paidWorkDays", 0, workdays);
  if (actualWorkDays > 0) emit("actualWorkDays", 0, actualWorkDays);
  if (actualWorkHours > 0) emit("actualWorkHours", 0, actualWorkHours);

  return out;
};

class ShikImportXL {
  constructor({ year, month }) {
    this.year = year || "";
    this.month = month || "";
  }

  // employees: array of per-employee row shapes from buildExportRow().
  // Returns the xlsx as a Buffer.
  async generate(employees) {
    const workMonth = toFiniteNumber(this.month);
    if (workMonth == null || workMonth < 1 || workMonth > 12) {
      throw new Error(
        `invalid workMonth ${JSON.stringify(this.month)} — expected 1..12`,
      );
    }

    const allRows = [];
    for (const emp of employees) {
      const rows = buildShikRowsForEmployee(workMonth, emp);
      for (const r of rows) allRows.push(r);
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = "allegro-payroll";
    wb.created = new Date();
    const ws = wb.addWorksheet("Shiklulit Import", {
      views: [{ rightToLeft: true }],
    });

    SHIK_HEADERS.forEach((h, i) => (ws.getColumn(i + 1).width = 16));

    const headerRow = ws.getRow(1);
    SHIK_HEADERS.forEach((h, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = h;
      cell.font = { bold: true };
      cell.alignment = { horizontal: "center" };
      cell.border = { bottom: { style: "thin" } };
    });

    // workMonth / employeeNumber / recordType / componentCode → integer.
    // rate / quantity → 2-decimal.
    [1, 2, 3, 4].forEach((c) => (ws.getColumn(c).numFmt = "0"));
    [5, 6].forEach((c) => (ws.getColumn(c).numFmt = "0.00"));

    for (let i = 0; i < allRows.length; i++) {
      const r = allRows[i];
      const row = ws.getRow(2 + i);
      row.getCell(1).value = r.workMonth;
      row.getCell(2).value = r.employeeNumber;
      row.getCell(3).value = r.recordType;
      row.getCell(4).value = r.componentCode;
      row.getCell(5).value = r.rate;
      row.getCell(6).value = r.quantity;
    }

    return wb.xlsx.writeBuffer();
  }
}

export default ShikImportXL;
