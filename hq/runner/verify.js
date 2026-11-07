// Which numbers in an answer cannot be found in the data the answer was written from?
// The model writes the words; the data numbers must come from the hub's calculations. Arithmetic the model does on
// them (owner 2026-11-08: "calculate when it is needed") is shown in brackets — "4,000 ₪ (= 20,000 ÷ 5)" — and is
// checked here: every input must be a known number and the result must be right; then the result is known too.
// Anything else that does not match (allowing for rounding) is listed and shown to the user as a warning.

const NUM = /-?\d[\d,]*(?:\.\d+)?/g;

function collect(value, out) {
  if (value == null) return;
  if (typeof value === 'number' && Number.isFinite(value)) {
    out.push(value);
    return;
  }
  if (typeof value === 'string') {
    for (const m of value.match(NUM) || []) {
      const n = Number(m.replace(/,/g, ''));
      if (Number.isFinite(n)) out.push(n);
    }
    return;
  }
  if (Array.isArray(value)) for (const v of value) collect(v, out);
  else if (typeof value === 'object') for (const v of Object.values(value)) collect(v, out);
}

/** True when `n` equals some known value after rounding it the way a writer might. */
function matches(n, known) {
  const a = Math.abs(n);
  for (const k of known) {
    const b = Math.abs(k);
    if (a === b) return true;
    if (Math.round(b) === a || Math.round(b * 10) / 10 === a || Math.round(b * 100) / 100 === a) return true;
    if (Math.floor(b) === a || Math.ceil(b) === a) return true;
    // thousands written short ("₪12.3K" → 12.3), or a share written as a percentage
    if (b >= 1000 && (Math.round(b / 100) / 10 === a || Math.round(b / 1000) === a)) return true;
    if (b <= 1 && Math.round(b * 1000) / 10 === a) return true;
  }
  return false;
}

// "= 20,000 ÷ 5", "= 15,200 − 12,000", "= 2,500 ÷ 20,000", "= 17% × 1,200": a chain of numbers and + − × ÷
const TERM = String.raw`-?\d[\d,]*(?:\.\d+)?%?`;
const EXPR = new RegExp(String.raw`=\s*(${TERM}(?:\s*[+\-−–×x*÷/]\s*${TERM})+)`, 'g');
const SMALL = 12; // a count the writer may use without it being in the data: months, days of a week, "÷ 2"

/** Evaluates a shown calculation; null when an input is not known or the chain is broken. */
function evalShown(expr, known) {
  const tokens = expr.match(new RegExp(String.raw`${TERM}|[+\-−–×x*÷/]`, 'g')) || [];
  const vals = [];
  const ops = [];
  for (const tk of tokens) {
    if (/^[+\-−–×x*÷/]$/.test(tk) && (vals.length > ops.length)) {
      ops.push(tk);
      continue;
    }
    const pct = tk.endsWith('%');
    const n = Number(tk.replace(/%$/, '').replace(/,/g, ''));
    if (!Number.isFinite(n)) return null;
    const ok = matches(n, known) || (Number.isInteger(n) && Math.abs(n) <= SMALL);
    if (!ok) return null;
    vals.push(pct ? n / 100 : n);
  }
  if (!vals.length || ops.length !== vals.length - 1) return null;
  // × ÷ first, then + −
  const v = [vals[0]];
  const o = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const b = vals[i + 1];
    if (/[×x*]/.test(op)) v[v.length - 1] *= b;
    else if (/[÷/]/.test(op)) {
      if (b === 0) return null;
      v[v.length - 1] /= b;
    } else {
      v.push(b);
      o.push(op);
    }
  }
  let r = v[0];
  for (let i = 0; i < o.length; i++) r = o[i] === '+' ? r + v[i + 1] : r - v[i + 1];
  return Number.isFinite(r) ? r : null;
}

/**
 * @param {string} answer
 * @param {...any} sources  results, context, the question — anything the answer may quote
 * @returns {string[]} numbers (as written) that are not in the sources
 */
export function unverifiedNumbers(answer, ...sources) {
  const known = [];
  for (const s of sources) collect(s, known);
  // dates and times in the sources give their parts too (2026-10-12 → 2026, 10, 12; 07:30 → 7, 30)
  const out = [];
  let text = String(answer || '');
  // a shown calculation whose inputs are known and whose result is right: the result becomes known, the text goes
  text = text.replace(EXPR, (m, expr) => {
    const r = evalShown(expr, known);
    if (r == null) return m;
    known.push(r);
    if (r !== 0 && Math.abs(r) < 1) known.push(r * 100); // a share: "12.5% (= 2,500 ÷ 20,000)"
    return ' ';
  });
  // a date or time written in the answer (11.10, 5/10/2026, 12:30) is checked part by part
  text = text.replace(/\b\d{1,2}[./:]\d{1,2}(?:[./]\d{2,4})?\b/g, (m) => {
    const parts = m.split(/[./:]/).map(Number);
    // "12.3" may be a decimal or 12 October: fine if either reading matches the data
    if (parts.length === 2 && m.includes('.') && matches(Number(m), known)) return ' ';
    const looksLikeDate = parts.length === 3 || (parts[0] <= 31 && parts[1] <= 12) || /:/.test(m);
    if (!looksLikeDate) return m;
    if (parts.some((x) => x > 2 && !matches(x, known) && !(x < 100 && matches(2000 + x, known)))) out.push(m);
    return ' ';
  });
  for (const m of text.match(NUM) || []) {
    const n = Number(m.replace(/,/g, ''));
    if (!Number.isFinite(n)) continue;
    if (Math.abs(n) <= 2) continue; // "one", "two", "0" — wording, not data
    if (!matches(n, known)) out.push(m);
  }
  return [...new Set(out)];
}
