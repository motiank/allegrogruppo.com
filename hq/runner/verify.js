// Which numbers in an answer cannot be found in the data the answer was written from?
// The model writes the words; the numbers must come from the hub's calculations. Anything
// that does not match (allowing for rounding) is listed and shown to the user as a warning.

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
