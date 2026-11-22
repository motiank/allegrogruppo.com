// The Beecomm update card of the System page (owner 2026-11-22: "add the update button to the Beecomm as well — to
// initiate the update process on the server"). The button starts the admin's nightly Beecomm loader on the server
// (src/services/beecommSync.js → the admin's /beecomm/sync/*); the card polls the state while it runs and shows the
// last runs and the last loaded business day. Nothing runs in the browser.
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

export default function BeecommUpdate({ onDone }) {
  const theme = useTheme();
  const c = useStyles(theme);
  const { t } = useT();
  const [state, setState] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const wasRunning = React.useRef(false);

  const load = React.useCallback(() => api('/beecomm/sync/state').then(setState).catch(setError), []);
  React.useEffect(() => {
    load();
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

  if (!state && !error) return null;
  const cur = state?.current;
  const runLine = (r) => {
    if (r.state === 'running') return t('joya.beecommSync.running', { s: r.seconds });
    if (r.ok && r.nothingToDo) return t('joya.beecommSync.nothing');
    if (r.ok) return t('joya.beecommSync.doneDays', { from: r.dates?.from ? fmtDay(r.dates.from) : '?', to: r.dates?.to ? fmtDay(r.dates.to) : '?', s: r.seconds });
    return r.error || t('joya.beecommSync.state.failed');
  };
  return (
    <Card title={t('joya.beecommSync.title')} right={<Btn small kind="primary" onClick={start} disabled={busy || running || state?.configured === false}>{running ? t('joya.beecommSync.busy') : t('joya.beecommSync.button')}</Btn>}>
      <div className={c.row}>
        {state?.loaded?.lastDay ? <span>{t('joya.beecommSync.loadedUpTo', { day: fmtDay(state.loaded.lastDay), when: state.loaded.loadedAt ? fmtWhen(state.loaded.loadedAt) : '' })}</span> : null}
        {state?.configured === false ? <span className={c.err}>{t('joya.beecommSync.notConfigured')}</span> : null}
      </div>
      {cur ? (
        <>
          <div className={c.prog} dir="auto">{runLine(cur)}</div>
          {cur.lastLine ? <div className={c.last}>{cur.lastLine}</div> : null}
        </>
      ) : null}
      {error ? <div className={c.err}>{String(error.message || error)}</div> : null}
      <p className={c.note}>{t('joya.beecommSync.hint')}</p>
      {state?.runs?.length ? (
        <ul className={c.list}>
          {state.runs.slice(0, 4).map((r) => (
            <li key={r.id} className={c.li}>
              <span className={c.dim}>{fmtWhen(r.startedAt)}</span>
              {r.by ? <span className={c.dim}>{r.by}</span> : null}
              <Badge tone={TONE[r.state] || 'muted'}>{t(`joya.beecommSync.state.${r.state}`)}</Badge>
              <span dir="auto" className={r.state === 'failed' ? c.err : undefined}>{runLine(r)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
