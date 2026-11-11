// Builds shared/priority_cheques.json from the Priority cheque export (scripts/data/priority-cheque.xlsx).
//
// The file is history: every cheque Pasta Lina wrote in Priority (April 2025 – March 2026, before Hashavshevet took
// over), one row per paid invoice, so a cheque that paid several invoices has several rows. The JSON keeps one record
// per payment (= one cheque) with its invoice lines. It is a constant file — run this only if the export changes:
//   node scripts/priority_cheques_import.js [path/to/priority-cheque.xlsx]
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import ExcelJS from "exceljs";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = process.argv[2] || path.join(here, "data", "priority-cheque.xlsx");
const out = path.join(here, "..", "shared", "priority_cheques.json");

// Priority's column titles → our field names (the sheet's order may change, the titles should not)
const COLUMNS = {
  "מספר תשלום": "payment", "תאריך": "payDate", "ת. המחאה": "chequeDate", "קוד חשבון בנק": "bankAccount", "מספר המחאה": "cheque",
  "חשבון ספק": "supplierAccount", "תאור": "supplier", "מס. חשבונית פנימי": "internal", "מס. חשבונית ספק": "invoice",
  "תאריך חשבונית": "invoiceDate", "פרטים": "details", "סכום התשלום": "amount", "הנחה": "discount", "% ניכוי": "withholdingPct",
  "נכוי מס": "withholding", "נטו לתשלום": "net", "מטבע": "currency",
};

const text = (v) => {
  if (v == null) return null;
  if (typeof v === "object" && v.richText) v = v.richText.map((t) => t.text).join("");
  if (typeof v === "object" && v.result !== undefined) v = v.result;
  const s = String(v).trim();
  return s === "" ? null : s;
};
const day = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : text(v));
const num = (v) => (v == null || v === "" ? 0 : Math.round(Number(v) * 100) / 100);
const intOrNull = (v) => { const s = text(v); return s && /^\d+$/.test(s) ? Number(s) : null; };

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(src);
const ws = wb.worksheets[0];
const head = [];
ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => (head[i] = COLUMNS[text(c.value)] || null));
for (const k of Object.values(COLUMNS)) if (!head.includes(k)) throw new Error(`column for "${k}" not found in ${src}`);

const byPayment = new Map();
ws.eachRow((row, r) => {
  if (r === 1) return;
  const v = {};
  row.eachCell({ includeEmpty: true }, (c, i) => { if (head[i]) v[head[i]] = c.value; });
  const payment = text(v.payment);
  if (!payment) return;
  const line = { internal: text(v.internal), invoice: text(v.invoice), invoiceDate: day(v.invoiceDate), details: text(v.details), amount: num(v.amount), withholding: num(v.withholding), net: num(v.net) };
  if (!byPayment.has(payment)) {
    byPayment.set(payment, {
      payment, cheque: intOrNull(v.cheque), payDate: day(v.payDate), chequeDate: day(v.chequeDate), bankAccount: text(v.bankAccount), currency: text(v.currency),
      supplierAccount: text(v.supplierAccount), supplier: text(v.supplier), amount: 0, withholdingPct: num(v.withholdingPct), withholding: 0, net: 0, details: null, lines: [],
    });
  }
  const p = byPayment.get(payment);
  p.amount = Math.round((p.amount + line.amount) * 100) / 100;
  p.withholding = Math.round((p.withholding + line.withholding) * 100) / 100;
  p.net = Math.round((p.net + line.net) * 100) / 100;
  p.lines.push(line);
});

const cheques = [...byPayment.values()].map((p) => {
  const details = [...new Set(p.lines.map((l) => l.details).filter(Boolean))];
  const invoices = p.lines.filter((l) => l.internal || l.invoice).length;
  return { ...p, details: details.join(" | ") || null, lines: p.lines.length > 1 || invoices ? p.lines : [] };
}).sort((a, b) => (a.cheque ?? Infinity) - (b.cheque ?? Infinity) || a.payment.localeCompare(b.payment));

const dates = (k) => cheques.map((c) => c[k]).filter(Boolean).sort();
const json = {
  source: "Priority",
  about: "Every cheque Pasta Lina wrote in Priority before Hashavshevet (history, constant). One record per payment = one cheque; amount = before withholding tax, net = the amount written on the cheque; lines = the invoices it paid (empty when the payment had one line without an invoice).",
  company: "pastaLina",
  file: path.basename(src),
  builtAt: new Date().toISOString().slice(0, 10),
  payDates: { from: dates("payDate")[0], to: dates("payDate").at(-1) },
  chequeDates: { from: dates("chequeDate")[0], to: dates("chequeDate").at(-1) },
  count: cheques.length,
  withoutNumber: cheques.filter((c) => c.cheque == null).length,
  net: Math.round(cheques.reduce((s, c) => s + c.net, 0) * 100) / 100,
  cheques,
};
// one cheque per line: readable diffs, half the size of an indented file
const { cheques: list, ...meta } = json;
fs.writeFileSync(out, `${JSON.stringify(meta, null, 1).replace(/\n}$/, ",\n \"cheques\": [\n")}${list.map((c) => "  " + JSON.stringify(c)).join(",\n")}\n ]\n}\n`);
console.log(`${out}: ${json.count} cheques (${json.withoutNumber} without a number), net ${json.net}, cheque dates ${json.chequeDates.from} – ${json.chequeDates.to}, ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
