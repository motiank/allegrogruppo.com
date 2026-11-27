// Detailed bank reconciliation report (דוח התאמת בנק מפורט) — the Hebrew, right-to-left HTML of a report
// built by admin/server/modules/bankRecon.js. Pure: a report object in, an HTML string out. Used by the admin
// server (GET /admin/bank-recon/report?format=html) and by the admin page (rendered inside the page).
//
// Signs everywhere: money into the bank is plus, money out is minus — on the bank side and on the books side.
// A filtered report (report.filter.active, shared/bankReconFilter.js) shows the filter under the header, only the
// kept rows in the sections, and "N מתוך M" in the section totals; the summary is always for the whole account.

import { NOISE_LABEL, TODO_LABEL } from "./bankReconNoise.js";
import { KIND_LABEL } from "./bankReconFilter.js";

// the card (כרטסת) of a line — admin/server/modules/bankLineAccounts.js; the pages color the one employees card
export const ACCOUNT_SOURCE_LABEL = {
  books: "מהספרים",
  name: "שם זהה לשם הכרטסת",
  employee: "עובד – כרטיס העובדים",
  history: "לפי פקודות יומן קודמות על שם זה",
  employee_guess: "כנראה עובד – לבדיקה",
  text: "לפי התאמות קודמות של אותו טקסט בנק",
};

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
  return `<td class="${cls}" data-v="${v}">${fmtMoney(v)}</td>`;
};
// a column with a filter icon (the page's script, bankReconBehavior, opens a Google-Sheets-like panel on it)
const fth = (label) => `<th data-filter="1">${label}</th>`;
const cell = (s, cls = "") => `<td${cls ? ` class="${cls}"` : ""}>${esc(s)}</td>`;
// the selection column (hidden until the section's "בחירה" button is pressed — bankReconBehavior)
const SEL_TH = `<th class="sel"><input type="checkbox" class="sel-all" aria-label="בחר הכל"></th>`;
const selTd = (id) => `<td class="sel"><input type="checkbox" class="pick" value="${esc(id ?? "")}" aria-label="בחר שורה"></td>`;

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
  chequesStale: "3ג. צ'קים שלא נפרעו מעל 60 יום – לטיפול",
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
.bank-recon th{background:#eef1f5;font-weight:700}
.bank-recon td{overflow-wrap:anywhere}
.bank-recon td.num,.bank-recon th.num{text-align:left;font-variant-numeric:tabular-nums;white-space:nowrap;direction:ltr}
.bank-recon td.neg{color:#b00020}
.bank-recon td.missing{color:#b00020;font-style:italic}
.bank-recon tr.hid,.bank-recon .hidden{display:none}
.bank-recon tr.filtered td{background:#fff8e1;font-weight:700}
.bank-recon h2.tog{cursor:pointer;user-select:none}
.bank-recon h2.tog .arrow{display:inline-block;width:1.1em;color:#666;transition:transform .15s}
.bank-recon h2.collapsed .arrow{transform:rotate(90deg)}
.bank-recon th{position:relative}
.bank-recon th .flt{border:1px solid #c9c9c9;background:#fff;color:#666;border-radius:3px;font-size:9px;line-height:1;padding:2px 3px;margin-right:6px;cursor:pointer;vertical-align:middle}
.bank-recon th .flt.on{background:#1a73e8;border-color:#1a73e8;color:#fff}
.bank-recon .br-panel{position:absolute;top:100%;right:0;z-index:20;width:280px;background:#fff;color:#222;border:1px solid #bbb;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.18);padding:8px;text-align:right;font-weight:400;white-space:normal;font-size:12px}
.bank-recon .br-search{width:100%;box-sizing:border-box;padding:5px 7px;border:1px solid #c9c9c9;border-radius:4px;margin-bottom:6px;font:inherit}
.bank-recon .br-list{max-height:260px;overflow:auto;border-top:1px solid #eee;border-bottom:1px solid #eee;padding:4px 0;margin:4px 0}
.bank-recon .br-row{display:flex;align-items:center;gap:6px;padding:2px 2px;cursor:pointer}
.bank-recon .br-row:hover{background:#f3f6fa}
.bank-recon .br-all{font-weight:700}
.bank-recon .br-count{color:#777;font-size:11px}
.bank-recon .br-foot{display:flex;gap:6px;justify-content:flex-start;margin-top:6px}
.bank-recon .br-foot button{font:inherit;padding:4px 10px;border:1px solid #c9c9c9;border-radius:4px;background:#fff;cursor:pointer}
.bank-recon .br-foot .br-ok{background:#1a73e8;border-color:#1a73e8;color:#fff}
@media print{.bank-recon .flt,.bank-recon .br-panel{display:none}}
.bank-recon td.strong,.bank-recon tr.total td{font-weight:700}
.bank-recon tr.total td{background:#f4f6f9}
.bank-recon tr.older td{color:#777;background:#fafafa}
.bank-recon tr.sub td{background:#f7f7f7;font-style:italic;color:#555}
.bank-recon .empty{color:#666;font-style:italic;padding:6px 0}
.bank-recon .br-find{position:sticky;top:0;z-index:5;background:#fffbe6;border:1px solid #e6d98a;padding:8px 12px;margin:10px 0;border-radius:4px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.bank-recon .br-find label{font-weight:700;font-size:13px}
.bank-recon .br-find input{flex:1;min-width:200px;padding:6px 8px;border:1px solid #bbb;border-radius:4px;font-size:14px}
.bank-recon .br-find .br-find-count{color:#555;font-size:12px}
.bank-recon .br-find .x{cursor:pointer;color:#555;border:none;background:none;font-size:16px;line-height:1}
.bank-recon .filter{background:#e8f0fe;border:1px solid #a9c4f5;padding:8px 12px;margin:10px 0;border-radius:4px}
.bank-recon .noisebox{background:#fff4e5;border:1px solid #f0c27a;padding:8px 12px;margin:10px 0;border-radius:4px;display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center}
.bank-recon .noisebox button{padding:4px 12px;border:1px solid #b36b00;background:#fff;color:#7a4a00;border-radius:4px;cursor:pointer;font-weight:700;font:inherit}
.bank-recon .noisebox .rules{font-size:.85em;color:#555;flex-basis:100%}
.bank-recon tr.noise td{color:#8a6d3b;background:#fffaf0}
.bank-recon .nz{display:inline-block;font-size:.75em;background:#f0c27a;color:#4a3000;border-radius:3px;padding:0 4px;margin-right:4px;vertical-align:middle}
.bank-recon.noise-off tr.noise{display:none}
.bank-recon .olderbox{background:#f1f3f6;border:1px solid #c9ced6;padding:8px 12px;margin:10px 0;border-radius:4px;display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center}
.bank-recon .olderbox button{padding:4px 12px;border:1px solid #556;background:#fff;color:#334;border-radius:4px;cursor:pointer;font-weight:700;font:inherit}
.bank-recon .olderbox .rules{font-size:.85em;color:#555;flex-basis:100%}
.bank-recon.older-off tr.older{display:none}
.bank-recon .todobox{background:#fdecea;border:1px solid #f1998e;padding:8px 12px;margin:10px 0;border-radius:4px}
.bank-recon .todobox .rules{font-size:.85em;color:#555;display:block;margin-top:2px}
.bank-recon tr.todo td{background:#fff1f0}
.bank-recon .td{display:inline-block;font-size:.75em;background:#e05050;color:#fff;border-radius:3px;padding:0 4px;margin-right:4px;vertical-align:middle}
.bank-recon .filter .of{color:#555;font-size:12px;margin-top:4px}
.bank-recon td.guess{color:#8a5a00}
.bank-recon td.acc{white-space:nowrap}
.bank-recon td.acc .k{font-variant-numeric:tabular-nums;font-weight:700}
.bank-recon td.acc .nm{color:#555}
.bank-recon td.acc.sugg{border-bottom:2px dotted #9aa}
.bank-recon td.acc-emp,.bank-recon .acc-emp.legend{background:#d6e9ff;color:#0b3d91}
.bank-recon td.acc-emp.acc-guess,.bank-recon .acc-guess.legend{background:#eaf3ff;font-style:italic}
.bank-recon .legend{padding:0 5px;border-radius:3px}
.bank-recon th.sel,.bank-recon td.sel{display:none}
.bank-recon table.selecting th.sel,.bank-recon table.selecting td.sel{display:table-cell;width:1.8em;text-align:center;padding:2px}
.bank-recon table.selecting tr.picked td{background:#fffde7}
.bank-recon .sel-btn{font:inherit;font-size:12px;font-weight:400;margin-right:10px;padding:2px 10px;border:1px solid #888;border-radius:4px;background:#fff;color:#333;cursor:pointer;vertical-align:middle}
.bank-recon .sel-btn.on{background:#1a73e8;border-color:#1a73e8;color:#fff}
.bank-recon .selbar{display:none;background:#eef6ff;border:1px solid #a9c4f5;border-radius:4px;padding:6px 10px;margin:4px 0 6px;align-items:center;gap:8px 14px;flex-wrap:wrap;font-size:12px}
.bank-recon table.selecting + .selbar,.bank-recon .selbar.show{display:flex}
.bank-recon .selbar button{font:inherit;font-size:12px;padding:3px 10px;border:1px solid #888;border-radius:4px;background:#fff;cursor:pointer}
.bank-recon .selbar button.main{background:#1a73e8;border-color:#1a73e8;color:#fff;font-weight:700}
.bank-recon .selbar button:disabled{opacity:.5;cursor:default}
.bank-recon .selbar input[type=date]{font:inherit;font-size:12px;padding:2px 4px}
.bank-recon .selbar .cnt{font-weight:700}
.bank-recon .selbar .msg{color:#b00020;flex-basis:100%}
.bank-recon select.act{font:inherit;font-size:12px;padding:1px 2px;max-width:170px}
.bank-recon td.bounced{color:#b00020;font-weight:700}
@media print{.bank-recon .sel-btn,.bank-recon .selbar,.bank-recon th.sel,.bank-recon td.sel{display:none !important}}
.bank-recon a.chq-img{text-decoration:none;font-size:12px;margin-right:4px;cursor:zoom-in}
.chq-modal{position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:24px;direction:rtl}
.chq-modal .chq-box{position:relative;background:#fff;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,.4);max-width:min(96vw,1400px);max-height:92vh;display:flex;flex-direction:column;overflow:hidden}
.chq-modal .chq-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 12px;border-bottom:1px solid #ddd;font:700 14px Arial,"Segoe UI",Tahoma,sans-serif;color:#222}
.chq-modal .chq-close{font:inherit;font-size:20px;line-height:1;border:1px solid #bbb;background:#fff;border-radius:4px;padding:2px 10px;cursor:pointer}
.chq-modal .chq-close:hover{background:#eee}
.chq-modal .chq-body{overflow:auto;padding:8px;background:#f4f4f4;display:flex;align-items:center;justify-content:center;min-width:280px;min-height:160px}
.chq-modal img{max-width:100%;max-height:calc(92vh - 70px);display:block;background:#fff}
.chq-modal .chq-open{font-size:12px;font-weight:400;color:#1a73e8;text-decoration:none;margin-right:auto}
.chq-modal .chq-err{color:#b00020;padding:24px;font:13px Arial,sans-serif}
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
<div class="sign">סימנים: כניסה לבנק = פלוס, יציאה מהבנק = מינוס, גם בצד הבנק וגם בצד הספרים. "ימים" = ימים מתאריך התנועה עד ${fmtDate(r.to)}.${r.employees?.account ? ` <span class="acc-emp legend">כרטיס העובדים ${esc(r.employees.name ? `${r.employees.name} (${r.employees.account})` : r.employees.account)}</span> מסומן בכחול; <span class="acc-emp acc-guess legend">?</span> = כנראה עובד, לבדיקה.` : ""}</div>`;
}

function notes(r) {
  if (!r.notes?.length) return "";
  return `<div class="notes"><b>הערות</b><ul>${r.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>`;
}

const SECTION_SHORT = { bankOpen: "סעיף 1", bookOpen: "סעיף 2", bookFutureMatched: "סעיף 2ב", chequesCleared: "סעיף 3א", chequesOpen: "סעיף 3ב", chequesStale: "סעיף 3ג" };

// the active filter (kind / party / text / amount / sections) and what it kept of each section
function filterBox(r) {
  if (!r.filter?.active) return "";
  const parts = Object.entries(r.filtered?.sections || {})
    .filter(([, x]) => x && !x.omitted && x.of)
    .map(([k, x]) => `${SECTION_SHORT[k] || k}: ${fmtInt(x.count)} מתוך ${fmtInt(x.of)}`);
  const omitted = Object.entries(r.filtered?.sections || {}).filter(([, x]) => x?.omitted && x.of).map(([k]) => SECTION_SHORT[k] || k);
  return `<div class="filter"><b>סינון:</b> ${esc(r.filter.label)}<div class="of">הסיכום הוא לכל החשבון; הסעיפים מציגים רק את השורות שעברו את הסינון${parts.length ? ` (${esc(parts.join(" · "))})` : ""}${omitted.length ? `. לא נכללו: ${esc(omitted.join(", "))}` : ""}.</div></div>`;
}

// the total row of a section: the kept rows and, with a filter, the whole section's count and total
function totalText(r, key, unit) {
  const x = r.filtered?.sections?.[key];
  const n = (r[key] || []).length;
  return x && x.of !== x.count ? `סה"כ ${fmtInt(n)} ${unit} (מתוך ${fmtInt(x.of)}, סכום מלא ${fmtMoney(x.ofTotal)})` : `סה"כ ${fmtInt(n)} ${unit}`;
}
const totalOf = (r, key) => (r.filtered?.sections?.[key] ? r.filtered.sections[key].total : r.summary[key].total);
const omittedSection = (r, key) => (r.filtered?.sections?.[key]?.omitted ? `<h2>${SECTION_TITLES[key === "bookFutureMatched" ? "bookFuture" : key]}</h2><div class="empty">לא נכלל בסינון הסעיפים.</div>` : null);
const noiseBadge = (x) => (x.noise ? `<span class="nz" title="${esc(NOISE_LABEL[x.noise.rule] || x.noise.rule)}${x.noise.with ? ` (מול ${esc(fmtDate(x.noise.with))})` : ""}">רעש</span>` : "");
const noiseClass = (x) => (x.noise ? " noise" : "");
const todoBadge = (x) => (x.todo ? `<span class="td" title="${esc(TODO_LABEL[x.todo.rule] || x.todo.rule)}">לטיפול</span>` : "");
const todoClass = (x) => (x.todo ? " todo" : "");

// the cheques to handle (section 3ב: past their date by more than 60 days and not cleared) — never hidden
function todoBox(r) {
  const n = r.todo;
  if (!n?.count) return "";
  const where = r.chequesStale ? 'סעיף 3ג' : 'סעיף 3ב, מסומנים "לטיפול"';
  return `<div class="todobox"><b>לטיפול:</b> ${fmtInt(n.count)} צ'קים שמועדם עבר לפני יותר מ-${n.staleDays} יום ולא נפרעו, סכום ${fmtMoney(n.total)} (${where})<span class="rules">${esc(TODO_LABEL.stale_cheque)}. הם אינם רעש ואינם מוסתרים.${r.chequesStale ? ' בסעיף 3ג: "בחירה" → מסמנים שורות, קובעים פעולה (בוטל / חזר מהבנק) ומייצאים קובץ ייבוא לחשבשבת.' : ""}</span></div>`;
}
const kindCell = (x) => `<td>${esc(KIND_LABEL[x.kind] || x.kind || "")}${noiseBadge(x)}</td>`;

// the noise rows (shared/bankReconNoise.js) and the button that hides / shows them; with the server filter noise=hide
// they are not in the report at all (the filter box says so)
function noiseBox(r) {
  const n = r.noise;
  if (!n?.count || r.filter?.noise === "hide") return "";
  const parts = Object.entries(n.sections || {}).filter(([, x]) => x.count).map(([k, x]) => `${SECTION_SHORT[k] || k}: ${fmtInt(x.count)}`);
  return `<div class="noisebox"><b>רעשים:</b> ${fmtInt(n.count)} שורות (${esc(parts.join(" · "))}), סכום ${fmtMoney(n.total)}
  <button type="button" class="noise-tog" data-count="${n.count}">הצג גם את הרעשים (${fmtInt(n.count)})</button>
  <span class="rules">רעש = ${esc(NOISE_LABEL.reversal)}, עד ${n.pairDays} ימים זו מזו (בבנק: אותו מוטב או אותה אסמכתא, למשל שיק והחזרתו; בספרים: אותו חשבון נגדי). השורות מסומנות "רעש"; הסיכום למעלה כולל אותן.</span></div>`;
}

// the rows dated before the period (older: true, shared/bankReconFilter.js tagOlder): open as of `to`, in the summary, but a
// report "for 2026" starts without them — a button shows them; with the server filter older=hide they are not in the report
function olderBox(r) {
  const n = r.older;
  if (!n?.count || r.filter?.older === "hide") return "";
  const parts = Object.entries(n.sections || {}).filter(([, x]) => x.count).map(([k, x]) => `${SECTION_SHORT[k] || k}: ${fmtInt(x.count)}`);
  return `<div class="olderbox"><b>תנועות מלפני ${fmtDate(r.from)}:</b> ${fmtInt(n.count)} שורות (${esc(parts.join(" · "))}), סכום ${fmtMoney(n.total)} – פתוחות נכון ל-${fmtDate(r.to)} ונכללות בסיכום, אך אינן מהתקופה המבוקשת
  <button type="button" class="older-tog" data-count="${n.count}">הצג גם תנועות מלפני התקופה (${fmtInt(n.count)})</button>
  <span class="rules">הדוח מציג כברירת מחדל רק תנועות מתאריך ${fmtDate(r.from)} ואילך; הכפתור מוסיף את הישנות (בסעיף 3ב – לפי תאריך הצ'ק).</span></div>`;
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
    ${s.chequesStale ? line(`ועוד: צ'קים שלא נפרעו מעל ${s.chequesStale.staleDays || 60} יום – לטיפול (סעיף 3ג)`, s.chequesStale.total, { count: s.chequesStale.count }) : ""}
    ${s.chequesStale?.bounced ? line("מתוכם – חזרו מהבנק (שורת החזרת שיק בסעיף 1)", s.chequesStale.bouncedTotal, { count: s.chequesStale.bounced, cls: "sub" }) : ""}
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

const olderClass = (row, from) => (row.older || (row.date && from && String(row.date) < String(from)) ? "older" : "");

// the beneficiary of a cheque line (payee from Hashavshevet; "priority" = named by the Priority cheque file, the
// history before Hashavshevet; "image" = the name was read from the scanned cheque in the Drive archive, "image_guess" =
// an unsure reading of it; "missing" = the cheque is not in Hashavshevet yet)
export const PAYEE_MISSING = "לא נמצא בחשבשבת";
export const PAYEE_SOURCE_SUFFIX = { priority: " (פריוריטי)", image: " (מהצ'ק)", image_guess: "? (מהצ'ק, לא ודאי)" };
// payeeRole "from" (the bank file's "המבצע: …", money that came in) is shown as "מאת: <name>", so a receipt is never read as a payment
export const payeeText = (x) =>
  x.payeeSource === "missing" ? PAYEE_MISSING : PAYEE_SOURCE_SUFFIX[x.payeeSource] && x.payee ? `${x.payee}${PAYEE_SOURCE_SUFFIX[x.payeeSource]}` : x.payeeRole === "from" && x.payee ? `מאת: ${x.payee}` : x.payee || "";

// the link to the scanned cheque: by default a relative "cheque-image/<id>" (the admin's /admin/bank-recon/report page
// and Joya's /api/joya/finance/bank-recon page both serve the picture next to the report); a page that renders the
// body itself passes its own `imageHref(row)`. The payee cell keeps its plain text in data-f for the column filter.
const defaultImageHref = (x) => `cheque-image/${encodeURIComponent(x.imageId)}`;
const payeeCell = (x, opts) => {
  const text = payeeText(x);
  const cls = x.payeeSource === "missing" ? "missing" : x.payeeSource === "image_guess" ? "guess" : "";
  // the page's script (bankReconBehavior) opens the picture in a modal; without a script (or with a middle click) the link opens a tab
  const link = x.imageId ? ` <a class="chq-img" href="${esc((opts?.imageHref || defaultImageHref)(x))}" target="_blank" rel="noreferrer" title="תמונת הצ'ק הסרוק" data-cheque="${esc(x.reference ?? x.chequeNo ?? "")}" data-payee="${esc(x.payee || "")}">📷</a>` : "";
  return `<td${cls ? ` class="${cls}"` : ""} data-f="${esc(text)}">${esc(text)}${link}</td>`;
};

// the card (כרטסת) to book the line on: "name (key)"; the one employees card in blue (a guess: lighter, with "?"); a card
// that is not from the books is a suggestion — dotted, the tooltip says what it is based on
const accountText = (x) => (x.counterAccount ? `${x.counterName || ""} (${x.counterAccount})`.trim() : "");
export const accountCell = (x) => {
  if (!x.counterAccount) return `<td class="acc" data-f=""></td>`;
  const guess = x.counterSource === "employee_guess";
  const cls = `acc${x.counterEmployee ? " acc-emp" : ""}${guess ? " acc-guess" : ""}${x.counterSource && x.counterSource !== "books" ? " sugg" : ""}`;
  const title = x.counterSource ? `${ACCOUNT_SOURCE_LABEL[x.counterSource] || x.counterSource}${x.counterBasis ? ` – ${x.counterBasis}` : ""}` : "";
  return `<td class="${cls}" data-f="${esc(accountText(x))}"${title ? ` title="${esc(title)}"` : ""}><span class="k">${esc(x.counterAccount)}</span>${guess ? "?" : ""} <span class="nm">${esc(x.counterName || "")}</span></td>`;
};
const counterCell = (x) => `<td${x.counterEmployee ? ' class="acc-emp"' : ""}>${esc(`${x.counterName || ""} ${x.counterAccount ? `(${x.counterAccount})` : ""}`.trim())}</td>`;

function bankOpenTable(r, opts) {
  const rows = r.bankOpen || [];
  if (!rows.length) return omittedSection(r, "bankOpen") || `<h2>${SECTION_TITLES.bankOpen}</h2><div class="empty">אין תנועות בנק פתוחות${r.filter?.active ? " שעוברות את הסינון" : ""}.</div>`;
  return `
<h2>${SECTION_TITLES.bankOpen}</h2>
<table data-section="bankOpen">
  <thead><tr>${SEL_TH}<th>תאריך</th><th>אסמכתא</th>${fth("פרטים")}${fth("סוג")}${fth("מוטב")}${fth("כרטסת")}<th class="num">סכום</th><th class="num">ימים</th><th>שנה</th></tr></thead>
  <tbody>
    ${rows
      .map(
        (x) => `<tr class="${olderClass(x, r.from)}${noiseClass(x)}" data-id="${esc(x.bankLineId)}">${selTd(x.bankLineId)}${cell(fmtDate(x.date))}${cell(x.reference)}${cell(x.details)}${kindCell(x)}${payeeCell(x, opts)}${accountCell(x)}${money(x.amount)}${cell(x.ageDays, "num")}${cell(x.year)}</tr>`,
      )
      .join("")}
    <tr class="total"><td colspan="7">${totalText(r, "bankOpen", "תנועות")}</td>${money(totalOf(r, "bankOpen"))}<td></td><td></td></tr>
  </tbody>
</table>`;
}

function bookOpenTable(r) {
  const rows = r.bookOpen || [];
  if (!rows.length) return omittedSection(r, "bookOpen") || `<h2>${SECTION_TITLES.bookOpen}</h2><div class="empty">אין תנועות ספרים פתוחות (ללא צ'קים)${r.filter?.active ? " שעוברות את הסינון" : ""}.</div>`;
  return `
<h2>${SECTION_TITLES.bookOpen}</h2>
<table data-section="bookOpen">
  <thead><tr>${SEL_TH}<th>תאריך</th><th>אסמכתא</th>${fth("סוג")}${fth("פרטים")}${fth("חשבון נגדי")}<th class="num">סכום</th><th class="num">ימים</th><th>מנה</th><th>סטטוס</th></tr></thead>
  <tbody>
    ${rows
      .map(
        (x) =>
          `<tr class="${olderClass(x, r.from)}${noiseClass(x)}" data-id="${esc(x.lineId)}">${selTd(x.lineId)}${cell(fmtDate(x.date))}${cell(x.reference)}${kindCell(x)}${cell(x.description)}${counterCell(x)}${money(x.amount)}${cell(x.ageDays, "num")}${cell(x.batch)}${cell(x.posted ? "" : "לא נקלט")}</tr>`,
      )
      .join("")}
    <tr class="total"><td colspan="6">${totalText(r, "bookOpen", "תנועות")}</td>${money(totalOf(r, "bookOpen"))}<td></td><td></td><td></td></tr>
  </tbody>
</table>`;
}

function bookFutureTable(r) {
  const rows = r.bookFutureMatched || [];
  if (!rows.length) return r.filtered?.sections?.bookFutureMatched?.of ? omittedSection(r, "bookFutureMatched") || "" : "";
  return `
<h2>${SECTION_TITLES.bookFuture}</h2>
<table data-section="bookFutureMatched">
  <thead><tr>${SEL_TH}<th>תאריך</th><th>אסמכתא</th>${fth("סוג")}${fth("פרטים")}${fth("חשבון נגדי")}<th class="num">סכום</th><th>מנה</th></tr></thead>
  <tbody>
    ${rows
      .map(
        (x) =>
          `<tr data-id="${esc(x.lineId)}">${selTd(x.lineId)}${cell(fmtDate(x.date))}${cell(x.reference)}${kindCell(x)}${cell(x.description)}${counterCell(x)}${money(x.amount)}${cell(x.batch)}</tr>`,
      )
      .join("")}
    <tr class="total"><td colspan="6">${totalText(r, "bookFutureMatched", "תנועות")}</td>${money(totalOf(r, "bookFutureMatched"))}<td></td></tr>
  </tbody>
</table>`;
}

function chequesClearedTable(r) {
  const rows = r.chequesCleared || [];
  if (!rows.length) return omittedSection(r, "chequesCleared") || `<h2>${SECTION_TITLES.chequesCleared}</h2><div class="empty">לא נפרעו צ'קים בתקופה${r.filter?.active ? " שעוברים את הסינון" : ""}.</div>`;
  return `
<h2>${SECTION_TITLES.chequesCleared}</h2>
<table data-section="chequesCleared">
  <thead><tr>${SEL_TH}<th>מס' צ'ק</th>${fth("מוטב")}${fth("כרטסת")}<th>תאריך רישום</th><th>תאריך הצ'ק</th><th class="num">סכום הצ'ק</th><th>נפרע בבנק</th><th class="num">סכום בבנק</th><th>אסמכתא בבנק</th><th class="num">ימים מתאריך הצ'ק</th><th>סטטוס</th></tr></thead>
  <tbody>
    ${rows
      .map(
        (x) =>
          `<tr data-id="${esc(x.chequeId)}">${selTd(x.chequeId)}${cell(x.chequeNo)}${cell(x.payee)}${accountCell(x)}${cell(fmtDate(x.issueDate))}${cell(fmtDate(x.dueDate))}${money(x.amount)}${cell(fmtDate(x.clearedDate))}${money(x.bankAmount)}${cell(x.bankReference)}${cell(x.daysAfterDue, "num")}${cell(CHEQUE_STATUS_LABEL[x.status] || x.status)}</tr>`,
      )
      .join("")}
    <tr class="total"><td colspan="6">${totalText(r, "chequesCleared", "צ'קים")}</td>${money(totalOf(r, "chequesCleared"))}<td></td><td></td><td></td><td></td><td></td></tr>
  </tbody>
</table>`;
}

function chequesOpenTable(r) {
  const rows = r.chequesOpen || [];
  if (!rows.length) return omittedSection(r, "chequesOpen") || `<h2>${SECTION_TITLES.chequesOpen}</h2><div class="empty">אין צ'קים פתוחים${r.filter?.active ? " שעוברים את הסינון" : ""}.</div>`;
  return `
<h2>${SECTION_TITLES.chequesOpen}</h2>
<table data-section="chequesOpen">
  <thead><tr>${SEL_TH}<th>מס' צ'ק</th>${fth("מוטב")}${fth("כרטסת")}<th>תאריך רישום</th><th>תאריך הצ'ק</th><th class="num">סכום</th><th class="num">ימים מתאריך הצ'ק</th><th>נמצא בבנק בתאריך</th><th>סטטוס</th></tr></thead>
  <tbody>
    ${rows
      .map(
        (x) =>
          `<tr class="${`${todoClass(x)}${x.older ? " older" : ""}`.trim()}" data-id="${esc(x.chequeId)}">${selTd(x.chequeId)}${cell(x.chequeNo)}${cell(x.payee)}${accountCell(x)}${cell(fmtDate(x.issueDate))}${cell(fmtDate(x.dueDate))}${money(x.amount)}${cell(x.daysAfterDue > 0 ? x.daysAfterDue : "", "num")}${cell(fmtDate(x.clearedDate))}<td>${esc(CHEQUE_STATUS_LABEL[x.status] || x.status)}${todoBadge(x)}</td></tr>`,
      )
      .join("")}
    <tr class="total"><td colspan="6">${totalText(r, "chequesOpen", "צ'קים")}</td>${money(totalOf(r, "chequesOpen"))}<td></td><td></td><td></td></tr>
  </tbody>
</table>`;
}

// section 3ג (owner 2026-11-18): the cheques not cleared more than 60 days after their date — to cancel in the books (never
// reached the beneficiary) or to record as returned by the bank. The last column is the action the export will write;
// "בחירה" (the page's selection mode) shows the checkboxes and the export buttons.
export const ACTION_LABEL = { cancel: "בוטל – לא הגיע למוטב", bounced: "חזר מהבנק", keep: "להשאיר" };
const actionSelect = (x) =>
  `<select class="act" data-id="${esc(x.chequeId)}" aria-label="פעולה לצ'ק ${esc(x.chequeNo)}">${Object.entries(ACTION_LABEL).map(([k, v]) => `<option value="${k}"${(x.suggestedAction || "cancel") === k ? " selected" : ""}>${esc(v)}</option>`).join("")}</select>`;
function chequesStaleTable(r) {
  if (!r.chequesStale && !r.summary?.chequesStale) return "";
  const rows = r.chequesStale || [];
  if (!rows.length) return omittedSection(r, "chequesStale") || `<h2>${SECTION_TITLES.chequesStale}</h2><div class="empty">אין צ'קים שלא נפרעו מעל 60 יום${r.filter?.active ? " שעוברים את הסינון" : ""}.</div>`;
  return `
<h2>${SECTION_TITLES.chequesStale}</h2>
<table data-section="chequesStale">
  <thead><tr>${SEL_TH}<th>מס' צ'ק</th>${fth("מוטב")}${fth("כרטסת")}<th>תאריך רישום</th><th>תאריך הצ'ק</th><th class="num">סכום</th><th class="num">ימים מתאריך הצ'ק</th>${fth("חזר בבנק")}${fth("פעולה")}</tr></thead>
  <tbody>
    ${rows
      .map(
        (x) =>
          `<tr class="todo${x.older ? " older" : ""}" data-id="${esc(x.chequeId)}" data-bounced="${esc(x.bounced?.date || "")}">${selTd(x.chequeId)}${cell(x.chequeNo)}${cell(x.payee)}${accountCell(x)}${cell(fmtDate(x.issueDate))}${cell(fmtDate(x.dueDate))}${money(x.amount)}${cell(x.daysAfterDue, "num")}<td${x.bounced ? ' class="bounced"' : ""} data-f="${x.bounced ? esc(fmtDate(x.bounced.date)) : ""}">${x.bounced ? `${esc(fmtDate(x.bounced.date))} <span class="td">החזרת שיק</span>` : ""}</td><td data-f="${esc(ACTION_LABEL[x.suggestedAction] || "")}">${actionSelect(x)}</td></tr>`,
      )
      .join("")}
    <tr class="total"><td colspan="6">${totalText(r, "chequesStale", "צ'קים")}</td>${money(totalOf(r, "chequesStale"))}<td></td><td></td><td></td></tr>
  </tbody>
</table>`;
}

// The report body (a <div class="bank-recon">…</div>), for embedding in a page that already has the CSS.
// opts.imageHref(row) = the link of a cheque's scanned picture (default: "cheque-image/<imageId>" next to the report);
// opts.exportHref = where the selection mode posts its export (default: the relative "export").
// a free-text box above section 1 that filters EVERY section while typing, by reference, amount or beneficiary
// (bankReconBehavior wires it). It sits above section 1 and stays visible (sticky) while scrolling the sections.
function findBar() {
  return `<div class="br-find"><label for="brFind">חיפוש בכל הסעיפים:</label><input id="brFind" type="search" class="br-find-input" placeholder="אסמכתא, סכום או מוטב…" autocomplete="off" aria-label="חיפוש בכל הסעיפים לפי אסמכתא, סכום או מוטב"><button type="button" class="x" title="נקה" aria-label="נקה">✕</button><span class="br-find-count"></span></div>`;
}

export function renderBankReconBody(report, opts = {}) {
  const hideNoise = Boolean(report.noise?.count) && report.filter?.noise !== "hide"; // the noise rows start hidden; the button shows them
  const hideOlder = Boolean(report.older?.count) && report.filter?.older !== "hide"; // so do the rows dated before the period
  // data-export = where the selection mode posts (default: the relative "export" next to the report; the admin page passes its own)
  const attrs = ` data-export="${esc(opts.exportHref || "export")}" data-company="${esc(report.company?.code || "")}" data-account="${esc(report.account?.key || "")}" data-from="${esc(report.from || "")}" data-to="${esc(report.to || "")}"`;
  return `<div class="bank-recon${hideNoise ? " noise-off" : ""}${hideOlder ? " older-off" : ""}"${attrs}>${header(report)}${filterBox(report)}${olderBox(report)}${noiseBox(report)}${todoBox(report)}${notes(report)}${summary(report)}${findBar()}${bankOpenTable(report, opts)}${bookOpenTable(report)}${bookFutureTable(report)}${chequesClearedTable(report)}${chequesOpenTable(report)}${chequesStaleTable(report)}</div>`;
}

// A complete standalone HTML page.
/**
 * Makes a rendered report interactive, in the browser: every section (h2) collapses on click, and the columns marked
 * `data-filter` (פרטים, מוטב, חשבון נגדי) get a Google-Sheets-like filter: a panel with a search box and the list of
 * the column's values with checkboxes (OK with a search word keeps only the matching checked values, like Excel);
 * hidden rows get the class `hid` and a line "מסונן: N מתוך M, סכום X" appears above the total. Plain DOM code, no outer references: the standalone page embeds `bankReconBehavior.toString()`
 * and the admin page calls it after rendering the body.
 * @param {Element} root  the `.bank-recon` element
 */
export function bankReconBehavior(root) {
  if (!root || root.getAttribute("data-live")) return;
  root.setAttribute("data-live", "1");
  var EMPTY = "(ריק)";
  var fmt = function (n, d) { return Number(n).toLocaleString("he-IL", { minimumFractionDigits: d, maximumFractionDigits: d }); };

  // 1. collapsible sections: the h2 toggles everything up to the next h2
  Array.prototype.forEach.call(root.querySelectorAll("h2"), function (h) {
    h.classList.add("tog");
    var arrow = document.createElement("span");
    arrow.className = "arrow";
    arrow.textContent = "▾";
    h.insertBefore(arrow, h.firstChild);
    h.setAttribute("role", "button");
    h.tabIndex = 0;
    h.setAttribute("aria-expanded", "true");
    var toggle = function () {
      var off = h.classList.toggle("collapsed");
      h.setAttribute("aria-expanded", String(!off));
      for (var n = h.nextElementSibling; n && n.tagName !== "H2"; n = n.nextElementSibling) n.classList.toggle("hidden", off);
    };
    h.addEventListener("click", toggle);
    h.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
  });

  // 2. column filters
  var closePanels = function () { Array.prototype.forEach.call(root.querySelectorAll(".br-panel"), function (p) { p.parentNode.removeChild(p); }); };
  // the free-text find box (above section 1): its normalised value, shared by every section's apply()
  var findQuery = "";
  var brNorm = function (s) { return String(s == null ? "" : s).toLowerCase().replace(/[,\s‎‏]/g, ""); };
  Array.prototype.forEach.call(root.querySelectorAll("table"), function (table) {
    var tbody = table.tBodies[0];
    var ths = table.tHead ? table.tHead.rows[0].cells : [];
    if (!tbody || !ths.length) return;
    var rows = Array.prototype.filter.call(tbody.rows, function (r) { return !r.classList.contains("total"); });
    var active = {}; // column index → the values kept (a column that is absent shows everything)
    var valueOf = function (r, i) { var c = r.cells[i]; var t = c ? (c.getAttribute("data-f") != null ? c.getAttribute("data-f") : c.textContent).trim() : ""; return t || EMPTY; };
    var noiseRows = rows.filter(function (r) { return r.classList.contains("noise"); }).length;
    var olderRows = rows.filter(function (r) { return r.classList.contains("older"); }).length;
    // the columns the free-text find looks in: reference (אסמכתא / מס' צ'ק), beneficiary (מוטב / חשבון נגדי) and amount
    // (סכום). The summary table is never searched.
    var findCols = [];
    if (!table.classList.contains("summary")) {
      Array.prototype.forEach.call(ths, function (th, i) {
        var t = th.textContent;
        if (t.indexOf("אסמכתא") >= 0 || t.indexOf("מס") >= 0 || t.indexOf("מוטב") >= 0 || t.indexOf("חשבון נגדי") >= 0 || t.indexOf("סכום") >= 0) findCols.push(i);
      });
    }
    var matchFind = function (r) {
      for (var k = 0; k < findCols.length; k++) {
        var c = r.cells[findCols[k]];
        if (!c) continue;
        var df = c.getAttribute("data-f"), dv = c.getAttribute("data-v");
        if (brNorm(df != null ? df : c.textContent).indexOf(findQuery) >= 0) return true;
        if (dv != null && brNorm(dv).indexOf(findQuery) >= 0) return true;
      }
      return false;
    };
    var apply = function () {
      var cols = Object.keys(active);
      var hideNoise = root.classList.contains("noise-off") && noiseRows > 0;
      var hideOlder = root.classList.contains("older-off") && olderRows > 0;
      var fActive = Boolean(findQuery) && findCols.length > 0;
      var shown = 0, sum = 0, hasSum = false;
      rows.forEach(function (r) {
        var ok = cols.every(function (i) { return active[i].has(valueOf(r, Number(i))); }) && !(hideNoise && r.classList.contains("noise")) && !(hideOlder && r.classList.contains("older")) && (!fActive || matchFind(r));
        r.classList.toggle("hid", !ok);
        if (ok) {
          shown++;
          var m = r.querySelector("td[data-v]");
          if (m) { hasSum = true; sum += Number(m.getAttribute("data-v")) || 0; }
        }
      });
      var line = tbody.querySelector("tr.filtered");
      if (!cols.length && !hideNoise && !hideOlder && !fActive) { if (line) line.parentNode.removeChild(line); }
      else {
        if (!line) {
          line = document.createElement("tr");
          line.className = "filtered";
          var td = document.createElement("td");
          td.colSpan = ths.length;
          line.appendChild(td);
          tbody.insertBefore(line, tbody.querySelector("tr.total"));
        }
        line.firstChild.textContent = (cols.length || fActive ? "מסונן: " : hideOlder ? "רק מהתקופה: " : "ללא רעשים: ") + fmt(shown, 0) + " מתוך " + fmt(rows.length, 0) + " שורות" + (hasSum ? ", סכום " + fmt(sum, 2) : "") + (hideNoise ? " (רעשים מוסתרים: " + fmt(noiseRows, 0) + ")" : "") + (hideOlder ? " (מלפני התקופה מוסתרות: " + fmt(olderRows, 0) + ")" : "");
      }
      Array.prototype.forEach.call(ths, function (th, i) { var b = th.querySelector(".flt"); if (b) b.classList.toggle("on", Boolean(active[i])); });
    };
    var openPanel = function (th, i) {
      closePanels();
      var counts = new Map();
      rows.forEach(function (r) { var v = valueOf(r, i); counts.set(v, (counts.get(v) || 0) + 1); });
      var values = Array.from(counts.keys()).sort(function (a, b) { return a === EMPTY ? -1 : b === EMPTY ? 1 : a.localeCompare(b, "he"); });
      var selected = new Set(active[i] ? Array.from(active[i]) : values);
      var el = function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
      var panel = el("div", "br-panel");
      panel.setAttribute("dir", "rtl");
      var search = el("input", "br-search");
      search.type = "search";
      search.placeholder = "חיפוש…";
      var all = el("label", "br-row br-all");
      var allCb = el("input");
      allCb.type = "checkbox";
      all.appendChild(allCb);
      all.appendChild(document.createTextNode("(בחר הכל)"));
      var list = el("div", "br-list");
      var foot = el("div", "br-foot");
      var okB = el("button", "br-ok", "אישור"), clearB = el("button", "", "נקה סינון"), cancelB = el("button", "", "ביטול");
      [okB, clearB, cancelB].forEach(function (b) { b.type = "button"; foot.appendChild(b); });
      panel.appendChild(search); panel.appendChild(all); panel.appendChild(list); panel.appendChild(foot);
      var visible = values;
      var syncAll = function () {
        var n = visible.filter(function (v) { return selected.has(v); }).length;
        allCb.checked = n > 0 && n === visible.length;
        allCb.indeterminate = n > 0 && n < visible.length;
      };
      var render = function () {
        var q = search.value.trim().toLowerCase();
        visible = values.filter(function (v) { return !q || v.toLowerCase().indexOf(q) >= 0; });
        list.textContent = "";
        visible.forEach(function (v) {
          var lab = el("label", "br-row");
          var cb = el("input");
          cb.type = "checkbox";
          cb.checked = selected.has(v);
          cb.addEventListener("change", function () { if (cb.checked) selected.add(v); else selected.delete(v); syncAll(); });
          lab.appendChild(cb);
          lab.appendChild(el("span", "", v));
          lab.appendChild(el("span", "br-count", "(" + fmt(counts.get(v), 0) + ")"));
          list.appendChild(lab);
        });
        syncAll();
      };
      allCb.addEventListener("change", function () { visible.forEach(function (v) { if (allCb.checked) selected.add(v); else selected.delete(v); }); render(); });
      search.addEventListener("input", render);
      // OK with a search word keeps only the matching values that are checked (like Excel); without one, every checked value
      okB.addEventListener("click", function () {
        var keep = search.value.trim() ? visible.filter(function (v) { return selected.has(v); }) : Array.from(selected);
        if (keep.length >= values.length) delete active[i]; else active[i] = new Set(keep);
        apply();
        closePanels();
      });
      clearB.addEventListener("click", function () { delete active[i]; apply(); closePanels(); });
      cancelB.addEventListener("click", closePanels);
      panel.addEventListener("click", function (e) { e.stopPropagation(); });
      th.appendChild(panel);
      render();
      search.focus();
    };
    Array.prototype.forEach.call(ths, function (th, i) {
      if (!th.hasAttribute("data-filter")) return;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "flt";
      btn.title = "סינון";
      btn.setAttribute("aria-label", "סינון " + th.textContent.trim());
      btn.textContent = "▼";
      th.appendChild(btn);
      btn.addEventListener("click", function (e) { e.stopPropagation(); if (th.querySelector(".br-panel")) closePanels(); else openPanel(th, i); });
    });
    table.__brApply = apply;
    if (noiseRows || olderRows) apply(); // the noise rows and the older rows start hidden: show the count line at once
  });

  // 2b. the free-text find box above section 1: while typing it filters every section by reference, amount or beneficiary
  var findInput = root.querySelector(".br-find-input");
  if (findInput) {
    var findCount = root.querySelector(".br-find-count");
    var runFind = function () {
      findQuery = brNorm(findInput.value.trim());
      Array.prototype.forEach.call(root.querySelectorAll("table"), function (t) { if (t.__brApply) t.__brApply(); });
      if (findCount) {
        var shown = 0;
        if (findQuery) Array.prototype.forEach.call(root.querySelectorAll("table[data-section] tbody tr"), function (tr) { if (!tr.classList.contains("total") && !tr.classList.contains("filtered") && !tr.classList.contains("hid")) shown++; });
        findCount.textContent = findQuery ? "נמצאו " + fmt(shown, 0) + " שורות" : "";
      }
    };
    findInput.addEventListener("input", runFind);
    var clearBtn = root.querySelector(".br-find .x");
    if (clearBtn) clearBtn.addEventListener("click", function () { findInput.value = ""; runFind(); findInput.focus(); });
  }
  // 3. the noise toggle (the rows with the class "noise": de facto cancelled cheques, entry + cancellation pairs)
  var tog = root.querySelector(".noise-tog");
  if (tog) {
    var count = tog.getAttribute("data-count");
    var relabel = function () { tog.textContent = root.classList.contains("noise-off") ? "הצג גם את הרעשים (" + count + ")" : "הסתר רעשים (" + count + ")"; };
    tog.addEventListener("click", function () {
      root.classList.toggle("noise-off");
      relabel();
      Array.prototype.forEach.call(root.querySelectorAll("table"), function (t) { if (t.__brApply) t.__brApply(); });
    });
    relabel();
  }
  // 5. the scanned cheque in a modal (owner 2026-11-18: "display the cheque jpg in a modal popup, with a close button"):
  //    a click on 📷 opens the picture over the page; the close button, the backdrop or Escape closes it; the link itself
  //    still opens a tab with a middle click or without the script
  var modal = null;
  var closeModal = function () { if (modal) { modal.parentNode.removeChild(modal); modal = null; } };
  var openModal = function (href, title) {
    closeModal();
    var el = function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    modal = el("div", "chq-modal");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", title);
    var box = el("div", "chq-box");
    var head = el("div", "chq-head");
    var ttl = el("span", "", title);
    var open = el("a", "chq-open", "פתח בחלון חדש");
    open.href = href; open.target = "_blank"; open.rel = "noreferrer";
    var close = el("button", "chq-close", "✕");
    close.type = "button";
    close.title = "סגור";
    close.setAttribute("aria-label", "סגור");
    head.appendChild(ttl); head.appendChild(open); head.appendChild(close);
    var body = el("div", "chq-body");
    var img = document.createElement("img");
    img.alt = title;
    img.src = href;
    img.addEventListener("error", function () { body.textContent = ""; body.appendChild(el("div", "chq-err", "התמונה לא נטענה (אין הרשאה או שהקובץ חסר בארכיון).")); });
    body.appendChild(img);
    box.appendChild(head); box.appendChild(body); modal.appendChild(box);
    close.addEventListener("click", closeModal);
    modal.addEventListener("click", function (e) { if (e.target === modal) closeModal(); });
    document.body.appendChild(modal);
    close.focus();
  };
  root.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a.chq-img") : null;
    if (!a || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    var no = a.getAttribute("data-cheque"), who = a.getAttribute("data-payee");
    openModal(a.getAttribute("href"), "תמונת הצ'ק" + (no ? " " + no : "") + (who ? " – " + who : ""));
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });

  // 6. selection mode (owner 2026-11-18): "בחירה" on a section shows a checkbox per row, "בחר הכל" (the rows the filters leave
  //    visible), the count and the sum of the picked rows, and the exports: every section → the chosen rows as Excel; section
  //    3ג → the Hashavshevet import file of the cheques' reversals (Excel, or movein.dat) with a date and an action per row.
  //    The export is a form POST (field `payload` = JSON) to root's data-export, into a hidden iframe, so the page stays.
  var exportHref = root.getAttribute("data-export") || "export";
  var ctx = { company: root.getAttribute("data-company"), account: root.getAttribute("data-account"), from: root.getAttribute("data-from"), to: root.getAttribute("data-to") };
  var todayIso = new Date().toISOString().slice(0, 10);
  var postExport = function (payload, bar) {
    var msg = bar.querySelector(".msg");
    msg.textContent = "";
    var frame = root.querySelector("iframe.br-export");
    if (!frame) {
      frame = document.createElement("iframe");
      frame.className = "br-export";
      frame.name = "br-export";
      frame.style.display = "none";
      root.appendChild(frame);
    }
    frame.onload = function () {
      try {
        var text = frame.contentDocument && frame.contentDocument.body ? frame.contentDocument.body.textContent : "";
        if (text && text.trim().charAt(0) === "{") { var j = JSON.parse(text); msg.textContent = "הייצוא נכשל: " + ((j.error && j.error.message) || text); }
      } catch (e) { /* the download happened: nothing to read */ }
    };
    var form = document.createElement("form");
    form.method = "POST";
    form.action = exportHref;
    form.target = "br-export";
    form.style.display = "none";
    var input = document.createElement("input");
    input.type = "hidden";
    input.name = "payload";
    input.value = JSON.stringify(payload);
    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
  };
  Array.prototype.forEach.call(root.querySelectorAll("table[data-section]"), function (table) {
    var section = table.getAttribute("data-section");
    var h = table.previousElementSibling;
    while (h && h.tagName !== "H2") h = h.previousElementSibling;
    if (!h) return;
    var rows = Array.prototype.filter.call(table.tBodies[0].rows, function (r) { return !r.classList.contains("total") && !r.classList.contains("filtered"); });
    if (!rows.length) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sel-btn";
    btn.textContent = "בחירה";
    btn.addEventListener("click", function (e) { e.stopPropagation(); var on = table.classList.toggle("selecting"); btn.classList.toggle("on", on); bar.classList.toggle("show", on); update(); });
    h.appendChild(btn);
    var bar = document.createElement("div");
    bar.className = "selbar";
    var el = function (tag, cls, text) { var x = document.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; };
    var all = el("button", "", "בחר הכל (הנראות)"), none = el("button", "", "נקה"), cnt = el("span", "cnt", ""), xls = el("button", "", "Excel של השורות שנבחרו"), msg = el("div", "msg", "");
    [all, none, xls].forEach(function (b) { b.type = "button"; });
    bar.appendChild(all); bar.appendChild(none); bar.appendChild(cnt); bar.appendChild(xls);
    var dateIn = null, hashBtn = null, moveinBtn = null;
    if (section === "chequesStale") {
      var lab = el("label", "", "תאריך הביטול: ");
      dateIn = document.createElement("input");
      dateIn.type = "date";
      dateIn.value = todayIso;
      lab.appendChild(dateIn);
      hashBtn = el("button", "main", "קובץ ייבוא לחשבשבת (Excel)");
      moveinBtn = el("button", "", "movein.dat");
      [hashBtn, moveinBtn].forEach(function (b) { b.type = "button"; });
      bar.appendChild(lab); bar.appendChild(hashBtn); bar.appendChild(moveinBtn);
      var hint = el("span", "", "הקובץ מכיל תנועת ביטול (סטורנו) לכל צ'ק שנבחר, לפי הפעולה שבעמודה האחרונה; \"להשאיר\" לא מיוצא. צ'ק שחזר מהבנק מקבל את תאריך ההחזרה.");
      hint.style.fontSize = ".9em";
      hint.style.color = "#555";
      hint.style.flexBasis = "100%";
      bar.appendChild(hint);
    }
    bar.appendChild(msg);
    table.parentNode.insertBefore(bar, table.nextSibling);
    var picked = function () { return rows.filter(function (r) { var cb = r.querySelector("input.pick"); return cb && cb.checked; }); };
    var update = function () {
      var p = picked(), sum = 0;
      p.forEach(function (r) { var m = r.querySelector("td[data-v]"); if (m) sum += Number(m.getAttribute("data-v")) || 0; r.classList.add("picked"); });
      rows.forEach(function (r) { var cb = r.querySelector("input.pick"); if (!cb || !cb.checked) r.classList.remove("picked"); });
      cnt.textContent = "נבחרו " + fmt(p.length, 0) + " שורות, סכום " + fmt(sum, 2);
      [xls, hashBtn, moveinBtn].forEach(function (b) { if (b) b.disabled = !p.length; });
      var selAll = table.querySelector("input.sel-all");
      if (selAll) { var vis = rows.filter(function (r) { return !r.classList.contains("hid"); }); var n = vis.filter(function (r) { return r.querySelector("input.pick").checked; }).length; selAll.checked = n > 0 && n === vis.length; selAll.indeterminate = n > 0 && n < vis.length; }
    };
    rows.forEach(function (r) { var cb = r.querySelector("input.pick"); if (cb) cb.addEventListener("change", update); });
    var selAll = table.querySelector("input.sel-all");
    var pickVisible = function (on) { rows.forEach(function (r) { if (!r.classList.contains("hid")) { var cb = r.querySelector("input.pick"); if (cb) cb.checked = on; } }); update(); };
    if (selAll) selAll.addEventListener("change", function () { pickVisible(selAll.checked); });
    all.addEventListener("click", function () { pickVisible(true); });
    none.addEventListener("click", function () { rows.forEach(function (r) { var cb = r.querySelector("input.pick"); if (cb) cb.checked = false; }); update(); });
    var ids = function () { return picked().map(function (r) { return r.getAttribute("data-id"); }); };
    xls.addEventListener("click", function () { postExport({ kind: "rows", section: section, ids: ids(), company: ctx.company, account: ctx.account, from: ctx.from, to: ctx.to }, bar); });
    var hashPayload = function (format) {
      var actions = {};
      picked().forEach(function (r) { var sel = r.querySelector("select.act"); actions[r.getAttribute("data-id")] = { action: sel ? sel.value : "cancel", date: (sel && sel.value === "bounced" && r.getAttribute("data-bounced")) || dateIn.value || todayIso }; });
      return { kind: "hashavshevet", format: format, ids: ids(), actions: actions, date: dateIn.value || todayIso, company: ctx.company, account: ctx.account, from: ctx.from, to: ctx.to };
    };
    if (hashBtn) hashBtn.addEventListener("click", function () { postExport(hashPayload("xlsx"), bar); });
    if (moveinBtn) moveinBtn.addEventListener("click", function () { postExport(hashPayload("movein"), bar); });
    update();
  });

  // 4. the older-rows toggle (the rows with the class "older": dated before the period, still open)
  var otog = root.querySelector(".older-tog");
  if (otog) {
    var ocount = otog.getAttribute("data-count");
    var orelabel = function () { otog.textContent = root.classList.contains("older-off") ? "הצג גם תנועות מלפני התקופה (" + ocount + ")" : "הסתר תנועות מלפני התקופה (" + ocount + ")"; };
    otog.addEventListener("click", function () {
      root.classList.toggle("older-off");
      orelabel();
      Array.prototype.forEach.call(root.querySelectorAll("table"), function (t) { if (t.__brApply) t.__brApply(); });
    });
    orelabel();
  }
  document.addEventListener("click", closePanels);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closePanels(); });
}

export function renderBankReconHtml(report, opts = {}) {
  const title = `התאמת בנק ${report.account?.key || ""} ${fmtDate(report.from)}–${fmtDate(report.to)}${report.filter?.active ? " (מסונן)" : ""}`;
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>body{margin:16px;background:#fff}${CSS}</style>
</head>
<body>${renderBankReconBody(report, opts)}
<script>(${bankReconBehavior.toString()})(document.querySelector(".bank-recon"));</script>
</body>
</html>`;
}

export { SECTION_TITLES };
