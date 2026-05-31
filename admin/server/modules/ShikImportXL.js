// Shiklulit (שיקלולית) import-format exporter.
//
// Long-format: one row per payroll component per employee. Header columns:
//   workMonth, employeeNumber, recordType, componentCode, rate, quantity
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

export const SHIK_HEADERS = [
  "workMonth",
  "employeeNumber",
  "recordType",
  "componentCode",
  "rate",
  "quantity",
];

export const SHIK_RECORD_TYPES = {
  SALARY: 1,
  VOLUNTARY_DEDUCTION: 3,
  EMPLOYMENT_DATA: 4,
};

export const SHIK_COMPONENTS = {
  baseHourly: { recordType: 1, componentCode: 1 }, // שכר יסוד שעתי
  overtime125: { recordType: 1, componentCode: 38 }, // שעות 125%
  overtime150: { recordType: 1, componentCode: 39 }, // שעות 150%
  travel: { recordType: 1, componentCode: 3 }, // נסיעות
  bonus: { recordType: 1, componentCode: 32 }, // בונוס
  globalSalary: { recordType: 1, componentCode: 1 }, // שכר גלובאלי
  workDays: { recordType: 4, componentCode: 4 }, // ימי עבודה
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

  if (row.isGlobal) {
    if (amount != null && amount !== 0) emit("globalSalary", amount, 1);
  } else {
    if (hourlyWage != null) {
      if (h100 != null && h100 > 0) emit("baseHourly", hourlyWage, h100);
      if (h125 != null && h125 > 0) emit("overtime125", hourlyWage, h125);
      if (h150 != null && h150 > 0) emit("overtime150", hourlyWage, h150);
    }
  }
  if (travel != null && travel > 0) emit("travel", travel, 1);
  if (bonus != null && bonus > 0) emit("bonus", bonus, 1);
  if (workdays != null && workdays > 0) emit("workDays", 0, workdays);

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
    const ws = wb.addWorksheet("Shiklulit Import");

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
