// The card (כרטסת = the Hashavshevet account) of every bank line of the bank reconciliation — so the bookkeeper sees, next
// to each open bank line, the account to book it on. Owner 2026-11-18: "I want to have the card index number next to each
// line in order to improve the process; your goal is to complete every row. The employee issue: we have one card index
// for all employees, so make sure it is an employee by checking the employees table in the admin — or another way you
// see fit. If it has no specific supplier or other role, put the employee card index, marked by color."
//
// Where the card comes from (counterSource), in this order:
//   books          the cheque is in Hashavshevet: the account the cheques module / the journal entry booked it on
//                  (chequePayees.js puts it in `booksAccount`);
//   name           an account of the company has exactly the payee's name (quotes, dots, בע"מ ignored);
//   employee       the payee is an employee: Priority wrote the cheque on the employees' one supplier (finance_map
//                  employees.prioritySuppliers, 108 = "עובדים"), or the name is in the admin's employee tables
//                  (employees, shift_employees, the Tabit shifts and rota) → the one employees card (employees.account);
//   history        past journal entries carry this name on one account (the journal keeps the person's name even on the
//                  shared employees card, so an employee paid before lands on 450001 this way too);
//   employee_guess a person's name (two to four words, no company word) with no card anywhere → the employees card, as a
//                  guess to check (the owner's rule: no supplier, no other role → the employees card, in color);
//   text           a line without a name (card company, fee, direct debit): the account the bookkeeper matched lines
//                  with the same bank text to before (at least 2 lines, at least 60 % on one account).
// A row gets counterAccount, counterName, counterSource, counterBasis (one Hebrew sentence that says why) and
// counterEmployee = true when the card is the employees card (the pages color it). Nothing is stored.
import { createRequire } from "module";
import { financeSql } from "../sources/financePool.js";
import { executeSql } from "../sources/dbpool.js";
import { normName, bankKind } from "../../../shared/bankReconFilter.js";
import { isChequeLine } from "./chequePayees.js";
import { prioritySupplierNames } from "./priorityCheques.js";

const require = createRequire(import.meta.url);
const FINANCE_MAP = require("../../../shared/finance_map.json");

export const ACCOUNT_SOURCE = { books: "books", name: "name", employee: "employee", history: "history", employeeGuess: "employee_guess", text: "text" };
export const ACCOUNT_SOURCE_LABEL = {
  books: "מהספרים",
  name: "שם זהה לשם הכרטסת",
  employee: "עובד – כרטיס העובדים",
  history: "לפי פקודות יומן קודמות על שם זה",
  employee_guess: "כנראה עובד – לבדיקה",
  text: "לפי התאמות קודמות של אותו טקסט בנק",
};

const CACHE_MS = 5 * 60 * 1000;
const MIN_SHARE = 0.6;

/** The employees rule of a finance company code: { account, prioritySuppliers } or null (shared/finance_map.json → employees). */
export function employeesRule(companyCode) {
  const e = FINANCE_MAP.companies?.[companyCode]?.employees;
  return e?.account ? { account: String(e.account), prioritySuppliers: (e.prioritySuppliers || []).map(String) } : null;
}
/**
 * Fixed payee name → card rules of a company (finance_map cardAliases: "מע\"מ" → the VAT settlement account; a value may
 * be one key or { in, out } = the card for money in / money out, like Wolt = a customer when it pays us and a supplier
 * when we pay it), as Map normName → { in, out }.
 */
export function cardAliases(companyCode) {
  const out = new Map();
  const a = FINANCE_MAP.companies?.[companyCode]?.cardAliases || {};
  for (const [name, v] of Object.entries(a)) {
    const k = normName(name);
    if (!k || !v) continue;
    const pair = typeof v === "object" ? { in: v.in == null ? null : String(v.in), out: v.out == null ? null : String(v.out) } : { in: String(v), out: String(v) };
    out.set(k, pair);
  }
  return out;
}

// ── pure helpers ─────────────────────────────────────────────────────────

/** A person's name as a key: no Tabit " - role" suffix or leading *, the words sorted (the bank writes "last first"). */
export function wordKey(name) {
  const s = String(name ?? "").replace(/^\*+/, "").replace(/\s+-\s+[^-]+$/, "");
  return normName(s).split(" ").filter(Boolean).sort().join(" ");
}

// not a person: a company suffix, a quote inside a word (an abbreviation: בע"מ, מ"ה, עו"ד), a comma or "=" (two names,
// a note), a digit — checked on the name as written, before normName strips בע"מ
const RAW_NOT_PERSON = /בע["״'׳]?מ|בעמ|\bltd\b|\binc\b|\bllc\b|[,=/"״\d]/i;
const COMPANY_WORDS = new Set((
  "בע בעמ ltd inc llc co corp group holdings holding enterprises enterprise solutions solution projects project marketing design center centre license " +
  "services service systems system international israel isr media studio foods food trade trading import export wolt joya allegro " +
  "חברה חב שירותי שרותי שירות שרות נציגות עיריית עירית מועצה מעמ ביטוח בנק הבנק בנקאות קרן קרנות קופת קופה הוצאות עמותת עמותה ועד קבוצת קבוצה סוכנות " +
  "מסעדת מסעדה בית מרכז סטודיו מזון טכנולוגיות טכנולוגיה תוכנה מחשוב הפצה שיווק יבוא יצוא סחר בניה בנייה הנדסה אחזקה אחזקות ניקיון נקיון דפוס חשמל " +
  "מוסך רכב ייעוץ יעוץ עוד רוח משרד משרדי תעשיות תעשיה מפעל פרויקטים פרוייקטים ושות ובניו אחים מרקט סופר מאפיית מאפיה קייטרינג אירועים הובלות " +
  "תקשורת מחשבים פיננסים פיננסי השקעות נכסים ניהול גז דלק מים בשר דגים ירקות פירות יין יינות משקאות פסטה גבינות חלב " +
  "אבטחה מערכות סולושיינס מרקטינג דיזיין סנטר פרוגקטס פרמצבטיקה נדלן עסקים מנעולים אמנות לאומי הפועלים דיסקונט טפחות מזרחי ישראכרט כאל מקס " +
  "המוסד האוצר מכס תשלום תשלומי נטען הלוואה הלוואות שכירות מילואים מועדון סניף יוזמת גלובל אינטרנשיונל בינלאומי ישראל מדיה הפקות עיצוב ריהוט " +
  "מטבחים קירור מיזוג אינסטלציה שיפוצים קבלן עבודות לבית אספקה ציוד נייר אריזות פלסטיק כימיקלים מוצרי מוצרים מכון מעבדה רפואי קליניקה חנות " +
  "בוטיק גלריה מלון מלונות ישרוטל נופש תיירות הסעות מוניות שליחויות משלוחים דואר אלגרו גויה פדרשי ליסינג השכרה מימון אשראי סליקה גבייה גביה " +
  "עובדים עובד משכורת משכורות שכר"
).split(" "));
/**
 * True when a payee name reads like a private person: two to four words, no digits or quotes inside words, no company
 * word (בע"מ, שירותי, עיריית, בנק, …; English ones too), no one-letter word (initials belong to companies).
 */
export function looksLikePerson(name) {
  const raw = String(name ?? "").trim();
  if (!raw || RAW_NOT_PERSON.test(raw)) return false;
  const words = normName(raw).split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;
  if (words.some((w) => w.length === 1 || COMPANY_WORDS.has(w))) return false;
  return true;
}

const compact = (s) => normName(s).replace(/ /g, "");
/**
 * The name indexes of an accounts list (pure): accounts (key → { key, name }), byName (normName → key), byCompact (the
 * name without spaces → key). A name two accounts share (a customer and a supplier with the same name) is in neither
 * index: it would be a guess.
 */
export function indexAccounts(rows) {
  const accounts = new Map();
  const byName = new Map();
  const byCompact = new Map();
  const seen = { name: new Set(), compact: new Set() };
  for (const r of rows) {
    const key = String(r.key ?? r.account_key);
    accounts.set(key, { key, name: r.name || null });
    const k = normName(r.name);
    if (k) {
      if (seen.name.has(k)) byName.delete(k); else byName.set(k, key);
      seen.name.add(k);
    }
    const c = compact(r.name);
    if (c) {
      if (seen.compact.has(c)) byCompact.delete(c); else byCompact.set(c, key);
      seen.compact.add(c);
    }
  }
  return { accounts, byName, byCompact };
}
/**
 * The account with the payee's name (pure): exactly (normName), then the same letters without spaces ("סופר נוב" =
 * "סופרנוב"), then — the bank file cuts names short — the one account whose compact name starts with the payee's (or
 * the other way round), at least 6 letters. Returns { key, partial } or null.
 */
export function accountByName(name, ctx, { moneyOut = true } = {}) {
  const k = normName(name);
  if (!k) return null;
  const alias = ctx.aliases?.get(k);
  if (alias && (moneyOut ? alias.out : alias.in)) return { key: moneyOut ? alias.out : alias.in, alias: true };
  if (ctx.byName.has(k)) return { key: ctx.byName.get(k), partial: false };
  const c = compact(name);
  if (ctx.byCompact?.has(c)) return { key: ctx.byCompact.get(c), partial: false };
  if (c.length < 5 || !ctx.byCompact) return null;
  // the bank file cuts a name short, the picture reader writes it a little differently: the one account that starts
  // with it (or that it starts with), that contains it (8+ letters), or that shares its first 12 letters
  const hits = new Set();
  for (const [name2, key] of ctx.byCompact) {
    if (name2.length < 5) continue;
    if (name2.startsWith(c) || c.startsWith(name2)) hits.add(key);
    else if (c.length >= 8 && name2.includes(c)) hits.add(key);
    else if (c.length >= 12 && name2.length >= 12 && name2.slice(0, 12) === c.slice(0, 12)) hits.add(key);
  }
  return hits.size === 1 ? { key: [...hits][0], partial: true } : null;
}

/** The dominant account of a history list [{ key, n }]: at least `min` hits in all and `minShare` of them on one account. */
export function topOf(list, { min = 1, minShare = MIN_SHARE } = {}) {
  if (!list?.length) return null;
  const of = list.reduce((s, x) => s + x.n, 0);
  if (of < min) return null;
  const top = [...list].sort((a, b) => b.n - a.n)[0];
  return top.n / of >= minShare ? { key: top.key, n: top.n, of } : null;
}

const nameOf = (ctx, key) => ctx.accounts.get(String(key))?.name || null;
const card = (ctx, key, source, basis) => {
  const k = String(key);
  return { key: k, name: nameOf(ctx, k), source, basis, employee: Boolean(ctx.employees && ctx.employees.account === k) };
};

/**
 * The card of one bank line (pure). `ctx`: { accounts: Map key → { key, name }, byName: Map normName → key, byCompact:
 * Map (name without spaces) → key, aliases: Map normName → { in, out }, nameHistory: Map normName → { debit: [{ key, n }], credit: [...] }
 * (or a plain list for both sides), textHistory:
 * Map normName(details) → [{ key, n }], employeeNames: Set<wordKey>, employees: { account, prioritySuppliers } | null }.
 * `row`: payee, payeeSource, booksAccount, payeeSupplier, details, amount (minus = money out).
 * @returns {{ key: string, name: string|null, source: string, basis: string, employee: boolean } | null}
 */
export function resolveAccount(row, ctx, { payee = (r) => r.payee, text = (r) => r.details, amount = (r) => r.amount } = {}) {
  if (row.booksAccount && ctx.accounts.has(String(row.booksAccount))) return card(ctx, row.booksAccount, ACCOUNT_SOURCE.books, "הצ'ק רשום בחשבשבת על כרטסת זו");
  const name = payee(row);
  const a = amount(row);
  const moneyOut = a == null || Number(a) < 0; // an employee is paid, never pays us: money in is never an employee's
  if (name) {
    const k = normName(name);
    const byName = accountByName(name, ctx, { moneyOut });
    if (byName) return card(ctx, byName.key, ACCOUNT_SOURCE.name, byName.alias ? "כלל קבוע: שם זה נרשם תמיד על כרטסת זו" : byName.partial ? "שם המוטב מתאים לשם הכרטסת (שם מקוצר)" : "שם המוטב זהה לשם הכרטסת");
    const emp = moneyOut ? ctx.employees : null;
    if (emp && row.payeeSupplier && emp.prioritySuppliers.includes(String(row.payeeSupplier)))
      return card(ctx, emp.account, ACCOUNT_SOURCE.employee, `עובד: בפריוריטי הצ'ק נכתב על ספק ${row.payeeSupplier} (ספק העובדים)`);
    const past = historyOf(ctx.nameHistory.get(k), moneyOut);
    const h = topOf(past);
    if (h) return card(ctx, h.key, ACCOUNT_SOURCE.history, `${h.n} מתוך ${h.of} פקודות יומן על שם זה נרשמו על כרטסת זו`);
    if (emp && ctx.employeeNames.has(wordKey(name))) return card(ctx, emp.account, ACCOUNT_SOURCE.employee, "עובד: השם רשום ברשימת העובדים (אדמין / פריוריטי)");
    // a name the journal already booked (on several accounts) is somebody's, not a nameless employee
    if (emp && !past?.length && looksLikePerson(name)) return card(ctx, emp.account, ACCOUNT_SOURCE.employeeGuess, "שם של אדם פרטי ללא כרטסת ספק – כנראה עובד, לבדיקה");
  }
  // the bank text's past matches — only a text that names the other side (a card company, a fee, a deposit, a direct
  // debit, the authorities); "העברה" or "שיק" says nothing about who
  const raw = text(row);
  const t = normName(raw);
  if (t && TEXT_KINDS.has(bankKind(raw, a))) {
    const h = topOf(ctx.textHistory.get(t), { min: 2 });
    if (h) return card(ctx, h.key, ACCOUNT_SOURCE.text, `${h.n} מתוך ${h.of} תנועות בנק קודמות עם הטקסט הזה הותאמו לכרטסת זו`);
  }
  return null;
}
const TEXT_KINDS = new Set(["card", "fee", "deposit", "direct_debit", "authorities", "salary"]);

/** Writes the card on a row: counterAccount, counterName, counterSource, counterBasis, counterEmployee (only when true). */
export function setCard(row, c) {
  row.counterAccount = c.key;
  row.counterName = c.name;
  row.counterSource = c.source;
  row.counterBasis = c.basis;
  if (c.employee) row.counterEmployee = true;
  return row;
}

// ── the company's context (cached 5 minutes) ─────────────────────────────

const cache = new Map(); // `${companyId}|${bank keys}` → { at, ctx }
const accountsCache = new Map(); // companyId → { at, value }

async function loadAccounts(companyId) {
  const hit = accountsCache.get(companyId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const rows = await financeSql(
    `SELECT a.account_key, a.name FROM accounts a
      WHERE a.company_id = :companyId AND a.deleted_at IS NULL AND a.account_key IS NOT NULL
        AND a.fiscal_year = (SELECT MAX(fiscal_year) FROM accounts WHERE company_id = :companyId AND deleted_at IS NULL)`,
    { companyId },
  );
  const value = indexAccounts(rows);
  accountsCache.set(companyId, { at: Date.now(), value });
  return value;
}

// the names on past journal entries and the account each name was booked on, by side (the bank accounts left out): money
// OUT of the bank debits the other side, money IN credits it — a group company that is a customer (200040) and a supplier
// (500117) under one name is told apart this way
async function loadNameHistory(companyId, bankKeys) {
  const p = { companyId };
  const blist = bankKeys.map((b, i) => ((p[`b${i}`] = b), `:b${i}`)).join(",");
  const notBank = (col) => (blist ? `AND ${col} NOT IN (${blist})` : "");
  const rows = await financeSql(
    `SELECT 'debit' AS side, debit_name AS nm, debit_account AS acc, COUNT(*) AS n FROM journal_entries
      WHERE company_id = :companyId AND deleted_at IS NULL AND debit_name IS NOT NULL AND debit_name <> '' AND debit_account IS NOT NULL ${notBank("debit_account")} GROUP BY 2, 3
     UNION ALL
     SELECT 'credit', credit_name, credit_account, COUNT(*) FROM journal_entries
      WHERE company_id = :companyId AND deleted_at IS NULL AND credit_name IS NOT NULL AND credit_name <> '' AND credit_account IS NOT NULL ${notBank("credit_account")} GROUP BY 2, 3`,
    p,
  );
  const out = new Map();
  for (const r of rows) {
    const k = normName(r.nm);
    if (!k) continue;
    if (!out.has(k)) out.set(k, { debit: [], credit: [] });
    out.get(k)[r.side].push({ key: String(r.acc), n: Number(r.n) });
  }
  return out;
}
/** The history list of a name for one direction: the side the bank move hits (out → debit, in → credit), else both sides together. */
export function historyOf(entry, moneyOut) {
  if (!entry) return null;
  if (Array.isArray(entry)) return entry;
  const side = moneyOut ? entry.debit : entry.credit;
  if (side?.length) return side;
  const both = new Map();
  for (const x of [...(entry.debit || []), ...(entry.credit || [])]) both.set(x.key, (both.get(x.key) || 0) + x.n);
  return [...both].map(([key, n]) => ({ key, n }));
}

// the bank texts the bookkeeper matched before, on this bank account, and the account of the matched book line
async function loadTextHistory(companyId, bankKeys) {
  if (!bankKeys.length) return new Map();
  const p = { companyId };
  const blist = bankKeys.map((b, i) => ((p[`b${i}`] = b), `:b${i}`)).join(",");
  const rows = await financeSql(
    `SELECT b.details, IF(l.side = 'credit', e.debit_account, e.credit_account) AS acc, COUNT(*) AS n
       FROM bank_matches mb
       JOIN bank_lines b ON b.company_id = mb.company_id AND b.bank_line_id = mb.linked_id AND b.deleted_at IS NULL
       JOIN bank_matches ml ON ml.company_id = mb.company_id AND ml.fiscal_year = mb.fiscal_year AND ml.match_num = mb.match_num AND ml.side = 'book' AND ml.deleted_at IS NULL
       JOIN journal_lines l ON l.company_id = ml.company_id AND l.line_id = ml.linked_id AND l.deleted_at IS NULL
       JOIN journal_entries e ON e.company_id = l.company_id AND e.fiscal_year = l.fiscal_year AND e.trans_id = l.trans_id AND e.deleted_at IS NULL
      WHERE mb.company_id = :companyId AND mb.side = 'bank' AND mb.deleted_at IS NULL AND b.account_key IN (${blist}) AND b.details IS NOT NULL
      GROUP BY 1, 2`,
    p,
  );
  const out = new Map();
  for (const r of rows) {
    if (!r.acc || isChequeLine(r.details)) continue;
    const k = normName(r.details);
    if (!k) continue;
    if (!out.has(k)) out.set(k, []);
    out.get(k).push({ key: String(r.acc), n: Number(r.n) });
  }
  return out;
}

// every employee name the admin knows (the Employees page, the Shift loader, the Tabit shifts and rota) — the allegro DB;
// an error leaves the set with the Priority names only and is reported
async function loadEmployeeNames(rule) {
  const names = new Set();
  let error = null;
  if (!rule) return { names, error };
  for (const n of prioritySupplierNames(rule.prioritySuppliers)) names.add(wordKey(n));
  const add = (v) => { const k = wordKey(v); if (k && k.includes(" ")) names.add(k); }; // one word alone is no match
  try {
    const [emps] = await executeSql("SELECT name FROM employees WHERE name IS NOT NULL");
    for (const r of emps) add(r.name);
    const [shift] = await executeSql("SELECT first_name, family_name FROM shift_employees");
    for (const r of shift) add(`${r.first_name || ""} ${r.family_name || ""}`);
    const [shifts] = await executeSql("SELECT DISTINCT employee_name FROM tabit_shifts WHERE employee_name IS NOT NULL");
    for (const r of shifts) add(r.employee_name);
    const [rota] = await executeSql("SELECT DISTINCT employee_name FROM tabit_rota WHERE employee_name IS NOT NULL");
    for (const r of rota) add(r.employee_name);
  } catch (err) {
    error = `the admin's employee tables were not read: ${err.code || err.message}`;
  }
  return { names, error };
}

/**
 * The resolving context of one company and its bank account(s), cached 5 minutes: accounts, names, histories, the
 * employee names. `code` = the finance company code (for the employees rule); `bankAccounts` = the bank account keys.
 */
export async function accountContext(companyId, { code = null, bankAccounts = [] } = {}) {
  const banks = [...new Set((bankAccounts || []).map(String).filter(Boolean))].sort();
  const key = `${companyId}|${banks.join(",")}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.ctx;
  const employees = code ? employeesRule(code) : null;
  const [{ accounts, byName, byCompact }, nameHistory, textHistory, emp] = await Promise.all([loadAccounts(companyId), loadNameHistory(companyId, banks), loadTextHistory(companyId, banks), loadEmployeeNames(employees)]);
  const ctx = { accounts, byName, byCompact, aliases: code ? cardAliases(code) : new Map(), nameHistory, textHistory, employeeNames: emp.names, employees, adminError: emp.error };
  cache.set(key, { at: Date.now(), ctx });
  return ctx;
}
export const forgetAccountContext = () => { cache.clear(); accountsCache.clear(); };

/** The accounts of a company (the master year) as Map key → { key, name }, cached 5 minutes. */
export async function companyAccounts(companyId) {
  return (await loadAccounts(companyId)).accounts;
}

/**
 * Adds the card to every row (rows that already have `counterAccount` are left alone): counterAccount, counterName,
 * counterSource, counterBasis, counterEmployee. A finance DB error leaves the rows unchanged and is reported in `error`.
 * @param {object[]} rows  bank lines with payee / payeeSource / booksAccount / payeeSupplier (chequePayees.js & co) and details
 * @param {{ companyId: number, code?: string, bankAccounts?: string[], payee?: Function, text?: Function }} opt
 * @returns {Promise<{ rows: number, found: number, books: number, name: number, employee: number, history: number, employeeGuess: number, text: number, missing: number, employeesAccount: string|null, error?: string, adminError?: string }>}
 */
export async function addBankLineAccounts(rows, { companyId, code = null, bankAccounts = [], payee, text, amount } = {}) {
  const stats = { rows: 0, found: 0, books: 0, name: 0, employee: 0, history: 0, employeeGuess: 0, text: 0, missing: 0, employeesAccount: null };
  const list = (rows || []).filter((r) => !r.counterAccount);
  stats.rows = list.length;
  if (!list.length || companyId == null) return stats;
  let ctx;
  try {
    ctx = await accountContext(companyId, { code, bankAccounts });
  } catch (err) {
    stats.error = `cards not looked up: ${err.code || err.message}`;
    return stats;
  }
  stats.employeesAccount = ctx.employees?.account || null;
  if (ctx.adminError) stats.adminError = ctx.adminError;
  const count = { books: "books", name: "name", employee: "employee", history: "history", employee_guess: "employeeGuess", text: "text" };
  for (const r of list) {
    const c = resolveAccount(r, ctx, { payee, text, amount });
    if (!c) { stats.missing++; continue; }
    setCard(r, c);
    stats.found++;
    stats[count[c.source]]++;
  }
  return stats;
}
