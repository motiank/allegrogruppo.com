// The Beecomm update card of the System page (owner 2026-11-22: "add the update button to the Beecomm as well — to
// initiate the update process on the server"). The button starts the admin's nightly Beecomm loader on the server
// (src/services/beecommSync.js → the admin's /beecomm/sync/*); the card polls the state while it runs and shows the
// last runs and the last loaded business day. Nothing runs in the browser.
// Through the Joya extension (owner 2026-11-28, Beecomm refuses the server's address): a second button, shown in a Chrome
// with the extension (version 1.1+), asks the extension to fetch Beecomm's answers from THIS browser with a token the server
// mints; the server then loads them with the same loader (the run shows "via extension"). The progress comes as window
// messages with job 'beecomm', like the bank card.
import React from 'react';
import { createUseStyles, useTheme } from 'react-jss';
import { api } from './api.js';
import { useT } from './i18n/index.js';
import { Card, Btn, Badge, fmtWhen, fmtDay } from './ui.js';

const useStyles = createUseStyles((theme) => ({
  row: { display: 'flex', gap: '0.7rem', flexWrap: 'wrap', alignItems: 'center', fontSize: '0.86rem', marginBottom: '0.4rem' },
  note: { fontSize: '0.82rem', color: theme.textSecondary, margin: '0 0 0.5rem', lineHeight: 1.5 },
  prog: { fontSize: '0.88rem', margin: '0.3rem 0', fontWeight: 600 },
  last: { fontSize: '0.78rem', color: theme.textSecondary, fontFamily: 'monospace', direction: 'ltr', textAlign: 'start', whiteSpace: 'pre-wrap', wordBreak: 'break-all' },
  err: { color: '#f2a3a8', fontSize: '0.82rem' },
  list: { margin: '0.3rem 0 0', padding: 0, listStyle: 'none', fontSize: '0.82rem' },
  li: { display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center', padding: '0.2rem 0', borderTop: `1px solid ${theme.border}` },
  dim: { color: theme.textSecondary },
}));

const TONE = { running: 'warn', done: 'ok', failed: 'bad' };
const extVersion = () => document.documentElement.dataset.joyaExt || null;
// the Beecomm job came with extension 1.1
const extHasBeecomm = (v) => { const [a, b] = String(v || '0').split('.').map(Number); return a > 1 || (a === 1 && b >= 1); };

export default function BeecommUpdate({ onDone }) {
  const theme = useTheme();
  const c = useStyles(theme);
  const { t } = useT();
  const [state, setState] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const wasRunning = React.useRef(false);
  const [ext, setExt] = React.useState(extVersion());
  const [prog, setProg] = React.useState(null); // the extension's progress message (job beecomm)
  const [busyExt, setBusyExt] = React.useState(false);
  const heard = React.useRef(false);

  const load = React.useCallback(() => api('/beecomm/sync/state').then(setState).catch(setError), []);
  React.useEffect(() => {
    load();
  }, [load]);

  React.useEffect(() => {
    const on = (ev) => {
      if (ev.source !== window || ev.data?.source !== 'joya-ext') return;
      const m = ev.data;
      if (m.type === 'hello') return setExt(m.version || extVersion());
      if (m.type !== 'progress' || m.job !== 'beecomm') return;
      heard.current = true;
      setProg(m);
      if (m.phase === 'idle') return setBusyExt(false);
      if (m.phase === 'running') setBusyExt(true);
      if (['done', 'error', 'stopped'].includes(m.phase)) {
        setBusyExt(false);
        load();
        if (m.phase === 'done' && !m.nothingToDo) wasRunning.current = true; // the server's replay run follows; onDone fires when it ends
      }
    };
    window.addEventListener('message', on);
    window.postMessage({ source: 'joya-page', type: 'hello' }, window.location.origin);
    if (extVersion()) window.postMessage({ source: 'joya-page', type: 'status', job: 'beecomm' }, window.location.origin);
    return () => window.removeEventListener('message', on);
  }, [load]);

  const running = Boolean(state?.running);
  React.useEffect(() => {
    if (running) wasRunning.current = true;
    else if (wasRunning.current) {
      wasRunning.current = false;
      onDone?.();
    }
    if (!running) return undefined;
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [running, load, onDone]);

  const start = async () => {
    setError(null);
    setBusy(true);
    try {
      await api('/beecomm/sync/start', { method: 'POST', body: {} });
      await load();
    } catch (e) {
      setError(e);
      if (e?.code === 'CONFLICT') load();
    } finally {
      setBusy(false);
    }
  };

  const startExt = () => {
    setError(null);
    setProg(null);
    setBusyExt(true);
    heard.current = false;
    window.postMessage({ source: 'joya-page', type: 'start', job: 'beecomm' }, window.location.origin);
    setTimeout(() => {
      if (heard.current) return;
      setError(new Error(t('joya.beecommSync.ext.noAnswer')));
      setBusyExt(false);
    }, 6000);
  };
  const stopExt = () => window.postMessage({ source: 'joya-page', type: 'stop', job: 'beecomm' }, window.location.origin);
  const extLine = () => {
    if (!prog) return null;
    const key = `joya.beecommSync.ext.phase.${prog.phase}`;
    const s = t(key, { text: prog.text || '' });
    return s === key ? prog.text : s;
  };

  if (!state && !error) return null;
  const cur = state?.current;
  const viaExt = ext && extHasBeecomm(ext);
  const runLine = (r) => {
    if (r.state === 'running') return t('joya.beecommSync.running', { s: r.seconds });
    if (r.ok && r.nothingToDo) return t('joya.beecommSync.nothing');
    if (r.ok) return t('joya.beecommSync.doneDays', { from: r.dates?.from ? fmtDay(r.dates.from) : '?', to: r.dates?.to ? fmtDay(r.dates.to) : '?', s: r.seconds });
    return r.error || t('joya.beecommSync.state.failed');
  };
  return (
    <Card
      title={t('joya.beecommSync.title')}
      right={
        <>
          {viaExt ? (
            busyExt ? <Btn small onClick={stopExt}>{t('joya.beecommSync.ext.stop')}</Btn> : <Btn small kind={state?.disabled ? 'primary' : undefined} onClick={startExt} disabled={busy || running || state?.configured === false}>{t('joya.beecommSync.ext.button')}</Btn>
          ) : null}
          <Btn small kind={state?.disabled ? undefined : 'primary'} onClick={start} disabled={busy || busyExt || running || state?.configured === false || state?.disabled}>{running ? t('joya.beecommSync.busy') : t('joya.beecommSync.button')}</Btn>
        </>
      }
    >
      <div className={c.row}>
        {state?.loaded?.lastDay ? <span>{t('joya.beecommSync.loadedUpTo', { day: fmtDay(state.loaded.lastDay), when: state.loaded.loadedAt ? fmtWhen(state.loaded.loadedAt) : '' })}</span> : null}
        {state?.disabled ? <span className={c.err}>{t('joya.beecommSync.disabled')}</span> : state?.configured === false ? <span className={c.err}>{t('joya.beecommSync.notConfigured')}</span> : null}
      </div>
      {cur ? (
        <>
          <div className={c.prog} dir="auto">{runLine(cur)}</div>
          {cur.lastLine ? <div className={c.last}>{cur.lastLine}</div> : null}
        </>
      ) : null}
      {extLine() ? <div className={c.prog} dir="auto">{extLine()}</div> : null}
      {error ? <div className={c.err}>{String(error.message || error)}</div> : null}
      <p className={c.note}>{t(state?.disabled ? 'joya.beecommSync.hintDisabled' : 'joya.beecommSync.hint')}{viaExt ? ` ${t('joya.beecommSync.ext.hint')}` : ''}</p>
      {state?.runs?.length ? (
        <ul className={c.list}>
          {state.runs.slice(0, 4).map((r) => (
            <li key={r.id} className={c.li}>
              <span className={c.dim}>{fmtWhen(r.startedAt)}</span>
              {r.by ? <span className={c.dim}>{r.by}</span> : null}
              <Badge tone={TONE[r.state] || 'muted'}>{t(`joya.beecommSync.state.${r.state}`)}</Badge>
              {r.via === 'extension' ? <Badge tone="muted">{t('joya.beecommSync.viaExt')}</Badge> : null}
              <span dir="auto" className={r.state === 'failed' ? c.err : undefined}>{runLine(r)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
