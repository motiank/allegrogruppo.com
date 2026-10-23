// A small CSV reader for file imports (Bikum, Tabit and payroll exports saved as CSV).
// Handles a UTF-8 BOM, quoted fields with commas / new lines / doubled quotes, and
// guesses the separator (comma, semicolon or tab) from the header line.
// No Excel reader: there is no xlsx package in this project, so .xlsx files are
// saved as CSV first ("Save as → CSV UTF-8").

export function detectSeparator(headerLine) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQ = false;
  for (const ch of headerLine) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch]++;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ',';
}

/** @returns {{ headers: string[], rows: object[] }} rows keyed by header */
export function parseCsv(text, { separator } = {}) {
  let s = String(text ?? '');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const firstLine = s.slice(0, s.search(/\r?\n/) === -1 ? s.length : s.search(/\r?\n/));
  const sep = separator || detectSeparator(firstLine);

  const records = [];
  let field = '';
  let rec = [];
  let inQ = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') inQ = true;
    else if (ch === sep) {
      rec.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      rec.push(field);
      records.push(rec);
      rec = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || rec.length) {
    rec.push(field);
    records.push(rec);
  }
  const nonEmpty = records.filter((r) => r.some((v) => String(v).trim() !== ''));
  if (!nonEmpty.length) return { headers: [], rows: [] };
  const headers = nonEmpty[0].map((h) => String(h).trim());
  const rows = nonEmpty.slice(1).map((r) => {
    const o = {};
    headers.forEach((h, idx) => {
      o[h] = r[idx] == null ? '' : String(r[idx]).trim();
    });
    return o;
  });
  return { headers, rows };
}

/** Quote a value for CSV output. */
export function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV text with a BOM so Excel opens Hebrew correctly. */
export function toCsv(headers, rows) {
  return '﻿' + [headers.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n') + '\r\n';
}
