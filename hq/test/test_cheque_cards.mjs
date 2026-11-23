// The cheque pictures shown as cards under a chat answer (lib/chequeCards.js): which answers show them and what each
// card carries. No DOM, no DB.
//   node --test test/test_cheque_cards.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chequeCards, cardOf, cardCaption, PICTURE_WORDS } from '../lib/chequeCards.js';

const archive = {
  calc: 'cheque_archive',
  params: { q: 'ציונוב' },
  result: {
    companies: [
      {
        company: 'פסטה לינה',
        rows: [
          { cheque: 11106, date: '2026-05-12', amount: 1200, payee: 'ציונוב מעיין', payeeSource: 'image', imageId: 'id-11106', inBooks: false },
          { cheque: 11386, date: '2026-06-01', amount: 800.5, payee: null, payeeGuess: 'שגב', imageId: 'id-11386', inBooks: true },
          { cheque: 11400, date: '2026-06-02', amount: 300, payee: null, payeeGuess: null, imageId: 'id-11400', inBooks: false },
        ],
        note: 'imageId in a note must not count: imageId',
      },
    ],
  },
};
const bank = {
  calc: 'bank_open_items',
  result: { companies: [{ rows: [{ date: '2026-05-12', reference: 11106, amount: -1200, payee: 'ציונוב מעיין', payeeSource: 'image', hasImage: true, imageId: 'id-11106' }, { date: '2026-05-13', reference: 555, amount: -50, payee: 'x', payeeSource: 'cheques' }] }] },
};

test('the cheque archive answer shows its pictures as cards, surest names first, each picture once', () => {
  const cards = chequeCards([bank, archive], 'של מי שיק 11106');
  assert.equal(cards.length, 3);
  assert.deepEqual(cards.map((c) => c.imageId), ['id-11106', 'id-11386', 'id-11400']);
  assert.equal(cards[0].calc, 'cheque_archive');
  assert.equal(cards[0].payee, 'ציונוב מעיין');
  assert.equal(cards[0].unsure, false);
  assert.equal(cards[0].amount, 1200);
  assert.equal(cards[0].date, '2026-05-12');
  assert.equal(cards[0].inBooks, false);
  assert.equal(cards[1].payee, 'שגב');
  assert.equal(cards[1].unsure, true);
  assert.equal(cards[2].payee, null);
});

test('a bank question without picture words keeps the pictures behind the report', () => {
  assert.deepEqual(chequeCards([bank], 'מה פתוח בבנק'), []);
  assert.deepEqual(chequeCards([], 'תמונות'), []);
  assert.deepEqual(chequeCards(null, 'תמונות'), []);
});

test('picture words in the question make every picture of the answer a card', () => {
  const cards = chequeCards([bank], 'תראה לי את תמונות השיקים מהבנק');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].number, '11106');
  assert.equal(cards[0].amount, 1200, 'the amount is shown without its sign');
  for (const q of ['תמונה של שיק 11106', 'הצ\'קים הסרוקים', 'צילום השיק', 'show me the cheque images', 'cheque pictures', 'the scans']) assert.ok(PICTURE_WORDS.test(q), q);
  for (const q of ['של מי שיק 11106', 'יתרת הבנק', 'דוח התאמת בנק']) assert.ok(!PICTURE_WORDS.test(q), q);
});

test('a failed archive calc shows nothing; nested pictures (archiveCheque) and report cheque rows are found', () => {
  assert.deepEqual(chequeCards([{ calc: 'cheque_archive', error: 'boom' }], 'של מי שיק 1'), []);
  const cmp = { calc: 'statement_compare', result: { companies: [{ onlyTheirs: [{ date: '2026-05-10', amount: 1200, kind: 'payment', archiveCheque: { cheque: 11106, bankDate: '2026-05-12', payee: 'שגב', unsure: true, imageId: 'id-11106' } }] }] } };
  const cards = chequeCards([cmp], 'תמונות');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].number, '11106');
  assert.equal(cards[0].date, '2026-05-12', 'the bank day, not the statement day');
  assert.equal(cards[0].unsure, true);
  const report = { calc: 'bank_recon_report', result: { companies: [{ sections: { chequesStale: { rows: [{ chequeNo: 17028, payee: 'אליהו', dueDate: '2026-01-02', amount: 900, imageId: 'id-17028' }] } } }] } };
  assert.equal(chequeCards([report], 'תמונות השיקים הישנים')[0].number, '17028');
});

test('cardOf ignores rows without a picture; the caption lists the parts that exist', () => {
  assert.equal(cardOf({ cheque: 1 }), null);
  assert.equal(cardOf({ imageId: '' }), null);
  assert.equal(cardOf(null), null);
  const c = cardOf({ cheque: 11106, date: '2026-05-12', amount: 1200, payee: 'ציונוב מעיין', imageId: 'a' });
  assert.equal(cardCaption(c), 'שיק 11106 · ציונוב מעיין · 1,200 ₪ · 2026-05-12');
  assert.equal(cardCaption(cardOf({ imageId: 'b', payeeGuess: 'שגב' })), 'שיק · שגב?');
});
