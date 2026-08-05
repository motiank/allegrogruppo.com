#!/usr/bin/env node
// scripts/payslips_to_micpal.js
//
// Read a Micpal (מיכפל) salary-slip PDF — one payslip per page — and rebuild the
// Micpal *import* xlsx from it (same format as admin/server/modules/MicpImportXL.js),
// so a batch of already-printed slips can be re-imported.
//
//   node scripts/payslips_to_micpal.js "<input.pdf>" [outDir]
//
// Defaults: outDir = the input PDF's folder.
// Requires the `pdftotext` CLI (poppler-utils) on PATH.
//
// One xlsx is written per company (חברה) found in the PDF. After writing, the
// script prints a report of everything that could NOT be placed into an import
// column — unmapped pay components, voluntary deductions (tips, pension…), and
// any per-employee total that the mapped columns don't reconcile against the
// slip's "סה\"כ תשלומים".
//
// MAPPING (payslip component -> import column). Only unambiguous reconstructions
// are mapped; anything semantically uncertain is deliberately left for the report
// so a human decides, rather than silently guessing at payroll numbers.
//
//   001 משכורת        -> שכר שעתי (rate)  + שעות 100% (qty)
//   007 ש.נוס 125%    -> שכר 125% (rate)  + שעות 125% (qty)
//   008 ש.נוס 150%    -> שכר 150% (rate)  + שעות 150% (qty)
//   009 ש.שבת         -> שבת (qty, hours)
//   004 נסיעות        -> נסיעות (amount)
//   006 השלמה         -> השלמה (amount)
//   ימי עבודה         -> ימי עבודה
//   י"ע בחברה         -> תקן ימים
//   ש"ע בחברה         -> תקן שעות
//
// NOT auto-mapped (reported as "couldn't fit"):
//   031 פדיון חופש  — "redemption" ≠ the import's "ניצול חופש" (utilization)
//   005 הבראה, 013 מחלה, 061 התלמדות — no matching import column
//   08 טיפים & other נכויי רשות (pension, funds) — deductions, not import inputs

import { execFileSync } from "child_process";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import MicpImportXL from "../admin/server/modules/MicpImportXL.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const INPUT =
  process.argv[2] ||
  "/home/moti/Downloads/תלושי משכורת 6.26 ראש פינה.pdf";
const OUT_DIR = process.argv[3] || path.dirname(INPUT);

// ---------- bidi / text helpers ----------------------------------------------
const CF = /\p{Cf}/gu; // Unicode format (bidi control) chars
const strip = (s) => s.replace(CF, "");
const isHeb = (t) => /[֐-׿]/.test(t);
const revWord = (t) => (isHeb(t) ? [...t].reverse().join("") : t);
// Reconstruct a visual line as human-readable RTL text (right-most word first,
// Hebrew letters un-reversed).
const rtl = (toks) =>
  toks
    .slice()
    .sort((a, b) => b.x - a.x)
    .map((w) => revWord(w.t))
    .join(" ");
const isNum = (t) => /^-?\d*\.?\d+$/.test(t.replace(/,/g, ""));
const toNum = (t) => Number(String(t).replace(/,/g, ""));

// ---------- PDF -> per-page word boxes ---------------------------------------
function readPages(pdfPath) {
  const xml = execFileSync("pdftotext", ["-bbox-layout", pdfPath, "-"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const pageChunks = xml.split("<page").slice(1);
  const wordRe =
    /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/word>/g;
  const unescape = (s) =>
    s
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  return pageChunks.map((chunk) => {
    const rows = new Map(); // y -> [{x,t}]
    let m;
    while ((m = wordRe.exec(chunk))) {
      const t = strip(unescape(m[5])).trim();
      if (!t) continue;
      const x = parseFloat(m[1]);
      const y = Math.round(parseFloat(m[2]));
      let key = y;
      for (const k of rows.keys())
        if (Math.abs(k - y) <= 2) {
          key = k;
          break;
        }
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push({ x, t });
    }
    return rows;
  });
}

// ---------- component code -> import column ----------------------------------
// value: "rate+qty" (fill two columns), "qty", or "amount".
const PAY_MAP = {
  "001": { rate: "hourlyWage", qty: "hours100" },
  "007": { rate: "wage125", qty: "hours125" },
  "008": { rate: "wage150", qty: "hours150" },
  "009": { qty: "shabbat" },
  "004": { amount: "travel" },
  "006": { amount: "completion" },
};
const PAY_LABEL = {
  "001": "משכורת",
  "007": "ש.נוס 125%",
  "008": "ש.נוס 150%",
  "009": "ש.שבת",
  "004": "נסיעות",
  "006": "השלמה",
  "031": "פדיון חופש",
  "005": "הבראה",
  "013": "מחלה",
  "061": "התלמדות",
};

// ---------- parse one payslip page -------------------------------------------
function parsePage(rows) {
  const ys = [...rows.keys()].sort((a, b) => a - b);
  const lineText = new Map();
  for (const y of ys) lineText.set(y, rtl(rows.get(y)));
  const text = ys.map((y) => lineText.get(y)).join("\n");

  const grab = (re) => {
    const m = text.match(re);
    return m ? m[1] : null;
  };

  const rec = {
    empNo: grab(/מספר העובד[:\s]*0*(\d+)/),
    ID_nmbr: grab(/מספר זהות[:\s]*(\d+)/),
    company: grab(/חברה\s*:?\s*(\d{3})/),
    companyName: (() => {
      const m = text.match(
        /חברה\s*:?\s*\d{3}\s*-?\s*(.+?)\s+(?:תיק|מספר|כתובת|ישוב|תלוש|הודפס|\n|$)/,
      );
      return m ? m[1].trim() : "";
    })(),
    month: grab(/לחודש\s*(\d{2})\/\d{4}/),
    year: grab(/לחודש\s*\d{2}\/(\d{4})/),
    name: (() => {
      // "לכבוד" then the employee name row (2 Hebrew words) just below it.
      const li = ys.findIndex((y) => /לכבוד/.test(lineText.get(y)));
      for (let i = li + 1; i < ys.length && i <= li + 3; i++) {
        const toks = rows.get(ys[i]).filter((w) => w.x >= 480 && isHeb(w.t));
        if (toks.length >= 2) return rtl(toks);
      }
      return "";
    })(),
    workdays: grab(/ימי עבודה\s+([\d.]+)/),
    standardDays: grab(/י"ע בחברה\s+([\d.]+)/),
    standardHours: grab(/ש"ע בחברה\s+([\d.]+)/),
    payTotal: grab(/תשלומים\s+([\d.]+)/),
    net: grab(/שכר נטו\s+([\d.]+)/),
    toPay: grab(/לתשלום\s+([\d.]+)/),
    components: [], // {code,label,qty,rate,amount}
    deductions: [], // {label,amount}  (נכויי חובה + רשות)
  };

  const hdrY = ys.find(
    (y) => /תאור/.test(lineText.get(y)) && /התשלום/.test(lineText.get(y)),
  );
  const totY = ys.find((y) => /תשלומים/.test(lineText.get(y)) && /סה/.test(lineText.get(y)));

  for (const y of ys) {
    const toks = rows.get(y);
    // Deduction row: amount at far-left (x<75) + Hebrew label at 95..175.
    const dAmt = toks.find((w) => w.x < 75 && isNum(w.t));
    const dLbl = toks.filter((w) => w.x >= 95 && w.x < 175 && isHeb(w.t));
    if (dAmt && dLbl.length) {
      const label = rtl(dLbl);
      if (!/נכויי|הניכוי|לתשלום|נטו/.test(label))
        rec.deductions.push({ label, amount: toNum(dAmt.t) });
    }

    // Payment component rows live between the table header and the total row.
    if (hdrY == null || totY == null || y <= hdrY || y >= totY) continue;
    const desc = toks.filter((w) => w.x >= 480);
    if (!desc.some((w) => isHeb(w.t))) continue; // skip the diagonal watermark
    const band = (a, b) => {
      const v = toks.find((w) => w.x >= a && w.x < b && isNum(w.t));
      return v ? toNum(v.t) : null;
    };
    const code = desc
      .filter((w) => isNum(w.t))
      .sort((a, b) => b.x - a.x)
      .map((w) => w.t)
      .join("");
    const dtext = rtl(desc.filter((w) => isHeb(w.t)));
    const amount = band(170, 238);
    const rate = band(352, 408);
    const qty = band(408, 468);
    if (!code && amount == null && rate == null && qty == null) continue;
    rec.components.push({ code, label: dtext, qty, rate, amount });
  }
  return rec;
}

// ---------- payslip record -> Micpal import row ------------------------------
function toMicRow(rec) {
  const row = {
    keyName: rec.empNo || "",
    ID_nmbr: rec.ID_nmbr || "",
    workdays: rec.workdays,
    standardDays: rec.standardDays,
    standardHours: rec.standardHours,
  };
  const unmapped = [];
  for (const c of rec.components) {
    const map = PAY_MAP[c.code];
    if (!map) {
      unmapped.push(c);
      continue;
    }
    if (map.rate) row[map.rate] = c.rate;
    if (map.qty) row[map.qty] = c.qty;
    if (map.amount) row[map.amount] = c.amount;
  }
  return { row, unmapped };
}

// ---------- main -------------------------------------------------------------
async function main() {
  if (!fs.existsSync(INPUT)) {
    console.error(`Input PDF not found: ${INPUT}`);
    process.exit(1);
  }
  console.log(`Reading: ${INPUT}`);
  const pages = readPages(INPUT);
  const records = pages
    .map(parsePage)
    .filter((r) => r.empNo && r.company); // real payslip pages only

  console.log(`Parsed ${records.length} payslip(s) from ${pages.length} page(s)\n`);

  // group by company
  const byCompany = new Map();
  for (const r of records) {
    if (!byCompany.has(r.company)) byCompany.set(r.company, []);
    byCompany.get(r.company).push(r);
  }

  const base = path.basename(INPUT, path.extname(INPUT));
  const report = []; // lines for the "couldn't fit" report (English)
  const issues = []; // structured, for the Hebrew report
  const tally = new Map(); // reason -> count
  const bump = (k) => tally.set(k, (tally.get(k) || 0) + 1);
  let outFiles = [];
  let meta = {};

  for (const [company, recs] of byCompany) {
    const { year, month, companyName } = recs[0];
    const rows = [];
    for (const rec of recs) {
      const { row, unmapped } = toMicRow(rec);
      rows.push(row);

      // reconciliation: mapped pay vs slip total
      const mappedPay = rec.components
        .filter((c) => PAY_MAP[c.code])
        .reduce((s, c) => s + (c.amount ?? (c.qty ?? 0) * (c.rate ?? 0)), 0);
      const total = rec.payTotal ? toNum(rec.payTotal) : null;
      const gap = total != null ? Math.round((total - mappedPay) * 100) / 100 : null;

      const who = `#${rec.empNo} ${rec.name || ""} (ת.ז ${rec.ID_nmbr})`.trim();
      const notes = [];
      const payItems = [];
      for (const c of unmapped) {
        const label = PAY_LABEL[c.code] || c.label || "?";
        const amt = c.amount ?? (c.qty ?? 0) * (c.rate ?? 0);
        notes.push(
          `  ↳ pay component [${c.code || "?"}] ${label}: ` +
            `qty=${c.qty ?? "-"} rate=${c.rate ?? "-"} amount=${round(amt)} → no import column`,
        );
        bump(`pay component: ${label}`);
        payItems.push({ code: c.code, label, qty: c.qty, rate: c.rate, amount: amt });
      }
      const voluntary = rec.deductions.filter((d) =>
        /טיפ|פנסי|השתלמות|מבטח|מנורה|מיטב|קרן|גמל/.test(d.label),
      );
      for (const d of voluntary) {
        notes.push(`  ↳ deduction "${d.label}": ${round(d.amount)} → not an import field`);
        bump(`deduction: ${d.label}`);
      }
      const unrec = gap != null && Math.abs(gap) >= 0.5 ? gap : null;
      if (unrec != null)
        notes.push(
          `  ↳ unreconciled: slip total ${round(total)} − mapped ${round(mappedPay)} = ${round(gap)}`,
        );
      if (notes.length) {
        report.push(`${who}\n${notes.join("\n")}`);
        issues.push({
          empNo: rec.empNo,
          name: rec.name || "",
          ID: rec.ID_nmbr,
          payItems,
          deductions: voluntary,
          total,
          mappedPay,
          unrec,
        });
      }
    }

    meta = { company, companyName, year, month };
    const xl = new MicpImportXL({
      company: `${company} ${companyName}`.trim(),
      year: year || "",
      month: month || "",
    });
    const buf = await xl.generate(rows);
    const outName = `micpal-import-${base}-חברה${company}.xlsx`;
    const outPath = path.join(OUT_DIR, outName);
    fs.writeFileSync(outPath, buf);
    outFiles.push({ outPath, count: rows.length, company, companyName });
  }

  console.log("=== Generated import files ===");
  for (const f of outFiles)
    console.log(`  ${f.outPath}  (${f.count} employees, חברה ${f.company} ${f.companyName})`);

  const header =
    `Fields that could NOT be placed into the import ` +
    `(${report.length} employee(s) affected)`;
  console.log(`\n=== ${header} ===`);
  if (!report.length) console.log("  (none — every component mapped and reconciled)");
  else console.log(report.join("\n\n"));

  if (tally.size) {
    console.log("\n=== Summary by type ===");
    for (const [k, v] of [...tally.entries()].sort((a, b) => b[1] - a[1]))
      console.log(`  ${v.toString().padStart(3)}×  ${k}`);
  }

  // Persist the report next to the xlsx for later review.
  const reportPath = path.join(OUT_DIR, `micpal-import-${base}-couldnt-fit.txt`);
  const tallyTxt = [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${String(v).padStart(3)}×  ${k}`)
    .join("\n");
  fs.writeFileSync(
    reportPath,
    `${header}\n\n${report.join("\n\n")}\n\n=== Summary by type ===\n${tallyTxt}\n`,
  );
  console.log(`\nReport saved: ${reportPath}`);

  // ----- Hebrew report for the accountant -----
  const hebPath = path.join(OUT_DIR, `micpal-import-${base}-לא-נכלל.txt`);
  fs.writeFileSync(hebPath, buildHebrewReport(issues, tally, meta, base));
  console.log(`דוח בעברית נשמר: ${hebPath}`);
}

function buildHebrewReport(issues, tally, meta, base) {
  const ils = (n) =>
    n == null ? "-" : (Math.round(n * 100) / 100).toLocaleString("en-US") + ' ש"ח';
  const L = [];
  L.push('דוח: רכיבים שלא נכללו בקובץ הייבוא למיכפל');
  L.push("=".repeat(60));
  L.push(`קובץ מקור: ${base}.pdf`);
  L.push(
    `חברה: ${meta.company || ""} ${meta.companyName || ""}`.trim() +
      `    חודש שכר: ${meta.month || ""}/${meta.year || ""}`,
  );
  L.push("");
  L.push(
    "הסבר: הרכיבים המפורטים למטה מופיעים בתלושים אך אינם נכנסים אוטומטית",
  );
  L.push(
    "לקובץ הייבוא (Excel) — כי אין להם עמודה מתאימה בפורמט הייבוא, או שהם",
  );
  L.push(
    "ניכויי רשות שמיכפל מחשב בעצמו. יש לעבור על הרשימה ולהחליט לכל רכיב",
  );
  L.push("האם להזין אותו ידנית במיכפל או להשאיר כפי שהוא.");
  L.push("");

  const withPay = issues.filter((e) => e.payItems.length || e.unrec != null);
  const withDed = issues.filter((e) => e.deductions.length);

  L.push("");
  L.push("■ חלק א׳ — רכיבי תשלום שלא נכללו (דורש טיפול / הזנה ידנית)");
  L.push("─".repeat(60));
  if (!withPay.length) L.push("  אין.");
  for (const e of withPay) {
    L.push(`עובד #${e.empNo}  ${e.name}  (ת.ז ${e.ID})`);
    for (const p of e.payItems) {
      const detail =
        p.qty != null && p.rate != null
          ? `כמות ${p.qty} × תעריף ${p.rate} = ${ils(p.amount)}`
          : ils(p.amount);
      L.push(`   • ${p.label} (קוד ${p.code || "?"}): ${detail}  ← אין עמודה בייבוא`);
    }
    if (e.unrec != null)
      L.push(
        `   • סכום שלא שובץ בייבוא: ${ils(e.total)} בתלוש, מתוכם שובצו ${ils(
          e.mappedPay,
        )} — חסר ${ils(e.unrec)}`,
      );
    L.push("");
  }

  L.push("");
  L.push("■ חלק ב׳ — ניכויי רשות שלא נכללו (לידיעה בלבד — מיכפל מחשב לבד)");
  L.push("─".repeat(60));
  if (!withDed.length) L.push("  אין.");
  for (const e of withDed) {
    L.push(`עובד #${e.empNo}  ${e.name}  (ת.ז ${e.ID})`);
    for (const d of e.deductions) L.push(`   • ${d.label}: ${ils(d.amount)}`);
    L.push("");
  }

  L.push("");
  L.push("■ סיכום לפי סוג");
  L.push("─".repeat(60));
  for (const [k, v] of [...tally.entries()].sort((a, b) => b[1] - a[1])) {
    const heb = k
      .replace(/^pay component: /, "רכיב תשלום: ")
      .replace(/^deduction: /, "ניכוי רשות: ");
    L.push(`   ${String(v).padStart(3)} עובדים —  ${heb}`);
  }
  L.push("");
  return L.join("\n") + "\n";
}

const round = (n) =>
  n == null ? "-" : (Math.round(n * 100) / 100).toLocaleString("en-US");

main().catch((e) => {
  console.error("Failed:", e);
  process.exit(1);
});
