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

// A cell's tone (owner 2026-11-12, the future cheques: the real bank balance in green, the expected one in red). The
// writer starts the cell with 🟢 or 🔴; the chat and the Excel show the text after it in that colour.
const TONE_MARK = /^(🟢|🔴)\s*/u;
const TONES = { '🟢': 'ok', '🔴': 'bad' };
/** { tone: 'ok' | 'bad', text } when the cell starts with a tone marker, else null. */
export function cellTone(s) {
  const m = TONE_MARK.exec(String(s ?? ''));
  return m ? { tone: TONES[m[1]], text: String(s).slice(m[0].length).trim() } : null;
}

/**
 * A cell as a number when it is one ("221,776", "₪ 1,234.5", "-3.6%", "(1,200)"), for Excel and for aligning numbers.
 * { value, percent, money } or null when the cell is text (a date, a name, "18.10–24.10").
 */
export function cellNumber(s) {
  const t = String(s ?? '').trim().replace(TONE_MARK, '');
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

// ---------------------------------------------------------------- money in whole shekels (owner 2026-11-04)
// "When displaying a number, round it down to NIS": money is shown without agorot, cut down (1,234.9 → 1,234;
// -17.6 → -17). Money = a number next to ₪ / ש"ח in the text, or a cell in a table column whose header is money.
// Percentages, hours, counts and other non-money numbers keep their decimals.

const MONEY_SIGN = '(?:₪|ש["״]ח|NIS)';
const MONEY_HEADER = new RegExp(`${MONEY_SIGN}|הכנס|מכיר|סכום|טיפ|תשלומ|זיכו|חיוב|מע["״]מ|ניכוי|עלות|שכר|אשראי|בנק|מזומן|income|sales|amount|tips?\\b|revenue|refund|charge|vat|cost|wage|pay`, 'i');
const NOT_MONEY_HEADER = /%|אחוז|percent|שעות|hours|סועד(ים)?$|diners$|הזמנות$|orders$|ימים|days|מספר|count|כמות|qty/i;

// 1,234.56 → 1,234 (keeps the thousands commas as written)
const cutAgorot = (num) => {
  const [i] = num.split('.');
  return /^[-−–]?0$/.test(i) ? '0' : i;
};

/** The answer with every money amount cut down to whole shekels. */
export function floorMoney(text) {
  const before = new RegExp(`(${MONEY_SIGN}\\s?[-−–]?)(\\d[\\d,]*\\.\\d+)`, 'g');
  const after = new RegExp(`([-−–]?\\d[\\d,]*\\.\\d+)(?=\\s?${MONEY_SIGN})`, 'g');
  const lines = String(text ?? '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (isRow(lines[i]) && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const header = cells(lines[i]);
      const money = header.map((h, c) => c > 0 && MONEY_HEADER.test(h) && !NOT_MONEY_HEADER.test(h));
      let j = i + 2;
      for (; j < lines.length && isRow(lines[j]) && !isSeparator(lines[j]); j++) {
        const r = cells(lines[j]);
        const out = r.map((v, c) => {
          const n = cellNumber(v);
          if (!n || n.percent || !(n.money || money[c]) || !/\.\d/.test(v)) return v.replace(before, (m, a, b) => a + cutAgorot(b)).replace(after, (m) => cutAgorot(m));
          return v.replace(/[-−–]?\d[\d,]*\.\d+/, (m) => cutAgorot(m));
        });
        if (out.some((v, c) => v !== r[c])) lines[j] = `| ${out.join(' | ')} |`;
      }
      i = j - 1;
    } else lines[i] = lines[i].replace(before, (m, a, b) => a + cutAgorot(b)).replace(after, (m) => cutAgorot(m));
  }
  return lines.join('\n');
}
