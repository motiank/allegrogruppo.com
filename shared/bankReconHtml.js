// Detailed bank reconciliation report (דוח התאמת בנק מפורט) — the Hebrew, right-to-left HTML of a report
// built by admin/server/modules/bankRecon.js. Pure: a report object in, an HTML string out. Used by the admin
// server (GET /admin/bank-recon/report?format=html) and by the admin page (rendered inside the page).
//
// Signs everywhere: money into the bank is plus, money out is minus — on the bank side and on the books side.

const nf = new Intl.NumberFormat("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 0 });

export const fmtMoney = (n) => (n == null || n === "" ? "" : nf.format(Number(n)));
export const fmtInt = (n) => (n == null ? "" : nf0.format(Number(n)));
export const fmtDate = (iso) => {
  if (!iso) return "";
  const s = String(iso).slice(0, 10);
  const [y, m, d] = s.split("-");
  return y && m && d ? `${d}/${m}/${y}` : s;
};
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const money = (n, { strong = false } = {}) => {
  if (n == null) return `<td class="num"></td>`;
  const v = Number(n);
  const cls = `num${v < 0 ? " neg" : ""}${strong ? " strong" : ""}`;
  return `<td class="${cls}">${fmtMoney(v)}</td>`;
};
const cell = (s, cls = "") => `<td${cls ? ` class="${cls}"` : ""}>${esc(s)}</td>`;

export const CHEQUE_STATUS_LABEL = {
  cleared: "נפרע",
  cleared_group: "הותאם בקבוצה (שורת הבנק לא זוהתה בוודאות)",
  cleared_unmatched: "נפרע בבנק – טרם הותאם בספרים",
  past_due: "לא נפרע – מועד הפירעון עבר",
  not_due: "טרם הגיע מועד הפירעון",
};

const SECTION_TITLES = {
  bankOpen: "1. תנועות בנק ללא התאמה בספרים",
  bookOpen: "2. תנועות ספרים ללא התאמה בבנק",
  bookFuture: "2ב. תנועות ספרים בתאריך מאוחר שכבר הותאמו לבנק",
  chequesCleared: "3א. פירעון צ'קים – צ'קים שנפרעו בבנק",
  chequesOpen: "3ב. צ'קים שהונפקו וטרם נפרעו",
};

export const CSS = `
.bank-recon{direction:rtl;font-family:Arial,"Segoe UI",Tahoma,sans-serif;font-size:13px;color:#222;line-height:1.45}
.bank-recon *{box-sizing:border-box}
.bank-recon h1{font-size:20px;margin:0 0 4px}
.bank-recon h2{font-size:16px;margin:28px 0 8px;border-bottom:2px solid #444;padding-bottom:4px}
.bank-recon .meta{color:#555;font-size:12px;margin-bottom:12px}
.bank-recon .meta span{margin-left:18px;white-space:nowrap}
.bank-recon table{border-collapse:collapse;width:100%;margin:6px 0 10px}
.bank-recon th,.bank-recon td{border:1px solid #c9c9c9;padding:4px 7px;text-align:right;vertical-align:top}
.bank-recon th{background:#eef1f5;font-weight:700;white-space:nowrap}
.bank-recon td.num,.bank-recon th.num{text-align:left;font-variant-numeric:tabular-nums;white-space:nowrap;direction:ltr}
.bank-recon td.neg{color:#b00020}
.bank-recon td.strong,.bank-recon tr.total td{font-weight:700}
.bank-recon tr.total td{background:#f4f6f9}
.bank-recon tr.older td{color:#777;background:#fafafa}
.bank-recon tr.sub td{background:#f7f7f7;font-style:italic;color:#555}
.bank-recon .empty{color:#666;font-style:italic;padding:6px 0}
.bank-recon .notes{background:#fff8e1;border:1px solid #f0d58c;padding:8px 12px;margin:10px 0;border-radius:4px}
.bank-recon .notes li{margin:2px 0}
.bank-recon .summary{max-width:720px}
.bank-recon .summary td:first-child{width:70%}
.bank-recon .sign{font-size:11px;color:#666}
.bank-recon .count{color:#555;font-size:12px}
@media print{.bank-recon h2{page-break-after:avoid}.bank-recon table{page-break-inside:auto}.bank-recon tr{page-break-inside:avoid}}
`;

function header(r) {
  const acc = r.account || {};
  return `
<h1>דוח התאמת בנק מפורט</h1>
<div class="meta">
  <span><b>חברה:</b> ${esc(r.company?.name || r.company?.code || "")}</span>
  <span><b>חשבון בנק:</b> ${esc(acc.name || "")} (${esc(acc.key || "")})</span>
  <span><b>תקופה:</b> ${fmtDate(r.from)} – ${fmtDate(r.to)}</span>
  <span><b>נכון ליום:</b> ${fmtDate(r.to)}</span>
  <span><b>נתונים עד:</b> ${fmtDate(r.dataUpTo)}</span>
  <span><b>סנכרון אחרון:</b> ${esc(r.lastSync ? String(r.lastSync).slice(0, 16).replace("T", " ") : "")}</span>
  <span><b>הופק:</b> ${esc(r.generatedAt ? String(r.generatedAt).slice(0, 16).replace("T", " ") : "")}</span>
</div>
<div class="sign">סימנים: כניסה לבנק = פלוס, יציאה מהבנק = מינוס, גם בצד הבנק וגם בצד הספרים. "ימים" = ימים מתאריך התנועה עד ${fmtDate(r.to)}.</div>`;
}

function notes(r) {
  if (!r.notes?.length) return "";
  return `<div class="notes"><b>הערות</b><ul>${r.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>`;
}

function summary(r) {
  const s = r.summary;
  const line = (label, value, { count, strong, cls } = {}) =>
    `<tr${cls ? ` class="${cls}"` : ""}><td>${esc(label)}${count != null ? ` <span class="count">(${fmtInt(count)} תנועות)</span>` : ""}</td>${money(value, { strong })}</tr>`;
  return `
<h2>סיכום</h2>
<table class="summary">
  <thead><tr><th>סעיף</th><th class="num">סכום</th></tr></thead>
  <tbody>
    ${line("יתרה בבנק לפי דף הבנק", s.bankBalance, { strong: true })}
    ${line("פחות: תנועות בנק ללא התאמה בספרים (סעיף 1)", -s.bankOpen.total, { count: s.bankOpen.count })}
    ${s.bankOpen.beforeCount ? line(`מתוכן מלפני ${fmtDate(r.from)}`, -s.bankOpen.beforeTotal, { count: s.bankOpen.beforeCount, cls: "sub" }) : ""}
    ${line("ועוד: תנועות ספרים ללא התאמה בבנק (סעיף 2)", s.bookOpen.total, { count: s.bookOpen.count })}
    ${s.bookOpen.beforeCount ? line(`מתוכן מלפני ${fmtDate(r.from)}`, s.bookOpen.beforeTotal, { count: s.bookOpen.beforeCount, cls: "sub" }) : ""}
    ${line("ועוד: צ'קים שהונפקו וטרם נפרעו (סעיף 3ב)", s.chequesOpen.total, { count: s.chequesOpen.count })}
    ${line("מתוכם – מועד הפירעון עבר", s.chequesOpen.pastDueTotal, { count: s.chequesOpen.pastDueCount, cls: "sub" })}
    ${line("מתוכם – טרם הגיע מועד הפירעון", s.chequesOpen.notDueTotal, { count: s.chequesOpen.notDueCount, cls: "sub" })}
    ${s.chequesOpen.clearedUnmatchedCount ? line("מתוכם – נפרעו בבנק אך טרם הותאמו בספרים", s.chequesOpen.clearedUnmatchedTotal, { count: s.chequesOpen.clearedUnmatchedCount, cls: "sub" }) : ""}
    ${s.bookFutureMatched?.count ? line(`פחות: תנועות ספרים בתאריך מאוחר מ-${fmtDate(r.to)} שכבר הותאמו לבנק (סעיף 2ב)`, -s.bookFutureMatched.total, { count: s.bookFutureMatched.count }) : ""}
    ${line("= יתרה צפויה בספרים", s.expectedBookBalance, { strong: true, cls: "total" })}
    ${line("יתרה בספרים בפועל", s.bookBalance, { strong: true })}
    ${line("הפרש לא מוסבר", s.unexplained, { strong: true, cls: "total" })}
  </tbody>
</table>
<table class="summary">
  <tbody>
    ${line("צ'קים שנפרעו בתקופה (סעיף 3א)", s.chequesCleared.total, { count: s.chequesCleared.count })}
    ${line("סכום כל תנועות הבנק עד התאריך (לבדיקה מול היתרה)", s.bankLinesSum)}
  </tbody>
</table>`;
}

const olderClass = (row, from) => (row.date && from && String(row.date) < String(from) ? "older" : "");

function bankOpenTable(r) {
  const rows = r.bankOpen || [];
  if (!rows.length) return `<h2>${SECTION_TITLES.bankOpen}</h2><div class="empty">אין תנועות בנק פתוחות.</div>`;
  return `
<h2>${SECTION_TITLES.bankOpen}</h2>
<table>
  <thead><tr><th>תאריך</th><th>אסמכתא</th><th>פרטים</th><th class="num">סכום</th><th class="num">ימים</th><th>שנה</th></tr></thead>
  <tbody>
    ${rows
      .map(
        (x) => `<tr class="${olderClass(x, r.from)}">${cell(fmtDate(x.date))}${cell(x.reference)}${cell(x.details)}${money(x.amount)}${cell(x.ageDays, "num")}${cell(x.year)}</tr>`,
      )
      .join("")}
    <tr class="total"><td colspan="3">סה"כ ${fmtInt(rows.length)} תנועות</td>${money(r.summary.bankOpen.total)}<td></td><td></td></tr>
  </tbody>
</table>`;
}

function bookOpenTable(r) {
  const rows = r.bookOpen || [];
  if (!rows.length) return `<h2>${SECTION_TITLES.bookOpen}</h2><div class="empty">אין תנועות ספרים פתוחות (ללא צ'קים).</div>`;
  return `
<h2>${SECTION_TITLES.bookOpen}</h2>
<table>
  <thead><tr><th>תאריך</th><th>אסמכתא</th><th>סוג</th><th>פרטים</th><th>חשבון נגדי</th><th class="num">סכום</th><th class="num">ימים</th><th>מנה</th><th>סטטוס</th></tr></thead>
  <tbody>
    ${rows
      .map(
        (x) =>
          `<tr class="${olderClass(x, r.from)}">${cell(fmtDate(x.date))}${cell(x.reference)}${cell(x.type)}${cell(x.description)}${cell(`${x.counterName || ""} ${x.counterAccount ? `(${x.counterAccount})` : ""}`.trim())}${money(x.amount)}${cell(x.ageDays, "num")}${cell(x.batch)}${cell(x.posted ? "" : "לא נקלט")}</tr>`,
      )
      .join("")}
    <tr class="total"><td colspan="5">סה"כ ${fmtInt(rows.length)} תנועות</td>${money(r.summary.bookOpen.total)}<td></td><td></td><td></td></tr>
  </tbody>
</table>`;
}

function bookFutureTable(r) {
  const rows = r.bookFutureMatched || [];
  if (!rows.length) return "";
  return `
<h2>${SECTION_TITLES.bookFuture}</h2>
<table>
  <thead><tr><th>תאריך</th><th>אסמכתא</th><th>סוג</th><th>פרטים</th><th>חשבון נגדי</th><th class="num">סכום</th><th>מנה</th></tr></thead>
  <tbody>
    ${rows
      .map(
        (x) =>
          `<tr>${cell(fmtDate(x.date))}${cell(x.reference)}${cell(x.type)}${cell(x.description)}${cell(`${x.counterName || ""} ${x.counterAccount ? `(${x.counterAccount})` : ""}`.trim())}${money(x.amount)}${cell(x.batch)}</tr>`,
      )
      .join("")}
    <tr class="total"><td colspan="5">סה"כ ${fmtInt(rows.length)} תנועות</td>${money(r.summary.bookFutureMatched.total)}<td></td></tr>
  </tbody>
</table>`;
}

function chequesClearedTable(r) {
  const rows = r.chequesCleared || [];
  if (!rows.length) return `<h2>${SECTION_TITLES.chequesCleared}</h2><div class="empty">לא נפרעו צ'קים בתקופה.</div>`;
  return `
<h2>${SECTION_TITLES.chequesCleared}</h2>
<table>
  <thead><tr><th>מס' צ'ק</th><th>מוטב</th><th>תאריך רישום</th><th>תאריך הצ'ק</th><th class="num">סכום הצ'ק</th><th>נפרע בבנק</th><th class="num">סכום בבנק</th><th>אסמכתא בבנק</th><th class="num">ימים מתאריך הצ'ק</th><th>סטטוס</th></tr></thead>
  <tbody>
    ${rows
      .map(
        (x) =>
          `<tr>${cell(x.chequeNo)}${cell(x.payee)}${cell(fmtDate(x.issueDate))}${cell(fmtDate(x.dueDate))}${money(x.amount)}${cell(fmtDate(x.clearedDate))}${money(x.bankAmount)}${cell(x.bankReference)}${cell(x.daysAfterDue, "num")}${cell(CHEQUE_STATUS_LABEL[x.status] || x.status)}</tr>`,
      )
      .join("")}
    <tr class="total"><td colspan="4">סה"כ ${fmtInt(rows.length)} צ'קים</td>${money(r.summary.chequesCleared.total)}<td></td><td></td><td></td><td></td><td></td></tr>
  </tbody>
</table>`;
}

function chequesOpenTable(r) {
  const rows = r.chequesOpen || [];
  if (!rows.length) return `<h2>${SECTION_TITLES.chequesOpen}</h2><div class="empty">אין צ'קים פתוחים.</div>`;
  return `
<h2>${SECTION_TITLES.chequesOpen}</h2>
<table>
  <thead><tr><th>מס' צ'ק</th><th>מוטב</th><th>תאריך רישום</th><th>תאריך הצ'ק</th><th class="num">סכום</th><th class="num">ימים מתאריך הצ'ק</th><th>נמצא בבנק בתאריך</th><th>סטטוס</th></tr></thead>
  <tbody>
    ${rows
      .map(
        (x) =>
          `<tr>${cell(x.chequeNo)}${cell(x.payee)}${cell(fmtDate(x.issueDate))}${cell(fmtDate(x.dueDate))}${money(x.amount)}${cell(x.daysAfterDue > 0 ? x.daysAfterDue : "", "num")}${cell(fmtDate(x.clearedDate))}${cell(CHEQUE_STATUS_LABEL[x.status] || x.status)}</tr>`,
      )
      .join("")}
    <tr class="total"><td colspan="4">סה"כ ${fmtInt(rows.length)} צ'קים</td>${money(r.summary.chequesOpen.total)}<td></td><td></td><td></td></tr>
  </tbody>
</table>`;
}

// The report body (a <div class="bank-recon">…</div>), for embedding in a page that already has the CSS.
export function renderBankReconBody(report) {
  return `<div class="bank-recon">${header(report)}${notes(report)}${summary(report)}${bankOpenTable(report)}${bookOpenTable(report)}${bookFutureTable(report)}${chequesClearedTable(report)}${chequesOpenTable(report)}</div>`;
}

// A complete standalone HTML page.
export function renderBankReconHtml(report) {
  const title = `התאמת בנק ${report.account?.key || ""} ${fmtDate(report.from)}–${fmtDate(report.to)}`;
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>body{margin:16px;background:#fff}${CSS}</style>
</head>
<body>${renderBankReconBody(report)}</body>
</html>`;
}

export { SECTION_TITLES };
