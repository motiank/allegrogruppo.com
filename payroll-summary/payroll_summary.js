#!/usr/bin/env node
// payroll_summary.js
// Consolidate time-tracking Excel exports into one payroll workbook.
//
// Usage: node payroll_summary.js /path/to/folder
//
// Reads every *.xlsx in the folder, scans every sheet, locates Hebrew
// "summary" rows (סיכום ...), aggregates per-employee, and emits a single
// workbook with three sheets:
//   1. Payroll_Summary  — ONE row per employee with a live סה"כ formula
//   2. Raw_Extract      — every detected summary row (audit trail)
//   3. Exceptions       — anything ambiguous, missing, or suspicious
//
// See README.md for the extraction strategy and assumptions.

"use strict";

const ExcelJS = require("exceljs");
const fsp = require("fs").promises;
const path = require("path");

// ---------- Constants ----------

const OUTPUT_FILE = "payroll_summary.xlsx";
const CONFIG_FILE = "employees_config.xlsx";
const SUMMARY_PREFIX = "סיכום";

// Explicit role mapping for the most common labels.
// Anything else starting with "סיכום " falls back to the trailing word.
const ROLE_MAP = {
  "סיכום כללי": "כללי",
  "סיכום מלצר": "מלצר",
  "סיכום אחמש": "אחמש",
  "סיכום בר": "בר",
  "סיכום מטבח": "מטבח",
  'סיכום בלת"מ': 'בלת"מ',
  "סיכום בלתמ": 'בלת"מ',
};

const GLOBAL_KEYWORDS = ["גלובלי", "גלובאלי", "חודשי", "שכר חודשי", "משכורת"];

// Top-of-sheet header-section labels. These are matched against the area
// ABOVE the data table's header row (i.e. the metadata block at the top of
// each employee sheet) — never against the column headers themselves.
const EMPLOYEE_NAME_LABELS = ["שם העובד", "שם עובד"];
// Ambiguous labels — only allowed as exact matches so they don't collide
// with column headers or other content.
const EMPLOYEE_NAME_LABELS_EXACT = ["שם", "עובד"];
const EMPLOYEE_NUMBER_LABELS = [
  "מספר עובד",
  "מס' עובד",
  "מס עובד",
  "מס. עובד",
  'מס"ע',
];
const WORK_DAYS_LABELS = ["מספר ימי עבודה", "ימי עבודה"];
const ID_NUMBER_LABELS = ["ת.ז.", 'ת"ז', "תז", "תעודת זהות", "ת.ז"];
const MONTH_LABELS = ["חודש", "תקופה"];
const HEBREW_MONTHS = {
  ינואר: 1,
  פברואר: 2,
  מרץ: 3,
  אפריל: 4,
  מאי: 5,
  יוני: 6,
  יולי: 7,
  אוגוסט: 8,
  ספטמבר: 9,
  אוקטובר: 10,
  נובמבר: 11,
  דצמבר: 12,
};

// Header synonyms map raw cell text → canonical field key.
// Iteration order is significant: earlier entries claim a column first, so
// e.g. "שעות 150%" is grabbed by hours150 before שבת/חג checks consider it.
// shabbatHag must precede shabbat/hag for the same reason.
const HEADER_SYNONYMS = {
  hours100: [
    "שעות 100%",
    "100%",
    "שעות רגילות",
    "רגיל",
    'סה"כ שעות',
    "סהכ שעות",
    "שעות",
  ],
  hours125: ["שעות 125%", "125%", "נוספות 125", "שעות נוספות 125"],
  hours150: ["שעות 150%", "150%", "נוספות 150", "שעות נוספות 150"],
  shabbatHag: ["שבת/חג", "שבת / חג", "חג/שבת", "חג / שבת", "שבתות וחגים"],
  shabbat: ["שעות שבת", "שבת"],
  hag: ["שעות חג", "חגים", "חג"],
  rate: ["מחיר לשעה", "תעריף לשעה", "שכר לשעה", "תעריף"],
  netGross: ["נטו/ברוטו", "נטו / ברוטו", "סוג שכר", "ברוטו/נטו"],
  tip: ["טיפ", "טיפים", "תשר"],
  completion: ["השלמה", "תוספת", "בונוס"],
  travel: ["נסיעות", "דמי נסיעה", "הוצאות נסיעה", "נסיעה"],
  notes: ["הערות", "הערה"],
  workdays: ["ימי עבודה", "מספר ימים", "ימים", 'סה"כ ימים', "סהכ ימים"],
  date: ["תאריך", "תאריך עבודה", "יום"],
  employeeNumber: [
    "מספר עובד",
    "מס' עובד",
    "מס עובד",
    "מס. עובד",
    'מס"ע',
    "ת.ז.",
    "תז",
    "תעודת זהות",
  ],
  total: ['סה"כ', "סהכ", "סך הכל", "סך הכול"],
};

// Words that, when present in the actual hours150 header text, indicate that
// the column already bakes in שבת/חג hours — so we must not double-count.
const SHABBAT_HAG_INCLUSION_HINTS = ["שבת", "חג"];

// ---------- Cell helpers ----------

function normalize(text) {
  if (text == null) return "";
  return String(text).replace(/‏|‎/g, "").replace(/\s+/g, " ").trim();
}

function getCellText(cell) {
  if (!cell) return "";
  const v = cell.value;
  if (v == null) return "";
  if (
    typeof v === "string" ||
    typeof v === "number" ||
    typeof v === "boolean"
  ) {
    return String(v);
  }
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    if (Array.isArray(v.richText))
      return v.richText.map((r) => r.text).join("");
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
    if (v.hyperlink && v.text == null) return String(v.hyperlink);
    if (v.formula) return "";
  }
  return "";
}

// Coerce a cell's value to a number, supporting "8:30" → 8.5.
function getCellNumber(cell) {
  if (!cell) return null;
  const v = cell.value;
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  if (
    typeof v === "object" &&
    v.result != null &&
    typeof v.result === "number"
  ) {
    return v.result;
  }
  const s = String(v).replace(/,/g, "").trim();
  if (!s) return null;
  const hm = s.match(/^(\d+):(\d{1,2})$/);
  if (hm) return parseInt(hm[1], 10) + parseInt(hm[2], 10) / 60;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Returns an ISO yyyy-mm-dd string for a cell that holds a date, else null.
function getCellDateKey(cell) {
  if (!cell) return null;
  const v = cell.value;
  if (v == null || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object" && v.text instanceof Date) {
    return v.text.toISOString().slice(0, 10);
  }
  if (typeof v === "string") {
    // Common Hebrew/EU formats: dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd, dd.mm.yyyy
    const s = v.trim();
    let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (m) {
      let [, d, mo, y] = m;
      if (y.length === 2) y = (parseInt(y, 10) > 50 ? "19" : "20") + y;
      return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
    m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
    if (m) {
      const [, y, mo, d] = m;
      return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
  }
  return null;
}

// ---------- Detection ----------

// Find the most likely header row by scoring each row against the
// HEADER_SYNONYMS table. Returns { row, columns, texts } where:
//   columns[fieldKey] = column number
//   texts[fieldKey]   = the raw header text that matched (used to detect
//                       e.g. "שעות 150% (כולל שבת/חג)" → no double-count)
//
// Each column may be claimed by at most one field, with iteration-order
// priority (hours150 wins over shabbat for ambiguous wording).
function detectHeaderRow(worksheet) {
  let best = { score: 0, row: null, columns: {}, texts: {} };
  const maxScan = Math.min(worksheet.rowCount || 50, 50);

  for (let r = 1; r <= maxScan; r++) {
    const row = worksheet.getRow(r);
    const map = {};
    const texts = {};
    let score = 0;
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const text = normalize(getCellText(cell));
      if (!text) return;
      for (const [field, syns] of Object.entries(HEADER_SYNONYMS)) {
        if (map[field]) continue;
        for (const syn of syns) {
          if (text === syn || text.includes(syn)) {
            map[field] = colNumber;
            texts[field] = text;
            score++;
            return; // claim this cell; do not consider further fields
          }
        }
      }
    });
    if (score > best.score) best = { score, row: r, columns: map, texts };
  }
  return best.score >= 1 ? best : null;
}

// Generic "find a value next to a labeled cell" helper. Scans the top
// `maxRows` rows of the sheet (default 60) for a cell whose text matches
// one of `labelSyns`, and returns the value of an adjacent cell.
//
// opts:
//   number: true   → coerce result to a number (else string)
//   exact:  true   → require text === syn (no substring matching)
//   maxRows: N     → cap the scan range (use this to confine to the
//                    metadata block above the data table)
function findValueNextToLabel(worksheet, labelSyns, opts = {}) {
  const wantNumber = !!opts.number;
  const exact = !!opts.exact;
  const maxRows = Math.min(worksheet.rowCount || 0, opts.maxRows || 60);
  for (let r = 1; r <= maxRows; r++) {
    const row = worksheet.getRow(r);
    const cells = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cells[col] = cell;
    });
    for (let c = 1; c < cells.length; c++) {
      const t = normalize(getCellText(cells[c]));
      if (!t) continue;
      let isLabel = false;
      for (const syn of labelSyns) {
        if (exact ? t === syn : t === syn || t.includes(syn)) {
          isLabel = true;
          break;
        }
      }
      if (!isLabel) continue;
      for (const off of [1, -1, 2, -2]) {
        const cell = cells[c + off];
        if (!cell) continue;
        const v = wantNumber
          ? getCellNumber(cell)
          : normalize(getCellText(cell));
        if (v != null && v !== "") return v;
      }
    }
  }
  return null;
}

// Stop tokens for inline parsing — when a single cell contains a metadata
// block like "שם עובד: אברהם\nחודש: אפריל 2026", these tokens (in addition
// to a newline) terminate the value capture so we don't pick up the next
// field's label or month/year.
const INLINE_STOP_TOKENS = [
  "חודש",
  "תקופה",
  "שנה",
  "תאריך",
  "מספר עובד",
  "מס' עובד",
  "מס עובד",
  'מס"ע',
  "ת.ז.",
  "תז",
  "תעודת זהות",
  "ימי עבודה",
  "מספר ימי עבודה",
  "שם העובד",
  "שם עובד",
  "מחיר לשעה",
  "תעריף",
  "סוג שכר",
  "נטו/ברוטו",
];

// Pull "<label>: <value>" out of a multi-line cell text. The capture stops
// at a newline, end of string, or any of the supplied stop tokens. The
// `labels` list is tried in order — first match wins. Returns the trimmed
// value or null.
function parseInlineLabelValue(rawText, labels, stopTokens) {
  if (rawText == null) return null;
  const text = String(rawText).replace(/[‏‎]/g, ""); // strip RLM/LRM marks
  const stops = stopTokens || INLINE_STOP_TOKENS;
  for (const label of labels) {
    const idx = text.indexOf(label);
    if (idx === -1) continue;
    let after = text.slice(idx + label.length);
    // Skip an optional ":" / "-" separator and surrounding whitespace.
    after = after.replace(/^[\s ]*[:\-–—][\s ]*/, "");
    // Stop at first newline.
    after = after.split(/\r?\n/)[0];
    // Stop at the first occurrence of any other metadata label.
    for (const tok of stops) {
      if (tok === label) continue;
      const i = after.indexOf(tok);
      if (i !== -1) after = after.slice(0, i);
    }
    after = after.trim();
    if (after) return after;
  }
  return null;
}

// Scan the metadata block above the data table for a cell whose text
// contains an inline "label: value" pattern. Used when label and value
// are baked into one cell instead of two adjacent cells.
function findInlineLabelValueInHeader(worksheet, headerRow, labels) {
  const upTo = headerRow ? Math.max(1, headerRow - 1) : 30;
  const lastRow = Math.min(worksheet.rowCount || 0, upTo);
  for (let r = 1; r <= lastRow; r++) {
    const row = worksheet.getRow(r);
    let hit = null;
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (hit) return;
      const text = getCellText(cell); // raw, with newlines preserved
      if (!text) return;
      const parsed = parseInlineLabelValue(text, labels);
      if (parsed) hit = parsed;
    });
    if (hit) return hit;
  }
  return null;
}

// Detect the employee name from the metadata block above the data table.
// Strategy (first hit wins):
//   1. Inline pattern in one cell: "שם עובד: אברהם\nחודש: ..." → "אברהם"
//   2. Label-adjacent cell: "שם עובד" | "אברהם"
//   3. Exact-match fallback for the ambiguous "שם" / "עובד" labels
// Never falls back to the sheet's tab name.
function detectEmployeeNameInHeader(worksheet, headerRow) {
  const inline = findInlineLabelValueInHeader(
    worksheet,
    headerRow,
    EMPLOYEE_NAME_LABELS,
  );
  if (inline && inline !== "שם" && !inline.startsWith(SUMMARY_PREFIX)) {
    return inline;
  }

  const upTo = headerRow ? Math.max(1, headerRow - 1) : 20;
  const v1 = findValueNextToLabel(worksheet, EMPLOYEE_NAME_LABELS, {
    number: false,
    maxRows: upTo,
  });
  if (v1 && v1 !== "שם" && !v1.startsWith(SUMMARY_PREFIX)) return v1;
  const v2 = findValueNextToLabel(worksheet, EMPLOYEE_NAME_LABELS_EXACT, {
    number: false,
    maxRows: upTo,
    exact: true,
  });
  if (v2 && v2 !== "שם" && !v2.startsWith(SUMMARY_PREFIX)) return v2;
  return null;
}

function detectGlobalInSheet(worksheet) {
  const maxRows = Math.min(worksheet.rowCount || 0, 200);
  for (let r = 1; r <= maxRows; r++) {
    const row = worksheet.getRow(r);
    let hit = false;
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (hit) return;
      const t = normalize(getCellText(cell));
      for (const kw of GLOBAL_KEYWORDS) {
        if (t.includes(kw)) {
          hit = true;
          return;
        }
      }
    });
    if (hit) return true;
  }
  return false;
}

// Parse a Hebrew/numeric "month" string to "YYYY-MM" or null.
function parseMonthString(str) {
  if (str == null) return null;
  const s = String(str).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.\s](\d{1,2})$/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-/.\s](\d{4})$/);
  if (m) return `${m[2]}-${String(m[1]).padStart(2, "0")}`;
  for (const [heb, num] of Object.entries(HEBREW_MONTHS)) {
    if (s.includes(heb)) {
      const ym = s.match(/(\d{4})/);
      const year = ym ? ym[1] : String(new Date().getFullYear());
      return `${year}-${String(num).padStart(2, "0")}`;
    }
  }
  return null;
}

// Try to detect the YYYY-MM month for a worksheet from its metadata block.
function detectMonthInSheet(worksheet, headerRow) {
  const upTo = headerRow ? Math.max(1, headerRow - 1) : 30;
  const inline = findInlineLabelValueInHeader(
    worksheet,
    headerRow,
    MONTH_LABELS,
  );
  let parsed = parseMonthString(inline);
  if (parsed) return parsed;
  const adj = findValueNextToLabel(worksheet, MONTH_LABELS, {
    number: false,
    maxRows: upTo,
  });
  parsed = parseMonthString(adj);
  if (parsed) return parsed;
  // Fallback: most common month from date cells.
  const counts = new Map();
  const lastRow = Math.min(worksheet.rowCount || 0, 500);
  for (let r = 1; r <= lastRow; r++) {
    const row = worksheet.getRow(r);
    row.eachCell({ includeEmpty: false }, (cell) => {
      const key = getCellDateKey(cell);
      if (!key) return;
      const ym = key.slice(0, 7);
      counts.set(ym, (counts.get(ym) || 0) + 1);
    });
  }
  if (counts.size === 0) return null;
  let best = null;
  for (const [ym, n] of counts.entries()) {
    if (!best || n > best[1]) best = [ym, n];
  }
  return best ? best[0] : null;
}

function extractRoleFromLabel(label) {
  const norm = normalize(label);
  if (ROLE_MAP[norm]) return ROLE_MAP[norm];
  if (norm.startsWith(SUMMARY_PREFIX)) {
    const rest = norm.substring(SUMMARY_PREFIX.length).trim();
    return rest || null;
  }
  return null;
}

// Detect shift-block columns from the data table's header row. A shift block
// is a triplet [role, entry, exit] (תפקיד / כניסה / יציאה) repeated
// horizontally. Returns an array of { role, entry, exit } column triples in
// document order. Blocks with no entry/exit pair are ignored.
function findShiftBlocks(worksheet, headerRow) {
  if (!headerRow) return [];
  const row = worksheet.getRow(headerRow);
  const cols = [];
  row.eachCell({ includeEmpty: false }, (cell, col) => {
    const t = normalize(getCellText(cell));
    if (!t) return;
    if (t === "תפקיד") cols.push({ kind: "role", col });
    else if (t === "כניסה") cols.push({ kind: "entry", col });
    else if (t === "יציאה") cols.push({ kind: "exit", col });
  });
  // Pair each entry with the next exit that follows it (and the closest role
  // before/around it).
  const blocks = [];
  const used = new Set();
  for (let i = 0; i < cols.length; i++) {
    if (cols[i].kind !== "entry") continue;
    let exit = null;
    for (let j = i + 1; j < cols.length; j++) {
      if (cols[j].kind === "exit" && !used.has(j)) {
        exit = cols[j];
        used.add(j);
        break;
      }
      if (cols[j].kind === "entry") break; // next entry – stop
    }
    let role = null;
    for (let j = i - 1; j >= 0; j--) {
      if (cols[j].kind === "role") {
        role = cols[j];
        break;
      }
    }
    blocks.push({
      role: role ? role.col : null,
      entry: cols[i].col,
      exit: exit ? exit.col : null,
    });
  }
  return blocks;
}

// Format a Date or HH:MM-bearing cell as "HH:MM"; returns "" if not parseable.
function formatTimeCell(cell) {
  if (!cell) return "";
  const v = cell.value;
  if (!v) return "";
  if (v instanceof Date) {
    return `${String(v.getUTCHours()).padStart(2, "0")}:${String(v.getUTCMinutes()).padStart(2, "0")}`;
  }
  const s = String(v);
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;
  return "";
}

function isCellEmpty(cell) {
  if (!cell) return true;
  const v = cell.value;
  if (v == null) return true;
  if (typeof v === "string" && v.trim() === "") return true;
  return false;
}

// Walk the data rows of a sheet and collect any shift block where כניסה
// exists without יציאה (or vice versa). Returns an array of issue objects.
function findIncompleteShifts({
  worksheet,
  file,
  sheetName,
  employee,
  headerInfo,
  summaryRowNumbers,
}) {
  if (!headerInfo) return [];
  const headerRow = headerInfo.row;
  const blocks = findShiftBlocks(worksheet, headerRow);
  if (blocks.length === 0) return [];
  // Find the תאריך column directly — the generic "date" detection may have
  // claimed יום (day name) which doesn't carry a date value.
  let dateCol = null;
  worksheet.getRow(headerRow).eachCell({ includeEmpty: false }, (cell, col) => {
    const t = normalize(getCellText(cell));
    if (t === "תאריך" || t.includes("תאריך")) {
      if (dateCol == null) dateCol = col;
    }
  });
  if (dateCol == null) dateCol = headerInfo.columns.date || 2;
  const issues = [];
  const last = worksheet.rowCount || 0;
  for (let r = headerRow + 1; r <= last; r++) {
    if (summaryRowNumbers && summaryRowNumbers.has(r)) continue;
    const row = worksheet.getRow(r);
    const dateKey = getCellDateKey(row.getCell(dateCol)) || "";
    blocks.forEach((b, idx) => {
      const entryCell = b.entry ? row.getCell(b.entry) : null;
      const exitCell = b.exit ? row.getCell(b.exit) : null;
      const entryEmpty = isCellEmpty(entryCell);
      const exitEmpty = isCellEmpty(exitCell);
      if (entryEmpty && exitEmpty) return;
      if (!entryEmpty && !exitEmpty) return;
      const role = b.role ? normalize(getCellText(row.getCell(b.role))) : "";
      issues.push({
        file,
        sheet: sheetName,
        employee,
        date: dateKey,
        slot: idx + 1,
        role: role || "",
        entry: entryEmpty ? "" : formatTimeCell(entryCell),
        exit: exitEmpty ? "" : formatTimeCell(exitCell),
        missing: entryEmpty ? "entry" : "exit",
      });
    });
  }
  return issues;
}

function findSummaryRows(worksheet, headerRowNumber) {
  const found = [];
  const maxRow = worksheet.rowCount || 0;
  for (let r = 1; r <= maxRow; r++) {
    // Never treat the header row as a summary row — its "סיכום" column
    // label would otherwise be misread as a bare summary row.
    if (headerRowNumber && r === headerRowNumber) continue;
    const row = worksheet.getRow(r);
    let label = null;
    let labelCol = null;
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      if (label) return;
      const t = normalize(getCellText(cell));
      if (!t.startsWith(SUMMARY_PREFIX)) return;
      // Reject bare "סיכום" with no role suffix — typically a column header.
      if (t === SUMMARY_PREFIX) return;
      label = t;
      labelCol = col;
    });
    if (label) found.push({ rowNumber: r, label, labelCol });
  }
  return found;
}

// Walk the data rows and emit per-date entries with the row's own
// hours100/125/150, tip, completion, and best-guess role. Multiple
// entries per date are allowed (multi-shift days). Returns
// { 'YYYY-MM-DD': [{role, h100, h125, h150, tip, completion}, ...] }.
function collectDailyBreakdown(worksheet, headerInfo, summaryRowNumbers) {
  const out = {};
  if (!headerInfo) return out;
  const cols = headerInfo.columns || {};
  const headerRow = headerInfo.row;
  const blocks = findShiftBlocks(worksheet, headerRow);

  let dateCol = null;
  worksheet.getRow(headerRow).eachCell({ includeEmpty: false }, (cell, col) => {
    const t = normalize(getCellText(cell));
    if (t === "תאריך" || t.includes("תאריך")) {
      if (dateCol == null) dateCol = col;
    }
  });
  if (dateCol == null) dateCol = cols.date || 2;

  const last = worksheet.rowCount || 0;
  for (let r = headerRow + 1; r <= last; r++) {
    if (summaryRowNumbers && summaryRowNumbers.has(r)) continue;
    const row = worksheet.getRow(r);
    const date = getCellDateKey(row.getCell(dateCol));
    if (!date) continue;

    const rowData = {
      hours100: cols.hours100
        ? getCellNumber(row.getCell(cols.hours100))
        : null,
      hours125: cols.hours125
        ? getCellNumber(row.getCell(cols.hours125))
        : null,
      hours150: cols.hours150
        ? getCellNumber(row.getCell(cols.hours150))
        : null,
      shabbat: cols.shabbat ? getCellNumber(row.getCell(cols.shabbat)) : null,
      hag: cols.hag ? getCellNumber(row.getCell(cols.hag)) : null,
      shabbatHag: cols.shabbatHag
        ? getCellNumber(row.getCell(cols.shabbatHag))
        : null,
      tip: cols.tip ? getCellNumber(row.getCell(cols.tip)) : null,
      completion: cols.completion
        ? getCellNumber(row.getCell(cols.completion))
        : null,
    };
    const { value: h150 } = normalize150(rowData, headerInfo);

    let role = null;
    for (const b of blocks) {
      if (!b.role) continue;
      const txt = normalize(getCellText(row.getCell(b.role)));
      if (txt) {
        role = txt;
        break;
      }
    }

    const h100 = rowData.hours100 || 0;
    const h125 = rowData.hours125 || 0;
    const h150v = h150 || 0;
    const tipv = rowData.tip || 0;
    const compv = rowData.completion || 0;
    if (h100 === 0 && h125 === 0 && h150v === 0 && tipv === 0 && compv === 0) {
      continue;
    }

    if (!out[date]) out[date] = [];
    out[date].push({
      role: role,
      h100,
      h125,
      h150: h150v,
      tip: tipv,
      completion: compv,
    });
  }
  return out;
}

// Parse a time-bearing cell (Date with UTC HH:MM, or "HH:MM" string)
// into minutes-from-midnight, or null if unparseable.
function timeCellToMinutes(cell) {
  if (!cell) return null;
  const v = cell.value;
  if (v == null) return null;
  if (v instanceof Date) {
    return v.getUTCHours() * 60 + v.getUTCMinutes();
  }
  if (typeof v === "number") {
    // Excel serial fraction-of-day (0..1).
    if (v >= 0 && v < 2) {
      const total = Math.round(v * 24 * 60);
      return total;
    }
  }
  const s = String(v);
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

// Walk the data rows and return { 'YYYY-MM-DD': totalHoursForThatDay }
// computed from כניסה/יציאה times across every complete shift block on
// the row. Wraps past midnight (exit < entry → +24h).
function collectDailyHours(worksheet, headerInfo, summaryRowNumbers) {
  const out = {};
  if (!headerInfo) return out;
  const headerRow = headerInfo.row;
  const blocks = findShiftBlocks(worksheet, headerRow);
  if (blocks.length === 0) return out;

  let dateCol = null;
  worksheet.getRow(headerRow).eachCell({ includeEmpty: false }, (cell, col) => {
    const t = normalize(getCellText(cell));
    if (t === "תאריך" || t.includes("תאריך")) {
      if (dateCol == null) dateCol = col;
    }
  });
  if (dateCol == null) dateCol = (headerInfo.columns || {}).date || 2;

  const last = worksheet.rowCount || 0;
  for (let r = headerRow + 1; r <= last; r++) {
    if (summaryRowNumbers && summaryRowNumbers.has(r)) continue;
    const row = worksheet.getRow(r);
    const date = getCellDateKey(row.getCell(dateCol));
    if (!date) continue;
    let rowHours = 0;
    for (const b of blocks) {
      if (!b.entry || !b.exit) continue;
      const entryCell = row.getCell(b.entry);
      const exitCell = row.getCell(b.exit);
      if (isCellEmpty(entryCell) || isCellEmpty(exitCell)) continue;
      const e = timeCellToMinutes(entryCell);
      const x = timeCellToMinutes(exitCell);
      if (e == null || x == null) continue;
      let diff = x - e;
      if (diff < 0) diff += 24 * 60;
      // Sanity cap (single shift > 18h → likely parsing artifact).
      if (diff <= 0 || diff > 18 * 60) continue;
      rowHours += diff / 60;
    }
    if (rowHours > 0) out[date] = (out[date] || 0) + rowHours;
  }
  return out;
}

// Collect YYYY-MM-DD strings for every data row that has at least one
// complete shift block (both כניסה and יציאה filled in). Used for
// per-day labor cost allocation. Returns Set<string>.
function collectWorkDates(worksheet, headerInfo, summaryRowNumbers) {
  const result = new Set();
  if (!headerInfo) return result;
  const headerRow = headerInfo.row;
  const blocks = findShiftBlocks(worksheet, headerRow);
  if (blocks.length === 0) return result;
  let dateCol = null;
  worksheet.getRow(headerRow).eachCell({ includeEmpty: false }, (cell, col) => {
    const t = normalize(getCellText(cell));
    if (t === "תאריך" || t.includes("תאריך")) {
      if (dateCol == null) dateCol = col;
    }
  });
  if (dateCol == null) dateCol = headerInfo.columns.date || 2;
  const last = worksheet.rowCount || 0;
  for (let r = headerRow + 1; r <= last; r++) {
    if (summaryRowNumbers && summaryRowNumbers.has(r)) continue;
    const row = worksheet.getRow(r);
    const dateKey = getCellDateKey(row.getCell(dateCol));
    if (!dateKey) continue;
    for (const b of blocks) {
      const entryCell = b.entry ? row.getCell(b.entry) : null;
      const exitCell = b.exit ? row.getCell(b.exit) : null;
      if (
        entryCell &&
        exitCell &&
        !isCellEmpty(entryCell) &&
        !isCellEmpty(exitCell)
      ) {
        result.add(dateKey);
        break;
      }
    }
  }
  return result;
}

// Count distinct work days from a "תאריך"-style column, ignoring summary
// rows. Returns null if there's no date column or no recognizable dates.
function countUniqueDatesInSheet(worksheet, headerInfo, summaryRowNumbers) {
  if (!headerInfo || !headerInfo.columns.date) return null;
  const dateCol = headerInfo.columns.date;
  const startRow = (headerInfo.row || 1) + 1;
  const endRow = worksheet.rowCount || 0;
  const seen = new Set();
  for (let r = startRow; r <= endRow; r++) {
    if (summaryRowNumbers.has(r)) continue;
    const key = getCellDateKey(worksheet.getRow(r).getCell(dateCol));
    if (key) seen.add(key);
  }
  return seen.size > 0 ? seen.size : null;
}

function extractFromSummaryRow(worksheet, summary, headerInfo) {
  const row = worksheet.getRow(summary.rowNumber);
  const out = {
    hours100: null,
    hours125: null,
    hours150: null,
    shabbat: null,
    hag: null,
    shabbatHag: null,
    rate: null,
    tip: null,
    completion: null,
    travel: null,
    workdays: null,
    notes: "",
  };
  if (headerInfo) {
    const cols = headerInfo.columns;
    if (cols.hours100) out.hours100 = getCellNumber(row.getCell(cols.hours100));
    if (cols.hours125) out.hours125 = getCellNumber(row.getCell(cols.hours125));
    if (cols.hours150) out.hours150 = getCellNumber(row.getCell(cols.hours150));
    if (cols.shabbat) out.shabbat = getCellNumber(row.getCell(cols.shabbat));
    if (cols.hag) out.hag = getCellNumber(row.getCell(cols.hag));
    if (cols.shabbatHag)
      out.shabbatHag = getCellNumber(row.getCell(cols.shabbatHag));
    if (cols.rate) out.rate = getCellNumber(row.getCell(cols.rate));
    if (cols.tip) out.tip = getCellNumber(row.getCell(cols.tip));
    if (cols.completion)
      out.completion = getCellNumber(row.getCell(cols.completion));
    if (cols.travel) out.travel = getCellNumber(row.getCell(cols.travel));
    if (cols.workdays) out.workdays = getCellNumber(row.getCell(cols.workdays));
    if (cols.notes) out.notes = normalize(getCellText(row.getCell(cols.notes)));
  }
  // Last-resort fallback: if we couldn't infer a 100% column, take the first
  // plausible numeric cell on the summary row.
  if (out.hours100 == null) {
    let firstNum = null;
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      if (firstNum != null) return;
      if (col === summary.labelCol) return;
      const n = getCellNumber(cell);
      if (n != null && n > 0 && n < 1000) firstNum = n;
    });
    if (firstNum != null) out.hours100 = firstNum;
  }
  return out;
}

// Compute the normalized 150% value for a single summary row.
// Returns { value, note } where `value` is the final number (or null) and
// `note` describes how it was built (empty when no normalization happened).
function normalize150(data, headerInfo) {
  const h150Header = headerInfo ? headerInfo.texts.hours150 || "" : "";
  const headerImpliesIncluded = SHABBAT_HAG_INCLUSION_HINTS.some((k) =>
    h150Header.includes(k),
  );

  // If the explicit 150% header already mentions שבת/חג, trust it as-is —
  // the source has bundled the overtime, and the shabbat/hag synonyms would
  // not have claimed a separate column anyway (column-priority is enforced
  // in detectHeaderRow). Just record the assumption in the audit note.
  if (headerImpliesIncluded && data.hours150 != null) {
    return {
      value: data.hours150,
      note: `150% header "${h150Header}" already includes שבת/חג; not double-counting`,
    };
  }

  const parts = [];
  if (data.hours150 != null) parts.push(["150%", data.hours150]);
  if (data.shabbat != null) parts.push(["שבת", data.shabbat]);
  if (data.hag != null) parts.push(["חג", data.hag]);
  if (data.shabbatHag != null) parts.push(["שבת/חג", data.shabbatHag]);

  if (parts.length === 0) return { value: null, note: "" };
  if (parts.length === 1) {
    const [name, val] = parts[0];
    const note = name === "150%" ? "" : `taken from ${name} only`;
    return { value: val, note };
  }
  const total = parts.reduce((s, [, v]) => s + v, 0);
  const note = `summed: ${parts.map(([n, v]) => `${n}=${v}`).join(" + ")}`;
  return { value: total, note };
}

// ---------- Optional config loading ----------
//
// Schema (header row first):
//   שם | מספר עובד | מחיר לשעה | נטו/ברוטו | עובד גלובאלי |
//   תפקיד ברירת מחדל | נסיעות | הערות

async function loadConfig(folder) {
  const cfgPath = path.join(folder, CONFIG_FILE);
  try {
    await fsp.access(cfgPath);
  } catch {
    return {};
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(cfgPath);
  const sheet = wb.worksheets[0];
  if (!sheet) return {};

  const headerRow = sheet.getRow(1);
  const headers = {};
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    headers[normalize(getCellText(cell))] = col;
  });

  const colName = headers["שם"];
  const colEmpNum = headers["מספר עובד"];
  const colRate = headers["מחיר לשעה"];
  const colNetGross = headers["נטו/ברוטו"];
  const colGlobal = headers["עובד גלובאלי"];
  const colRole = headers["תפקיד ברירת מחדל"];
  const colTravel = headers["נסיעות"];
  const colWorkdays = headers["ימי עבודה"] || headers["מספר ימי עבודה"];
  const colNotes = headers["הערות"];

  const result = {};
  const last = sheet.rowCount || 0;
  for (let r = 2; r <= last; r++) {
    const row = sheet.getRow(r);
    const name = colName ? normalize(getCellText(row.getCell(colName))) : "";
    if (!name) continue;
    result[name] = {
      employeeNumber: colEmpNum
        ? normalize(getCellText(row.getCell(colEmpNum)))
        : "",
      rate: colRate ? getCellNumber(row.getCell(colRate)) : null,
      netGross: colNetGross
        ? normalize(getCellText(row.getCell(colNetGross)))
        : "",
      global: colGlobal ? normalize(getCellText(row.getCell(colGlobal))) : "",
      defaultRole: colRole ? normalize(getCellText(row.getCell(colRole))) : "",
      travel: colTravel ? getCellNumber(row.getCell(colTravel)) : null,
      workdays: colWorkdays ? getCellNumber(row.getCell(colWorkdays)) : null,
      notes: colNotes ? normalize(getCellText(row.getCell(colNotes))) : "",
    };
  }
  return result;
}

// ---------- Aggregation helpers ----------

function sumNullable(a, b) {
  if (a == null && b == null) return null;
  return (a || 0) + (b || 0);
}

function newBucket() {
  return {
    h100: null,
    h125: null,
    h150: null,
    rate: null, // שכר שעתי — per-role hourly wage
    tip: null,
    completion: null,
    manualCompletion: null, // השלמה ידני — manual adjustment, never auto-extracted
    travel: null,
  };
}

function addToBucket(bucket, data, h150Normalized, rate) {
  bucket.h100 = sumNullable(bucket.h100, data.hours100);
  bucket.h125 = sumNullable(bucket.h125, data.hours125);
  bucket.h150 = sumNullable(bucket.h150, h150Normalized);
  bucket.tip = sumNullable(bucket.tip, data.tip);
  bucket.completion = sumNullable(bucket.completion, data.completion);
  bucket.travel = sumNullable(bucket.travel, data.travel);
  if (rate != null && bucket.rate == null) bucket.rate = rate;
}

function bucketIsEmpty(data, h150Normalized) {
  return [
    data.hours100,
    data.hours125,
    h150Normalized,
    data.tip,
    data.completion,
    data.travel,
  ].every((v) => v == null || v === 0);
}

function bucketsApproxEqual(a, b, tol = 0.5) {
  const keys = ["h100", "h125", "h150", "tip", "completion", "travel"];
  for (const k of keys) {
    if (Math.abs((a[k] || 0) - (b[k] || 0)) > tol) return false;
  }
  return true;
}

function sumRolesData(rolesData) {
  const total = newBucket();
  for (const v of rolesData.values()) {
    total.h100 = sumNullable(total.h100, v.h100);
    total.h125 = sumNullable(total.h125, v.h125);
    total.h150 = sumNullable(total.h150, v.h150);
    total.tip = sumNullable(total.tip, v.tip);
    total.completion = sumNullable(total.completion, v.completion);
    total.travel = sumNullable(total.travel, v.travel);
  }
  return total;
}

function chooseFirst(existing, candidate) {
  if (existing != null && existing !== "") return existing;
  if (candidate == null || candidate === "") return existing;
  return candidate;
}

function getOrCreateEmployee(employees, name) {
  if (!employees.has(name)) {
    employees.set(name, {
      name,
      employeeNumber: null,
      idNumber: null,
      netGross: null,
      global: false,
      // Per-role hour buckets (insertion order preserved). Keys are the
      // normalized role labels (מלצר, בר, אחמש, מטבח, בלת"מ, ...).
      rolesData: new Map(),
      // The general (סיכום כללי) bucket — shown as the סה"כ row.
      general: newBucket(),
      hasGeneral: false,
      // workdays accumulated per source sheet (avoids double counting):
      workdaysPerSheet: new Map(), // sheetKey -> { count, source }
      workdaysUncertain: false,
      // audit / qualitative:
      sheetsSeen: new Set(),
      normalizationNotes: new Set(),
      notes: new Set(),
      issues: new Set(), // dedup'd messages → exceptions
      // Unique YYYY-MM-DD dates the employee was on the floor (any shift
      // block with both כניסה and יציאה filled in). Used to allocate
      // monthly labor cost to days.
      workDates: new Set(),
      // Per-date row buckets keyed by 'YYYY-MM-DD' → array of entries
      // [{role, h100, h125, h150, tip, completion}, ...]. Used for
      // per-day labor cost computation.
      dailyBreakdown: new Map(),
      // Per-date raw hours computed from entry/exit times across all
      // shift blocks on that row. Used to allocate the employee's
      // monthly cost proportionally to each day's hours when the data
      // rows don't carry hours100/125/150 cells.
      dailyHours: new Map(),
    });
  }
  return employees.get(name);
}

// ---------- Output ----------

function buildTotalFormula(rowNum) {
  // Column layout (must match Payroll_Summary.columns below):
  //   A שם
  //   B מספר עובד
  //   C תפקיד
  //   D שכר שעתי
  //   E ימי עבודה
  //   F שעות 100%
  //   G שעות 125%
  //   H שעות 150%
  //   I נטו/ברוטו
  //   J טיפ
  //   K השלמה
  //   L השלמה ידני
  //   M נסיעות
  //   N עובד גלובאלי
  //   O סה"כ
  const r = rowNum;
  const term100 = `IF(ISNUMBER(F${r}),F${r},0)*IF(ISNUMBER(D${r}),D${r},0)`;
  const term125 = `IF(ISNUMBER(G${r}),G${r},0)*IF(ISNUMBER(D${r}),D${r},0)*1.25`;
  const term150 = `IF(ISNUMBER(H${r}),H${r},0)*IF(ISNUMBER(D${r}),D${r},0)*1.5`;
  const termTip = `IF(ISNUMBER(J${r}),J${r},0)`;
  const termCmp = `IF(ISNUMBER(K${r}),K${r},0)`;
  const termManual = `IF(ISNUMBER(L${r}),L${r},0)`;
  const termTrv = `IF(ISNUMBER(M${r}),M${r},0)`;
  return `IFERROR(${term100}+${term125}+${term150}+${termTip}+${termCmp}+${termManual}+${termTrv},0)`;
}

async function writeOutput(folder, payroll, rawRows, exceptions) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "payroll_summary.js";
  wb.created = new Date();

  // ---- Sheet 1: Payroll_Summary ----
  const ws1 = wb.addWorksheet("Payroll_Summary", {
    views: [{ state: "frozen", ySplit: 1, rightToLeft: true }],
  });
  ws1.columns = [
    { header: "שם", key: "name", width: 22 },
    { header: "מספר עובד", key: "employeeNumber", width: 12 },
    { header: "תפקיד", key: "role", width: 14 },
    { header: "שכר שעתי", key: "rate", width: 12 },
    { header: "ימי עבודה", key: "workdays", width: 10 },
    { header: "שעות 100%", key: "h100", width: 12 },
    { header: "שעות 125%", key: "h125", width: 12 },
    { header: "שעות 150%", key: "h150", width: 12 },
    { header: "נטו/ברוטו", key: "netGross", width: 12 },
    { header: "טיפ", key: "tip", width: 12 },
    { header: "השלמה", key: "completion", width: 12 },
    { header: "השלמה ידני", key: "manualCompletion", width: 12 },
    { header: "נסיעות", key: "travel", width: 12 },
    { header: "עובד גלובאלי", key: "global", width: 14 },
    { header: 'סה"כ', key: "total", width: 14 },
  ];
  ws1.getRow(1).font = { bold: true };

  let nextRow = 2;
  for (const p of payroll) {
    p.rows.forEach((r, idx) => {
      const isFirst = idx === 0;
      const rowNum = nextRow++;
      const added = ws1.addRow({
        name: isFirst ? p.name : "",
        employeeNumber: isFirst ? p.employeeNumber || "" : "",
        role: r.role,
        rate: r.bucket.rate,
        workdays: isFirst ? p.workdays : null,
        h100: r.bucket.h100,
        h125: r.bucket.h125,
        h150: r.bucket.h150,
        netGross: isFirst ? p.netGross || "" : "",
        tip: r.bucket.tip,
        completion: r.bucket.completion,
        manualCompletion: r.bucket.manualCompletion,
        travel: r.bucket.travel,
        global: isFirst ? p.global : "",
        total: { formula: buildTotalFormula(rowNum) },
      });

      if (r.isTotal) {
        added.font = { bold: true };
        added.eachCell((cell) => {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFE6E6E6" },
          };
        });
      }
    });
  }

  ws1.getColumn("E").numFmt = "0";
  ["F", "G", "H"].forEach((c) => (ws1.getColumn(c).numFmt = "0.00"));
  ["D", "J", "K", "L", "M", "O"].forEach(
    (c) => (ws1.getColumn(c).numFmt = "#,##0.00"),
  );

  // ---- Sheet 2: Raw_Extract ----
  const ws2 = wb.addWorksheet("Raw_Extract", {
    views: [{ rightToLeft: true }],
  });
  ws2.columns = [
    { header: "קובץ", key: "file", width: 30 },
    { header: "גיליון", key: "sheet", width: 18 },
    {
      header: "extracted_employee_name",
      key: "extracted_employee_name",
      width: 24,
    },
    {
      header: "extracted_employee_number",
      key: "extracted_employee_number",
      width: 22,
    },
    { header: "extracted_work_days", key: "extracted_work_days", width: 18 },
    { header: "extraction_source", key: "extraction_source", width: 38 },
    { header: "שם", key: "name", width: 22 },
    { header: "מספר עובד", key: "employee_number", width: 12 },
    { header: "תווית סיכום", key: "label", width: 18 },
    { header: "תפקיד", key: "role", width: 14 },
    { header: "ימי עבודה", key: "workdays", width: 10 },
    { header: "שעות 100%", key: "h100", width: 12 },
    { header: "שעות 125%", key: "h125", width: 12 },
    { header: "raw_150", key: "raw_150", width: 12 },
    { header: "raw_שבת", key: "raw_shabbat", width: 12 },
    { header: "raw_חג", key: "raw_hag", width: 12 },
    { header: "raw_שבת_חג", key: "raw_shabbat_hag", width: 14 },
    { header: "normalized_150", key: "normalized_150", width: 14 },
    { header: "normalization_note", key: "normalization_note", width: 50 },
    { header: "מחיר לשעה", key: "rate", width: 12 },
    { header: "נטו/ברוטו", key: "netGross", width: 12 },
    { header: "טיפ", key: "tip", width: 12 },
    { header: "השלמה", key: "completion", width: 12 },
    { header: "נסיעות", key: "travel", width: 12 },
    { header: "עובד גלובאלי", key: "global", width: 14 },
    { header: "הערות", key: "notes", width: 30 },
    { header: "skipped_reason", key: "skipped_reason", width: 28 },
  ];
  ws2.getRow(1).font = { bold: true };
  rawRows.forEach((r) => ws2.addRow(r));

  // ---- Sheet 3: Exceptions ----
  const ws3 = wb.addWorksheet("Exceptions", { views: [{ rightToLeft: true }] });
  ws3.columns = [
    { header: "קובץ", key: "file", width: 30 },
    { header: "גיליון", key: "sheet", width: 18 },
    { header: "שם", key: "name", width: 22 },
    { header: "בעיה", key: "issue", width: 70 },
  ];
  ws3.getRow(1).font = { bold: true };
  exceptions.forEach((e) => ws3.addRow(e));

  const outPath = path.join(folder, OUTPUT_FILE);
  await wb.xlsx.writeFile(outPath);
  return outPath;
}

// ---------- Main ----------

async function processWorkbookSheets(
  wb,
  file,
  config,
  employees,
  rawRows,
  exceptions,
  shiftIssues,
) {
  for (const sheet of wb.worksheets) {
    try {
      const sheetName = sheet.name;
      const sheetKey = `${file}::${sheetName}`;
      const headerInfo = detectHeaderRow(sheet);
      const headerRow = headerInfo ? headerInfo.row : null;
      const headerScanLimit = headerRow ? Math.max(1, headerRow - 1) : 30;

      // ---- Employee metadata extraction (header section only) ----
      // Strict rule: NEVER use the sheet name as the primary source.
      // Try the worksheet's metadata block first, then fall back to
      // employees_config.xlsx. Track the source per field for audit.
      let extractedName = detectEmployeeNameInHeader(sheet, headerRow);
      let nameSource = extractedName ? "header" : null;

      // Try inline ("מספר עובד: 1042" inside one cell) first, then the
      // classic label-adjacent layout. Same for work days.
      let extractedEmpNum = findInlineLabelValueInHeader(
        sheet,
        headerRow,
        EMPLOYEE_NUMBER_LABELS,
      );
      if (!extractedEmpNum) {
        extractedEmpNum = findValueNextToLabel(sheet, EMPLOYEE_NUMBER_LABELS, {
          number: false,
          maxRows: headerScanLimit,
        });
      }
      let empNumSource = extractedEmpNum ? "header" : null;

      let extractedDays = null;
      const inlineDays = findInlineLabelValueInHeader(
        sheet,
        headerRow,
        WORK_DAYS_LABELS,
      );
      if (inlineDays != null) {
        const n = Number(String(inlineDays).replace(/[^\d.\-]/g, ""));
        if (Number.isFinite(n)) extractedDays = n;
      }
      if (extractedDays == null) {
        extractedDays = findValueNextToLabel(sheet, WORK_DAYS_LABELS, {
          number: true,
          maxRows: headerScanLimit,
        });
      }
      let daysSource = extractedDays != null ? "header" : null;

      // Config fallback (looked up by extracted name).
      const cfg = extractedName ? config[extractedName] || null : null;
      if (!extractedEmpNum && cfg && cfg.employeeNumber) {
        extractedEmpNum = cfg.employeeNumber;
        empNumSource = "config";
      }
      if (extractedDays == null && cfg && cfg.workdays != null) {
        extractedDays = cfg.workdays;
        daysSource = "config";
      }

      // Other supporting context (still pulled from anywhere in the sheet
      // — these aren't part of the strict three-field rule).
      const sheetGlobal = detectGlobalInSheet(sheet);
      const sheetRate = findValueNextToLabel(sheet, HEADER_SYNONYMS.rate, {
        number: true,
      });
      const sheetNetGross = findValueNextToLabel(
        sheet,
        HEADER_SYNONYMS.netGross,
        { number: false },
      );
      const summaries = findSummaryRows(sheet, headerRow);

      // ---- Validation per the three required header fields ----
      if (!extractedName) {
        exceptions.push({
          file,
          sheet: sheetName,
          name: "",
          issue: "missing employee name",
        });
        // Without a name we can't aggregate this sheet — every employee
        // is keyed by name. Skip (raw rows for this sheet aren't useful
        // either since we don't know whose data it is).
        continue;
      }
      // Employee-number validation intentionally skipped — many source
      // files don't carry it and the column is allowed to stay blank.

      if (summaries.length === 0) {
        exceptions.push({
          file,
          sheet: sheetName,
          name: extractedName,
          issue: "No summary row found",
        });
        continue;
      }

      const summaryRowNumbers = new Set(summaries.map((s) => s.rowNumber));

      // Shift completeness validation: every כניסה must pair with a יציאה.
      if (shiftIssues) {
        const issues = findIncompleteShifts({
          worksheet: sheet,
          file,
          sheetName,
          employee: extractedName,
          headerInfo,
          summaryRowNumbers,
        });
        for (const i of issues) shiftIssues.push(i);
      }

      // Tertiary fallback for work days: count unique dates in the data
      // section. Allowed when both header and config are missing — this
      // is a date-based count, NOT recalculated from hours.
      if (extractedDays == null) {
        const c = countUniqueDatesInSheet(sheet, headerInfo, summaryRowNumbers);
        if (c != null) {
          extractedDays = c;
          daysSource = "dates";
        }
      }
      if (extractedDays == null) {
        exceptions.push({
          file,
          sheet: sheetName,
          name: extractedName,
          issue: "missing work days",
        });
      }

      const employeeName = extractedName;
      const emp = getOrCreateEmployee(employees, employeeName);
      emp.sheetsSeen.add(sheetKey);
      if (sheetGlobal) emp.global = true;
      const dates = collectWorkDates(sheet, headerInfo, summaryRowNumbers);
      for (const d of dates) emp.workDates.add(d);
      const daily = collectDailyBreakdown(sheet, headerInfo, summaryRowNumbers);
      for (const [d, entries] of Object.entries(daily)) {
        if (!emp.dailyBreakdown.has(d)) emp.dailyBreakdown.set(d, []);
        emp.dailyBreakdown.get(d).push(...entries);
      }
      const dailyHrs = collectDailyHours(sheet, headerInfo, summaryRowNumbers);
      for (const [d, hrs] of Object.entries(dailyHrs)) {
        emp.dailyHours.set(d, (emp.dailyHours.get(d) || 0) + hrs);
      }

      // National ID (ת.ז. / תעודת זהות) — distinct from employee number.
      let extractedIdNum = findInlineLabelValueInHeader(
        sheet,
        headerRow,
        ID_NUMBER_LABELS,
      );
      if (!extractedIdNum) {
        extractedIdNum = findValueNextToLabel(sheet, ID_NUMBER_LABELS, {
          number: false,
          maxRows: headerScanLimit,
        });
      }

      // Employee-level enrichment (first non-empty wins).
      emp.employeeNumber = chooseFirst(emp.employeeNumber, extractedEmpNum);
      emp.idNumber = chooseFirst(emp.idNumber, extractedIdNum);
      emp.netGross = chooseFirst(emp.netGross, sheetNetGross);
      if (cfg && cfg.netGross)
        emp.netGross = chooseFirst(emp.netGross, cfg.netGross);

      // Per-row audit string describing where each field came from.
      const extractionSource = `name=${nameSource || "missing"}, empnum=${empNumSource || "missing"}, days=${daysSource || "missing"}`;

      // Pre-compute per-summary normalized data so we can both write the
      // raw audit row and identify the כללי row in a single pass.
      const enriched = summaries.map((summary) => {
        const role =
          extractRoleFromLabel(summary.label) ||
          (cfg && cfg.defaultRole) ||
          "כללי";
        const data = extractFromSummaryRow(sheet, summary, headerInfo);
        const { value: h150Normalized, note: h150Note } = normalize150(
          data,
          headerInfo,
        );

        let rate = data.rate ?? sheetRate;
        let global = sheetGlobal;
        if (cfg) {
          if (rate == null && cfg.rate != null) rate = cfg.rate;
          if (cfg.global && /^(כן|true|1|yes|y)$/i.test(cfg.global))
            global = true;
        }
        const isGlobal = global || (rate == null && data.hours100 != null);

        return {
          summary,
          role,
          data,
          h150Normalized,
          h150Note,
          rate,
          isGlobal,
        };
      });

      // The general summary row is the SOLE source of Payroll_Summary
      // numerics. Role-specific rows only contribute their role label.
      const generalRows = enriched.filter((r) => r.role === "כללי");
      const generalRow = generalRows[0] || null;

      if (generalRows.length > 1) {
        emp.issues.add(
          `Multiple "סיכום כללי" rows in sheet ${sheetName} — used the first`,
        );
      }
      if (!generalRow) {
        emp.issues.add(`No "סיכום כללי" row in sheet ${sheetName}`);
      }

      // Emit Raw_Extract for every detected summary row, regardless of role.
      for (const e of enriched) {
        const isGeneral = e.role === "כללי";
        const isEmptyGeneral =
          isGeneral &&
          [
            e.data.hours100,
            e.data.hours125,
            e.h150Normalized,
            e.rate,
            e.data.tip,
            e.data.completion,
            e.data.travel,
          ].every((v) => v == null || v === 0);

        let skippedReason = "";
        if (isEmptyGeneral) skippedReason = "empty general summary row";
        else if (!isGeneral)
          skippedReason = "role-specific row (not used in Payroll_Summary)";

        rawRows.push({
          file,
          sheet: sheetName,
          extracted_employee_name: extractedName || "",
          extracted_employee_number: extractedEmpNum || "",
          extracted_work_days: extractedDays,
          extraction_source: extractionSource,
          name: employeeName,
          employee_number: emp.employeeNumber || "",
          label: e.summary.label,
          role: e.role,
          workdays: e.data.workdays,
          h100: e.data.hours100,
          h125: e.data.hours125,
          raw_150: e.data.hours150,
          raw_shabbat: e.data.shabbat,
          raw_hag: e.data.hag,
          raw_shabbat_hag: e.data.shabbatHag,
          normalized_150: e.h150Normalized,
          normalization_note: e.h150Note,
          rate: e.rate,
          netGross: emp.netGross || "",
          tip: e.data.tip,
          completion: e.data.completion,
          travel: e.data.travel,
          global: e.isGlobal ? "כן" : "",
          notes: e.data.notes || "",
          skipped_reason: skippedReason,
        });
      }

      // ---- Aggregate numerics from EVERY summary row ----
      // Role-specific rows feed per-role buckets; the כללי row feeds
      // the general bucket (rendered as the סה"כ row).
      let usedAny = false;
      for (const e of enriched) {
        const { role, data, h150Normalized, h150Note, rate, isGlobal } = e;
        if (bucketIsEmpty(data, h150Normalized)) continue;
        usedAny = true;

        if (role === "כללי") {
          emp.hasGeneral = true;
          addToBucket(emp.general, data, h150Normalized, rate);
          if (data.notes) emp.notes.add(data.notes);
        } else {
          if (!emp.rolesData.has(role)) emp.rolesData.set(role, newBucket());
          addToBucket(emp.rolesData.get(role), data, h150Normalized, rate);
        }

        if (isGlobal) emp.global = true;
        if (h150Note) emp.normalizationNotes.add(h150Note);
      }

      if (cfg && cfg.notes) emp.notes.add(cfg.notes);

      if (generalRow) {
        const { data, h150Normalized, rate, isGlobal } = generalRow;
        if (!bucketIsEmpty(data, h150Normalized)) {
          if (rate == null && !isGlobal) emp.issues.add("Hourly rate missing");
          if (
            data.hours100 == null &&
            data.hours125 == null &&
            h150Normalized == null &&
            !isGlobal
          ) {
            emp.issues.add("Hours columns unclear");
          }
        }
      }

      // ---- Per-sheet workday total ----
      // Use the value extracted from the worksheet's header section
      // (or config / date-count fallback computed above). Per-sheet
      // counts are summed across an employee's sheets.
      if (usedAny) {
        emp.workdaysPerSheet.set(sheetKey, {
          count: extractedDays,
          source: daysSource || "missing",
        });
        if (daysSource === "dates") emp.workdaysUncertain = true;
      }

      // Config-supplied defaults: applied per-bucket (per-role) rather
      // than at the employee level, so each role row keeps its own wage.
      if (cfg && cfg.rate != null) {
        if (emp.hasGeneral && emp.general.rate == null)
          emp.general.rate = cfg.rate;
        for (const bucket of emp.rolesData.values()) {
          if (bucket.rate == null) bucket.rate = cfg.rate;
        }
      }
    } catch (err) {
      exceptions.push({
        file,
        sheet: sheet.name,
        name: "",
        issue: `Failed to process sheet: ${err.message}`,
      });
    }
  }
}

async function main() {
  const folder = process.argv[2];
  if (!folder) {
    console.error("Usage: node payroll_summary.js /path/to/folder");
    process.exit(1);
  }

  const stat = await fsp.stat(folder).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    console.error(`Folder not found or not a directory: ${folder}`);
    process.exit(1);
  }

  const entries = await fsp.readdir(folder);
  const xlsxFiles = entries
    .filter((f) => f.toLowerCase().endsWith(".xlsx"))
    .filter((f) => !f.startsWith("~$"))
    .filter((f) => f !== OUTPUT_FILE)
    .filter((f) => f !== CONFIG_FILE)
    .sort();

  console.log(`Folder: ${folder}`);
  console.log(`Found ${xlsxFiles.length} workbook(s) to process.`);

  const config = await loadConfig(folder);
  const cfgCount = Object.keys(config).length;
  if (cfgCount)
    console.log(
      `Loaded ${cfgCount} config entr${cfgCount === 1 ? "y" : "ies"}.`,
    );

  const rawRows = [];
  const exceptions = [];
  const employees = new Map(); // employee name → accumulator

  for (const file of xlsxFiles) {
    const filepath = path.join(folder, file);
    console.log(`  Processing ${file} ...`);

    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.readFile(filepath);
    } catch (err) {
      exceptions.push({
        file,
        sheet: "",
        name: "",
        issue: `Failed to open workbook: ${err.message}`,
      });
      continue;
    }

    await processWorkbookSheets(
      wb,
      file,
      config,
      employees,
      rawRows,
      exceptions,
    );
  }

  // ---- Build Payroll_Summary rows + final validations ----
  const payroll = [];
  const normalizationFlagged = [];
  for (const emp of employees.values()) {
    // Aggregate workdays across sheets, summing distinct sheet contributions.
    let workdays = null;
    for (const w of emp.workdaysPerSheet.values()) {
      if (w.count != null) workdays = (workdays || 0) + w.count;
    }

    // Cross-sheet flags. (Per-sheet "missing employee name/number/work days"
    // exceptions are emitted in the main loop; we don't duplicate them here.)
    if (emp.workdaysUncertain && workdays != null) {
      emp.issues.add(
        "ימי עבודה derived from date-count fallback (header/config value missing) — verify",
      );
    }

    // Validate normalized 150% isn't absurdly high relative to other hours.
    // Accumulated and emitted as one consolidated warning after the loop.
    const g = emp.general;
    const otherHours = (g.h100 || 0) + (g.h125 || 0);
    if (g.h150 != null && g.h150 > 0 && g.h150 > otherHours) {
      normalizationFlagged.push(emp.name);
    }

    // Validation #10: general summary should approximately equal the sum
    // of per-role buckets. Emitted only when both sides have data.
    if (emp.hasGeneral && emp.rolesData.size > 0) {
      const rolesSum = sumRolesData(emp.rolesData);
      if (!bucketsApproxEqual(rolesSum, emp.general)) {
        emp.issues.add("general summary mismatch");
      }
    }

    // ---- Build the multi-row block for this employee per the spec ----
    const roleEntries = [...emp.rolesData.entries()];
    const blockRows = [];

    if (roleEntries.length === 1 && emp.hasGeneral) {
      // Single role + general → collapse to one role row (no סה"כ).
      const [role, bucket] = roleEntries[0];
      blockRows.push({ role, bucket, isTotal: false });
    } else if (roleEntries.length === 0 && emp.hasGeneral) {
      // Only general row → single סה"כ row.
      blockRows.push({ role: 'סה"כ', bucket: emp.general, isTotal: true });
    } else if (roleEntries.length > 0) {
      for (const [role, bucket] of roleEntries) {
        blockRows.push({ role, bucket, isTotal: false });
      }
      if (emp.hasGeneral) {
        blockRows.push({ role: 'סה"כ', bucket: emp.general, isTotal: true });
      }
    }
    // If the employee yielded no rows at all, skip them entirely.
    if (blockRows.length === 0) continue;

    payroll.push({
      name: emp.name,
      employeeNumber: emp.employeeNumber || "",
      workdays,
      netGross: emp.netGross || "",
      global: emp.global ? "כן" : "",
      rows: blockRows,
    });

    // Lift collected per-employee issues into exceptions.
    for (const issue of emp.issues) {
      exceptions.push({
        file: "",
        sheet: [...emp.sheetsSeen].join(", "),
        name: emp.name,
        issue,
      });
    }
  }

  // Single consolidated warning for all employees whose 150% hours look high.
  if (normalizationFlagged.length > 0) {
    exceptions.push({
      file: "",
      sheet: "",
      name: "",
      issue: `verify normalization — שעות 150% exceeds 100%+125% for: ${normalizationFlagged.join(", ")}`,
    });
  }

  // Stable sort by employee name (Hebrew-aware).
  payroll.sort((a, b) => a.name.localeCompare(b.name, "he"));

  const outPath = await writeOutput(folder, payroll, rawRows, exceptions);

  console.log("");
  console.log("Done.");
  console.log(`  Output:     ${outPath}`);
  console.log(`  Employees:  ${payroll.length}`);
  console.log(`  Raw:        ${rawRows.length} row(s)`);
  console.log(`  Exceptions: ${exceptions.length} row(s)`);

  // Print every exception to the screen by default — easier triage than
  // opening the workbook to read the Exceptions sheet.
  if (exceptions.length > 0) {
    console.log("");
    console.log("Exceptions:");
    for (const e of exceptions) {
      const where = [e.file, e.sheet].filter(Boolean).join(" / ") || "-";
      const who = e.name || "-";
      console.log(`  • [${where}] ${who}: ${e.issue}`);
    }
  }
}

async function extractEmployees(items, configMap = {}) {
  const employees = new Map();
  const rawRows = [];
  const exceptions = [];
  const shiftIssues = [];
  const monthCounts = new Map();
  for (const item of items) {
    const filename = item.filename || item.name || "uploaded.xlsx";
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(item.buffer);
    } catch (err) {
      exceptions.push({
        file: filename,
        sheet: "",
        name: "",
        issue: `Failed to open workbook: ${err.message}`,
      });
      continue;
    }
    for (const sheet of wb.worksheets) {
      try {
        const headerInfo = detectHeaderRow(sheet);
        const headerRow = headerInfo ? headerInfo.row : null;
        const ym = detectMonthInSheet(sheet, headerRow);
        if (ym) monthCounts.set(ym, (monthCounts.get(ym) || 0) + 1);
      } catch {
        // ignore
      }
    }
    await processWorkbookSheets(
      wb,
      filename,
      configMap,
      employees,
      rawRows,
      exceptions,
      shiftIssues,
    );
  }
  let month = null;
  if (monthCounts.size > 0) {
    let best = null;
    for (const [ym, n] of monthCounts.entries()) {
      if (!best || n > best[1]) best = [ym, n];
    }
    month = best ? best[0] : null;
  }
  const list = [...employees.values()].map((emp) => {
    const payroll_data = {};
    const role_extras = {};
    for (const [role, bucket] of emp.rolesData.entries()) {
      if (!role || role === "כללי") continue;
      payroll_data[role] = {
        hours: [bucket.h100 || 0, bucket.h125 || 0, bucket.h150 || 0],
        tip: bucket.tip || 0,
        completion: bucket.completion || 0,
      };
      role_extras[role] = {
        manualCompletion: bucket.manualCompletion || 0,
        travel: bucket.travel || 0,
        rate: bucket.rate ?? null,
      };
    }
    let workdays = 0;
    for (const w of emp.workdaysPerSheet.values()) {
      if (w && w.count != null) workdays += w.count;
    }
    return {
      name: emp.name,
      mic_nmbr: emp.employeeNumber || null,
      ID_nmbr: emp.idNumber || null,
      roles: Array.from(new Set([...emp.rolesData.keys()])).filter(
        (r) => r && r !== "כללי",
      ),
      payroll_data,
      role_extras,
      workdays: workdays || null,
      global: !!emp.global,
      netGross: emp.netGross || null,
      work_dates: Array.from(emp.workDates).sort(),
      daily_breakdown: Object.fromEntries(emp.dailyBreakdown),
      daily_hours: Object.fromEntries(emp.dailyHours),
    };
  });
  list.sort((a, b) => a.name.localeCompare(b.name, "he"));
  return { employees: list, exceptions, month, shiftIssues };
}

module.exports = { extractEmployees, main };

if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
