// Ask in words — about the data, a list, a plan or a review — and see where every
// number came from. A proposed change (add a waiter, change a quantity, a reply
// draft) is shown as a preview and saved only when the user taps Apply.
//
// The answer is written by the AI runner (hq/runner) from calculations the hub
// ran with this user's access; those calculations are listed under the answer.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createUseStyles, useTheme } from 'react-jss';
import { api, qs } from './api.js';
import { useT, Term } from './i18n/index.js';
import { Btn, Badge, Details, Pre, ErrorBox, fmtWhen, TextArea, SourceLine } from './ui.js';
import { useJoya } from './context.js';

const useStyles = createUseStyles((theme) => ({
  box: { border: `1px solid ${theme.border}`, borderRadius: 10, padding: '0.7rem 0.85rem', background: theme.surface, marginBottom: '0.7rem' },
  head: { fontSize: '0.88rem', fontWeight: 650, marginBottom: '0.45rem' },
  q: { fontSize: '0.84rem', fontWeight: 600, marginTop: '0.6rem' },
  a: { fontSize: '0.86rem', lineHeight: 1.55, whiteSpace: 'pre-wrap', marginTop: '0.25rem' },
  meta: { fontSize: '0.7rem', color: theme.textSecondary, marginTop: '0.15rem' },
  warn: { fontSize: '0.75rem', color: '#d29922', marginTop: '0.3rem' },
  prop: { border: `1px dashed ${theme.primary}`, borderRadius: 8, padding: '0.5rem 0.6rem', marginTop: '0.45rem', fontSize: '0.8rem' },
  propLine: { padding: '0.12rem 0' },
  form: { display: 'flex', gap: '0.45rem', alignItems: 'flex-end', marginTop: '0.4rem' },
  examples: { display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginTop: '0.35rem' },
  chip: { fontSize: '0.72rem', border: `1px solid ${theme.border}`, borderRadius: 999, padding: '0.15rem 0.5rem', background: 'none', color: theme.textSecondary, cursor: 'pointer', fontFamily: 'inherit' },
  thinking: { fontSize: '0.8rem', color: theme.textSecondary, marginTop: '0.3rem' },
  suggest: { border: `1px solid ${theme.border}`, borderRadius: 8, marginTop: '0.3rem', overflow: 'hidden' },
  suggestItem: {
    display: 'block',
    width: '100%',
    textAlign: 'start',
    padding: '0.4rem 0.6rem',
    fontSize: '0.8rem',
    background: 'none',
    border: 0,
    borderTop: `1px solid ${theme.border}`,
    color: theme.text,
    cursor: 'pointer',
    fontFamily: 'inherit',
    '&:first-child': { borderTop: 0 },
    '&:hover': { background: 'rgba(127,127,127,0.12)' },
  },
}));

// words of 2+ letters, lower case (Hebrew has no case; the prefixes ה/ו/ב/ל still match as part of a word)
const words = (s) => String(s).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);

/** Up to 5 suggestions that share the most words with what is typed (a typed word may be a word's start). */
function matchSuggestions(text, pool) {
  const typed = words(text);
  if (!typed.length) return [];
  const t = text.trim().toLowerCase();
  return pool
    .map((s) => {
      const ws = words(s);
      const score = typed.filter((w) => ws.some((x) => x.includes(w))).length;
      return { s, score };
    })
    .filter((x) => x.score > 0 && x.s.toLowerCase() !== t)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((x) => x.s);
}

function ProposalPreview({ p, classes }) {
  const { t } = useT();
  const { roleName } = useJoya();
  if (!p) return null;
  const lines = p.preview || [];
  return (
    <>
      {p.note ? <div className={classes.meta}>{t('joya.ask.whatIfNote')}</div> : null}
      {lines.map((o, i) => (
        <div key={i} className={classes.propLine}>
          {p.type === 'ORDER_OPS' ? (
            <>
              {t(`joya.ask.op.${o.op}`)} <bdi dir="auto">{o.name}</bdi>
              {o.qty != null ? (
                <>
                  {' '}
                  <Term>{o.before != null ? `${o.before} → ` : ''}{o.qty}{o.unit ? ` ${o.unit}` : ''}</Term>
                </>
              ) : null}
            </>
          ) : (
            <>
              {t(`joya.ask.op.${o.op}`)} <Term>{o.date}</Term> · {o.shiftCode} · {roleName(o.roleCode)}{' '}
              {o.headcount != null ? <Term>{o.before?.headcount != null || typeof o.before === 'number' ? `${o.before?.headcount ?? o.before} → ` : ''}{o.headcount}</Term> : null}
              {o.start ? <Term> {String(o.start).slice(0, 5)}–{String(o.end).slice(0, 5)}</Term> : null}
            </>
          )}
        </div>
      ))}
    </>
  );
}

function Answer({ r, classes, onChanged }) {
  const { t } = useT();
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const act = async (what) => {
    setBusy(true);
    setErr(null);
    try {
      const out = await api(`/ai/requests/${r.id}/${what}`, { method: 'POST', body: {} });
      onChanged?.(what, out);
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };
  const unverified = r.meta?.unverifiedNumbers || [];
  return (
    <div>
      <div className={classes.q} dir="auto">
        {r.question}
      </div>
      <div className={classes.meta}>
        <Term>{fmtWhen(r.createdAt)}</Term>
      </div>
      {r.status === 'THINKING' && <div className={classes.thinking}>{t('joya.ask.thinking')}</div>}
      {r.status === 'FAILED' && <ErrorBox error={{ message: `${t('joya.ask.failed')} ${r.error ? `(${r.error})` : ''}` }} />}
      {r.status === 'ANSWERED' && (
        <>
          <div className={classes.a} dir="auto">
            {r.answer}
          </div>
          {unverified.length ? (
            <div className={classes.warn}>
              ⚠ {t('joya.ask.unverified')} <Term>{unverified.join(', ')}</Term>
            </div>
          ) : null}
        </>
      )}
      {r.calcs?.length ? (
        <Details summary={t('joya.ask.howCalculated', { count: r.calcs.length })}>
          {r.calcs.map((c, i) => (
            <div key={i} style={{ marginTop: '0.35rem' }}>
              <Badge tone={c.error ? 'bad' : 'info'}>
                <Term>{c.calc}</Term>
              </Badge>
              {c.result ? <SourceLine source={c.result.source || Object.values(c.result.sources || {}).join(' · ')} period={c.result.period} /> : null}
              {c.error ? <div className={classes.warn}>{c.error}</div> : null}
              <Details summary={t('joya.ask.rawNumbers')}>
                <Pre>{{ params: c.params, result: c.result }}</Pre>
              </Details>
            </div>
          ))}
        </Details>
      ) : null}
      {r.proposal && (
        <div className={classes.prop}>
          <div style={{ fontWeight: 650, marginBottom: '0.25rem' }}>
            {t('joya.ask.proposal')}{' '}
            {r.proposalStatus !== 'PENDING' ? <Badge tone={r.proposalStatus === 'APPLIED' ? 'ok' : 'muted'}>{t(`joya.ask.ps.${r.proposalStatus}`)}</Badge> : null}
          </div>
          <ProposalPreview p={r.proposal} classes={classes} />
          {r.proposalStatus === 'PENDING' && r.status === 'ANSWERED' && (
            <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.45rem' }}>
              <Btn kind="primary" small disabled={busy} onClick={() => act('apply')}>
                {t('joya.ask.apply')}
              </Btn>
              <Btn small disabled={busy} onClick={() => act('discard')}>
                {t('joya.ask.discard')}
              </Btn>
            </div>
          )}
          <ErrorBox error={err} />
        </div>
      )}
    </div>
  );
}

/**
 * @param {object} p
 * @param {'GENERAL'|'ORDER_LIST'|'STAFFING_PLAN'|'AREA'} p.contextKind
 * @param {number} [p.contextId]
 * @param {number} [p.locationId]
 * @param {string[]} [p.examples]   example questions (translated), shown as buttons
 * @param {string[]} [p.suggestions]  questions suggested while typing (with the user's own past questions)
 * @param {(what, out) => void} [p.onApplied]  called after Apply (reload the page data)
 */
export default function AskBox({ contextKind = 'GENERAL', contextId = null, locationId = null, examples = [], suggestions = [], title, onApplied, limit = 5 }) {
  const theme = useTheme();
  const classes = useStyles(theme);
  const { t, lang } = useT();
  const [items, setItems] = useState([]);
  const [text, setText] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);
  const input = useRef(null);
  const pool = useMemo(() => [...new Set([...suggestions, ...examples, ...items.map((r) => r.question)])], [suggestions, examples, items]);
  const matches = useMemo(() => (suggestions.length ? matchSuggestions(text, pool) : []), [text, pool, suggestions.length]);
  const pick = (s) => {
    setText(s);
    input.current?.focus();
  };

  const load = () =>
    api(`/ai/requests${qs({ contextKind, contextId, limit })}`)
      .then((d) => setItems(d.requests))
      .catch(setErr);
  useEffect(() => {
    load();
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextKind, contextId]);

  // poll while something is still being answered
  useEffect(() => {
    clearTimeout(timer.current);
    if (items.some((r) => r.status === 'THINKING')) timer.current = setTimeout(load, 3000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const send = async (q) => {
    const question = (q ?? text).trim();
    if (!question) return;
    setBusy(true);
    setErr(null);
    try {
      const { request } = await api('/ai/ask', { method: 'POST', body: { question, contextKind, contextId, locationId, lang } });
      setItems((xs) => [request, ...xs]);
      setText('');
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={classes.box}>
      <div className={classes.head}>{title || t('joya.ask.title')}</div>
      <div className={classes.form}>
        <div style={{ flex: 1 }}>
          <TextArea ref={input} rows={2} value={text} placeholder={t('joya.ask.placeholder')} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && send()} />
        </div>
        <Btn kind="primary" disabled={busy || !text.trim()} onClick={() => send()}>
          {t('joya.ask.send')}
        </Btn>
      </div>
      {matches.length ? (
        <div className={classes.suggest} role="listbox" aria-label={t('joya.ask.suggestions')}>
          {matches.map((s) => (
            <button key={s} type="button" role="option" aria-selected={false} className={classes.suggestItem} onClick={() => pick(s)} dir="auto">
              {s}
            </button>
          ))}
        </div>
      ) : null}
      {examples.length && !text.trim() ? (
        <div className={classes.examples}>
          {examples.map((x) => (
            <button key={x} type="button" className={classes.chip} onClick={() => send(x)} disabled={busy}>
              {x}
            </button>
          ))}
        </div>
      ) : null}
      <div className={classes.meta} style={{ marginTop: '0.4rem' }}>
        {t('joya.ask.howItWorks')}
      </div>
      <ErrorBox error={err} />
      {items.map((r) => (
        <Answer
          key={r.id}
          r={r}
          classes={classes}
          onChanged={(what) => {
            load();
            if (what === 'apply') onApplied?.();
          }}
        />
      ))}
    </div>
  );
}
