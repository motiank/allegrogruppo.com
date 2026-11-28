// The scanned cheques of a chat answer as a card list (owner 2026-11-23: "if I asked for cheque images, display them on a
// card list with the options to copy and share"). Which pictures and when: lib/chequeCards.js. Each card shows the picture
// (tap = full size), the cheque number, the payee, the amount and the bank day, with Copy (the picture to the clipboard,
// as PNG — the link when the browser cannot) and Share (the phone's share sheet with the picture; a browser without it
// downloads the file). The picture itself streams through Joya (/api/joya/finance/cheque-image/:id), so no Drive access
// is needed.
import React, { useMemo, useState } from 'react';
import { createUseStyles, useTheme } from 'react-jss';
import { useT, Term } from './i18n/index.js';
import { Btn, Modal, fmtILS, fmtDay } from './ui.js';
import { chequeCards, cardCaption, cardOf } from '../lib/chequeCards.js';

const FIRST = 12; // cards shown before "show all"
const STEP = 24;

export const imageUrl = (id) => `/api/joya/finance/cheque-image/${encodeURIComponent(id)}`;
const absoluteUrl = (id) => `${window.location.origin}${imageUrl(id)}`;
const fileName = (card) => `cheque-${card.number || card.imageId}.jpg`;

const useStyles = createUseStyles((theme) => ({
  wrap: { marginTop: '0.6rem' },
  head: { fontSize: '0.8rem', fontWeight: 650, marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '0.55rem' },
  card: { border: `1px solid ${theme.border}`, borderRadius: 10, background: theme.background, overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  pic: { display: 'block', width: '100%', aspectRatio: '2.3 / 1', background: '#000', border: 0, padding: 0, cursor: 'zoom-in', '& img': { width: '100%', height: '100%', objectFit: 'contain', display: 'block' } },
  body: { padding: '0.45rem 0.6rem 0.5rem', fontSize: '0.78rem', lineHeight: 1.45 },
  num: { fontWeight: 650 },
  payee: { color: theme.text },
  unsure: { color: '#d29922' },
  sub: { color: theme.textSecondary, fontSize: '0.74rem' },
  actions: { display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '0.4rem' },
  status: { fontSize: '0.72rem', color: theme.textSecondary },
  statusBad: { fontSize: '0.72rem', color: '#f2a3a8' },
  more: { marginTop: '0.5rem' },
  full: { width: '100%', display: 'block', borderRadius: 8, background: '#000' },
}));

// ---- the picture as bytes: the browser's clipboard takes PNG only, the share sheet takes the JPEG as it is

async function fetchBlob(id) {
  const res = await fetch(imageUrl(id), { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

async function toPng(blob) {
  if (blob.type === 'image/png') return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'));
}

/** Copy the picture to the clipboard; returns 'copied', or 'copiedLink' when only text can be copied here. */
export async function copyCard(card) {
  const text = `${cardCaption(card)}\n${absoluteUrl(card.imageId)}`;
  if (typeof window.ClipboardItem === 'function' && navigator.clipboard?.write) {
    try {
      // the promise form: Safari needs the write to start inside the tap, before the bytes arrive
      await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': fetchBlob(card.imageId).then(toPng) })]);
      return 'copied';
    } catch (e) {
      if (e?.name === 'NotAllowedError') throw e;
      // an older browser without promise values, or a format it refuses — fall through to the link
    }
  }
  if (!navigator.clipboard?.writeText) throw new Error('clipboard');
  await navigator.clipboard.writeText(text);
  return 'copiedLink';
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Share the picture with the device's share sheet; returns 'shared', 'cancelled' or 'downloaded' (no share sheet here). */
export async function shareCard(card) {
  const title = cardCaption(card);
  const blob = await fetchBlob(card.imageId);
  const file = new File([blob], fileName(card), { type: blob.type || 'image/jpeg' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title, text: title });
      return 'shared';
    }
    if (navigator.share) {
      await navigator.share({ title, text: title, url: absoluteUrl(card.imageId) });
      return 'shared';
    }
  } catch (e) {
    if (e?.name === 'AbortError') return 'cancelled';
    throw e;
  }
  download(blob, fileName(card));
  return 'downloaded';
}

// ---- the components

function useCardActions(card) {
  const { t } = useT();
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn) => {
    setBusy(true);
    setStatus(null);
    try {
      const out = await fn(card);
      if (out === 'cancelled') return;
      setStatus({ text: t(`joya.ask.cheq.${out}`) });
      setTimeout(() => setStatus(null), 3500);
    } catch (e) {
      setStatus({ bad: true, text: `${t('joya.ask.cheq.failed')} ${e?.message || ''}`.trim() });
    } finally {
      setBusy(false);
    }
  };
  const open = () => window.open(absoluteUrl(card.imageId), '_blank', 'noopener');
  const save = () => run(async (c) => { download(await fetchBlob(c.imageId), fileName(c)); return 'downloaded'; });
  return { status, busy, copy: () => run(copyCard), share: () => run(shareCard), open, save };
}

function Actions({ card, classes, full }) {
  const { t } = useT();
  const a = useCardActions(card);
  return (
    <div className={classes.actions}>
      <Btn small onClick={a.copy} disabled={a.busy}>
        📋 {t('joya.ask.cheq.copy')}
      </Btn>
      <Btn small onClick={a.share} disabled={a.busy}>
        ↗ {t('joya.ask.cheq.share')}
      </Btn>
      {full ? (
        <>
          <Btn small onClick={a.save} disabled={a.busy}>
            ⬇ {t('joya.ask.cheq.download')}
          </Btn>
          <Btn small onClick={a.open}>
            {t('joya.ask.cheq.openNew')}
          </Btn>
        </>
      ) : null}
      {a.status ? <span className={a.status.bad ? classes.statusBad : classes.status}>{a.status.text}</span> : null}
    </div>
  );
}

function Caption({ card, classes }) {
  const { t } = useT();
  return (
    <div className={classes.body}>
      <div>
        <span className={classes.num}>
          {t('joya.ask.cheq.cheque')} <Term>{card.number || '—'}</Term>
        </span>
        {card.payee ? (
          <>
            {' · '}
            <span className={card.unsure ? classes.unsure : classes.payee} dir="auto">
              {card.payee}
              {card.unsure ? ` ${t('joya.ask.cheq.unsure')}` : ''}
            </span>
          </>
        ) : (
          <>
            {' · '}
            <span className={classes.sub}>{t('joya.ask.cheq.noName')}</span>
          </>
        )}
      </div>
      <div className={classes.sub}>
        {card.amount != null ? <Term>{fmtILS(card.amount)}</Term> : null}
        {card.amount != null && card.date ? ' · ' : ''}
        {card.date ? <Term>{fmtDay(card.date)}</Term> : null}
        {card.inBooks === false ? ` · ${t('joya.ask.cheq.notInBooks')}` : ''}
      </div>
    </div>
  );
}

function ChequeCard({ card, classes, onOpen }) {
  const { t } = useT();
  return (
    <div className={classes.card}>
      <button type="button" className={classes.pic} onClick={() => onOpen(card)} aria-label={t('joya.ask.cheq.openFull')}>
        <img src={imageUrl(card.imageId)} alt={cardCaption(card)} loading="lazy" decoding="async" />
      </button>
      <Caption card={card} classes={classes} />
      <div className={classes.body} style={{ paddingTop: 0 }}>
        <Actions card={card} classes={classes} />
      </div>
    </div>
  );
}

/** The card list under an answer (nothing when the answer has no pictures to show). r = the request as the client gets it. */
export default function ChequeCards({ r }) {
  const theme = useTheme();
  const classes = useStyles(theme);
  const { t } = useT();
  const cards = useMemo(() => chequeCards(r.calcs, r.question), [r.calcs, r.question]);
  const [shown, setShown] = useState(FIRST);
  const [open, setOpen] = useState(null);
  if (!cards.length) return null;
  const visible = cards.slice(0, shown);
  return (
    <div className={classes.wrap}>
      <div className={classes.head}>
        📷 {t('joya.ask.cheq.title', { n: cards.length })}
        {cards.length > visible.length ? <span className={classes.sub}>{t('joya.ask.cheq.shownOf', { shown: visible.length, n: cards.length })}</span> : null}
      </div>
      <div className={classes.grid}>
        {visible.map((c) => (
          <ChequeCard key={c.imageId} card={c} classes={classes} onOpen={setOpen} />
        ))}
      </div>
      {cards.length > shown ? (
        <div className={classes.more}>
          <Btn small onClick={() => setShown((n) => n + STEP)}>
            {t('joya.ask.cheq.more', { n: Math.min(STEP, cards.length - shown) })}
          </Btn>
        </div>
      ) : null}
      {open ? (
        <Modal title={cardCaption(open, { cheque: t('joya.ask.cheq.cheque'), unsure: ' ?', fmtAmount: fmtILS, fmtDate: fmtDay })} onClose={() => setOpen(null)}>
          <img className={classes.full} src={imageUrl(open.imageId)} alt={cardCaption(open)} />
          <Actions card={open} classes={classes} full />
        </Modal>
      ) : null}
    </div>
  );
}

const useThumbStyles = createUseStyles((theme) => ({
  thumb: { display: 'inline-flex', alignItems: 'center', border: `1px solid ${theme.border}`, borderRadius: 6, background: '#000', padding: 0, cursor: 'zoom-in', width: 64, height: 28, overflow: 'hidden', flex: '0 0 auto', '& img': { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } },
  // the small 📷 of the bank reconciliation page (owner 2026-11-28: "a small icon in the details column, as on the recon page")
  icon: { display: 'inline-block', border: 0, background: 'none', padding: '0 0.15rem', cursor: 'zoom-in', fontSize: '0.95em', lineHeight: 1, verticalAlign: 'middle', opacity: 0.85, '&:hover': { opacity: 1 } },
}));

/**
 * The scanned cheque of ONE line as a small thumbnail (owner 2026-11-28: "when displaying bank pages — add the cheque image when
 * applicable"): tap = the full picture in a dialog with copy / share. Nothing when the row has no imageId.
 * row: any row with imageId (+ reference / cheque / number, payee, amount, bankDate / date).
 */
export function ChequeThumb({ row, icon = false }) {
  const theme = useTheme();
  const classes = useStyles(theme);
  const th = useThumbStyles(theme);
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const card = useMemo(() => cardOf(row, 'line'), [row]);
  if (!card) return null;
  const caption = cardCaption(card, { cheque: t('joya.ask.cheq.cheque'), unsure: ' ?', fmtAmount: fmtILS, fmtDate: fmtDay });
  return (
    <>
      {icon ? (
        <button type="button" className={th.icon} onClick={(e) => { e.stopPropagation(); setOpen(true); }} title={t('joya.ask.cheq.openFull')} aria-label={t('joya.ask.cheq.openFull')}>📷</button>
      ) : (
        <button type="button" className={th.thumb} onClick={(e) => { e.stopPropagation(); setOpen(true); }} title={t('joya.ask.cheq.openFull')} aria-label={t('joya.ask.cheq.openFull')}>
          <img src={imageUrl(card.imageId)} alt={caption} loading="lazy" decoding="async" />
        </button>
      )}
      {open ? (
        <Modal title={caption} onClose={() => setOpen(false)}>
          <img className={classes.full} src={imageUrl(card.imageId)} alt={caption} />
          <Actions card={card} classes={classes} full />
        </Modal>
      ) : null}
    </>
  );
}
