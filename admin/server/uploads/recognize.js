// File recognition for the "Upload files" page.
// recognizeFile() opens one file, decides what it is from its content (title rows,
// header cells, sheet layout — never from the file name alone), and says what an
// import would do: which branch, which period, how many rows, or why it is not imported.
import crypto from "crypto";
import { containerOf, loadWorkbook, topRows, norm, nameKey, findHeaderRow, monthBounds } from "./workbook.js";
import { parseTabitDetailed, parseBankHapoalim, peekTabitRoster } from "./parsers.js";

// How each kind is imported:
//   server        — POST /admin/files/import (this module)
// (Beecomm cash / Z data is not uploaded: the daily loader reads it from the Beecomm API.)
//   roster        — the existing /admin/payroll/shift-employees/preview + commit
//   payrollIndex  — the existing /admin/payroll/micpal/sync
//   null          — recognized, but nothing is imported (the reason says why)
export const KINDS = {
  TABIT_DETAILED: { label: "Tabit — detailed attendance report (דוח מפורט)", handler: "server" },
  // Not a file: the same report read from the Tabit Shift API (POST /admin/files/tabit-shift, daily job).
  TABIT_SHIFT_API: { label: "Tabit Shift — detailed report from the API (no file)", handler: null },
  TABIT_ROSTER: { label: "Tabit — employee list (רשימת עובדים)", handler: "roster" },
  TABIT_SUMMARY: { label: "Tabit — summaries report (דוח סיכומים)", handler: null },
  MICPAL_INDEX: { label: "Micpal — employee data (נתוני עובד)", handler: "payrollIndex" },
  SHIKLULIT_INDEX: { label: "Shiklulit — employee index (אינדקס עובדים)", handler: "payrollIndex" },
  SHIKLULIT_WORKSHEET: { label: "Shiklulit — payroll worksheet (נייר עבודה)", handler: null },
  BEECOMM_Z: { label: "Beecomm — cash report / Z (דוחות קופה)", handler: null },
  BEECOMM_EXCEPTIONS: { label: "Beecomm — exceptions / credits (דוח חריגות)", handler: null },
  BANK_HAPOALIM: { label: "Bank Hapoalim — account transactions (תנועות בחשבון)", handler: "server", adminOnly: true },
  BANK_SALARY_BATCH: { label: "Bank — salary transfer batch (פרטי משכורת)", handler: null, adminOnly: true },
  BANK_LEUMI_HTML: { label: "Bank Leumi — transactions (HTML .xls)", handler: null, adminOnly: true },
  PAYSLIPS_PDF: { label: "Payslips (PDF)", handler: null },
  ALLEGRO_EXPORT: { label: "A file made by Allegro admin", handler: null },
};

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

const cellsOf = (rows) => rows.flat().filter(Boolean);
const anyCell = (rows, pred) => cellsOf(rows).some(pred);

// Suggest a branch from employee names: the branch whose known employees match most names.
const suggestBranch = (names, ctx, allowed) => {
  const votes = new Map();
  let total = 0;
  for (const n of names) {
    const key = nameKey(n);
    if (!key) continue;
    total += 1;
    for (const rest of ctx.nameIndex.get(key) || []) votes.set(rest, (votes.get(rest) || 0) + 1);
  }
  const best = [...votes.entries()].filter(([rest]) => !allowed || allowed.has(rest)).sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] < Math.max(2, Math.ceil(total * 0.3))) return null;
  return { rest: best[0], matched: best[1], total };
};

const result = (base, kind, extra = {}) => {
  const k = KINDS[kind];
  return {
    ...base,
    kind,
    label: k.label,
    recognized: true,
    handler: k.handler,
    importable: !!k.handler,
    adminOnly: !!k.adminOnly,
    ...extra,
  };
};

const unknown = (base, reason) => ({ ...base, kind: null, label: "Not recognized", recognized: false, importable: false, handler: null, reason });

// ctx: { groups: [{key, label, payrollSoft, micCompany, branches: [ids]}], nameIndex: Map(name key → Set(branch id)) }
// allowed: Set of branch ids the user may use (null = all); isAdmin: may import bank files.
export const recognizeFile = async (file, ctx, { allowed = null, isAdmin = false } = {}) => {
  const buf = file.buffer;
  const base = { name: file.originalname, size: buf.length, hash: sha256(buf), warnings: [] };
  const container = containerOf(buf, file.originalname);
  const fname = norm(file.originalname);

  if (container === "pdf") {
    if (/תלוש/.test(fname)) return result(base, "PAYSLIPS_PDF", { reason: "Payslip PDFs are not imported yet." });
    return unknown(base, "A PDF file that is not a payslip file.");
  }
  if (container === "html") {
    const head = buf.subarray(0, 20000).toString("utf8");
    if (/בנק לאומי/.test(head)) return result(base, "BANK_LEUMI_HTML", { reason: "Bank Leumi files are not imported yet (this export is a web page saved as .xls)." });
    return unknown(base, "A web page (HTML) saved as a spreadsheet. Open it in Excel and save it as .xlsx.");
  }
  if (container === "xls-binary" || container === "xls-xml") {
    return unknown(base, "Old Excel format (.xls). Open it in Excel and save it as .xlsx, then upload again.");
  }
  if (container === "csv") return unknown(base, "CSV files are not recognized yet. Upload the .xlsx export.");
  if (container !== "zip") return unknown(base, "Not a spreadsheet, PDF or known file type.");

  let wb;
  try {
    wb = await loadWorkbook(buf);
  } catch (e) {
    return unknown(base, `The file could not be opened (${e.message || "bad .xlsx"}). Open it in Excel and save it again.`);
  }
  const ws = wb.worksheets.find((w) => w.rowCount > 0) || wb.worksheets[0];
  if (!ws) return unknown(base, "The workbook has no sheets.");
  const top = topRows(ws, 12);
  const sheetNames = wb.worksheets.map((w) => norm(w.name));

  // Files that Allegro admin itself produced (exports) — dropped back in by mistake.
  if (
    sheetNames.includes("דיווח") ||
    sheetNames.includes("Shiklulit Import") ||
    sheetNames.includes("עם מספר מיקפל") ||
    /^(payroll_summary_|tlush_|micpal_import|siklulit_import|shik_import)/i.test(fname)
  ) {
    return result(base, "ALLEGRO_EXPORT", { reason: "This file was created by Allegro admin; there is nothing to import from it." });
  }

  // ── Tabit
  if (anyCell(top.slice(0, 4), (c) => c === "דוח מפורט") && anyCell(top.slice(0, 6), (c) => c.startsWith("שם עובד"))) {
    const parsed = parseTabitDetailed(wb);
    const shifts = parsed.employees.reduce((n, e) => n + e.shifts.length, 0);
    const suggestion = suggestBranch(parsed.employees.map((e) => e.name), ctx, allowed);
    const out = result(base, "TABIT_DETAILED", {
      needsBranch: true,
      rest: suggestion?.rest || null,
      suggestion,
      period: parsed.month ? { month: parsed.month, ...monthBounds(parsed.month) } : null,
      summary: `${parsed.employees.length} employees, ${shifts} shifts`,
    });
    if (!parsed.month) out.warnings.push("Could not find the month in the report.");
    if (parsed.skipped.length) out.warnings.push(`${parsed.skipped.length} sheets were skipped (${parsed.skipped[0].reason}).`);
    if (!parsed.employees.length) Object.assign(out, { importable: false, reason: "No employee sheets were found in the report." });
    return out;
  }
  if (anyCell(top.slice(0, 4), (c) => c === "דוח סיכומים")) {
    return result(base, "TABIT_SUMMARY", { reason: "The summaries report is not used. Upload the detailed report (דוח מפורט) — it has every shift." });
  }
  if (anyCell(top.slice(0, 4), (c) => c === "רשימת עובדים") || findHeaderRow(ws, ["שם משתמש", "שם משפחה"], 15)) {
    const peek = peekTabitRoster(ws);
    const suggestion = suggestBranch(peek.names, ctx, allowed);
    const out = result(base, "TABIT_ROSTER", {
      needsBranch: true,
      rest: suggestion?.rest || null,
      suggestion,
      summary: `${peek.count} employees`,
    });
    if (!peek.count) Object.assign(out, { importable: false, reason: "The employee list is empty." });
    return out;
  }

  // ── Payroll software
  if (anyCell(top, (c) => /שיקלולית/.test(c))) {
    if (anyCell(top, (c) => c.startsWith("נייר עבודה"))) {
      return result(base, "SHIKLULIT_WORKSHEET", { reason: "The Shiklulit payroll worksheet is not imported." });
    }
    const company = (cellsOf(top.slice(0, 2)).join(" ").match(/חברה\s+(\d+)/) || [])[1] || null;
    const group = ctx.groups.find((g) => g.payrollSoft === "shik" && company && String(Number(g.micCompany)) === String(Number(company)));
    const out = result(base, "SHIKLULIT_INDEX", {
      company,
      rest: group?.branches[0] || null,
      group: group?.label || null,
      groupBranches: group?.branches || [],
      summary: `Employee numbers for company ${company || "?"}${group ? ` (${group.label})` : ""}`,
    });
    if (!group) Object.assign(out, { importable: false, reason: `No restaurant group uses Shiklulit with company ${company || "(not found in the file)"}.` });
    return out;
  }
  const row1 = new Set(top[0] || []);
  if (row1.has("מספר עובד") && (row1.has("מפתח שם עובד") || (row1.has("מספר זהות") && ws.columnCount > 50))) {
    const groups = ctx.groups.filter((g) => g.payrollSoft === "mic");
    const out = result(base, "MICPAL_INDEX", {
      company: groups.length === 1 ? groups[0].micCompany : null,
      rest: groups.length === 1 ? groups[0].branches[0] : null,
      group: groups.length === 1 ? groups[0].label : null,
      groupBranches: groups.length === 1 ? groups[0].branches : [],
      summary: `${Math.max(0, ws.rowCount - 1)} employee rows${groups.length === 1 ? ` (${groups[0].label})` : ""}`,
    });
    if (groups.length !== 1) Object.assign(out, { importable: false, reason: "Cannot tell which company this Micpal file belongs to." });
    return out;
  }

  // ── Beecomm
  if (anyCell(top.slice(0, 4), (c) => c.startsWith("טווח תאריכים לדוח")) && findHeaderRow(ws, ["סניף", "מספר זד"], 12)) {
    return result(base, "BEECOMM_Z", {
      reason: "Not needed: the cash details (Z reports) are loaded every day from the Beecomm API.",
    });
  }
  if (findHeaderRow(ws, ["פעולה", "סיבת הפעולה", "מנהל מאשר"], 12)) {
    return result(base, "BEECOMM_EXCEPTIONS", { reason: "Beecomm exceptions / credits reports are not imported yet." });
  }

  // ── Bank
  if (anyCell(top.slice(0, 5), (c) => c === "תנועות בחשבון") && findHeaderRow(ws, ["תאריך", "חובה", "זכות"], 12)) {
    const parsed = parseBankHapoalim(ws);
    const out = result(base, "BANK_HAPOALIM", {
      account: parsed.account || null,
      period: parsed.from ? { from: parsed.from, to: parsed.to } : null,
      summary: `Account ${parsed.account || "?"}: ${parsed.rows.length} transactions`,
    });
    if (!parsed.account) Object.assign(out, { importable: false, reason: "The account number was not found in the file." });
    if (!parsed.account.startsWith("12-")) out.warnings.push("The account does not start with 12 (Bank Hapoalim).");
    return out;
  }
  if (anyCell(top.slice(0, 5), (c) => c === "פרטי משכורת") && findHeaderRow(ws, ["סכום להעברה"], 12)) {
    return result(base, "BANK_SALARY_BATCH", { reason: "Salary transfer batches are not imported." });
  }

  return unknown(base, `The layout does not match any known file. First row: ${(top.find((r) => r.some(Boolean)) || []).filter(Boolean).slice(0, 4).join(" | ") || "(empty)"}`);
};

// After recognition: apply the user's permissions to the answer.
// bankAccounts (Joya's accountant): the bank accounts of the user's companies; a bank file of one of them is allowed.
export const applyPermissions = (r, { allowed, isAdmin, bankAccounts = null }) => {
  if (r.adminOnly && !isAdmin) {
    if (bankAccounts && r.account && bankAccounts.has(r.account)) return r;
    return { ...r, importable: false, reason: "Only an admin can import bank files." };
  }
  if (!allowed) return r;
  if (r.handler === "payrollIndex") {
    // the employee index is per company: use any branch of that company the user may use
    const rest = (r.groupBranches || []).find((b) => allowed.has(b));
    return rest ? { ...r, rest } : { ...r, rest: null, importable: false, reason: "This company has no branch you are allowed to use." };
  }
  if (r.rest && !allowed.has(r.rest)) return { ...r, rest: null, suggestion: null };
  return r;
};
