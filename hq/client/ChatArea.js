// The chat of a main-menu area (pages/Area.js). Before the first question the ask field is in the
// middle of the page; after it, every question is a box (the question, a line, the answer, × to delete)
// and the ask field stays fixed at the bottom of the screen. The field opens a list of suggestions: the
// area's fixed questions when it is empty, the ones that fit the typed words while typing. Files dropped on the page
// (or picked with the paperclip) are read with the Allegro admin's upload code and imported on "Import" (FileDrop.js).
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createUseStyles, useTheme } from 'react-jss';
import { api, qs } from './api.js';
import { useT, Term } from './i18n/index.js';
import { ErrorBox, fmtWhen } from './ui.js';
import { Answer, matchSuggestions } from './AskBox.js';
import { useJoya } from './context.js';
import { useWindowDrop, DropOverlay, useUploads, UploadCard } from './FileDrop.js';

const useStyles = createUseStyles((theme) => ({
  start: { minHeight: 'calc(100vh - 190px)', display: 'flex', flexDirection: 'column', justifyContent: 'center', maxWidth: 680, margin: '0 auto', width: '100%' },
  startTitle: { fontSize: '1.25rem', fontWeight: 650, textAlign: 'center', margin: '0 0 0.4rem' },
  intro: { fontSize: '0.84rem', color: theme.textSecondary, textAlign: 'center', margin: '0 0 1rem', lineHeight: 1.55 },
  note: { fontSize: '0.7rem', color: theme.textSecondary, textAlign: 'center', marginTop: '0.7rem', lineHeight: 1.5 },
  list: { maxWidth: 820, margin: '0 auto', paddingBottom: 110 },
  card: { position: 'relative', border: `1px solid ${theme.border}`, borderRadius: 12, background: theme.surface, padding: '0.7rem 0.85rem 0.8rem', marginBottom: '0.75rem' },
  cardHead: { display: 'flex', alignItems: 'flex-start', gap: '0.5rem' },
  cardTitle: { flex: 1, minWidth: 0, fontSize: '0.92rem', fontWeight: 650, lineHeight: 1.45, overflowWrap: 'anywhere' },
  when: { fontSize: '0.68rem', color: theme.textSecondary, marginTop: '0.1rem' },
  x: {
    flex: 'none',
    width: 26,
    height: 26,
    borderRadius: 999,
    border: 0,
    background: 'none',
    color: theme.textSecondary,
    fontSize: '1.05rem',
    lineHeight: 1,
    cursor: 'pointer',
    '&:hover': { background: 'rgba(127,127,127,0.16)', color: theme.text },
  },
  sep: { border: 0, borderTop: `1px solid ${theme.border}`, margin: '0.55rem 0 0.3rem' },
  dock: {
    position: 'fixed',
    insetInline: 0,
    bottom: 0,
    zIndex: 15,
    background: theme.background,
    borderTop: `1px solid ${theme.border}`,
    padding: '0.55rem 1rem calc(0.55rem + env(safe-area-inset-bottom))',
  },
  dockInner: { maxWidth: 820, margin: '0 auto' },
  // the field and the send button
  composer: { position: 'relative' },
  row: { display: 'flex', alignItems: 'flex-end', gap: '0.45rem' },
  field: {
    flex: 1,
    minWidth: 0,
    resize: 'none',
    border: `1px solid ${theme.border}`,
    borderRadius: 22,
    padding: '0.6rem 1rem',
    background: theme.surface,
    color: theme.text,
    fontSize: '0.95rem',
    lineHeight: 1.4,
    fontFamily: 'inherit',
    maxHeight: 140,
    overflowY: 'hidden',
    outline: 'none',
    '&:focus': { borderColor: theme.primary },
  },
  send: {
    flex: 'none',
    width: 44,
    height: 44,
    borderRadius: 999,
    border: 0,
    background: theme.primary,
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    '&:hover': { background: theme.primaryHover },
    '&:disabled': { opacity: 0.45, cursor: 'default' },
  },
  menu: {
    position: 'absolute',
    insetInline: 0,
    zIndex: 25,
    maxHeight: 'min(320px, 45vh)',
    overflowY: 'auto',
    border: `1px solid ${theme.border}`,
    borderRadius: 12,
    background: theme.surface,
    boxShadow: '0 6px 24px rgba(0,0,0,0.35)',
  },
  below: { top: 'calc(100% + 6px)' },
  above: { bottom: 'calc(100% + 6px)' },
  item: {
    display: 'block',
    width: '100%',
    textAlign: 'start',
    padding: '0.55rem 0.9rem',
    fontSize: '0.86rem',
    background: 'none',
    border: 0,
    borderTop: `1px solid ${theme.border}`,
    color: theme.text,
    cursor: 'pointer',
    fontFamily: 'inherit',
    '&:first-child': { borderTop: 0 },
  },
  active: { background: 'rgba(127,127,127,0.16)' },
  attach: {
    flex: 'none',
    width: 44,
    height: 44,
    borderRadius: 999,
    border: `1px solid ${theme.border}`,
    background: theme.surface,
    color: theme.textSecondary,
    fontSize: '1.15rem',
    cursor: 'pointer',
    '&:hover': { color: theme.text },
  },
}));

/** The arrow of the send button. It points to where the text runs: left in Hebrew, right in English. */
function SendIcon({ rtl }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" style={rtl ? { transform: 'scaleX(-1)' } : null}>
      <path fill="currentColor" d="M3.4 20.4 21 12 3.4 3.6 3.4 10.1 15 12 3.4 13.9z" />
    </svg>
  );
}

function Composer({ classes, docked, suggestions, pool, busy, onSend, onFiles }) {
  const { t, isRtl } = useT();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const field = useRef(null);
  const picker = useRef(null);
  const typed = text.trim();
  const list = useMemo(() => (typed ? matchSuggestions(text, pool) : suggestions), [typed, text, pool, suggestions]);
  const show = open && list.length > 0;

  // the field grows with the text, up to its max height
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
    el.style.overflowY = el.scrollHeight > 140 ? 'auto' : 'hidden';
  }, [text]);
  useEffect(() => setActive(-1), [text, open]);

  const send = async () => {
    if (!typed || busy) return;
    if (await onSend(typed)) setText('');
    setOpen(false);
  };
  const pick = (s) => {
    setText(s);
    setOpen(false);
    field.current?.focus();
  };
  const onKeyDown = (e) => {
    if (show && e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % list.length);
    } else if (show && e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i <= 0 ? list.length - 1 : i - 1));
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (show && active >= 0) pick(list[active]);
      else send();
    }
  };

  return (
    <div className={classes.composer}>
      <div className={classes.row}>
        {onFiles ? (
          <>
            <button type="button" className={classes.attach} onClick={() => picker.current?.click()} aria-label={t('joya.files.attach')} title={t('joya.files.attach')}>
              📎
            </button>
            <input
              ref={picker}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                const files = [...(e.target.files || [])];
                e.target.value = '';
                if (files.length) onFiles(files);
              }}
            />
          </>
        ) : null}
        <textarea
          ref={field}
          className={classes.field}
          rows={1}
          dir="auto"
          value={text}
          placeholder={t('joya.area.placeholder')}
          aria-label={t('joya.area.askTitle')}
          aria-expanded={show}
          aria-autocomplete="list"
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
        <button type="button" className={classes.send} disabled={busy || !typed} onClick={send} aria-label={t('joya.ask.send')} title={t('joya.ask.send')}>
          <SendIcon rtl={isRtl} />
        </button>
      </div>
      {show ? (
        <div className={`${classes.menu} ${docked ? classes.above : classes.below}`} role="listbox" aria-label={t('joya.ask.suggestions')}>
          {list.map((s, i) => (
            <button
              key={s}
              type="button"
              role="option"
              aria-selected={i === active}
              className={`${classes.item} ${i === active ? classes.active : ''}`}
              dir="auto"
              // mousedown, not click: a click would first blur the field and close the list
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
              onMouseEnter={() => setActive(i)}
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Card({ r, classes, onDelete, onChanged }) {
  const { t } = useT();
  return (
    <div className={classes.card}>
      <div className={classes.cardHead}>
        <div className={classes.cardTitle} dir="auto">
          {r.question}
          <div className={classes.when}>
            <Term>{fmtWhen(r.createdAt)}</Term>
          </div>
        </div>
        <button type="button" className={classes.x} onClick={onDelete} aria-label={t('joya.ask.delete')} title={t('joya.ask.delete')}>
          ×
        </button>
      </div>
      <hr className={classes.sep} />
      <Answer r={r} head={false} onChanged={onChanged} />
    </div>
  );
}

/**
 * @param {object} p
 * @param {number} p.contextId     the area (src/services/ai.js AREAS)
 * @param {string} [p.locationId]
 * @param {string} p.title          shown above the field before the first question
 * @param {string} [p.intro]
 * @param {string[]} p.suggestions  the area's questions (translated)
 */
export default function ChatArea({ contextId, locationId = null, title, intro, suggestions = [], limit = 20 }) {
  const theme = useTheme();
  const classes = useStyles(theme);
  const { t, lang } = useT();
  // with no restaurant given, the question is about the company chosen in the picker (null = all)
  const { companyKey } = useJoya();
  const [items, setItems] = useState(null); // newest first, as the server sends them
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);
  const scrollDown = useRef(false);
  const contextKind = 'AREA';
  const { uploads, add: addFiles, run: importFiles, remove: removeUpload } = useUploads();
  const dragging = useWindowDrop((files) => {
    scrollDown.current = true;
    addFiles(files);
  });

  const load = () =>
    api(`/ai/requests${qs({ contextKind, contextId, limit })}`)
      .then((d) => setItems(d.requests))
      .catch(setErr);
  useEffect(() => {
    load();
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextId]);

  // poll while something is still being answered
  useEffect(() => {
    clearTimeout(timer.current);
    if (items?.some((r) => r.status === 'THINKING')) timer.current = setTimeout(load, 3000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // the newest question is at the bottom, next to the field
  useEffect(() => {
    if (!items?.length) return;
    const smooth = scrollDown.current;
    scrollDown.current = false;
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items?.length, items?.[0]?.status, uploads.length]);

  const pool = useMemo(() => [...new Set([...suggestions, ...(items || []).map((r) => r.question)])], [suggestions, items]);

  const send = async (question) => {
    setBusy(true);
    setErr(null);
    try {
      const { request } = await api('/ai/ask', { method: 'POST', body: { question, contextKind, contextId, locationId, companyKey: locationId == null ? companyKey : null, lang } });
      scrollDown.current = true;
      setItems((xs) => [request, ...(xs || [])]);
      return true;
    } catch (e) {
      setErr(e);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id) => {
    const before = items;
    setItems((xs) => xs.filter((r) => r.id !== id));
    try {
      await api(`/ai/requests/${id}`, { method: 'DELETE' });
    } catch (e) {
      setItems(before);
      setErr(e);
    }
  };

  if (items == null) return <ErrorBox error={err} />;
  const composer = <Composer classes={classes} docked={items.length + uploads.length > 0} suggestions={suggestions} pool={pool} busy={busy} onSend={send} onFiles={addFiles} />;
  const overlay = dragging ? <DropOverlay /> : null;

  if (!items.length && !uploads.length)
    return (
      <div className={classes.start}>
        {overlay}
        <h2 className={classes.startTitle}>{title}</h2>
        {intro ? <p className={classes.intro}>{intro}</p> : null}
        {composer}
        <ErrorBox error={err} />
        <div className={classes.note}>{t('joya.ask.howItWorks')}</div>
      </div>
    );

  return (
    <>
      {overlay}
      <div className={classes.list}>
        {[...items].reverse().map((r) => (
          <Card key={r.id} r={r} classes={classes} onDelete={() => remove(r.id)} onChanged={() => load()} />
        ))}
        {uploads.map((u) => (
          <UploadCard key={u.key} u={u} onImport={(rests) => importFiles(u, rests)} onRemove={() => removeUpload(u.key)} />
        ))}
        <ErrorBox error={err} />
      </div>
      <div className={classes.dock}>
        <div className={classes.dockInner}>{composer}</div>
      </div>
    </>
  );
}
