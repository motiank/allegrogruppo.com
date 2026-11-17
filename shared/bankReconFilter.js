// Filters of the detailed bank reconciliation report (admin/server/modules/bankRecon.js) — pure, no DB, no Express.
// Owner (2026-11-13): "I want to filter the report by supplier, by the type of transaction (cheque…) and by a name
// (in the chat only), and the API should do it, to save AI tokens when the report is big."
//
// Every row of the report gets a `kind` (the payment instrument, from the bank line's text or the book line's text
// and counter account) and a `party` (the supplier / payee / counter account). The filter keeps only the rows that
// match; the report's summary (the tie-out of the bank balance to the book balance) is always for the whole account.
//
// Query parameters (all optional, the same on the admin route, the Finance API and Joya's calc):
//   kind=cheque,transfer,…     one or more of KINDS (comma separated)
//   party=<account key | name> the supplier / payee: the counter account key, or a part of the name
//   q=<text>                   a text in any column (details, payee, description, counter account, references)
//   amount=<number>            the exact amount (either sign, ±0.01)
//   sections=bankOpen,…        only these sections (bankOpen, bookOpen, bookFutureMatched, chequesCleared, chequesOpen)
//   noise=hide                 without the noise rows (shared/bankReconNoise.js: de facto cancelled cheques, reversal pairs)
//   older=hide                 without the rows dated before `from` (open items of earlier years that are still open as of
//                              `to`; every such row carries older: true and report.older counts them — owner 2026-11-18:
//                              "a report for 2026 must not show tons of 2025 data"; the pages hide them by default)
//   facets=1                   also the list of parties of the whole report (the kinds are always given)

export const KINDS = [
  { kind: "cheque", label: "שיקים" },
  { kind: "transfer", label: "העברות" },
  { kind: "card", label: "כרטיסי אשראי וסליקה" },
  { kind: "direct_debit", label: "הוראות קבע וחיובים ישירים" },
  { kind: "deposit", label: "הפקדות ופקדונות" },
  { kind: "fee", label: "עמלות וריבית" },
  { kind: "authorities", label: 'רשויות (מע"מ, מס הכנסה, ביטוח לאומי)' },
  { kind: "salary", label: "משכורות ופנסיה" },
  { kind: "other", label: "אחר" },
];
export const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.kind, k.label]));
import { tagNoise } from "./bankReconNoise.js";

export const SECTIONS = ["bankOpen", "bookOpen", "bookFutureMatched", "chequesCleared", "chequesOpen"];
const SECTION_LABEL = { bankOpen: "1 בנק ללא ספרים", bookOpen: "2 ספרים ללא בנק", bookFutureMatched: "2ב", chequesCleared: "3א צ'קים שנפרעו", chequesOpen: "3ב צ'קים פתוחים" };

// ── text rules ───────────────────────────────────────────────────────────
// Hebrew has no \b: the rules anchor on the start of the text or use plain substrings.
const RULES = {
  fee: /^עמ(?:'|\.|לת|לה| )|^דמי |^ד\.ניהול|ריבית|^הפרשי|^עמלות/,
  cheque: /^שיק(?![א-ת])|החזרת שיק|^צ'ק|ב[יי]?טול שיק/,
  deposit: /הפקד|פקדון|פיקדון|^הפ'?\.?\s?תיק|ממסרים/,
  transfer: /העבר|^העב'|זה"ב|^שובר|תשלום שובר|מב"ל|^מט"ח/,
  authorities: /מע"מ|מע״מ|^מעמ(?![א-ת])|מס הכנסה|מ\.הכנסה|ביטוח לאומי|ב\.לאומי|^ב"ל |ניכויים|עיריי?ת|רשות המסים|מקדמות מס/,
  card: /מקס איט|מקס פיננס|^מקס(?![א-ת])|ישראכרט|אמריקן אקספרס|אמקס|^כאל(?![א-ת])|לאומי קארד|ויזה|דיינרס|פלאקסי|איי\.סי\.מגא|ביי מי|מועדון חבר|חבר משרתי|רעיונית|סיבוס|תן ביס|גודי|פייבוקס|^ביט(?![א-ת])|פאיימי|סליקה|קארד/,
  salary: /משכורת|משכורות|שכר עבודה|נטו לתשלום|פנסיה|השתלמות|קופת גמל|גמלא|מגדל מקפת|הראל פנסיה|מנורה מבטחים|כלל פנסיה|אלטשולר|הפניקס|מיטב דש|מור גמל/,
};
const CARD_NAME = RULES.card;
// counter account groups of the books (shared/finance_map.json balanceGroups): the first three digits of the key
const GROUP_KIND = { 100: "transfer", 110: "transfer", 130: "deposit", 200: "deposit", 210: "deposit", 400: "authorities", 410: "authorities", 420: "authorities", 450: "salary", 510: "salary" };

const text = (v) => String(v ?? "").trim();
const groupOf = (accountKey) => {
  const m = /^(\d{3})/.exec(text(accountKey));
  return m ? Number(m[1]) : null;
};

/** The kind of a bank statement line, from its text (`details`) and direction (`amount` minus = money out). */
export function bankKind(details, amount) {
  const t = text(details);
  if (!t) return Number(amount) < 0 ? "direct_debit" : "other";
  for (const k of ["fee", "cheque", "transfer", "deposit", "authorities", "card", "salary"]) if (RULES[k].test(t)) return k;
  return Number(amount) < 0 ? "direct_debit" : "other";
}

/** The kind of a book line of the bank account: the cheque flag, then the text, then the counter account's group. */
export function bookKind(row) {
  if (row.chequeId) return "cheque";
  const t = `${text(row.description)} ${text(row.counterName)}`;
  if (RULES.cheque.test(t) || /שיק|צ'ק/.test(text(row.description))) return "cheque";
  if (RULES.salary.test(t)) return "salary";
  if (RULES.fee.test(t)) return "fee";
  if (RULES.authorities.test(t)) return "authorities";
  if (CARD_NAME.test(t)) return "card";
  if (RULES.transfer.test(t)) return "transfer";
  if (RULES.deposit.test(t)) return "deposit";
  const g = groupOf(row.counterAccount);
  if (g != null && GROUP_KIND[g]) return GROUP_KIND[g];
  // a supplier (group 500) or anyone else, paid without a cheque: a transfer (the books do not say the instrument)
  return g != null ? "transfer" : "other";
}

// ── names ────────────────────────────────────────────────────────────────
const QUOTES = /["'״׳`’‘]/g;
/** A name for comparing: lower case, no quotes / dots / dashes, no בע"מ, one space between words. */
export function normName(s) {
  return text(s)
    .toLowerCase()
    .replace(QUOTES, "")
    .replace(/(^| )(בעמ|ltd\.?|inc\.?)(?= |$)/g, " ")
    .replace(/[().,\-–—_/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const has = (hay, needle) => needle !== "" && normName(hay).includes(needle);

// ── decoration: kind + party on every row ────────────────────────────────
// name = the payee / counter name on the row; key = the card (כרטסת: the counter account of a book line, the card
// bankLineAccounts.js found for a bank line or a cheque); keyName = the card's own name when the row carries it (an
// employee's cheque: name = the person, key = the one employees card, keyName = "עובד")
const PARTY_OF = {
  bankOpen: (x) => ({ name: x.payee || null, key: x.counterAccount ? String(x.counterAccount) : null, keyName: x.counterName || null, text: x.details }),
  bookOpen: (x) => ({ name: x.counterName || null, key: x.counterAccount ? String(x.counterAccount) : null, keyName: null, text: x.description }),
  bookFutureMatched: (x) => ({ name: x.counterName || null, key: x.counterAccount ? String(x.counterAccount) : null, keyName: null, text: x.description }),
  chequesCleared: (x) => ({ name: x.payee || null, key: x.counterAccount ? String(x.counterAccount) : null, keyName: x.counterName || null, text: null }),
  chequesOpen: (x) => ({ name: x.payee || null, key: x.counterAccount ? String(x.counterAccount) : null, keyName: x.counterName || null, text: null }),
};
const KIND_OF = {
  bankOpen: (x) => bankKind(x.details, x.amount),
  bookOpen: bookKind,
  bookFutureMatched: bookKind,
  chequesCleared: () => "cheque",
  chequesOpen: () => "cheque",
};

/** Adds `kind` (and keeps the party fields as they are) to every row of every section. Returns the report. */
export function decorateReport(report) {
  for (const s of SECTIONS) for (const x of report[s] || []) if (!x.kind) x.kind = KIND_OF[s](x);
  return report;
}

// ── the filter ───────────────────────────────────────────────────────────
const list = (v) => (v == null ? [] : (Array.isArray(v) ? v : String(v).split(",")).map((x) => String(x).trim()).filter(Boolean));

/**
 * The filter of a query: { kinds: string[]|null, party, q, amount, sections: string[]|null, facets: boolean, active }
 * (applyFilter adds partyNames when party is an account key: the names that key carries).
 * Throws an Error with code "bad_request" for an unknown kind or section.
 */
export function parseFilter(query = {}) {
  const kinds = [...new Set(list(query.kind))];
  const bad = kinds.filter((k) => !KIND_LABEL[k]);
  if (bad.length) throw Object.assign(new Error(`unknown kind ${bad.join(", ")} (kinds: ${KINDS.map((k) => k.kind).join(", ")})`), { code: "bad_request" });
  const sections = [...new Set(list(query.sections))];
  const badS = sections.filter((s) => !SECTIONS.includes(s));
  if (badS.length) throw Object.assign(new Error(`unknown section ${badS.join(", ")} (sections: ${SECTIONS.join(", ")})`), { code: "bad_request" });
  let amount = null;
  if (query.amount != null && String(query.amount).trim() !== "") {
    amount = Number(String(query.amount).replace(/[,\s₪]/g, ""));
    if (!Number.isFinite(amount)) throw Object.assign(new Error("amount must be a number"), { code: "bad_request" });
    amount = Math.abs(amount);
  }
  const party = text(query.party) || null;
  const q = text(query.q) || null;
  const noise = /^(hide|1|true|yes|off)$/i.test(text(query.noise)) ? "hide" : null;
  const older = /^(hide|1|true|yes|off)$/i.test(text(query.older)) ? "hide" : null;
  const f = { kinds: kinds.length ? kinds : null, party, q, amount, sections: sections.length ? sections : null, noise, older, facets: /^(1|true|yes)$/i.test(text(query.facets)) };
  f.active = Boolean(f.kinds || f.party || f.q || f.amount != null || f.sections || f.noise || f.older);
  return f;
}

/** One Hebrew line that names the active filters (for the page header, the Excel and the chat). */
export function filterLabel(f) {
  if (!f || !f.active) return "";
  const parts = [];
  if (f.kinds) parts.push(`סוג: ${f.kinds.map((k) => KIND_LABEL[k] || k).join(" / ")}`);
  if (f.party) parts.push(`ספק / מוטב: ${f.partyLabel || f.party}`);
  if (f.q) parts.push(`טקסט: ${f.q}`);
  if (f.amount != null) parts.push(`סכום: ${f.amount.toLocaleString("he-IL", { minimumFractionDigits: 2 })}`);
  if (f.sections) parts.push(`סעיפים: ${f.sections.map((s) => SECTION_LABEL[s] || s).join(", ")}`);
  if (f.noise === "hide") parts.push("ללא רעשים");
  if (f.older === "hide") parts.push("רק תנועות מהתקופה");
  return parts.join(" · ");
}

const rowTexts = (x, section) => {
  const p = PARTY_OF[section](x);
  return [x.details, x.description, p.name, p.key, p.keyName, x.reference, x.bankReference, x.chequeNo, x.transId, x.batch].filter((v) => v != null && v !== "");
};

/** True when the row of `section` passes the filter `f` (kind, party, q, amount). */
export function matchRow(x, section, f) {
  if (f.noise === "hide" && x.noise) return false;
  if (f.older === "hide" && x.older) return false;
  if (f.kinds && !f.kinds.includes(x.kind || KIND_OF[section](x))) return false;
  if (f.amount != null) {
    const ok = [x.amount, x.bankAmount].some((v) => v != null && Math.abs(Math.abs(Number(v)) - f.amount) < 0.011);
    if (!ok) return false;
  }
  if (f.party) {
    const p = PARTY_OF[section](x);
    const needles = [normName(f.party), ...(f.partyNames || [])];
    const byKey = p.key != null && p.key === f.party;
    const byName = needles.some((needle) => (p.name && has(p.name, needle)) || (p.keyName && has(p.keyName, needle)) || (!p.name && p.text && has(p.text, needle)));
    if (!byKey && !byName) return false;
  }
  if (f.q) {
    const needle = normName(f.q);
    if (!rowTexts(x, section).some((v) => has(v, needle))) return false;
  }
  return true;
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const sumOf = (rows) => round2(rows.reduce((a, r) => a + (Number(r.amount) || 0), 0));

// the rows dated before the period: open bank / book lines by their date, open cheques by the cheque's date — still open
// as of `to`, counted in the summary, but not what a report "for 2026" is asked for
const OLDER_DATE = { bankOpen: (x) => x.date, bookOpen: (x) => x.date, chequesOpen: (x) => x.dueDate };
/** Marks `older: true` on every row dated before report.from and sets report.older = { count, total, sections }. Idempotent. */
export function tagOlder(report) {
  const from = report.from ? String(report.from) : null;
  const sections = {};
  let count = 0;
  let total = 0;
  for (const s of Object.keys(OLDER_DATE)) {
    const rows = report[s] || [];
    for (const x of rows) {
      const d = OLDER_DATE[s](x);
      if (from && d && String(d) < from) x.older = true; else delete x.older;
    }
    const old = rows.filter((x) => x.older);
    sections[s] = { count: old.length, total: sumOf(old) };
    count += old.length;
    total += sumOf(old);
  }
  report.older = { count, total: round2(total), sections };
  return report;
}

/**
 * The facets of the (unfiltered) report: the kinds with count and total, and — with `withParties` — the parties
 * (supplier / payee / counter account) with count (rows in the whole report), total, the sections they appear in,
 * and bankOpen / bankOpenTotal (their bank moves missing from the books, section 1), most rows first.
 */
export function facetsOf(report, { withParties = false, maxParties = 400 } = {}) {
  const kinds = new Map();
  const parties = new Map();
  for (const s of SECTIONS) {
    for (const x of report[s] || []) {
      const k = x.kind || KIND_OF[s](x);
      const kc = kinds.get(k) || { kind: k, label: KIND_LABEL[k] || k, count: 0, total: 0 };
      kc.count++;
      kc.total += Number(x.amount) || 0;
      kinds.set(k, kc);
      if (!withParties) continue;
      const p = PARTY_OF[s](x);
      const name = p.name || (s === "bankOpen" && k !== "cheque" ? p.text : null);
      // the parties this row counts for: its card (named by the card when the row knows it) and, when the row's own name
      // is another one (an employee on the shared employees card), that name too — so the picker has both
      const entries = [];
      if (p.key) entries.push({ id: p.key, name: p.keyName || name || p.key, key: p.key, keyName: p.keyName });
      if (name && (!p.key || (p.keyName && normName(p.keyName) !== normName(name)))) entries.push({ id: normName(name), name, key: null, keyName: null });
      for (const e of entries) {
        const pc = parties.get(e.id) || { name: e.name, key: e.key, count: 0, total: 0, sections: [], bankOpen: 0, bankOpenTotal: 0 };
        if (e.keyName && pc.name !== e.keyName) pc.name = e.keyName; // the card's own name wins over the first row's name
        pc.count++;
        pc.total += Number(x.amount) || 0;
        if (s === "bankOpen") {
          // bank moves missing from the books (section 1) — the owner wants this number in red next to the party
          pc.bankOpen++;
          pc.bankOpenTotal += Number(x.amount) || 0;
        }
        if (!pc.sections.includes(s)) pc.sections.push(s);
        if (!pc.key && e.key) pc.key = e.key;
        parties.set(e.id, pc);
      }
    }
  }
  const out = { kinds: KINDS.filter((k) => kinds.has(k.kind)).map((k) => ({ ...kinds.get(k.kind), total: round2(kinds.get(k.kind).total) })) };
  if (withParties) {
    // the same supplier by its account key (the books) and by its payee name (bank lines, cheques) is one party
    const byNorm = new Map();
    for (const [id, p] of parties) if (p.key) byNorm.set(normName(p.name), id);
    for (const [id, p] of [...parties]) {
      if (p.key) continue;
      const keyedId = byNorm.get(id);
      if (!keyedId) continue;
      const k = parties.get(keyedId);
      k.count += p.count;
      k.total += p.total;
      k.bankOpen += p.bankOpen;
      k.bankOpenTotal += p.bankOpenTotal;
      for (const s of p.sections) if (!k.sections.includes(s)) k.sections.push(s);
      parties.delete(id);
    }
    out.parties = [...parties.values()]
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "he"))
      .slice(0, maxParties)
      .map((p) => ({ ...p, total: round2(p.total), bankOpenTotal: round2(p.bankOpenTotal) }));
  }
  return out;
}

/**
 * Applies the filter to a decorated report, in place: the section arrays keep only the matching rows (a section not
 * in `sections` becomes [] and is marked omitted); `report.facets` (from the whole report), `report.filter` (the
 * filter + its label) and `report.filtered` (per section: count, total, of, ofTotal, omitted) are added. The summary
 * is not touched. Returns the report.
 */
export function applyFilter(report, f) {
  decorateReport(report);
  tagNoise(report); // the noise rows are marked on the whole report; noise=hide drops them, the page hides them with a toggle
  tagOlder(report); // the rows dated before `from` likewise: older=hide drops them, the page starts without them
  report.facets = facetsOf(report, { withParties: f.facets });
  // a party given as an account key also matches that account's name on the bank side and in the cheques
  if (f.party && /^\d+$/.test(f.party)) {
    const keyed = (f.facets ? report.facets.parties : facetsOf(report, { withParties: true }).parties).find((p) => p.key === f.party);
    f.partyNames = keyed ? [normName(keyed.name)] : [];
    f.partyLabel = keyed ? `${keyed.name} (${keyed.key})` : null;
  }
  report.filter = { kinds: f.kinds, party: f.party, q: f.q, amount: f.amount, sections: f.sections, noise: f.noise, older: f.older, active: f.active, label: filterLabel(f) };
  if (!f.active) {
    report.filtered = null;
    return report;
  }
  const filtered = { sections: {} };
  for (const s of SECTIONS) {
    const all = report[s] || [];
    const omitted = Boolean(f.sections && !f.sections.includes(s));
    const kept = omitted ? [] : all.filter((x) => matchRow(x, s, f));
    filtered.sections[s] = { count: kept.length, total: sumOf(kept), of: all.length, ofTotal: sumOf(all), ...(omitted ? { omitted: true } : {}) };
    report[s] = kept;
  }
  report.filtered = filtered;
  return report;
}
