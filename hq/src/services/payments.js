// Payments (תשלומים): the planned bank transfers of a company — Joya's own table joya_payments (hq/sql/add-joya.sql).
// Chain admin only. The owner says in the Payments chat "pay X 5,000 on 15.11", "in week 2 of December", "every month on
// the 10th", or moves / cancels a payment; the planner turns it into payment ops, `checkOps` makes the proposal the
// chat shows, and Apply runs `applyOps`. The page and the calc `payments_due` read `list`.
//
// Rules (owner 2026-11-07):
// - Transfers only; cheques stay in Hashavshevet.
// - "Week N of a month" = a flexible window: week 1 = days 1–7, 2 = 8–14, 3 = 15–21, 4 = 22–end of the month. The
//   payment is due somewhere in it.
// - A monthly series: the first row is the head (series_id = its own id, repeat_json = the rule); the instances point
//   to it and are made HORIZON_MONTHS ahead, topped up every time the list is read (`topUpSeries`, idempotent: one row
//   per month of a series, cancelled months included so they are not made again).
// - A payment becomes PAID only from the admin's bank file (bank_transactions through the Local Data API, see
//   `matchWithBank`), never by hand. An unclear match (two payments with the same amount in the same window, or a line
//   whose name does not fit) stays PLANNED and is given back as `candidates`; the page lets the owner confirm one.
// - OVERDUE is not a stored status: a PLANNED payment whose window has passed (displayStatus).
import { q, one, tx, lockRow, err, audit, todayLocal, ymd, parseJson } from '../db.js';
import { addDays } from '../lib/recommend.js';
import { bank as sourceBank, bankStatus } from './source.js';
import { listLocations } from './master.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
export const HORIZON_MONTHS = 12; // how far a monthly series is made ahead
const MATCH_DAYS_BEFORE = 7; // a transfer may leave the bank this many days before the due day …
const MATCH_DAYS_AFTER = 21; // … or this many days after the window
const NAME_MATCH = 0.5; // share of the payee's words that must be in the bank line's name
const MAX_AMOUNT = 100_000_000;
// Hapoalim operation codes: 485 = a transfer we made ("העברה מהבנק", "העברה לאחר", "העב' לאחר-נייד", "העברת זה"ב נט",
// "תשלום שובר-נט"), 515 = a standing order (the payee is the action text), 473 = a bank fee (never a payment).
const TRANSFER_CODES = new Set(['485', '515']);
const TRANSFER_RE = /העברה|העב'|זה"ב|שובר/;
const FEE_CODE = '473';
const STATUS = ['PLANNED', 'PAID', 'CANCELLED'];

const pad = (n) => String(n).padStart(2, '0');

// ---------------------------------------------------------------- dates (pure)

export const daysInMonth = (month) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
const addMonths = (month, n) => {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};
/** The week-of-month window: week 1 = 1–7, 2 = 8–14, 3 = 15–21, 4 = 22 – the last day. */
export function weekWindow(month, week) {
  if (!MONTH.test(String(month || ''))) throw err('BAD_REQUEST', 'the month must be YYYY-MM');
  const w = Number(week);
  if (![1, 2, 3, 4].includes(w)) throw err('BAD_REQUEST', 'the week of the month must be 1, 2, 3 or 4');
  const last = daysInMonth(month);
  return { from: `${month}-${pad((w - 1) * 7 + 1)}`, to: `${month}-${pad(w === 4 ? last : w * 7)}` };
}
/** The week-of-month number (1–4) a day falls in. */
export const weekOfMonth = (date) => Math.min(4, Math.ceil(Number(String(date).slice(8, 10)) / 7));
/** Day `day` of a month; a day the month does not have (31 in November) = its last day. */
export const monthDay = (month, day) => `${month}-${pad(Math.min(Math.max(1, Number(day) || 1), daysInMonth(month)))}`;

/** One occurrence of a monthly rule in a month: { dueKind, dueDate, dueTo, dueEnd }. */
export function occurrenceIn(rule, month) {
  if (rule.week) {
    const w = weekWindow(month, rule.week);
    return { dueKind: 'WEEK', dueDate: w.from, dueTo: w.to, dueEnd: w.to };
  }
  const d = monthDay(month, rule.day);
  return { dueKind: 'DATE', dueDate: d, dueTo: null, dueEnd: d };
}
/** The next `count` occurrences of a monthly rule from `fromDate` (an occurrence whose window still reaches it counts), up to rule.until. */
export function nextOccurrences(rule, fromDate, count = HORIZON_MONTHS) {
  const out = [];
  let month = String(fromDate).slice(0, 7);
  for (let i = 0; out.length < count && i <= count; i++, month = addMonths(month, 1)) {
    const o = occurrenceIn(rule, month);
    if (o.dueEnd < fromDate) continue;
    if (rule.until && o.dueDate > rule.until) break;
    out.push(o);
  }
  return out;
}

const fmtDate = (d) => (d ? `${Number(d.slice(8, 10))}.${Number(d.slice(5, 7))}.${d.slice(0, 4)}` : '');
const fmtDayMonth = (d) => `${Number(d.slice(8, 10))}.${Number(d.slice(5, 7))}`;
export const fmtAmount = (n) => `${Math.floor(Number(n)).toLocaleString('en-US')} ₪`;
/** The due text of a payment: "15.11.2026" or "שבוע 2 של 12/2026 (8.12–14.12)". */
export function dueText(kind, dueDate, dueTo) {
  if (kind === 'WEEK' && dueTo) return `שבוע ${weekOfMonth(dueDate)} של ${Number(dueDate.slice(5, 7))}/${dueDate.slice(0, 4)} (${fmtDayMonth(dueDate)}–${fmtDayMonth(dueTo)})`;
  return fmtDate(dueDate);
}
const repeatText = (rule) => (!rule ? '' : (rule.week ? `כל חודש בשבוע ${rule.week}` : `כל חודש ב-${rule.day} לחודש`) + (rule.count ? ` · ${rule.count} תשלומים` : rule.until ? ` · עד ${fmtDate(rule.until)}` : ''));

// ---------------------------------------------------------------- names and the bank line (pure)

const STOP_WORDS = new Set(['בעמ', 'בע', 'מ', 'ltd', 'inc', 'llc', 'co', 'חפ', 'ח', 'פ']);
/** A payee name for comparing: lower case, dotted initials joined (ר.ר.ג → ררג), no quotes or punctuation, without בע"מ / ltd, single spaces. */
export function normalizePayee(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/["'`´׳״]/g, '')
    .replace(/(?<=\p{L})\.(?=\p{L})/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((w) => w && !STOP_WORDS.has(w))
    .join(' ');
}
/** The payee's name in a bank line: the text after "לטובת:" (up to "עבור:"); a standing order has it as the action. */
export function bankLineName(row) {
  const details = String(row?.details || '');
  const m = details.match(/לטובת:\s*(.*?)(?:\s+עבור:|$)/s);
  if (m && m[1].trim()) return m[1].trim();
  if (String(row?.actionCode ?? '') === '515' || !details) return String(row?.action || '');
  return details;
}
/** How well a payee name fits a bank line's name: 1 = one contains the other, else the share of the payee's words found. */
export function nameScore(payeeNorm, text) {
  const t = normalizePayee(text);
  if (!payeeNorm || !t) return 0;
  if (t.includes(payeeNorm) || payeeNorm.includes(t)) return 1;
  const words = payeeNorm.split(' ').filter((w) => w.length >= 2);
  if (!words.length) return 0;
  const have = t.split(' ');
  const hit = words.filter((w) => have.some((h) => h === w || (h.length >= 3 && w.length >= 3 && (h.startsWith(w) || w.startsWith(h))))).length;
  return hit / words.length;
}
/** A bank line that is a transfer we made (not a fee, not a cheque, not money in). */
export function isTransferLine(row) {
  const code = String(row?.actionCode ?? '');
  if (!(Number(row?.debit) > 0) || code === FEE_CODE) return false;
  return TRANSFER_CODES.has(code) || TRANSFER_RE.test(String(row?.action || ''));
}
/** The key of a bank line (the same line can come twice from overlapping uploads). */
export const bankLineKey = (row) => `${row.account ?? ''}|${row.date}|${row.reference ?? ''}|${Number(row.debit).toFixed(2)}`;
const sameAmount = (a, b) => Math.abs(Number(a) - Number(b)) < 0.011;
const candidateOf = (x) => ({ key: x.key, date: x.row.date, amount: Number(x.row.debit), name: x.name, action: x.row.action ?? null, details: x.row.details ?? null, reference: x.row.reference ?? null, score: Math.round(x.score * 100) / 100 });

/**
 * Which PLANNED payments the bank lines paid (pure).
 * planned: [{ id, payeeNorm, amount, dueDate, dueTo }]; bankRows: the Local Data API rows (date, actionCode, action,
 * details, reference, debit, account). A line is a candidate of a payment when the amount is the same and its date is
 * within MATCH_DAYS_BEFORE of the due day … MATCH_DAYS_AFTER after the window. Pass 1: the line whose name fits the
 * payee (best score, then the nearest date). Pass 2: a line that is the only candidate of the only payment left.
 * Everything else stays open and is returned as candidates (the page asks the owner).
 * @returns {{ matched: Array<{paymentId:number, key:string, row:object, score:number, how:'name'|'only'}>, candidates: Record<number, object[]> }}
 */
export function pickMatches(planned, bankRows, today = null) {
  const lines = [];
  const seen = new Set();
  for (const row of bankRows || []) {
    if (!isTransferLine(row)) continue;
    const key = bankLineKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push({ key, row, name: bankLineName(row) });
  }
  const cands = new Map();
  const claims = new Map();
  for (const p of planned || []) {
    const from = addDays(p.dueDate, -MATCH_DAYS_BEFORE);
    const to = addDays(p.dueTo || p.dueDate, MATCH_DAYS_AFTER);
    const list = lines
      .filter((x) => sameAmount(x.row.debit, p.amount) && x.row.date >= from && x.row.date <= to && (!today || x.row.date <= today))
      .map((x) => ({ ...x, score: nameScore(p.payeeNorm, x.name) }));
    cands.set(p.id, list);
    for (const x of list) {
      if (!claims.has(x.key)) claims.set(x.key, new Set());
      claims.get(x.key).add(p.id);
    }
  }
  const order = [...(planned || [])].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id - b.id);
  const dist = (x, p) => Math.abs(Date.parse(x.row.date) - Date.parse(p.dueDate));
  const used = new Set();
  const done = new Set();
  const matched = [];
  for (const p of order) {
    const named = cands.get(p.id).filter((x) => x.score >= NAME_MATCH && !used.has(x.key)).sort((a, b) => b.score - a.score || dist(a, p) - dist(b, p));
    if (!named.length) continue;
    used.add(named[0].key);
    done.add(p.id);
    matched.push({ paymentId: p.id, key: named[0].key, row: named[0].row, score: named[0].score, how: 'name' });
  }
  const candidates = {};
  for (const p of order) {
    if (done.has(p.id)) continue;
    const free = cands.get(p.id).filter((x) => !used.has(x.key));
    const only = free.length === 1 && [...claims.get(free[0].key)].filter((id) => !done.has(id)).length === 1;
    if (only) {
      used.add(free[0].key);
      done.add(p.id);
      matched.push({ paymentId: p.id, key: free[0].key, row: free[0].row, score: free[0].score, how: 'only' });
    } else if (free.length) candidates[p.id] = free.map(candidateOf);
  }
  return { matched, candidates };
}

// ---------------------------------------------------------------- the ops of the planner / the API (pure checks)

const parseAmount = (v) => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[,\s₪]/g, ''));
  if (!Number.isFinite(n) || n <= 0 || n > MAX_AMOUNT) throw err('BAD_REQUEST', 'the amount must be a number above 0');
  return Math.round(n * 100) / 100;
};
const intId = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw err('BAD_REQUEST', 'a payment id (#) is needed');
  return n;
};
const scopeOf = (v) => {
  if (v == null || v === '' || v === 'one') return 'one';
  if (v === 'series') return 'series';
  throw err('BAD_REQUEST', 'scope must be "one" or "series"');
};
/** The due part of an add / move op → { dueKind, dueDate, dueTo }; a past day or window is refused. */
function dueOf(op, today, { optional = false } = {}) {
  if (op.dueKind === 'WEEK' && op.dueTo) {
    // an op that was normalised before (the proposal's ops come back to applyOps): keep its week window
    const from = String(op.dueDate).slice(0, 10);
    const to = String(op.dueTo).slice(0, 10);
    if (!DATE.test(from) || !DATE.test(to) || to < from) throw err('BAD_REQUEST', 'the week window must be two dates YYYY-MM-DD');
    if (to < today) throw err('BAD_REQUEST', `the week ${fmtDate(from)}–${fmtDate(to)} has passed (today is ${fmtDate(today)})`);
    return { dueKind: 'WEEK', dueDate: from, dueTo: to };
  }
  if (op.dueWeek && typeof op.dueWeek === 'object') {
    // { year: 2026, month: 12, week: 2 } (the planner: numbers only — a quoted "YYYY-MM" inside lost its closing quote) or { month: 'YYYY-MM', week }
    const dw = op.dueWeek;
    const month = typeof dw.month === 'string' && MONTH.test(dw.month) ? dw.month : dw.year != null && dw.month != null && Number(dw.month) >= 1 && Number(dw.month) <= 12 ? `${dw.year}-${pad(Number(dw.month))}` : String(dw.month ?? '');
    const w = weekWindow(month, dw.week);
    if (w.to < today) throw err('BAD_REQUEST', `week ${dw.week} of ${month} has passed (today is ${today})`);
    return { dueKind: 'WEEK', dueDate: w.from, dueTo: w.to };
  }
  if (op.dueDate != null && op.dueDate !== '') {
    const d = String(op.dueDate).slice(0, 10);
    if (!DATE.test(d)) throw err('BAD_REQUEST', 'the date must be YYYY-MM-DD');
    if (d < today) throw err('BAD_REQUEST', `${fmtDate(d)} has passed (today is ${fmtDate(today)}); a payment is planned for today or later`);
    return { dueKind: 'DATE', dueDate: d, dueTo: null };
  }
  if (optional) return null;
  throw err('BAD_REQUEST', 'a payment needs a day (dueDate), a week of a month (dueWeek) or "now" (= today)');
}
function repeatOf(rep, due) {
  if (rep == null || rep === false) return null;
  if (typeof rep !== 'object') throw err('BAD_REQUEST', 'repeat must be { every: "month", day | week, until? }');
  if (rep.every && rep.every !== 'month') throw err('BAD_REQUEST', 'only a monthly repeat is possible for now');
  const out = { every: 'month' };
  if (rep.week != null) {
    if (![1, 2, 3, 4].includes(Number(rep.week))) throw err('BAD_REQUEST', 'repeat.week must be 1–4');
    out.week = Number(rep.week);
  } else if (rep.day != null) {
    if (!Number.isInteger(Number(rep.day)) || Number(rep.day) < 1 || Number(rep.day) > 31) throw err('BAD_REQUEST', 'repeat.day must be 1–31');
    out.day = Number(rep.day);
  } else if (due?.dueKind === 'WEEK') out.week = weekOfMonth(due.dueDate);
  else if (due) out.day = Number(due.dueDate.slice(8, 10));
  else throw err('BAD_REQUEST', 'a repeat needs a day of the month or a week of the month');
  if (rep.until != null && rep.until !== '') {
    const u = String(rep.until).slice(0, 10);
    if (!DATE.test(u)) throw err('BAD_REQUEST', 'repeat.until must be YYYY-MM-DD');
    out.until = u;
  }
  if (rep.count != null && rep.count !== '') {
    const n = Number(rep.count);
    if (!Number.isInteger(n) || n < 2 || n > 60) throw err('BAD_REQUEST', 'repeat.count (how many payments in all) must be 2–60');
    out.count = n;
  }
  return out;
}
/** A series of `count` payments ends with its last one: the rule gets `until` = the end of the count-th occurrence from the first due. */
export function closeCount(rule, firstDue) {
  if (!rule?.count) return rule;
  const all = nextOccurrences(rule, firstDue, rule.count);
  const last = all[all.length - 1];
  const until = last ? last.dueTo || last.dueDate : firstDue;
  return { ...rule, until: rule.until && rule.until < until ? rule.until : until };
}
/**
 * One op of the planner / the API, checked and in one shape (pure). known = [{ name, norm }] payees used before: the
 * same name in another spelling takes the known spelling.
 */
export function normalizeOp(op, { today = todayLocal(), known = [] } = {}) {
  if (!op || typeof op !== 'object') throw err('BAD_REQUEST', 'an op must be an object');
  const kind = String(op.op || '');
  if (kind === 'add') {
    const payee = String(op.payee ?? '').trim();
    if (!payee) throw err('BAD_REQUEST', 'who is paid? (payee)');
    if (payee.length > 255) throw err('BAD_REQUEST', 'the payee name is too long');
    const norm = normalizePayee(payee);
    const same = known.find((k) => k.norm === norm);
    const amount = parseAmount(op.amount);
    let due = dueOf(op, today, { optional: true });
    const repeat = repeatOf(op.repeat, due);
    if (!due && repeat) {
      const first = nextOccurrences(repeat, today, 1)[0];
      if (!first) throw err('BAD_REQUEST', 'the repeat ends before its first payment');
      due = { dueKind: first.dueKind, dueDate: first.dueDate, dueTo: first.dueTo };
    }
    if (!due) dueOf(op, today); // throws the explanation
    const note = op.note == null ? null : String(op.note).trim().slice(0, 1000) || null;
    return { op: 'add', payee: same ? same.name : payee, payeeNorm: same ? same.norm : norm, amount, ...due, repeat: closeCount(repeat, due.dueDate), note };
  }
  if (kind === 'move') return { op: 'move', id: intId(op.id), ...dueOf(op, today), scope: scopeOf(op.scope) };
  if (kind === 'amount') return { op: 'amount', id: intId(op.id), amount: parseAmount(op.amount), scope: scopeOf(op.scope) };
  if (kind === 'cancel') return { op: 'cancel', id: intId(op.id), scope: scopeOf(op.scope) };
  throw err('BAD_REQUEST', `unknown payment op "${kind}" (add, move, amount, cancel)`);
}

// ---------------------------------------------------------------- rows

const shape = (r, today = null) => {
  const dueDate = ymd(r.due_date);
  const dueTo = r.due_to ? ymd(r.due_to) : null;
  const end = dueTo || dueDate;
  const rule = parseJson(r.repeat_json);
  const match = parseJson(r.match_json);
  return {
    id: r.id,
    companyKey: r.company_key,
    payee: r.payee,
    amount: Number(r.amount),
    dueKind: r.due_kind,
    dueDate,
    dueTo,
    dueText: dueText(r.due_kind, dueDate, dueTo),
    status: r.status,
    displayStatus: r.status === 'PLANNED' && today && end < today ? 'OVERDUE' : r.status,
    seriesId: r.series_id,
    repeat: rule ? { ...rule, text: repeatText(rule) } : null,
    paidDate: r.paid_date ? ymd(r.paid_date) : null,
    bank: match ? { date: match.date, reference: match.reference ?? null, name: match.name ?? null, how: match.how } : null,
    note: r.note,
    requestId: r.request_id,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
};
const getRow = (db, id) => db.one(`SELECT * FROM joya_payments WHERE id=:id`, { id });

/** The companies of the chain admin (the bank and the payments are per company). */
export async function companiesOf(access) {
  if (!access?.isAdmin) throw err('FORBIDDEN', 'payments are for the chain admin only');
  const out = new Map();
  for (const l of await listLocations(access)) if (l.company?.key && !out.has(l.company.key)) out.set(l.company.key, { key: l.company.key, label: l.company.label ?? l.company.key });
  return [...out.values()];
}
async function resolveCompany(access, companyKey) {
  const all = await companiesOf(access);
  if (companyKey) {
    const co = all.find((c) => c.key === companyKey || c.label === companyKey);
    if (!co) throw err('BAD_REQUEST', `unknown company ${companyKey}`);
    return co;
  }
  if (all.length === 1) return all[0];
  // no company chosen: the one company that has a bank account in Allegro (the payments leave from a bank account)
  let withBank = [];
  try {
    const accounts = await bankStatus();
    withBank = all.filter((c) => accounts.some((a) => a.company === c.key));
  } catch {
    withBank = [];
  }
  if (withBank.length === 1) return withBank[0];
  throw err('BAD_REQUEST', `which company? (${all.map((c) => c.label).join(', ')})`);
}

/** The payees used before (latest first): [{ name, norm, count, lastAmount }]. companyKey null = all companies. */
export async function payees(companyKey = null, limit = 50) {
  const rows = await q(`SELECT payee, payee_norm, amount, created_at FROM joya_payments WHERE status<>'CANCELLED' ${companyKey ? 'AND company_key=:k' : ''} ORDER BY id DESC LIMIT 1000`, { k: companyKey });
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.payee_norm)) out.set(r.payee_norm, { name: r.payee, norm: r.payee_norm, count: 0, lastAmount: Number(r.amount) });
    out.get(r.payee_norm).count++;
  }
  return [...out.values()].slice(0, limit);
}

/**
 * The PLANNED transfers of a company whose day (or week window) falls in from–to, oldest first: [{ id, payee, amount,
 * date (the day, or the first day of the window), dueTo, dueKind }]. For the expected bank balance of the future
 * cheques (finance.js): a planned payment leaves the account like a cheque.
 */
export async function plannedByDay(companyKey, from, to) {
  if (!companyKey || !DATE.test(from) || !DATE.test(to) || from > to) return [];
  await topUpSeries(companyKey).catch(() => {});
  const rows = await q(
    `SELECT id, payee, amount, due_kind, due_date, due_to FROM joya_payments WHERE company_key=:k AND status='PLANNED' AND due_date <= :to AND COALESCE(due_to, due_date) >= :from ORDER BY due_date, id`,
    { k: companyKey, from, to },
  );
  return rows.map((r) => ({ id: r.id, payee: r.payee, amount: Number(r.amount), date: ymd(r.due_date), dueTo: r.due_to ? ymd(r.due_to) : null, dueKind: r.due_kind }));
}

/** Makes the missing months of every monthly series of a company, HORIZON_MONTHS ahead. Returns how many rows were added. */
export async function topUpSeries(companyKey, today = todayLocal()) {
  const heads = await q(`SELECT * FROM joya_payments WHERE company_key=:k AND repeat_json IS NOT NULL AND series_id = id`, { k: companyKey });
  let added = 0;
  for (const h of heads) {
    const rule = parseJson(h.repeat_json);
    if (!rule || (rule.until && rule.until < today)) continue;
    const have = new Set((await q(`SELECT due_date FROM joya_payments WHERE series_id=:s`, { s: h.id })).map((r) => ymd(r.due_date).slice(0, 7)));
    for (const o of nextOccurrences(rule, today, HORIZON_MONTHS)) {
      if (have.has(o.dueDate.slice(0, 7))) continue;
      await q(
        `INSERT INTO joya_payments (company_key, payee, payee_norm, amount, due_kind, due_date, due_to, series_id, status, note, created_by)
         VALUES (:k, :payee, :norm, :amount, :kind, :due, :dueTo, :s, 'PLANNED', :note, :by)`,
        { k: companyKey, payee: h.payee, norm: h.payee_norm, amount: h.amount, kind: o.dueKind, due: o.dueDate, dueTo: o.dueTo, s: h.id, note: h.note, by: h.created_by },
      );
      added++;
    }
  }
  return added;
}

async function bankLines(companyKey, from, to) {
  const res = await sourceBank(companyKey, from, to, { side: 'debit' });
  if (!res.available) return { note: res.reason, rows: [] };
  const rows = res.rows.map((r) => ({ ...r, date: ymd(r.date) }));
  // how far the company's accounts are loaded (/status meta.bank: [{ company, account, lastDate }]); the rows as a fallback
  let upTo = null;
  try {
    for (const a of await bankStatus()) if (a.company === companyKey && a.lastDate && (!upTo || a.lastDate > upTo)) upTo = ymd(a.lastDate);
  } catch {
    upTo = null;
  }
  return { rows, upTo: upTo || rows.reduce((m, r) => (r.date > m ? r.date : m), null) };
}

/**
 * Marks as PAID the PLANNED payments of a company that a line of the bank file paid (see pickMatches). Runs when the
 * list is read. A bank file that is not loaded is not an error: { bankNote }. Returns the open candidates per payment.
 */
export async function matchWithBank(access, companyKey, today = todayLocal()) {
  const planned = await q(`SELECT id, payee, payee_norm, amount, due_date, due_to FROM joya_payments WHERE company_key=:k AND status='PLANNED' AND due_date <= :lim ORDER BY due_date, id`, {
    k: companyKey,
    lim: addDays(today, MATCH_DAYS_BEFORE),
  });
  if (!planned.length) return { bankUpTo: null, candidates: {}, matched: 0 };
  const from = addDays(ymd(planned[0].due_date), -MATCH_DAYS_BEFORE);
  let bank;
  try {
    bank = await bankLines(companyKey, from, today);
  } catch (e) {
    return { bankUpTo: null, bankNote: `the bank file could not be read (${e.code || e.message})`, candidates: {}, matched: 0 };
  }
  if (bank.note) return { bankUpTo: null, bankNote: bank.note, candidates: {}, matched: 0 };
  const list = planned.map((p) => ({ id: p.id, payeeNorm: p.payee_norm, amount: Number(p.amount), dueDate: ymd(p.due_date), dueTo: p.due_to ? ymd(p.due_to) : null }));
  const { matched, candidates } = pickMatches(list, bank.rows, today);
  let n = 0;
  for (const m of matched) {
    const detail = { how: m.how, key: m.key, date: m.row.date, amount: Number(m.row.debit), name: bankLineName(m.row), reference: m.row.reference ?? null, action: m.row.action ?? null, score: m.score };
    try {
      const r = await q(`UPDATE joya_payments SET status='PAID', paid_date=:d, bank_tx_key=:key, match_json=:m WHERE id=:id AND status='PLANNED'`, { d: m.row.date, key: m.key, m: JSON.stringify(detail), id: m.paymentId });
      if (!r.affectedRows) continue;
      n++;
      await audit(access?.username ?? null, 'PAYMENT_PAID', 'payment', m.paymentId, null, { ...detail, auto: true });
    } catch (e) {
      if (e.code !== 'ER_DUP_ENTRY') throw e; // the line already paid another payment: this one stays open
    }
  }
  return { bankUpTo: bank.upTo, candidates, matched: n };
}

/** The owner says which bank line paid a payment (one of its candidates). */
export async function confirmMatch(access, id, bankTxKey) {
  if (!access?.isAdmin) throw err('FORBIDDEN', 'payments are for the chain admin only');
  const key = String(bankTxKey || '').trim();
  if (!key) throw err('BAD_REQUEST', 'bankTxKey is needed');
  const r = await getRow({ one }, id);
  if (!r) throw err('NOT_FOUND', `there is no payment #${id}`);
  if (r.status !== 'PLANNED') throw err('CONFLICT', `payment #${id} is already ${r.status.toLowerCase()}`);
  const today = todayLocal();
  const dueDate = ymd(r.due_date);
  const bank = await bankLines(r.company_key, addDays(dueDate, -MATCH_DAYS_BEFORE), today);
  if (bank.note) throw err('NOT_LOADED', bank.note);
  const row = bank.rows.find((x) => isTransferLine(x) && bankLineKey(x) === key);
  if (!row) throw err('NOT_FOUND', 'that bank line was not found in the bank file');
  if (!sameAmount(row.debit, r.amount)) throw err('CONFLICT', 'the bank line has another amount');
  const detail = { how: 'confirmed', key, date: row.date, amount: Number(row.debit), name: bankLineName(row), reference: row.reference ?? null, action: row.action ?? null, by: access.username };
  try {
    await q(`UPDATE joya_payments SET status='PAID', paid_date=:d, bank_tx_key=:key, match_json=:m WHERE id=:id AND status='PLANNED'`, { d: row.date, key, m: JSON.stringify(detail), id });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw err('CONFLICT', 'that bank line already paid another payment');
    throw e;
  }
  await audit(access.username, 'PAYMENT_PAID', 'payment', id, null, detail);
  return shape(await getRow({ one }, id), today);
}

const weekStartOf = (d) => addDays(d, -new Date(`${d}T00:00:00Z`).getUTCDay()); // weeks run Sunday–Saturday

/** The payments of one company in a period, grouped for the page and the chat. status: PLANNED (default) | PAID | CANCELLED | all. */
async function companyBoard(access, co, { from, to, status = 'PLANNED', today }) {
  await topUpSeries(co.key, today);
  const bank = await matchWithBank(access, co.key, today);
  const st = status === 'all' ? null : status;
  if (st && !STATUS.includes(st)) throw err('BAD_REQUEST', 'status must be PLANNED, PAID, CANCELLED or all');
  const rows = await q(
    `SELECT * FROM joya_payments WHERE company_key=:k
       AND ((status='PLANNED' AND due_date <= :to) OR (status<>'PLANNED' AND due_date BETWEEN :from AND :to))
       ${st ? 'AND status=:st' : ''} ORDER BY due_date, id`,
    { k: co.key, from, to, st },
  );
  const weekEnd = addDays(weekStartOf(today), 6);
  const groups = { overdue: [], today: [], thisWeek: [], upcoming: [], paid: [], cancelled: [] };
  for (const r of rows) {
    const p = shape(r, today);
    if (bank.candidates[p.id]) p.candidates = bank.candidates[p.id];
    const end = p.dueTo || p.dueDate;
    if (p.status === 'PAID') groups.paid.push(p);
    else if (p.status === 'CANCELLED') groups.cancelled.push(p);
    else if (p.displayStatus === 'OVERDUE') groups.overdue.push(p);
    else if (p.dueDate <= today && end >= today) groups.today.push(p);
    else if (p.dueDate <= weekEnd) groups.thisWeek.push(p);
    else groups.upcoming.push(p);
  }
  const sum = (list) => Math.round(list.reduce((s, p) => s + p.amount, 0) * 100) / 100;
  const totals = Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, sum(v)]));
  totals.open = totals.overdue + totals.today + totals.thisWeek + totals.upcoming;
  totals.count = rows.length;
  return {
    company: co.label,
    companyKey: co.key,
    bankUpTo: bank.bankUpTo,
    ...(bank.bankNote ? { bankNote: bank.bankNote } : {}),
    matchedNow: bank.matched,
    ...groups,
    totals,
  };
}

/** The payments board (the page): GET /joya/payments. */
export async function list(access, { companyKey = null, from = null, to = null, status = 'PLANNED' } = {}) {
  const today = todayLocal();
  const cos = companyKey ? [await resolveCompany(access, companyKey)] : await companiesOf(access);
  const f = from || today;
  const t = to || addDays(today, 30);
  if (!DATE.test(f) || !DATE.test(t) || f > t) throw err('BAD_REQUEST', 'from/to must be YYYY-MM-DD, from ≤ to');
  const companies = [];
  for (const co of cos) companies.push(await companyBoard(access, co, { from: f, to: t, status, today }));
  return { today, period: { from: f, to: t }, status, companies };
}

/** The calc payments_due of the chat: the same board per company, with its source and a note for the writer. */
export async function listForCalc(companies, p = {}, today = todayLocal()) {
  const from = p.from || today;
  const to = p.to || addDays(today, 30);
  if (!DATE.test(from) || !DATE.test(to) || from > to) throw err('BAD_REQUEST', 'from and to must be YYYY-MM-DD, from ≤ to');
  const status = p.status || 'PLANNED';
  const out = [];
  for (const co of companies) out.push(await companyBoard({ isAdmin: true, username: null }, co, { from, to, status, today }));
  return {
    period: { from, to },
    today,
    status,
    source: 'joya_payments (the planned bank transfers of the Payments chat); PAID comes only from the bank file (/bank/transactions/stored)',
    note:
      'overdue = planned payments whose day or week has passed and no bank line paid them; today / thisWeek (Sunday–Saturday) / upcoming are what is still to pay; ' +
      'a payment with candidates has bank lines of its amount that may have paid it — the owner confirms one on the Payments page; dueText is the day or the week-of-month window; a series row repeats every month',
    companies: out,
  };
}

// ---------------------------------------------------------------- the planner's change → a proposal → applied

/** The text of one proposed op, as the chat shows it. */
function previewLine(op, before) {
  const who = (p) => `${p.payee} · ${fmtAmount(p.amount)}`;
  if (op.op === 'add') return `תשלום חדש · ${who(op)} · ${dueText(op.dueKind, op.dueDate, op.dueTo)}${op.repeat ? ` · ${repeatText(op.repeat)}` : ''}`;
  const b = before;
  const series = op.scope === 'series' ? ' (כל הסדרה)' : '';
  if (op.op === 'move') return `תשלום #${op.id} · ${who(b)} · ${b.dueText} → ${dueText(op.dueKind, op.dueDate, op.dueTo)}${series}`;
  if (op.op === 'amount') return `תשלום #${op.id} · ${b.payee} · ${fmtAmount(b.amount)} → ${fmtAmount(op.amount)}${series}`;
  return `ביטול תשלום #${op.id} · ${who(b)} · ${b.dueText}${series}`;
}

/**
 * The planner's payment ops → a checked proposal { type: 'PAYMENT_OPS', companyKey, ops, preview }. Chain admin only.
 * companyKey: the picker's company; an admin with one company needs none; with several and none chosen → BAD_REQUEST.
 */
export async function checkOps(access, ops, { companyKey = null, today = todayLocal(), requestId = null } = {}) {
  if (!access?.isAdmin) throw err('FORBIDDEN', 'only the chain admin can plan payments');
  if (!Array.isArray(ops) || !ops.length) throw err('BAD_REQUEST', 'no payment change');
  if (ops.length > 20) throw err('BAD_REQUEST', 'at most 20 payment changes at once');
  let co = null;
  companyKey = companyKey || ops.find((o) => o && typeof o.companyKey === 'string' && o.companyKey)?.companyKey || null; // the planner names it when the question does
  if (!companyKey) {
    // a change of an existing payment: its company
    const first = ops.find((o) => o && o.op !== 'add' && Number(o.id) > 0);
    const row = first ? await getRow({ one }, Number(first.id)) : null;
    if (row) co = await resolveCompany(access, row.company_key);
  }
  if (!co) co = await resolveCompany(access, companyKey);
  const known = await payees(co.key, 200);
  const checked = [];
  const preview = [];
  for (const raw of ops) {
    const op = normalizeOp(raw, { today, known });
    let before = null;
    if (op.op !== 'add') {
      const r = await getRow({ one }, op.id);
      if (!r || r.company_key !== co.key) throw err('NOT_FOUND', `there is no payment #${op.id}`);
      if (r.status !== 'PLANNED') throw err('CONFLICT', `payment #${op.id} is already ${r.status === 'PAID' ? 'paid' : 'cancelled'}`);
      if (op.scope === 'series' && !r.series_id) throw err('BAD_REQUEST', `payment #${op.id} is not part of a monthly series`);
      before = shape(r, today);
    }
    checked.push(op);
    preview.push({ op: op.op, id: op.id ?? null, text: previewLine(op, before), ...(before ? { before: { payee: before.payee, amount: before.amount, dueDate: before.dueDate, dueTo: before.dueTo, dueText: before.dueText } } : {}) });
  }
  return { type: 'PAYMENT_OPS', companyKey: co.key, company: co.label, ops: checked, preview, ...(requestId ? { requestId } : {}) };
}

/** Applies a checked proposal (the user tapped Apply, or the API). Everything in one transaction. */
export async function applyOps(access, proposal, { via = 'API' } = {}) {
  if (!access?.isAdmin) throw err('FORBIDDEN', 'only the chain admin can change payments');
  const co = await resolveCompany(access, proposal?.companyKey);
  const ops = Array.isArray(proposal?.ops) ? proposal.ops : [];
  if (!ops.length) throw err('BAD_REQUEST', 'nothing to apply');
  const today = todayLocal();
  const by = access.username;
  const requestId = proposal.requestId ?? null;
  const applied = await tx(async (c) => {
    const out = [];
    const insert = async (p) => {
      const r = await c.q(
        `INSERT INTO joya_payments (company_key, payee, payee_norm, amount, due_kind, due_date, due_to, series_id, repeat_json, status, note, request_id, created_by)
         VALUES (:k, :payee, :norm, :amount, :kind, :due, :dueTo, :series, :rep, 'PLANNED', :note, :req, :by)`,
        { k: co.key, payee: p.payee, norm: p.payeeNorm, amount: p.amount, kind: p.dueKind, due: p.dueDate, dueTo: p.dueTo ?? null, series: p.seriesId ?? null, rep: p.repeat ? JSON.stringify(p.repeat) : null, note: p.note ?? null, req: requestId, by },
      );
      return r.insertId;
    };
    const instancesAfter = async (head, rule, afterDate, amount) => {
      const ids = [];
      for (const o of nextOccurrences(rule, addDays(afterDate, 1), HORIZON_MONTHS - 1)) ids.push(await insert({ payee: head.payee, payeeNorm: head.payee_norm, amount, dueKind: o.dueKind, dueDate: o.dueDate, dueTo: o.dueTo, seriesId: head.id, note: head.note }));
      return ids;
    };
    for (const raw of ops) {
      const op = normalizeOp(raw, { today }); // checked again: the proposal may be old
      if (op.op === 'add') {
        const id = await insert({ ...op, seriesId: null, repeat: null });
        let ids = [id];
        if (op.repeat) {
          await c.q(`UPDATE joya_payments SET series_id=:id, repeat_json=:rep WHERE id=:id`, { id, rep: JSON.stringify(op.repeat) });
          const head = await getRow(c, id);
          ids = ids.concat(await instancesAfter(head, op.repeat, op.dueTo || op.dueDate, op.amount));
        }
        await audit(by, 'PAYMENT_ADDED', 'payment', id, null, { via, payee: op.payee, amount: op.amount, dueDate: op.dueDate, dueTo: op.dueTo, repeat: op.repeat, made: ids.length });
        out.push({ op: 'add', id, ids });
        continue;
      }
      const r = await lockRow(c, 'joya_payments', op.id);
      if (!r || r.company_key !== co.key) throw err('NOT_FOUND', `there is no payment #${op.id}`);
      if (r.status !== 'PLANNED') throw err('CONFLICT', `payment #${op.id} is already ${r.status === 'PAID' ? 'paid' : 'cancelled'}`);
      const series = op.scope === 'series' && r.series_id ? await lockRow(c, 'joya_payments', r.series_id) : null;
      if (op.scope === 'series' && !series) throw err('BAD_REQUEST', `payment #${op.id} is not part of a monthly series`);
      const dueDate = ymd(r.due_date);
      if (op.op === 'move') {
        await c.q(`UPDATE joya_payments SET due_kind=:kind, due_date=:due, due_to=:dueTo WHERE id=:id`, { kind: op.dueKind, due: op.dueDate, dueTo: op.dueTo, id: op.id });
        let ids = [op.id];
        if (series) {
          // the rule follows the new day / week; the later months are made again
          const rule = { ...parseJson(series.repeat_json), ...(op.dueKind === 'WEEK' ? { week: weekOfMonth(op.dueDate), day: undefined } : { day: Number(op.dueDate.slice(8, 10)), week: undefined }) };
          if (rule.week == null) delete rule.week;
          if (rule.day == null) delete rule.day;
          await c.q(`UPDATE joya_payments SET repeat_json=:rep WHERE id=:id`, { rep: JSON.stringify(rule), id: series.id });
          await c.q(`DELETE FROM joya_payments WHERE series_id=:s AND status='PLANNED' AND due_date > :d AND id<>:id`, { s: series.id, d: dueDate, id: op.id });
          ids = ids.concat(await instancesAfter(series, rule, op.dueTo || op.dueDate, r.amount));
        }
        await audit(by, 'PAYMENT_MOVED', 'payment', op.id, null, { via, from: dueDate, to: op.dueDate, dueTo: op.dueTo, scope: op.scope });
        out.push({ op: 'move', id: op.id, ids });
      } else if (op.op === 'amount') {
        if (series) await c.q(`UPDATE joya_payments SET amount=:a WHERE series_id=:s AND status='PLANNED' AND due_date >= :d`, { a: op.amount, s: series.id, d: dueDate });
        else await c.q(`UPDATE joya_payments SET amount=:a WHERE id=:id`, { a: op.amount, id: op.id });
        await audit(by, 'PAYMENT_AMOUNT', 'payment', op.id, null, { via, from: Number(r.amount), to: op.amount, scope: op.scope });
        out.push({ op: 'amount', id: op.id });
      } else {
        await c.q(`UPDATE joya_payments SET status='CANCELLED', cancelled_by=:by, cancelled_at=NOW() WHERE id=:id`, { by, id: op.id });
        if (series) {
          // the series ends here: the later months (machine-made, still PLANNED) go, and the rule stops before this one
          await c.q(`DELETE FROM joya_payments WHERE series_id=:s AND status='PLANNED' AND due_date > :d AND id<>:id AND id<>:s`, { s: series.id, d: dueDate, id: op.id });
          const rule = { ...parseJson(series.repeat_json), until: addDays(dueDate, -1) };
          await c.q(`UPDATE joya_payments SET repeat_json=:rep WHERE id=:id`, { rep: JSON.stringify(rule), id: series.id });
        }
        await audit(by, 'PAYMENT_CANCELLED', 'payment', op.id, null, { via, payee: r.payee, amount: Number(r.amount), dueDate, scope: op.scope });
        out.push({ op: 'cancel', id: op.id });
      }
    }
    return out;
  });
  const ids = [...new Set(applied.flatMap((a) => a.ids || [a.id]))];
  const rows = ids.length ? await q(`SELECT * FROM joya_payments WHERE id IN (${ids.map((_, i) => `:i${i}`).join(',')}) ORDER BY due_date, id`, Object.fromEntries(ids.map((v, i) => [`i${i}`, v]))) : [];
  return { companyKey: co.key, applied, payments: rows.map((r) => shape(r, today)) };
}

/** One payment by id (the chain admin's companies only). */
export async function get(access, id) {
  const r = await getRow({ one }, id);
  if (!r) throw err('NOT_FOUND', `there is no payment #${id}`);
  await resolveCompany(access, r.company_key);
  return shape(r, todayLocal());
}
