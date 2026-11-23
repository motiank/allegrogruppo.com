// The scanned cheques behind a chat answer (owner 2026-11-23: "if I asked for cheque images, display them on a card list
// with the options to copy and share"). Pure: reads the calcs of an answered request and lists the pictures to show as
// cards under the answer. Shared by the client (client/ChequeCards.js) and the tests; no DOM, no DB.
//
// A picture is any row of a calc result that carries `imageId` (the Drive id of the scanned front, served by Joya at
// /api/joya/finance/cheque-image/:id) — the cheque archive rows, the bank rows (bank_transactions, bank_open_items, the
// report's sections), the cheques file rows and statement_compare's archiveCheque all carry it. The cards are shown when
// the answer used the cheque archive (calc cheque_archive — the archive IS the pictures: a cheque by its number, the
// work list, the pictures of a payee) or when the question asked for pictures in words; a plain bank question keeps its
// pictures behind the report page's 📷 as before.

/** Words that ask for the pictures themselves, in Hebrew or English. */
export const PICTURE_WORDS = /תמונ|צילומ|צילום|סרוק|סריק|picture|image|photo|scan/i;

const MAX_CARDS = 500; // a guard, never a limit the user meets (the archive calc returns at most 500 rows)
const MAX_DEPTH = 8;

const num = (v) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** One card from a row that carries an imageId: the cheque number, the payee (a guess is marked), the amount and the bank day. */
export function cardOf(row, calc) {
  if (!row || typeof row !== 'object' || typeof row.imageId !== 'string' || !row.imageId) return null;
  const number = row.cheque ?? row.chequeNo ?? row.reference ?? row.number ?? null;
  const guess = !row.payee && row.payeeGuess ? String(row.payeeGuess) : null;
  const payee = row.payee ? String(row.payee) : guess;
  const unsure = Boolean(guess || row.unsure || row.payeeSource === 'image_guess');
  const amount = num(row.amount ?? row.net);
  return {
    imageId: row.imageId,
    number: number == null || number === '' ? null : String(number),
    payee,
    unsure,
    amount: amount == null ? null : Math.abs(amount),
    date: row.bankDate || row.date || row.dueDate || null,
    inBooks: typeof row.inBooks === 'boolean' ? row.inBooks : undefined,
    calc,
  };
}

/** Every picture in a calc result, in the order found; nested lists (per company, per section) are walked. */
export function cardsOfResult(result, calc, out = [], seen = new Set(), depth = 0) {
  if (!result || typeof result !== 'object' || depth > MAX_DEPTH || out.length >= MAX_CARDS) return out;
  if (Array.isArray(result)) {
    for (const x of result) cardsOfResult(x, calc, out, seen, depth + 1);
    return out;
  }
  const card = cardOf(result, calc);
  if (card) {
    if (!seen.has(card.imageId)) {
      seen.add(card.imageId);
      out.push(card);
    }
    // a row's own nested objects (archiveCheque on a statement line) may hold another picture
  }
  for (const [k, v] of Object.entries(result)) {
    if (k === 'note' || k === 'params' || k === 'source' || k === 'sources' || v == null || typeof v !== 'object') continue;
    cardsOfResult(v, calc, out, seen, depth + 1);
  }
  return out;
}

/**
 * The cards to show under an answer: [] when the answer is not about the pictures.
 * @param {Array<{calc:string, result?:object, error?:any}>} calcs the request's calcs (as the client gets them)
 * @param {string} [question] the user's question — picture words make every picture in the results a card
 */
export function chequeCards(calcs, question = '') {
  const list = Array.isArray(calcs) ? calcs : [];
  const archive = list.some((c) => c?.calc === 'cheque_archive' && c.result && !c.error);
  const asked = PICTURE_WORDS.test(String(question || ''));
  if (!archive && !asked) return [];
  const out = [];
  const seen = new Set();
  // the archive's rows first (they carry the surest names), then the pictures of the other calcs
  for (const c of [...list.filter((c) => c?.calc === 'cheque_archive'), ...list.filter((c) => c?.calc !== 'cheque_archive')]) {
    if (!c?.result || c.error) continue;
    cardsOfResult(c.result, c.calc, out, seen);
  }
  return out;
}

/** The caption of a card, one line: "שיק 11106 · ציונוב מעיין · 1,200 ₪ · 12.5.2026" (the parts that exist). */
export function cardCaption(card, { cheque = 'שיק', unsure = '?', fmtAmount = (n) => `${Math.round(n).toLocaleString('en-US')} ₪`, fmtDate = (d) => String(d).slice(0, 10) } = {}) {
  return [
    card.number ? `${cheque} ${card.number}` : cheque,
    card.payee ? `${card.payee}${card.unsure ? unsure : ''}` : null,
    card.amount != null ? fmtAmount(card.amount) : null,
    card.date ? fmtDate(card.date) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
