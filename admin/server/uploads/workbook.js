// Low-level helpers for the "Upload files" page: open a file, read cells as text,
// and read dates/times the way the source systems write them.
import ExcelJS from "exceljs";

// Strip bidi / zero-width marks, unify Hebrew geresh/gershayim and quotes, collapse spaces.
export const norm = (s) =>
  String(s == null ? "" : s)
    .replace(/[​-‏‪-‮⁦-⁩﻿]/g, "")
    .replace(/[׳‘’`´]/g, "'")
    .replace(/[״“”]/g, '"')
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();

// A name key for matching people / branches across systems: no quotes at all,
// no Tabit "*" prefix, no " - <role/branch>" suffix.
export const nameKey = (s) =>
  norm(s)
    .replace(/^\*+/, "")
    .replace(/\s+-\s+.*$/, "")
    .replace(/['"]/g, "")
    .trim();

// Cell value → plain text (rich text, formulas, hyperlinks, dates).
export const cellText = (v) => {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join("");
    if ("result" in v) return cellText(v.result);
    if ("text" in v) return cellText(v.text);
    return "";
  }
  return String(v);
};

// Cell value → number or null (formula results too).
export const cellNum = (v) => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "object" && "result" in v) return cellNum(v.result);
  const n = Number(String(cellText(v)).replace(/[,\s₪]/g, ""));
  return Number.isFinite(n) ? n : null;
};

const pad = (n) => String(n).padStart(2, "0");

// Excel stores local times; exceljs hands them back as UTC Dates with the same
// wall-clock digits. So the ISO string IS the local time.
export const dateOf = (v) => {
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  const t = norm(cellText(v));
  let m = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
};

// Date-time cell → 'YYYY-MM-DD HH:MM:SS' (local). A bare 'HH:MM' needs the day.
export const dateTimeOf = (v, day) => {
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 19).replace("T", " ");
  const t = norm(cellText(v));
  if (!t) return null;
  let m = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])} ${pad(m[4])}:${m[5]}:${m[6] || "00"}`;
  m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m && day) return `${day} ${pad(m[1])}:${m[2]}:${m[3] || "00"}`;
  return null;
};

// What kind of container the bytes are, before trying to open them.
export const containerOf = (buf, name) => {
  const head = buf.subarray(0, 512);
  if (head[0] === 0x50 && head[1] === 0x4b) return "zip"; // .xlsx (or another zip)
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) return "xls-binary";
  if (head.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  const text = buf.subarray(0, 4096).toString("utf8").replace(/^﻿/, "").trimStart().toLowerCase();
  if (text.startsWith("<?xml") && text.includes("urn:schemas-microsoft-com:office:spreadsheet")) return "xls-xml";
  if (text.startsWith("<") && (text.includes("<html") || text.includes("<table"))) return "html";
  if (/\.csv$/i.test(name || "")) return "csv";
  return "unknown";
};

export const loadWorkbook = async (buf) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
};

// The first rows of a sheet as arrays of normalized text (index 0 = column A).
export const topRows = (ws, maxRows = 15) => {
  const out = [];
  const last = Math.min(ws.rowCount, maxRows);
  for (let r = 1; r <= last; r++) {
    const row = ws.getRow(r);
    const cells = [];
    for (let c = 1; c <= ws.columnCount; c++) cells.push(norm(cellText(row.getCell(c).value)));
    out.push(cells);
  }
  return out;
};

// Index (1-based) of the first row whose cells include every wanted header.
export const findHeaderRow = (ws, wanted, maxRows = 15) => {
  const rows = topRows(ws, maxRows);
  for (let i = 0; i < rows.length; i++) {
    const set = new Set(rows[i]);
    if (wanted.every((w) => set.has(w))) return i + 1;
  }
  return 0;
};

// header text → column number (1-based), for one row.
export const headerMap = (ws, rowNo) => {
  const map = new Map();
  const row = ws.getRow(rowNo);
  for (let c = 1; c <= ws.columnCount; c++) {
    const h = norm(cellText(row.getCell(c).value));
    if (h && !map.has(h)) map.set(h, c);
  }
  return map;
};

const HEB_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

// 'יולי 2026' → '2026-07'
export const hebMonth = (s) => {
  const t = norm(s);
  for (let i = 0; i < HEB_MONTHS.length; i++) {
    const m = t.match(new RegExp(`${HEB_MONTHS[i]}\\s+(\\d{4})`));
    if (m) return `${m[1]}-${pad(i + 1)}`;
  }
  return null;
};

export const monthBounds = (month) => {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${pad(last)}` };
};
