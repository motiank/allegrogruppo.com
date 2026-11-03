// Tables inside an AI answer. The runner's writer may put a pipe table in the answer text:
//   | שבוע | אשראי | בנק |
//   |---|---|---|
//   | 18.10–24.10 | 221,776 | 218,546 |
// The chat shows it as a table component with an Excel download (routes.js /ai/requests/:id/tables/:n.xlsx).
// Pure ESM, no dependencies: used by the client (AskBox.js) and the server (routes.js) so both read the same tables.

const isRow = (line) => /^\s*\|.*\|\s*$/.test(line);
const isSeparator = (line) => /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/.test(line);
const cells = (line) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim().replace(/\*\*/g, ''));

/**
 * The answer as blocks, in order: { type: 'text', text } and { type: 'table', index, header: [..], rows: [[..]] }.
 * A table = a header row, a separator row (|---|---|) and its rows. Anything else stays text.
 */
export function splitAnswer(text) {
  const lines = String(text ?? '').split('\n');
  const blocks = [];
  let buf = [];
  let index = 0;
  const flush = () => {
    if (buf.length) blocks.push({ type: 'text', text: buf.join('\n').replace(/^\n+|\n+$/g, '') });
    buf = [];
  };
  for (let i = 0; i < lines.length; i++) {
    if (isRow(lines[i]) && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const header = cells(lines[i]);
      const rows = [];
      let j = i + 2;
      for (; j < lines.length && isRow(lines[j]) && !isSeparator(lines[j]); j++) {
        const r = cells(lines[j]);
        rows.push(header.map((_, k) => r[k] ?? ''));
      }
      flush();
      blocks.push({ type: 'table', index: index++, header, rows });
      i = j - 1;
    } else buf.push(lines[i]);
  }
  flush();
  return blocks.filter((b) => b.type === 'table' || b.text);
}

/** The tables of an answer only. */
export const answerTables = (text) => splitAnswer(text).filter((b) => b.type === 'table');

/**
 * A cell as a number when it is one ("221,776", "₪ 1,234.5", "-3.6%", "(1,200)"), for Excel and for aligning numbers.
 * { value, percent, money } or null when the cell is text (a date, a name, "18.10–24.10").
 */
export function cellNumber(s) {
  const t = String(s ?? '').trim();
  if (!t) return null;
  const money = /₪|ש"ח|NIS/i.test(t);
  const percent = /%$/.test(t);
  let x = t.replace(/₪|ש"ח|NIS|%/gi, '').replace(/\s/g, '');
  const neg = /^\(.*\)$/.test(x) || /^[-−–]/.test(x);
  x = x.replace(/^\(|\)$/g, '').replace(/^[-−–+]/, '');
  if (!/^\d{1,3}(,\d{3})+(\.\d+)?$|^\d+(\.\d+)?$/.test(x)) return null;
  const n = Number(x.replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  return { value: neg ? -n : n, percent, money };
}

// ---------------------------------------------------------------- totals (owner 2026-11-03)
// "When a table has a total and the system did not give it — calculate it, don't invent it; a missing number in the
// table is zero." The writer ends a table with a total row; here the system recalculates every number in that row from
// the rows above it, so a total is never the model's own number. Columns of dates, times or percentages are not summed.

const TOTAL_ROW = /^(סה["״׳'`]?\s?כ|סך\s?ה?כו?ל|סיכום|total|sum\b)/i;
const NOT_SUMMED = /תאריך|date|יום|day|שבוע|week|חודש|month|תקופה|period|שעת|כניסה|יציאה|clock|time|%|אחוז|percent|ממוצע|average|avg|תעריף|rate|יתרה|balance|שכר לשעה|per\b|ל-?(סועד|עובד|שעה)/i;
const EMPTY = /^(|—|–|-|n\/a)$/i;
// a total cell the writer meant as a number, even a broken one ("1,964,79")
const LOOSE_NUMBER = /^[\s₪(−–+-]*\d[\d,.\s]*\)?\s*(₪|ש"ח)?\s*$/;
const meantNumber = (s) => Boolean(cellNumber(s)) || LOOSE_NUMBER.test(String(s ?? ''));

function decimals(s) {
  const m = String(s).replace(/,/g, '').match(/\.(\d+)/);
  return m ? m[1].length : 0;
}

function formatLike(value, cellsSeen, original) {
  const d = Math.max(0, ...cellsSeen.map(decimals));
  const commas = cellsSeen.some((c) => /\d,\d{3}/.test(c)) || Math.abs(value) >= 1000;
  let n = Math.abs(value).toFixed(d);
  if (commas) {
    const [i, f] = n.split('.');
    n = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? `.${f}` : '');
  }
  if (value < 0) n = `-${n}`;
  // keep what the writer put around the number (₪, a word)
  const m = String(original).match(/^(.*?)[-−–(]?\d[\d,]*(?:\.\d+)?\)?(.*)$/);
  return m ? `${m[1]}${n}${m[2]}` : n;
}

/**
 * The answer with each table's total row recalculated from its rows, and missing numbers in number columns written
 * as 0. A table is changed only when its LAST row is its only total row ("סה"כ", "Total"…); a total cell is changed
 * only when the writer put a number there. Returns { text, totals: [numbers the system calculated] }.
 */
export function fillTotals(text) {
  const lines = String(text ?? '').split('\n');
  const totals = [];
  for (let i = 0; i < lines.length; i++) {
    if (!(isRow(lines[i]) && i + 1 < lines.length && isSeparator(lines[i + 1]))) continue;
    const header = cells(lines[i]);
    let j = i + 2;
    while (j < lines.length && isRow(lines[j]) && !isSeparator(lines[j])) j++;
    const rowIdx = Array.from({ length: j - i - 2 }, (_, k) => i + 2 + k);
    const rows = rowIdx.map((k) => header.map((_, c) => cells(lines[k])[c] ?? ''));
    const totalAt = rows.map((r, k) => (TOTAL_ROW.test(r[0]) ? k : -1)).filter((k) => k >= 0);
    const hasTotal = totalAt.length === 1 && totalAt[0] === rows.length - 1 && rows.length >= 2;
    const body = hasTotal ? rows.slice(0, -1) : rows;
    let changed = false;
    // a total COLUMN (the last header is "סה"כ"): each row's total = the sum of the number columns before it
    const last = header.length - 1;
    const numberCol = (c) => {
      const col = body.map((r) => r[c]);
      return !NOT_SUMMED.test(header[c]) && col.some((v) => cellNumber(v)) && col.every((v) => cellNumber(v) || EMPTY.test(v)) && !col.some((v) => cellNumber(v)?.percent);
    };
    const parts = Array.from({ length: Math.max(0, last - 1) }, (_, k) => k + 1);
    if (last >= 2 && TOTAL_ROW.test(header[last]) && parts.every(numberCol)) {
      for (const r of rows) {
        if (!meantNumber(r[last]) && !EMPTY.test(r[last])) continue;
        const sum = Math.round(parts.reduce((a, c) => a + (cellNumber(r[c])?.value ?? 0), 0) * 1e6) / 1e6;
        const cell = formatLike(sum, parts.map((c) => r[c]).filter((v) => !EMPTY.test(v)), r[last]);
        totals.push(sum);
        if (cell !== r[last]) {
          r[last] = cell;
          changed = true;
        }
      }
    }
    for (let c = 1; c < header.length; c++) {
      if (NOT_SUMMED.test(header[c])) continue;
      const col = body.map((r) => r[c]);
      const nums = col.map(cellNumber);
      // a number column: some numbers, every other cell empty, no percentages
      if (!nums.some(Boolean) || col.some((v, k) => !nums[k] && !EMPTY.test(v)) || nums.some((x) => x?.percent)) continue;
      body.forEach((r, k) => {
        if (!nums[k]) {
          r[c] = '0';
          changed = true;
        }
      });
      if (!hasTotal) continue;
      const totalRow = rows[rows.length - 1];
      if (!meantNumber(totalRow[c])) continue;
      const sum = Math.round(nums.reduce((s, x) => s + (x?.value ?? 0), 0) * 1e6) / 1e6;
      const cell = formatLike(sum, col.filter((v) => !EMPTY.test(v)), totalRow[c]);
      totals.push(sum);
      if (cell !== totalRow[c]) {
        totalRow[c] = cell;
        changed = true;
      }
    }
    if (changed) rows.forEach((r, k) => (lines[rowIdx[k]] = `| ${r.join(' | ')} |`));
    i = j - 1;
  }
  return { text: lines.join('\n'), totals };
}
