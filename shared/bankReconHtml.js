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
  return `<td class="${cls}" data-v="${v}">${fmtMoney(v)}</td>`;
};
// a column with a filter icon (the page's script, bankReconBehavior, opens a Google-Sheets-like panel on it)
const fth = (label) => `<th data-filter="1">${label}</th>`;
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

// the beneficiary of a cheque line (payee from Hashavshevet; "missing" = the cheque is not in Hashavshevet yet)
export const PAYEE_MISSING = "לא נמצא בחשבשבת";
export const payeeText = (x) => (x.payeeSource === "missing" ? PAYEE_MISSING : x.payee || "");

function bankOpenTable(r) {
  const rows = r.bankOpen || [];
  if (!rows.length) return `<h2>${SECTION_TITLES.bankOpen}</h2><div class="empty">אין תנועות בנק פתוחות.</div>`;
  return `
<h2>${SECTION_TITLES.bankOpen}</h2>
<table>
  <thead><tr><th>תאריך</th><th>אסמכתא</th>${fth("פרטים")}${fth("מוטב")}<th class="num">סכום</th><th class="num">ימים</th><th>שנה</th></tr></thead>
  <tbody>
    ${rows
      .map(
        (x) => `<tr class="${olderClass(x, r.from)}">${cell(fmtDate(x.date))}${cell(x.reference)}${cell(x.details)}${cell(payeeText(x), x.payeeSource === "missing" ? "missing" : "")}${money(x.amount)}${cell(x.ageDays, "num")}${cell(x.year)}</tr>`,
      )
      .join("")}
    <tr class="total"><td colspan="4">סה"כ ${fmtInt(rows.length)} תנועות</td>${money(r.summary.bankOpen.total)}<td></td><td></td></tr>
  </tbody>
</table>`;
}

function bookOpenTable(r) {
  const rows = r.bookOpen || [];
  if (!rows.length) return `<h2>${SECTION_TITLES.bookOpen}</h2><div class="empty">אין תנועות ספרים פתוחות (ללא צ'קים).</div>`;
  return `
<h2>${SECTION_TITLES.bookOpen}</h2>
<table>
  <thead><tr><th>תאריך</th><th>אסמכתא</th><th>סוג</th>${fth("פרטים")}${fth("חשבון נגדי")}<th class="num">סכום</th><th class="num">ימים</th><th>מנה</th><th>סטטוס</th></tr></thead>
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
  <thead><tr><th>תאריך</th><th>אסמכתא</th><th>סוג</th>${fth("פרטים")}${fth("חשבון נגדי")}<th class="num">סכום</th><th>מנה</th></tr></thead>
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
  <thead><tr><th>מס' צ'ק</th>${fth("מוטב")}<th>תאריך רישום</th><th>תאריך הצ'ק</th><th class="num">סכום הצ'ק</th><th>נפרע בבנק</th><th class="num">סכום בבנק</th><th>אסמכתא בבנק</th><th class="num">ימים מתאריך הצ'ק</th><th>סטטוס</th></tr></thead>
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
  <thead><tr><th>מס' צ'ק</th>${fth("מוטב")}<th>תאריך רישום</th><th>תאריך הצ'ק</th><th class="num">סכום</th><th class="num">ימים מתאריך הצ'ק</th><th>נמצא בבנק בתאריך</th><th>סטטוס</th></tr></thead>
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
  Array.prototype.forEach.call(root.querySelectorAll("table"), function (table) {
    var tbody = table.tBodies[0];
    var ths = table.tHead ? table.tHead.rows[0].cells : [];
    if (!tbody || !ths.length) return;
    var rows = Array.prototype.filter.call(tbody.rows, function (r) { return !r.classList.contains("total"); });
    var active = {}; // column index → the values kept (a column that is absent shows everything)
    var valueOf = function (r, i) { var c = r.cells[i]; var t = c ? c.textContent.trim() : ""; return t || EMPTY; };
    var apply = function () {
      var cols = Object.keys(active);
      var shown = 0, sum = 0, hasSum = false;
      rows.forEach(function (r) {
        var ok = cols.every(function (i) { return active[i].has(valueOf(r, Number(i))); });
        r.classList.toggle("hid", !ok);
        if (ok) {
          shown++;
          var m = r.querySelector("td[data-v]");
          if (m) { hasSum = true; sum += Number(m.getAttribute("data-v")) || 0; }
        }
      });
      var line = tbody.querySelector("tr.filtered");
      if (!cols.length) { if (line) line.parentNode.removeChild(line); }
      else {
        if (!line) {
          line = document.createElement("tr");
          line.className = "filtered";
          var td = document.createElement("td");
          td.colSpan = ths.length;
          line.appendChild(td);
          tbody.insertBefore(line, tbody.querySelector("tr.total"));
        }
        line.firstChild.textContent = "מסונן: " + fmt(shown, 0) + " מתוך " + fmt(rows.length, 0) + " שורות" + (hasSum ? ", סכום " + fmt(sum, 2) : "");
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
  });
  document.addEventListener("click", closePanels);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closePanels(); });
}

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
<body>${renderBankReconBody(report)}
<script>(${bankReconBehavior.toString()})(document.querySelector(".bank-recon"));</script>
</body>
</html>`;
}

export { SECTION_TITLES };
