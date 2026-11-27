// The bank update card of the System page (owner 2026-11-22: "update the bank data in the system the same way we have
// with the legal: click the button, it opens the login to the Poalim bank, downloads the missing bank data of the
// Allegro account and the Pasta Lina account and pushes it to the database — the transactions, the transfers, and the
// new cheque images"). The Joya browser extension (../../joya-extension) marks the page when it is installed; without it
// the card shows only while a run is open or as the last runs' state. Server side: src/services/bankSync.js.
import React from 'react';
import { createUseStyles, useTheme } from 'react-jss';
import { api } from './api.js';
import { useT } from './i18n/index.js';
import { Card, Btn, Badge, fmtWhen, fmtDay } from './ui.js';

const useStyles = createUseStyles((theme) => ({
  row: { display: 'flex', gap: '0.7rem', flexWrap: 'wrap', alignItems: 'center', fontSize: '0.86rem', marginBottom: '0.4rem' },
  note: { fontSize: '0.82rem', color: theme.textSecondary, margin: '0 0 0.5rem', lineHeight: 1.5 },
  prog: { fontSize: '0.88rem', margin: '0.3rem 0', fontWeight: 600 },
  err: { color: '#f2a3a8', fontSize: '0.82rem' },
  list: { margin: '0.3rem 0 0', padding: 0, listStyle: 'none', fontSize: '0.82rem' },
  li: { display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center', padding: '0.2rem 0', borderTop: `1px solid ${theme.border}` },
  dim: { color: theme.textSecondary },
  acc: { display: 'block', fontSize: '0.8rem', color: theme.textSecondary },
}));

const TONE = { open: 'warn', done: 'ok', failed: 'bad' };
const extVersion = () => document.documentElement.dataset.joyaExt || document.documentElement.dataset.joyaLegalExt || null;
const bankReady = () => Number(String(document.documentElement.dataset.joyaExt || '0').split('.')[0]) >= 1; // the bank part came with version 1.0

export default function BankUpdate() {
  const theme = useTheme();
  const c = useStyles(theme);
  const { t } = useT();
  const [ext, setExt] = React.useState(extVersion());
  const [state, setState] = React.useState(null);
  const [plan, setPlan] = React.useState(null);
  const [prog, setProg] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const heard = React.useRef(false); // a progress message came since the last start (else the page's extension link is dead)

  const load = React.useCallback(() => api('/bank/sync/state').then(setState).catch(() => {}), []);

  React.useEffect(() => {
    const on = (ev) => {
      if (ev.source !== window || ev.data?.source !== 'joya-ext') return;
      const m = ev.data;
      if (m.type === 'hello') return setExt(m.version || extVersion());
      if (m.type !== 'progress' || (m.job && m.job !== 'bank')) return;
      heard.current = true;
      setProg(m);
      if (m.phase === 'idle') return setBusy(false);
      if (['done', 'error', 'stopped'].includes(m.phase)) { setBusy(false); load(); }
      if (m.phase === 'running') setBusy(true);
    };
    window.addEventListener('message', on);
    window.postMessage({ source: 'joya-page', type: 'hello' }, window.location.origin);
    if (extVersion()) window.postMessage({ source: 'joya-page', type: 'status', job: 'bank' }, window.location.origin);
    load();
    return () => window.removeEventListener('message', on);
  }, [load]);

  const open = !!state?.open;
  React.useEffect(() => {
    if (!open && !busy) return undefined;
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, [open, busy, load]);

  const start = async () => {
    setError(null);
    setBusy(true);
    setProg(null);
    try {
      const p = await api('/bank/sync/plan');
      setPlan(p);
      const run = await api('/bank/sync/start', { method: 'POST', body: { plan: p } });
      heard.current = false;
      window.postMessage({ source: 'joya-page', type: 'start', job: 'bank', runId: run.id, plan: p }, window.location.origin);
      load();
      // the extension answers within a second; nothing after 6 s = the page's link to it is dead (2026-11-28: the owner
      // reloaded the extension and the open Joya page kept the old, dead connection — no bank tab opened, no message)
      setTimeout(() => {
        if (heard.current) return;
        setError(new Error(t('joya.bankSync.noAnswer')));
        setBusy(false);
        api(`/bank/sync/${run.id}/cancel`, { method: 'POST', body: { why: 'the extension did not answer' } }).then(load).catch(() => {});
      }, 6000);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  const stop = () => window.postMessage({ source: 'joya-page', type: 'stop', job: 'bank' }, window.location.origin);
  const cancel = (id) => api(`/bank/sync/${id}/cancel`, { method: 'POST', body: { why: 'cancelled by the user' } }).then(load).catch(setError);

  if (!state || (!ext && !open && !state.runs?.length)) return null;
  const canRun = ext && bankReady();
  const line = () => {
    if (!prog) return null;
    if (prog.phase === 'error' && /context invalidated/i.test(prog.text || '')) return t('joya.bankSync.noAnswer');
    if (prog.phase === 'done') {
      const s = t('joya.bankSync.phase.done', { rows: prog.summary?.newRows ?? 0, images: prog.summary?.images ?? 0, accounts: prog.summary?.accounts ?? 0 });
      // cheques the bank itself has no picture of — found in this run only (a placeholder keeps them out of the next runs)
      return prog.summary?.imagesEmpty ? `${s} · ${t('joya.bankSync.empty', { n: prog.summary.imagesEmpty })}` : s;
    }
    if (/tab was closed/.test(prog.text || '')) return t('joya.bankSync.tabClosed');
    const key = `joya.bankSync.phase.${prog.phase}`;
    const s = t(key, { text: prog.text || '' });
    return s === key ? prog.text : s;
  };
  const accLine = (a) =>
    t('joya.bankSync.account', { account: a.companyLabel || a.account, rows: a.newRows || 0, images: a.images || 0 }) +
    (a.imagesEmpty ? ` · ${t('joya.bankSync.empty', { n: a.imagesEmpty })}` : '') +
    (a.imageErrors ? ` · ${t('joya.bankSync.imageErrors', { n: a.imageErrors })}` : '');
  return (
    <Card
      title={t('joya.bankSync.title')}
      right={
        canRun ? (
          busy ? <Btn small onClick={stop}>{t('joya.bankSync.stop')}</Btn> : <Btn small kind="primary" onClick={start} disabled={open}>{t('joya.bankSync.button')}</Btn>
        ) : null
      }
    >
      {ext && !canRun ? <div className={c.err}>{t('joya.bankSync.oldExt', { version: ext })}</div> : null}
      {plan?.accounts?.length && busy ? (
        <div className={c.row}>
          {plan.accounts.map((a) => (
            <Badge key={a.account} tone="muted" title={a.account}>{a.companyLabel || a.account}: {a.lastDay ? t('joya.bankSync.fromDay', { day: fmtDay(a.from) }) : t('joya.bankSync.fromStart')}</Badge>
          ))}
        </div>
      ) : null}
      {line() ? <div className={c.prog} dir="auto">{line()}</div> : null}
      {prog?.summary?.failed?.length ? <div className={c.err}>{t('joya.bankSync.failed', { n: prog.summary.failed.length, first: prog.summary.failed[0] })}</div> : null}
      {error ? <div className={c.err}>{String(error.message || error)}</div> : null}
      {canRun ? <p className={c.note}>{t('joya.bankSync.hint')}</p> : null}
      {state.runs?.length ? (
        <ul className={c.list}>
          {state.runs.slice(0, 4).map((r) => (
            <li key={r.id} className={c.li}>
              <span className={c.dim}>{fmtWhen(r.startedAt)}</span>
              {r.by ? <span className={c.dim}>{r.by}</span> : null}
              <Badge tone={TONE[r.state] || 'muted'}>{t(`joya.bankSync.state.${r.state}`)}</Badge>
              <span>
                {r.accounts?.map((a) => <span key={a.account} className={c.acc} dir="auto">{accLine(a)}</span>)}
              </span>
              {r.step ? <span className={c.dim} dir="auto">{r.step}</span> : null}
              {r.error ? <span className={c.err} dir="auto">{r.error}</span> : null}
              {r.state === 'open' && !busy ? <Btn small onClick={() => cancel(r.id)}>{t('joya.bankSync.cancel')}</Btn> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
