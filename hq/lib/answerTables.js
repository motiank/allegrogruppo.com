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
