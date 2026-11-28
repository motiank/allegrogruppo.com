// A column filter in a table header, like the bank reconciliation report's (owner 2026-11-28: "the filter in the table head
// like we did on bank recon"): the column's name and a ▼ button; the button opens a panel with a search box, "(בחר הכל)", the
// column's distinct values with their counts as checkboxes, and אישור / נקה סינון / ביטול. OK keeps the checked values (with a
// search word: only the matching checked ones, like Excel); every value checked = no filter. The panel is fixed-positioned
// under the button, so a table box that hides its overflow does not cut it. DateHeadFilter = the same button with a panel
// of preset windows and two date pickers.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createUseStyles, useTheme } from 'react-jss';
import { useT } from './i18n/index.js';
import { Btn, Input } from './ui.js';

const useStyles = createUseStyles((theme) => ({
  head: { display: 'inline-flex', alignItems: 'center', gap: '0.25rem', whiteSpace: 'nowrap' },
  btn: { border: 0, background: 'none', color: theme.textSecondary, cursor: 'pointer', fontSize: '0.7rem', padding: '0 0.15rem', lineHeight: 1, fontFamily: 'inherit', '&:hover': { color: theme.text } },
  on: { color: theme.primary, fontWeight: 700 },
  backdrop: { position: 'fixed', inset: 0, zIndex: 60, background: 'transparent' },
  panel: { position: 'fixed', zIndex: 61, width: 340, maxWidth: 'calc(100vw - 16px)', background: theme.surface, color: theme.text, border: `1px solid ${theme.border}`, borderRadius: 8, boxShadow: '0 6px 24px rgba(0,0,0,.35)', padding: '0.5rem', fontSize: '0.8rem', fontWeight: 400, textAlign: 'start', whiteSpace: 'normal' },
  title: { fontWeight: 650, marginBottom: '0.35rem' },
  row: { display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.12rem 0', cursor: 'pointer', '& input': { margin: 0 }, '& span:nth-child(2)': { flex: 1, minWidth: 0, overflowWrap: 'anywhere' } },
  count: { color: theme.textSecondary, fontSize: '0.74rem', whiteSpace: 'nowrap' },
  all: { borderBottom: `1px solid ${theme.border}`, paddingBottom: '0.3rem', marginBottom: '0.2rem' },
  list: { maxHeight: 260, overflowY: 'auto', margin: '0.2rem 0 0.4rem', paddingInlineEnd: '0.3rem' },
  foot: { display: 'flex', gap: '0.35rem', flexWrap: 'wrap', justifyContent: 'flex-end' },
  dates: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.35rem 0.5rem', alignItems: 'center', margin: '0.3rem 0 0.5rem' },
  presets: { display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginBottom: '0.4rem' },
  more: { color: theme.textSecondary, fontSize: '0.74rem', padding: '0.2rem 0' },
}));

const MAX_LIST = 400;

/** Where the panel opens: under the button, kept inside the window. */
function panelPos(btn) {
  const r = btn?.getBoundingClientRect();
  if (!r) return { top: 60, left: 8 };
  const width = 340;
  const left = Math.max(8, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 8));
  return { top: Math.min(r.bottom + 4, window.innerHeight - 200), left };
}

function Shell({ open, onClose, btnRef, children, title }) {
  const theme = useTheme();
  const c = useStyles(theme);
  const [pos, setPos] = useState({ top: 60, left: 8 });
  useEffect(() => {
    if (open) setPos(panelPos(btnRef.current));
  }, [open, btnRef]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className={c.backdrop} onClick={onClose} />
      <div className={c.panel} style={pos} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className={c.title}>{title}</div>
        {children}
      </div>
    </>
  );
}

/**
 * options: [{ value, count }] (every distinct value of the column, counted over the unfiltered rows); selected: Set | null
 * (null = no filter); onChange(Set | null).
 */
export function HeadFilter({ label, options = [], selected = null, onChange }) {
  const theme = useTheme();
  const c = useStyles(theme);
  const { t } = useT();
  const btnRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(() => new Set());
  const values = useMemo(() => options.map((o) => String(o.value)), [options]);
  const counts = useMemo(() => new Map(options.map((o) => [String(o.value), o.count])), [options]);
  const visible = useMemo(() => { const w = q.trim().toLowerCase(); return w ? values.filter((v) => v.toLowerCase().includes(w)) : values; }, [values, q]);
  const start = () => {
    setPicked(new Set(selected && selected.size ? [...selected] : values));
    setQ('');
    setOpen(true);
  };
  const toggle = (v) => setPicked((s) => { const n = new Set(s); if (n.has(v)) n.delete(v); else n.add(v); return n; });
  const nVisiblePicked = visible.filter((v) => picked.has(v)).length;
  const allChecked = visible.length > 0 && nVisiblePicked === visible.length;
  const toggleAll = () => setPicked((s) => { const n = new Set(s); for (const v of visible) { if (allChecked) n.delete(v); else n.add(v); } return n; });
  const ok = () => {
    const keep = q.trim() ? visible.filter((v) => picked.has(v)) : [...picked].filter((v) => values.includes(v));
    onChange(keep.length === 0 || keep.length >= values.length ? null : new Set(keep));
    setOpen(false);
  };
  const clear = () => { onChange(null); setOpen(false); };
  const active = Boolean(selected && selected.size);
  const title = t('joya.hf.title', { col: label });
  return (
    <span className={c.head}>
      <span>{label}</span>
      <button ref={btnRef} type="button" className={`${c.btn} ${active ? c.on : ''}`} onClick={(e) => { e.stopPropagation(); open ? setOpen(false) : start(); }} title={title} aria-label={title}>▼{active ? ` ${selected.size}` : ''}</button>
      <Shell open={open} onClose={() => setOpen(false)} btnRef={btnRef} title={title}>
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('joya.hf.search')} autoFocus dir="auto" aria-label={t('joya.hf.search')} />
        <label className={`${c.row} ${c.all}`}>
          <input type="checkbox" checked={allChecked} ref={(el) => { if (el) el.indeterminate = nVisiblePicked > 0 && !allChecked; }} onChange={toggleAll} />
          <span>{t('joya.hf.selectAll')}</span>
          <span className={c.count}>({visible.length.toLocaleString('en-US')})</span>
        </label>
        <div className={c.list}>
          {visible.slice(0, MAX_LIST).map((v) => (
            <label key={v} className={c.row}>
              <input type="checkbox" checked={picked.has(v)} onChange={() => toggle(v)} />
              <span dir="auto">{v}</span>
              <span className={c.count}>({Number(counts.get(v) || 0).toLocaleString('en-US')})</span>
            </label>
          ))}
          {visible.length > MAX_LIST ? <div className={c.more}>{t('joya.hf.more', { n: visible.length - MAX_LIST })}</div> : null}
        </div>
        <div className={c.foot}>
          <Btn small kind="primary" onClick={ok}>{t('joya.hf.ok')}</Btn>
          <Btn small onClick={clear} disabled={!active}>{t('joya.hf.clear')}</Btn>
          <Btn small onClick={() => setOpen(false)}>{t('joya.hf.cancel')}</Btn>
        </div>
      </Shell>
    </span>
  );
}

/** The date column's filter: preset windows and two date pickers. presets: [{ key, label, from, to }]; value: { from, to }; onChange({ from, to }). */
export function DateHeadFilter({ label, value, presets = [], onChange, activeKey = null, isDefault = true }) {
  const theme = useTheme();
  const c = useStyles(theme);
  const { t } = useT();
  const btnRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(value.from);
  const [to, setTo] = useState(value.to);
  const start = () => { setFrom(value.from); setTo(value.to); setOpen(true); };
  const title = t('joya.hf.title', { col: label });
  const ok = () => { if (from && to && from <= to) { onChange({ from, to }); setOpen(false); } };
  return (
    <span className={c.head}>
      <span>{label}</span>
      <button ref={btnRef} type="button" className={`${c.btn} ${isDefault ? '' : c.on}`} onClick={(e) => { e.stopPropagation(); open ? setOpen(false) : start(); }} title={title} aria-label={title}>▼</button>
      <Shell open={open} onClose={() => setOpen(false)} btnRef={btnRef} title={title}>
        <div className={c.presets}>
          {presets.map((p) => <Btn key={p.key} small kind={activeKey === p.key ? 'primary' : 'default'} onClick={() => { onChange({ from: p.from, to: p.to }); setOpen(false); }}>{p.label}</Btn>)}
        </div>
        <div className={c.dates}>
          <span>{t('joya.bl.fromDay')}</span>
          <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          <span>{t('joya.bl.toDay')}</span>
          <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className={c.foot}>
          <Btn small kind="primary" onClick={ok} disabled={!from || !to || from > to}>{t('joya.hf.ok')}</Btn>
          <Btn small onClick={() => setOpen(false)}>{t('joya.hf.cancel')}</Btn>
        </div>
      </Shell>
    </span>
  );
}
