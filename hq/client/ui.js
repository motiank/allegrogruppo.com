// Shared building blocks for the Joya Headquarter pages.
//
// Rules every page follows (owner rules for phone pages + the Joya brief):
//   - boxes, never tables; one column on a phone, wider boxes on a desktop
//   - Hebrew right-to-left: logical sides only (marginInlineStart, textAlign 'start'),
//     Latin terms / numbers / dates inside Hebrew wrapped in <Term>, free text dir="auto"
//   - a value that is not known is shown with <Val> as "לא ידוע"/"missing", NEVER as 0
//   - demonstration data carries the <DemoBanner>
//   - numbers say where they came from: <SourceLine>
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createUseStyles, useTheme } from 'react-jss';
import { useNavigate } from 'react-router-dom';
import { useT, Term, getLocale } from './i18n/index.js';

export { Term };

export const tones = {
  ok: { color: '#3fb950', background: 'rgba(63,185,80,0.12)' },
  warn: { color: '#d29922', background: 'rgba(210,153,34,0.14)' },
  bad: { color: '#f2a3a8', background: '#3a1f22' },
  info: { color: '#79a6ff', background: 'rgba(74,125,255,0.14)' },
  muted: { color: '#9aa0aa', background: 'rgba(139,148,158,0.12)' },
};

const useStyles = createUseStyles((theme) => ({
  root: { minHeight: '100vh', background: theme.background, color: theme.text },
  header: { padding: '0.7rem 1rem 0.6rem', borderBottom: `1px solid ${theme.border}`, maxWidth: 1100, margin: '0 auto' },
  back: { background: 'none', border: 0, color: theme.textSecondary, padding: 0, marginBottom: '0.35rem', cursor: 'pointer', fontSize: '0.8rem', fontFamily: 'inherit' },
  titleRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' },
  title: { margin: 0, fontSize: '1.1rem', fontWeight: 650 },
  sub: { marginTop: '0.2rem', fontSize: '0.78rem', color: theme.textSecondary },
  actions: { display: 'flex', gap: '0.4rem', flexWrap: 'wrap' },
  main: { padding: '0.9rem 1rem 2.5rem', maxWidth: 1100, margin: '0 auto' },
  card: { border: `1px solid ${theme.border}`, borderRadius: 10, padding: '0.75rem 0.9rem', marginBottom: '0.65rem', background: theme.surface, minWidth: 0 },
  clickable: { cursor: 'pointer', '&:hover': { borderColor: theme.primary } },
  cardTitle: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', fontSize: '0.92rem', fontWeight: 600, marginBottom: '0.45rem' },
  grid: { display: 'grid', gap: '0.65rem', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', '& > *': { marginBottom: 0 } },
  row: { display: 'flex', justifyContent: 'space-between', gap: '0.75rem', fontSize: '0.84rem', padding: '0.18rem 0' },
  rowLabel: { color: theme.textSecondary, minWidth: 0 },
  rowValue: { fontWeight: 550, textAlign: 'end' },
  btn: {
    padding: '0.42rem 0.85rem',
    border: `1px solid ${theme.border}`,
    borderRadius: 7,
    background: theme.surface,
    color: theme.text,
    fontSize: '0.84rem',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
    '&:hover:not(:disabled)': { borderColor: theme.primary },
    '&:disabled': { opacity: 0.5, cursor: 'default' },
  },
  primary: { background: theme.primary, borderColor: theme.primary, color: '#fff', '&:hover:not(:disabled)': { background: theme.primaryHover } },
  danger: { color: theme.errorText, borderColor: theme.errorBorder },
  ghost: { background: 'none', border: 0, color: theme.primary, padding: '0.2rem 0.3rem' },
  small: { padding: '0.22rem 0.55rem', fontSize: '0.76rem' },
  badge: { display: 'inline-block', fontSize: '0.72rem', fontWeight: 650, padding: '0.08rem 0.45rem', borderRadius: 4, whiteSpace: 'nowrap' },
  field: { display: 'block', marginBottom: '0.6rem' },
  label: { display: 'block', fontSize: '0.76rem', color: theme.textSecondary, marginBottom: '0.2rem' },
  hint: { display: 'block', fontSize: '0.7rem', color: theme.textSecondary, marginTop: '0.15rem' },
  input: {
    width: '100%',
    padding: '0.45rem 0.55rem',
    border: `1px solid ${theme.border}`,
    borderRadius: 6,
    background: theme.background,
    color: theme.text,
    fontSize: '0.9rem',
    fontFamily: 'inherit',
    '&:focus': { outline: 'none', borderColor: theme.primary },
  },
  overlay: { position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0.75rem' },
  dialog: { width: '100%', maxWidth: 520, maxHeight: '88vh', overflowY: 'auto', background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.5)' },
  dialogHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.65rem 0.9rem', borderBottom: `1px solid ${theme.border}`, fontWeight: 650 },
  dialogBody: { padding: '0.8rem 0.9rem' },
  dialogFoot: { display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', padding: '0.6rem 0.9rem', borderTop: `1px solid ${theme.border}` },
  demo: { border: '1px dashed #d29922', color: '#d29922', background: 'rgba(210,153,34,0.08)', borderRadius: 8, padding: '0.45rem 0.7rem', fontSize: '0.8rem', marginBottom: '0.7rem' },
  source: { fontSize: '0.72rem', color: theme.textSecondary, marginTop: '0.4rem', lineHeight: 1.5 },
  missing: { color: '#d29922', fontWeight: 500, fontSize: '0.85em' },
  center: { padding: '2.5rem 1rem', textAlign: 'center', color: theme.textSecondary },
  error: { border: `1px solid ${theme.errorBorder}`, background: theme.errorBg, color: theme.errorText, borderRadius: 8, padding: '0.6rem 0.8rem', fontSize: '0.84rem', marginBottom: '0.7rem' },
  tabs: { display: 'flex', gap: '0.35rem', overflowX: 'auto', marginTop: '0.55rem', paddingBottom: '0.1rem', scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } },
  tab: { flex: '0 0 auto', padding: '0.38rem 0.75rem', border: `1px solid ${theme.border}`, borderRadius: 999, background: 'none', color: theme.textSecondary, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  tabOn: { borderColor: theme.primary, color: theme.primary, background: 'rgba(74,125,255,0.1)' },
  details: { fontSize: '0.78rem', marginTop: '0.35rem', '& summary': { cursor: 'pointer', color: theme.textSecondary } },
  pre: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', direction: 'ltr', textAlign: 'left', fontSize: '0.72rem', background: theme.background, border: `1px solid ${theme.border}`, borderRadius: 6, padding: '0.45rem', maxHeight: 280, overflow: 'auto' },
}));

export function useJoyaStyles() {
  const theme = useTheme();
  return useStyles(theme);
}

export function Page({ title, sub, back, actions, tabs, children }) {
  const c = useJoyaStyles();
  const navigate = useNavigate();
  const { t } = useT();
  return (
    <div className={c.root}>
      <header className={c.header}>
        {back ? (
          <button className={c.back} onClick={() => (typeof back === 'string' ? navigate(back) : navigate(-1))}>
            {t('joya.back')}
          </button>
        ) : null}
        <div className={c.titleRow}>
          <div style={{ minWidth: 0 }}>
            <h1 className={c.title}>{title}</h1>
            {sub ? <div className={c.sub}>{sub}</div> : null}
          </div>
          {actions ? <div className={c.actions}>{actions}</div> : null}
        </div>
        {tabs || null}
      </header>
      <main className={c.main}>{children}</main>
    </div>
  );
}

export function Card({ title, right, children, onClick, style, className }) {
  const c = useJoyaStyles();
  return (
    <div className={`${c.card} ${onClick ? c.clickable : ''} ${className || ''}`} onClick={onClick} style={style}>
      {title || right ? (
        <div className={c.cardTitle}>
          <span style={{ minWidth: 0 }}>{title}</span>
          {right ? <span>{right}</span> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function Grid({ children }) {
  const c = useJoyaStyles();
  return <div className={c.grid}>{children}</div>;
}

export function Row({ label, children }) {
  const c = useJoyaStyles();
  return (
    <div className={c.row}>
      <span className={c.rowLabel}>{label}</span>
      <span className={c.rowValue}>{children}</span>
    </div>
  );
}

export function Btn({ kind = 'default', small, className, ...rest }) {
  const c = useJoyaStyles();
  return <button type="button" className={`${c.btn} ${kind === 'primary' ? c.primary : kind === 'danger' ? c.danger : kind === 'ghost' ? c.ghost : ''} ${small ? c.small : ''} ${className || ''}`} {...rest} />;
}

export function Badge({ tone = 'muted', children, title }) {
  const c = useJoyaStyles();
  return (
    <span className={c.badge} style={tones[tone] || tones.muted} title={title}>
      {children}
    </span>
  );
}

export function Field({ label, hint, children }) {
  const c = useJoyaStyles();
  return (
    <label className={c.field}>
      {label ? <span className={c.label}>{label}</span> : null}
      {children}
      {hint ? <span className={c.hint}>{hint}</span> : null}
    </label>
  );
}

export function Input(props) {
  const c = useJoyaStyles();
  return <input className={c.input} {...props} />;
}
export function Select({ children, ...props }) {
  const c = useJoyaStyles();
  return (
    <select className={c.input} {...props}>
      {children}
    </select>
  );
}
export const TextArea = React.forwardRef(function TextArea(props, ref) {
  const c = useJoyaStyles();
  return <textarea ref={ref} className={c.input} rows={3} dir="auto" {...props} />;
});

export function Modal({ title, onClose, children, footer }) {
  const c = useJoyaStyles();
  const { t, dir } = useT();
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className={c.overlay} onClick={onClose}>
      <div className={c.dialog} dir={dir} role="dialog" aria-label={typeof title === 'string' ? title : undefined} onClick={(e) => e.stopPropagation()}>
        <div className={c.dialogHead}>
          <span>{title}</span>
          <Btn small onClick={onClose} aria-label={t('menu.close')}>
            ✕
          </Btn>
        </div>
        <div className={c.dialogBody}>{children}</div>
        {footer ? <div className={c.dialogFoot}>{footer}</div> : null}
      </div>
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  const c = useJoyaStyles();
  return (
    <div className={c.tabs} role="tablist">
      {tabs.map(([k, label]) => (
        <button key={k} type="button" role="tab" aria-selected={k === value} className={`${c.tab} ${k === value ? c.tabOn : ''}`} onClick={() => onChange(k)}>
          {label}
        </button>
      ))}
    </div>
  );
}

// The shell shows one banner for the whole screen; a page's own banner then stays hidden.
export const ShellDemoContext = createContext(false);

export function DemoBanner({ show = true }) {
  const c = useJoyaStyles();
  const { t } = useT();
  const shellShows = useContext(ShellDemoContext);
  if (!show || shellShows) return null;
  return <div className={c.demo}>⚠ {t('joya.demoBanner')}</div>;
}

/** "Source: … · Period: … · Missing: …" under a number box. */
export function SourceLine({ source, period, updated, missing }) {
  const c = useJoyaStyles();
  const { t } = useT();
  const parts = [];
  if (source) parts.push(<span key="s">{t('joya.source')}: <Term>{source}</Term></span>);
  if (period?.from) parts.push(<span key="p">{t('joya.period')}: <Term>{fmtDay(period.from)} – {fmtDay(period.to)}</Term></span>);
  if (updated) parts.push(<span key="u">{t('joya.updated')}: <Term>{fmtDay(updated)}</Term></span>);
  if (missing) parts.push(<span key="m" className={c.missing}>{missing}</span>);
  if (!parts.length) return null;
  return <div className={c.source}>{parts.reduce((acc, p, i) => (i ? [...acc, ' · ', p] : [p]), [])}</div>;
}

/** A value that may be unknown. null/undefined → "not known" — never 0. */
export function Val({ v, fmt, title }) {
  const c = useJoyaStyles();
  const { t } = useT();
  if (v == null || (typeof v === 'number' && !Number.isFinite(v))) {
    return (
      <span className={c.missing} title={title || t('joya.unknownTitle')}>
        {t('joya.unknown')}
      </span>
    );
  }
  return <Term>{fmt ? fmt(v) : String(v)}</Term>;
}

export function Loading() {
  const c = useJoyaStyles();
  const { t } = useT();
  return <div className={c.center}>{t('joya.loading')}</div>;
}
export function Empty({ children }) {
  const c = useJoyaStyles();
  return <div className={c.center}>{children}</div>;
}
export function ErrorBox({ error }) {
  const c = useJoyaStyles();
  const { t } = useT();
  if (!error) return null;
  const msg = error.status === 401 ? t('common.sessionExpiredSignIn') : error.code === 'NO_JOYA_ACCESS' ? t('joya.noAccess') : error.message || String(error);
  return (
    <div className={c.error} dir="auto">
      {msg}
      {error.details?.violations?.length ? (
        <ul style={{ margin: '0.3rem 0 0', paddingInlineStart: '1.1rem' }}>
          {error.details.violations.map((v, i) => (
            <li key={i}>
              <Term>{v.date}</Term> · {v.shiftCode} · {v.roleCode}: <Term>{v.planned} &lt; {v.minRequired}</Term>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function Details({ summary, children }) {
  const c = useJoyaStyles();
  return (
    <details className={c.details}>
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
export function Pre({ children }) {
  const c = useJoyaStyles();
  return <pre className={c.pre}>{typeof children === 'string' ? children : JSON.stringify(children, null, 2)}</pre>;
}

/** Load data; reload() re-runs. */
export function useLoad(fn, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const run = useCallback(() => {
    const my = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    return Promise.resolve()
      .then(fn)
      .then((data) => my === seq.current && setState({ data, error: null, loading: false }))
      .catch((error) => my === seq.current && setState({ data: null, error, loading: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    run();
  }, [run]);
  return { ...state, reload: run, setData: (d) => setState((s) => ({ ...s, data: typeof d === 'function' ? d(s.data) : d })) };
}

/** Run an action with busy/error state. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = useCallback(async (fn) => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, setError };
}

// ---------------------------------------------------------------- formatting
// Money in shekels with Latin digits. Each result is wrapped in Unicode left-to-right
// isolate marks (LRI … PDI), so a sign, ₪ or % stays in place even when the text goes
// into a translated Hebrew sentence as a plain string (where <Term> cannot be used).
const ltr = (s) => `\u2066${s}\u2069`;
export const fmtILS = (n) => (n == null ? '—' : ltr(`${Number(n) < 0 ? '-' : ''}₪${Math.abs(Math.round(Number(n))).toLocaleString('en-US')}`));
export const fmtNum = (n, d = 0) => (n == null ? '—' : ltr(Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 })));
export const fmtPctSigned = (n) => (n == null ? '—' : ltr(`${n > 0 ? '+' : ''}${Number(n).toFixed(1)}%`));
export const fmtPctPlain = (n) => (n == null ? '—' : ltr(`${Number(n).toFixed(1)}%`));
export function fmtDay(ymd) {
  if (!ymd) return '—';
  const d = new Date(String(ymd).slice(0, 10) + 'T12:00:00Z');
  return isNaN(d.getTime()) ? String(ymd) : d.toLocaleDateString(getLocale(), { day: 'numeric', month: 'numeric', year: '2-digit', timeZone: 'UTC' });
}
export function fmtWhen(v) {
  if (!v) return '—';
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toLocaleString(getLocale(), { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export const hhmm = (t) => (t ? String(t).slice(0, 5) : '—');
export const weekdayOf = (ymd) => new Date(String(ymd).slice(0, 10) + 'T00:00:00Z').getUTCDay();
export const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

/** Tone of a status word the API sends in English. */
export function statusTone(s) {
  return (
    {
      DRAFT: 'warn',
      APPROVED: 'info',
      ORDERED: 'ok',
      REJECTED: 'muted',
      OPEN: 'warn',
      IN_PROGRESS: 'info',
      DONE: 'ok',
      CANCELLED: 'muted',
      CORRECTED: 'ok',
      ACCEPTED: 'ok',
      DISMISSED: 'muted',
      NEW: 'warn',
      DRAFT_READY: 'info',
      RESPONDED: 'ok',
      CLOSED: 'muted',
      HIGH: 'bad',
      MEDIUM: 'warn',
      LOW: 'muted',
      INFO: 'muted',
    }[s] || 'muted'
  );
}
