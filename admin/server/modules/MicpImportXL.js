import { createRequire } from "module";
const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs");

class MicpImportXL {
  constructor({ company, year, month, department }) {
    this.company = company || "";
    this.year = year || "";
    this.month = month || "";
    this.department = department || "";
  }

  async generate(employees) {
    const wb = new ExcelJS.Workbook();
    wb.creator = "allegro-payroll";
    wb.created = new Date();
    const ws = wb.addWorksheet("דיווח", {
      views: [{ state: "frozen", ySplit: 4, rightToLeft: true }],
    });

    ws.getColumn(1).width = 14;
    ws.getColumn(2).width = 24;
    ws.getColumn(3).width = 14;
    ws.getColumn(4).width = 14;
    ws.getColumn(5).width = 14;
    ws.getColumn(6).width = 14;
    ws.getColumn(7).width = 14;
    ws.getColumn(8).width = 14;
    ws.getColumn(9).width = 14;
    ws.getColumn(10).width = 14;
    ws.getColumn(11).width = 14;
    ws.getColumn(12).width = 14;
    ws.getColumn(13).width = 14;
    ws.getColumn(14).width = 14;

    // Row 1: labels
    const r1 = ws.getRow(1);
    r1.getCell(1).value = "חברה";
    r1.getCell(2).value = "שנת מס";
    r1.getCell(3).value = "חודש דיווח";
    r1.font = { bold: true };

    // Row 2: values
    const r2 = ws.getRow(2);
    r2.getCell(1).value = this.company;
    r2.getCell(2).value = this.year;
    r2.getCell(3).value = this.month;

    // Row 3: empty

    // Row 4: column headers
    const headers = [
      "מס עובד",
      "תז",
      "ניצול חופש",
      "שכר שעתי",
      "ימי עבודה",
      "שעות 100%",
      "שעות 125%",
      "שעות 150%",
      "שבת",
      "חג",
      "נטו",
      "נסיעות",
      "השלמה",
      "מחלקה",
    ];
    const r4 = ws.getRow(4);
    headers.forEach((h, i) => {
      const cell = r4.getCell(i + 1);
      cell.value = h;
      cell.font = { bold: true };
      cell.alignment = { horizontal: "center" };
      cell.border = {
        bottom: { style: "thin" },
      };
    });

    const numCols = [3, 4, 6, 7, 8, 9, 10, 12, 13];
    for (const c of numCols) {
      ws.getColumn(c).numFmt = "0.00";
    }
    ws.getColumn(5).numFmt = "0";

    const toNum = (v) => {
      if (v === "" || v == null) return "";
      const n = Number(v);
      return Number.isFinite(n) ? Math.round(n * 100) / 100 : "";
    };

    // Row 5+: employee data
    for (let i = 0; i < employees.length; i++) {
      const emp = employees[i];
      const row = ws.getRow(5 + i);
      row.getCell(1).value = emp.keyName || "";
      row.getCell(2).value = emp.ID_nmbr || "";
      row.getCell(3).value = toNum(emp.vacation);
      row.getCell(4).value = toNum(emp.hourlyWage);
      row.getCell(5).value = toNum(emp.workdays);
      row.getCell(6).value = toNum(emp.hours100);
      row.getCell(7).value = toNum(emp.hours125);
      row.getCell(8).value = toNum(emp.hours150);
      row.getCell(9).value = toNum(emp.shabbat);
      row.getCell(10).value = toNum(emp.holiday);
      row.getCell(11).value = emp.net ?? "";
      row.getCell(12).value = toNum(emp.travel);
      row.getCell(13).value = toNum(emp.completion);
      row.getCell(14).value = this.department || "";
    }

    return wb.xlsx.writeBuffer();
  }
}

export default MicpImportXL;
