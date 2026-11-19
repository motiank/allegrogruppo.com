// The legal update card of the System page (owner 2026-11-19: "the initiation will be from the update (legal) button
// on the system page; display it only if it is possible to do it — run on a computer and have the chrome extension
// installed"). The Joya Legal extension (../../legal-extension) marks the page when it is installed; a phone's Chrome
// cannot hold an extension, so the button never shows there. Without the extension the card shows only while an
// update is still being processed, as a status line. Server side: src/services/legalSync.js.
import React from 'react';
import { createUseStyles, useTheme } from 'react-jss';
import { api, qs } from './api.js';
import { useT } from './i18n/index.js';
import { Card, Btn, Badge, fmtWhen } from './ui.js';

const useStyles = createUseStyles((theme) => ({
  row: { display: 'flex', gap: '0.7rem', flexWrap: 'wrap', alignItems: 'center', fontSize: '0.86rem', marginBottom: '0.4rem' },
  note: { fontSize: '0.82rem', color: theme.textSecondary, margin: '0 0 0.5rem', lineHeight: 1.5 },
  sel: { background: 'transparent', color: 'inherit', border: `1px solid ${theme.border}`, borderRadius: 6, padding: '0.2rem 0.4rem', font: 'inherit' },
  prog: { fontSize: '0.88rem', margin: '0.3rem 0', fontWeight: 600 },
  err: { color: '#f2a3a8', fontSize: '0.82rem' },
  list: { margin: '0.3rem 0 0', padding: 0, listStyle: 'none', fontSize: '0.82rem' },
  li: { display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center', padding: '0.2rem 0', borderTop: `1px solid ${theme.border}` },
  dim: { color: theme.textSecondary },
}));

const TONE = { open: 'warn', ready: 'warn', taken: 'warn', done: 'ok', failed: 'bad' };
const ACTIVE = ['open', 'ready', 'taken'];
const extVersion = () => document.documentElement.dataset.joyaLegalExt || null;

export default function LegalUpdate() {
  const theme = useTheme();
  const c = useStyles(theme);
  const { t } = useT();
  const [ext, setExt] = React.useState(extVersion());
  const [state, setState] = React.useState(null);
  const [person, setPerson] = React.useState('');
  const [prog, setProg] = React.useState(null); // the extension's last message
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);

  const load = React.useCallback(() => api('/legal/sync/state').then((s) => { setState(s); setPerson((p) => p || s.mine || s.people?.[0] || ''); }).catch(() => {}), []);

  React.useEffect(() => {
    const on = (ev) => {
      if (ev.source !== window || ev.data?.source !== 'joya-ext') return;
      const m = ev.data;
      if (m.type === 'hello') return setExt(m.version || extVersion());
      if (m.type !== 'progress') return;
      setProg(m);
      if (['done', 'error', 'stopped'].includes(m.phase)) { setBusy(false); load(); }
      if (m.phase === 'running') setBusy(true);
    };
    window.addEventListener('message', on);
    window.postMessage({ source: 'joya-page', type: 'hello' }, window.location.origin);
    if (extVersion()) window.postMessage({ source: 'joya-page', type: 'status' }, window.location.origin);
    load();
    return () => window.removeEventListener('message', on);
  }, [load]);

  const active = (state?.batches || []).some((b) => ACTIVE.includes(b.state));
  React.useEffect(() => {
    if (!active && !busy) return undefined;
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [active, busy, load]);

  const start = async () => {
    setError(null);
    setBusy(true);
    setProg(null);
    try {
      const plan = await api(`/legal/sync/plan${qs({ person })}`);
      const batch = await api('/legal/sync/start', { method: 'POST', body: { person } });
      window.postMessage({ source: 'joya-page', type: 'start', person, batchId: batch.id, plan }, window.location.origin);
      load();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  const stop = () => window.postMessage({ source: 'joya-page', type: 'stop' }, window.location.origin);

  if (!state || (!ext && !active)) return null;
  const line = () => {
    if (!prog) return null;
    if (prog.phase === 'done') return t('joya.legalSync.phase.done', { cases: prog.summary?.casesChecked ?? 0, papers: prog.summary?.newPapers ?? 0 });
    const key = `joya.legalSync.phase.${prog.phase}`;
    const s = t(key, { text: prog.text || '' });
    return s === key ? prog.text : s;
  };
  const fails = prog?.summary ? (prog.summary.failedCases?.length || 0) + (prog.summary.failedPapers?.length || 0) : 0;
  return (
    <Card
      title={t('joya.legalSync.title')}
      right={
        ext ? (
          busy ? <Btn small onClick={stop}>{t('joya.legalSync.stop')}</Btn> : <Btn small kind="primary" onClick={start} disabled={!person || active}>{t('joya.legalSync.button')}</Btn>
        ) : null
      }
    >
      {ext ? (
        <div className={c.row}>
          {state.people?.length > 1 ? (
            <label>
              {t('joya.legalSync.person')}{' '}
              <select className={c.sel} value={person} onChange={(e) => setPerson(e.target.value)} disabled={busy}>
                {state.people.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
          ) : null}
          <Badge tone={state.agent?.online ? 'ok' : 'warn'} title={state.agent?.lastSeen ? fmtWhen(state.agent.lastSeen) : undefined}>
            {t(state.agent?.online ? 'joya.legalSync.agentOn' : 'joya.legalSync.agentOff')}
          </Badge>
        </div>
      ) : null}
      {line() ? <div className={c.prog} dir="auto">{line()}</div> : null}
      {fails ? <div className={c.err}>{t('joya.legalSync.failed', { cases: prog.summary.failedCases?.length || 0, papers: prog.summary.failedPapers?.length || 0 })}</div> : null}
      {error ? <div className={c.err}>{String(error.message || error)}</div> : null}
      {ext ? <p className={c.note}>{t('joya.legalSync.hint')}</p> : null}
      {state.batches?.length ? (
        <ul className={c.list}>
          {state.batches.slice(0, 4).map((b) => (
            <li key={b.id} className={c.li}>
              <span className={c.dim}>{fmtWhen(b.startedAt)}</span>
              <span>{b.person}</span>
              <Badge tone={TONE[b.state] || 'muted'}>{t(`joya.legalSync.state.${b.state}`)}</Badge>
              <span>{b.result?.nothingNew ? t('joya.legalSync.nothing') : t('joya.legalSync.row', { papers: b.files, cases: b.cases })}</span>
              {b.step ? <span className={c.dim} dir="auto">{b.step}</span> : null}
              {b.error ? <span className={c.err} dir="auto">{b.error}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
