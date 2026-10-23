// Import kinds: what each file type must and may contain, and how a raw cell becomes
// a value. A column mapping is { targetField: 'column name in the file' }; the UI shows
// these fields with their help text. A missing optional value becomes NULL — never 0.

export const SOURCES = ['BIKUM_POS', 'TABIT', 'PAYROLL', 'MANUAL'];

// type: str | int | num | date | datetime | time | month | bool
export const KINDS = {
  SALES_CHECKS: {
    sources: ['BIKUM_POS', 'MANUAL'],
    needsLocation: true,
    fields: [
      { key: 'check_id', type: 'str', required: true },
      { key: 'business_date', type: 'date', required: false },
      { key: 'opened_at', type: 'datetime', required: true },
      { key: 'closed_at', type: 'datetime' },
      { key: 'diners', type: 'int' },
      { key: 'net_amount', type: 'num' },
    ],
  },
  SALES_ITEMS: {
    sources: ['BIKUM_POS', 'MANUAL'],
    needsLocation: true,
    fields: [
      { key: 'business_date', type: 'date', required: true },
      { key: 'item_code', type: 'str', required: true },
      { key: 'item_name', type: 'str' },
      { key: 'qty', type: 'num', required: true },
      { key: 'net_amount', type: 'num' },
      { key: 'check_id', type: 'str' },
      { key: 'sold_at', type: 'datetime' },
    ],
  },
  MENU: {
    sources: ['BIKUM_POS', 'MANUAL'],
    needsLocation: true,
    fields: [
      { key: 'item_code', type: 'str', required: true },
      { key: 'name', type: 'str', required: true },
      { key: 'category', type: 'str' },
      { key: 'active', type: 'bool' },
    ],
  },
  RECIPES: {
    sources: ['MANUAL'],
    needsLocation: true,
    fields: [
      { key: 'item_code', type: 'str', required: true },
      { key: 'ingredient_code', type: 'str' },
      { key: 'ingredient_name', type: 'str' },
      { key: 'qty', type: 'num' },
      { key: 'unit', type: 'str' },
      { key: 'ingredient_unit', type: 'str' },
    ],
    oneOf: [['ingredient_code', 'ingredient_name']],
  },
  EMPLOYEES: {
    sources: ['TABIT', 'PAYROLL', 'MANUAL'],
    needsLocation: false,
    fields: [
      { key: 'external_id', type: 'str', required: true },
      { key: 'name', type: 'str', required: true },
      { key: 'location_code', type: 'str' },
      { key: 'role', type: 'str' },
      { key: 'hourly_wage', type: 'num', payroll: true },
    ],
  },
  ATTENDANCE: {
    sources: ['TABIT', 'PAYROLL', 'MANUAL'],
    needsLocation: true,
    fields: [
      { key: 'external_employee_id', type: 'str', required: true },
      { key: 'business_date', type: 'date', required: true },
      { key: 'clock_in', type: 'datetime' },
      { key: 'clock_out', type: 'datetime' },
      { key: 'role', type: 'str' },
    ],
  },
  PAYROLL: {
    sources: ['PAYROLL', 'MANUAL'],
    needsLocation: true,
    payroll: true,
    fields: [
      { key: 'period', type: 'month', required: true },
      { key: 'external_employee_id', type: 'str', required: true },
      { key: 'component', type: 'str', required: true },
      { key: 'cost_type', type: 'str' },
      { key: 'hours', type: 'num' },
      { key: 'amount', type: 'num' },
    ],
  },
  ORDER_HISTORY: {
    sources: ['MANUAL'],
    needsLocation: true,
    fields: [
      { key: 'list_date', type: 'date', required: true },
      { key: 'ingredient_code', type: 'str' },
      { key: 'ingredient_name', type: 'str' },
      { key: 'qty', type: 'num' },
      { key: 'unit', type: 'str' },
    ],
    oneOf: [['ingredient_code', 'ingredient_name']],
  },
};

const pad = (n) => String(n).padStart(2, '0');

export function parseNumber(v) {
  if (v == null) return null;
  let s = String(v).trim().replace(/[₪$€\s]/g, '');
  if (s === '' || s === '-') return null;
  // "1,234.50" → 1234.50 ; "1234,5" (decimal comma, no dot) → 1234.5
  if (s.includes('.') && s.includes(',')) s = s.replace(/,/g, '');
  else if (s.includes(',')) s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  if (/^\(.*\)$/.test(s)) s = '-' + s.slice(1, -1);
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** 'DMY' (Israeli default), 'MDY' or 'YMD' for slash/dot dates; ISO always works. */
export function parseDate(v, order = 'DMY') {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})/);
  if (!m) return NaN;
  let y, mo, d;
  if (order === 'YMD' || m[1].length === 4) [y, mo, d] = [+m[1], +m[2], +m[3]];
  else if (order === 'MDY') [mo, d, y] = [+m[1], +m[2], +m[3]];
  else [d, mo, y] = [+m[1], +m[2], +m[3]];
  if (y < 100) y += 2000;
  return valid(y, mo, d);
}

function valid(y, mo, d) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return NaN;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

export function parseTime(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m || +m[1] > 23 || +m[2] > 59) return NaN;
  return `${pad(+m[1])}:${m[2]}:${m[3] ?? '00'}`;
}

/** "2026-10-01 12:30", "01/10/2026 12:30", or a time alone with a base date. Local time, no zone. */
export function parseDateTime(v, order = 'DMY', baseDate = null) {
  if (v == null) return null;
  const s = String(v).trim().replace('T', ' ');
  if (!s) return null;
  const t = parseTime(s);
  if (t && t === t) return baseDate ? `${baseDate} ${t}` : NaN;
  const [datePart, timePart] = s.split(/\s+/);
  const d = parseDate(datePart, order);
  if (!d || d !== d) return NaN;
  const tm = timePart ? parseTime(timePart.replace(/\.\d+$/, '').replace(/Z$/, '')) : '00:00:00';
  if (!tm || tm !== tm) return NaN;
  return `${d} ${tm}`;
}

export function parseMonth(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})$/);
  if (m) return +m[2] >= 1 && +m[2] <= 12 ? `${m[1]}-${pad(+m[2])}` : NaN;
  m = s.match(/^(\d{1,2})[./-](\d{4})$/);
  if (m) return +m[1] >= 1 && +m[1] <= 12 ? `${m[2]}-${pad(+m[1])}` : NaN;
  return NaN;
}

export function parseBool(v) {
  if (v == null || String(v).trim() === '') return null;
  const s = String(v).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'כן', 'פעיל', 'active'].includes(s)) return true;
  if (['0', 'false', 'no', 'n', 'לא', 'לא פעיל', 'inactive'].includes(s)) return false;
  return NaN;
}

function parseValue(type, raw, opts, rec) {
  switch (type) {
    case 'int': {
      const n = parseNumber(raw);
      return n == null || n !== n ? n : Math.round(n) === n ? n : NaN;
    }
    case 'num':
      return parseNumber(raw);
    case 'date':
      return parseDate(raw, opts.dateOrder);
    case 'datetime':
      return parseDateTime(raw, opts.dateOrder, rec.business_date || opts.defaultDate || null);
    case 'time':
      return parseTime(raw);
    case 'month':
      return parseMonth(raw);
    case 'bool':
      return parseBool(raw);
    default: {
      const s = raw == null ? '' : String(raw).trim();
      return s === '' ? null : s;
    }
  }
}

/**
 * Turn file rows into clean records with the target field names.
 * @returns {{ records: object[], rejected: { line: number, reason: string, field?: string }[] }}
 */
export function applyMapping(kind, rows, mapping, opts = {}) {
  const spec = KINDS[kind];
  if (!spec) throw Object.assign(new Error(`unknown import kind ${kind}`), { code: 'BAD_REQUEST' });
  const missingMap = spec.fields.filter((f) => f.required && !mapping[f.key] && !(kind === 'SALES_CHECKS' && f.key === 'business_date'));
  if (missingMap.length) throw Object.assign(new Error(`mapping is missing required field(s): ${missingMap.map((f) => f.key).join(', ')}`), { code: 'BAD_REQUEST' });
  for (const group of spec.oneOf || []) {
    if (!group.some((k) => mapping[k])) throw Object.assign(new Error(`mapping needs one of: ${group.join(', ')}`), { code: 'BAD_REQUEST' });
  }

  const records = [];
  const rejected = [];
  // dates first, so a time-only column can borrow the row's business date
  const ordered = [...spec.fields].sort((a, b) => (a.type === 'date' ? -1 : 0) - (b.type === 'date' ? -1 : 0));
  rows.forEach((row, i) => {
    const rec = {};
    for (const f of ordered) {
      const col = mapping[f.key];
      if (!col) {
        rec[f.key] = null;
        continue;
      }
      const v = parseValue(f.type, row[col], opts, rec);
      if (v !== v) {
        rejected.push({ line: i + 2, field: f.key, reason: `cannot read "${row[col]}" as ${f.type}` });
        return;
      }
      rec[f.key] = v;
    }
    for (const f of spec.fields) {
      if (f.required && (rec[f.key] == null || rec[f.key] === '')) {
        if (kind === 'SALES_CHECKS' && f.key === 'business_date') continue;
        rejected.push({ line: i + 2, field: f.key, reason: 'required value is empty' });
        return;
      }
    }
    for (const group of spec.oneOf || []) {
      if (!group.some((k) => rec[k] != null)) {
        rejected.push({ line: i + 2, reason: `needs one of ${group.join(' / ')}` });
        return;
      }
    }
    if (kind === 'SALES_CHECKS' && !rec.business_date) rec.business_date = rec.opened_at.slice(0, 10);
    if (rec.clock_in && rec.clock_out && rec.clock_out < rec.clock_in) {
      // a shift past midnight: the clock-out belongs to the next day
      const d = new Date(rec.clock_out.replace(' ', 'T') + 'Z');
      d.setUTCDate(d.getUTCDate() + 1);
      rec.clock_out = d.toISOString().slice(0, 19).replace('T', ' ');
    }
    if (rec.closed_at && rec.opened_at && rec.closed_at < rec.opened_at) {
      const d = new Date(rec.closed_at.replace(' ', 'T') + 'Z');
      d.setUTCDate(d.getUTCDate() + 1);
      rec.closed_at = d.toISOString().slice(0, 19).replace('T', ' ');
    }
    records.push(rec);
  });
  return { records, rejected };
}

/** Suggest a mapping from header names (Hebrew and English synonyms). The user always confirms it. */
const SYNONYMS = {
  check_id: ['check', 'check id', 'check_id', 'bill', 'bill id', 'מספר חשבון', 'חשבון', 'מס חשבון', 'הזמנה'],
  business_date: ['date', 'business date', 'business_date', 'תאריך', 'יום עסקים'],
  opened_at: ['opened', 'open time', 'opened_at', 'שעת פתיחה', 'פתיחה'],
  closed_at: ['closed', 'close time', 'closed_at', 'שעת סגירה', 'סגירה'],
  diners: ['diners', 'covers', 'guests', 'סועדים', 'מס סועדים'],
  net_amount: ['amount', 'net', 'net amount', 'total', 'סכום', 'סה"כ', 'סהכ', 'נטו'],
  item_code: ['item code', 'item_code', 'code', 'sku', 'קוד', 'קוד פריט', 'מק"ט', 'מקט'],
  item_name: ['item', 'item name', 'name', 'פריט', 'שם פריט', 'מנה'],
  name: ['name', 'שם', 'שם פריט', 'שם עובד'],
  qty: ['qty', 'quantity', 'כמות'],
  category: ['category', 'קטגוריה'],
  ingredient_code: ['ingredient code', 'ingredient_code', 'קוד רכיב', 'קוד חומר גלם'],
  ingredient_name: ['ingredient', 'ingredient name', 'רכיב', 'חומר גלם', 'מוצר'],
  unit: ['unit', 'יחידה', 'יח'],
  external_id: ['employee id', 'id', 'external id', 'מספר עובד', 'ת.ז', 'קוד עובד'],
  external_employee_id: ['employee id', 'employee', 'מספר עובד', 'קוד עובד'],
  clock_in: ['clock in', 'in', 'start', 'כניסה', 'שעת כניסה'],
  clock_out: ['clock out', 'out', 'end', 'יציאה', 'שעת יציאה'],
  role: ['role', 'position', 'תפקיד'],
  hourly_wage: ['hourly wage', 'wage', 'rate', 'שכר שעתי', 'תעריף'],
  period: ['period', 'month', 'חודש', 'תקופה'],
  component: ['component', 'item', 'רכיב שכר', 'רכיב'],
  hours: ['hours', 'שעות'],
  amount: ['amount', 'סכום'],
  list_date: ['date', 'order date', 'תאריך', 'תאריך הזמנה'],
  location_code: ['location', 'branch', 'סניף', 'קוד סניף'],
};

export function suggestMapping(kind, headers) {
  const spec = KINDS[kind];
  if (!spec) return {};
  const norm = (s) => String(s).trim().toLowerCase().replace(/[_\-]+/g, ' ');
  const used = new Set();
  const out = {};
  for (const f of spec.fields) {
    const syn = (SYNONYMS[f.key] || [f.key]).map(norm);
    const hit = headers.find((h) => !used.has(h) && (norm(h) === norm(f.key) || syn.includes(norm(h))));
    if (hit) {
      out[f.key] = hit;
      used.add(hit);
    }
  }
  return out;
}
