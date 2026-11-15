// "Noise" in the bank reconciliation report (owner 2026-11-15: "a noise cancellation toggle button"): rows that are open
// only on paper and hide the real work —
//   stale_cheque  a cheque that was not cleared more than STALE_DAYS (60) days after its date: de facto cancelled
//                 (section 3ב, status past_due);
//   reversal      two opposite moves with the same name and the same amount within PAIR_DAYS (90) days — an entry and
//                 its cancellation (sections 1 and 2; on the bank side the name is the payee, else the reference, e.g.
//                 a cheque and its "החזרת שיק"; on the books side the counter account, else the description).
// tagNoise marks the rows (`noise: { rule, with }`) and counts them per section; the filter `noise=hide`
// (shared/bankReconFilter.js) drops them, the page hides them with a toggle. Pure, no DB; shared by the admin server,
// the admin page, Joya and the eval's fake Allegro.
import { normName } from "./bankReconFilter.js";

export const STALE_DAYS = 60;
export const PAIR_DAYS = 90;
export const NOISE_LABEL = {
  stale_cheque: `צ'ק שמועדו עבר לפני יותר מ-${STALE_DAYS} יום (בוטל דה-פקטו)`,
  reversal: "שתי תנועות הפוכות, אותו שם ואותו סכום (רישום וביטולו)",
};
const NOISE_SECTIONS = ["bankOpen", "bookOpen", "chequesOpen"];

const dayNum = (d) => Math.round(new Date(String(d).slice(0, 10)).getTime() / 864e5);
const text = (v) => String(v ?? "").trim();
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Pairs opposite rows that share a key within `pairDays`: the nearest unused opposite row first. Marks both. */
function pairOpposites(rows, keyOf, pairDays) {
  const groups = new Map();
  for (const x of rows) {
    if (x.noise || !(Number(x.amount) < 0 || Number(x.amount) > 0)) continue;
    const k = keyOf(x);
    if (!k) continue;
    const key = `${k}|${Math.round(Math.abs(Number(x.amount)) * 100)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(x);
  }
  let tagged = 0;
  for (const g of groups.values()) {
    const pos = g.filter((x) => x.amount > 0).sort((a, b) => dayNum(a.date) - dayNum(b.date));
    const neg = g.filter((x) => x.amount < 0).sort((a, b) => dayNum(a.date) - dayNum(b.date));
    if (!pos.length || !neg.length) continue;
    const used = new Set();
    for (const p of pos) {
      let best = null;
      let bestGap = Infinity;
      for (const n of neg) {
        if (used.has(n)) continue;
        const gap = Math.abs(dayNum(n.date) - dayNum(p.date));
        if (gap <= pairDays && gap < bestGap) {
          best = n;
          bestGap = gap;
        }
      }
      if (!best) continue;
      used.add(best);
      p.noise = { rule: "reversal", with: best.date };
      best.noise = { rule: "reversal", with: p.date };
      tagged += 2;
    }
  }
  return tagged;
}

const bankName = (x) => (x.payee ? `n:${normName(x.payee)}` : null);
const bankRef = (x) => (text(x.reference) ? `r:${text(x.reference)}` : null);
const bookParty = (x) => (text(x.counterAccount) ? `a:${text(x.counterAccount)}` : text(x.description) ? `d:${normName(x.description)}` : null);

/**
 * Marks the noise rows of the report's sections (before any filter) and sets `report.noise`
 * = { staleDays, pairDays, count, total, sections: { bankOpen: { count, total }, … }, rules: NOISE_LABEL }.
 * Rows already tagged are left as they are (idempotent). Returns the report.
 */
export function tagNoise(report, { staleDays = STALE_DAYS, pairDays = PAIR_DAYS } = {}) {
  for (const s of NOISE_SECTIONS) for (const x of report[s] || []) if (x.noise) delete x.noise;
  for (const x of report.chequesOpen || []) if (x.status === "past_due" && Number(x.daysAfterDue) > staleDays) x.noise = { rule: "stale_cheque" };
  const bank = report.bankOpen || [];
  pairOpposites(bank, bankName, pairDays);
  pairOpposites(bank, bankRef, pairDays);
  pairOpposites(report.bookOpen || [], bookParty, pairDays);
  const sections = {};
  let count = 0;
  let total = 0;
  for (const s of NOISE_SECTIONS) {
    const rows = (report[s] || []).filter((x) => x.noise);
    const t = round2(rows.reduce((sum, x) => sum + Number(x.amount || 0), 0));
    sections[s] = { count: rows.length, total: t };
    count += rows.length;
    total += t;
  }
  report.noise = { staleDays, pairDays, count, total: round2(total), sections, rules: NOISE_LABEL };
  return report;
}
