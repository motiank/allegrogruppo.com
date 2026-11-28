// The bank lines page (owner 2026-11-28: "create a bank page with the ability to filter by name (details), type of action and
// an extended date filter; add a total to the in and out columns when filtered; a small 📷 icon in the details column, as on the
// bank reconciliation page"). Data: GET /api/joya/bank/lines (src/services/bank.js bankLines → the admin's stored bank rows of
// the window; filters and totals in lib/bankLines.js). The table is ui.js DataTable (wraps; a card list on a phone). The 📷
// opens the scanned cheque (client/ChequeCards.js ChequeThumb, icon mode). The filters live in the URL, so a view can be shared.
import React, { useEffect, useMemo, useState } from 'react';
import { createUseStyles, useTheme } from 'react-jss';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useT, Term } from '../i18n/index.js';
import { Page, Card, Btn, Badge, Select, Input, Loading, Empty, ErrorBox, DataTable, useLoad, fmtILS, fmtDay } from '../ui.js';
import { ChequeThumb } from '../ChequeCards.js';

const useStyles = createUseStyles((theme) => ({
  bar: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.5rem' },
  presets: { display: 'flex', gap: '0.3rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.6rem' },
  q: { flex: '1 1 220px', minWidth: 0 },
  date: { width: 'auto', flex: '0 1 150px' },
  sel: { flex: '0 1 230px', minWidth: 160, '& select': { width: '100%' } },
  sum: { display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.86rem', margin: '0 0 0.5rem', alignItems: 'center' },
  sumVal: { fontWeight: 650 },
  in: { color: '#3fb950' },
  out: { color: '#f2a3a8' },
  dim: { color: theme.textSecondary, fontSize: '0.78rem' },
  payee: { display: 'block', color: theme.textSecondary, fontSize: '0.76rem' },
  num: { whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  foot: { fontWeight: 700 },
}));

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const monthStart = (d = new Date()) => ymd(new Date(d.getFullYear(), d.getMonth(), 1));
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The preset windows: key → [from, to] (today's date decides). */
function presetWindow(key) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (key) {
    case 'month': return [monthStart(now), today()];
    case 'lastMonth': return [ymd(new Date(y, m - 1, 1)), ymd(new Date(y, m, 0))];
    case 'months3': return [ymd(new Date(y, m - 2, 1)), today()];
    case 'year': return [`${y}-01-01`, today()];
    case 'lastYear': return [`${y - 1}-01-01`, `${y - 1}-12-31`];
    case 'all': return ['2024-01-01', today()];
    default: return null;
  }
}
const PRESETS = ['month', 'lastMonth', 'months3', 'year', 'lastYear', 'all'];

export default function BankLines() {
  const theme = useTheme();
  const c = useStyles(theme);
  const { t, dir } = useT();
  const [sp, setSp] = useSearchParams();
  const from = DAY.test(sp.get('from') || '') ? sp.get('from') : monthStart();
  const to = DAY.test(sp.get('to') || '') ? sp.get('to') : today();
  const q = sp.get('q') || '';
  const action = sp.get('action') || '';
  const side = ['in', 'out'].includes(sp.get('side')) ? sp.get('side') : '';
  const company = sp.get('company') || '';
  const set = (patch) => {
    const next = { company, from, to, q, action, side, ...patch };
    setSp(Object.fromEntries(Object.entries(next).filter(([, v]) => v)));
  };
  // the text box waits 400 ms before it filters (the rows come from the server)
  const [text, setText] = useState(q);
  useEffect(() => setText(q), [q]);
  useEffect(() => {
    if (text === q) return undefined;
    const id = setTimeout(() => set({ q: text }), 400);
    return () => clearTimeout(id);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  const r = useLoad(() => api(`/bank/lines${qs({ company: company || undefined, from, to, q: q || undefined, action: action || undefined, side: side || undefined })}`), [company, from, to, q, action, side]);
  const d = r.data;
  const filtered = Boolean(q || action || side);
  const preset = PRESETS.find((k) => { const w = presetWindow(k); return w && w[0] === from && w[1] === to; }) || null;
  const payeeLine = (x) => {
    const name = x.payee || x.event?.payee || null;
    if (!name) return null;
    const role = x.payeeRole === 'from' ? t('joya.bl.from') : x.payeeSource === 'bank_file' || x.event ? t('joya.bl.to') : '';
    return `${role ? role + ' ' : ''}${name}${x.payeeSource === 'image_guess' ? ' ?' : ''}${x.payeePurpose ? ` · ${x.payeePurpose}` : ''}`;
  };
  const rows = useMemo(() => (d?.rows || []).map((x, i) => ({
    key: `${x.date}-${x.reference}-${i}`,
    cells: [
      { node: <Term>{fmtDay(x.date)}</Term>, num: true },
      { node: x.action || '—' },
      { node: <>{x.details || ''}{x.imageId ? <> <ChequeThumb row={x} icon /></> : null}{payeeLine(x) ? <span className={c.payee} dir="auto">{payeeLine(x)}</span> : null}</> },
      { node: x.reference ? <Term>{x.reference}</Term> : '', num: true },
      { node: x.moneyIn ? <span className={c.in}>{fmtILS(x.moneyIn)}</span> : '', num: true },
      { node: x.moneyOut ? <span className={c.out}>{fmtILS(x.moneyOut)}</span> : '', num: true },
      { node: x.balance != null ? fmtILS(x.balance) : '', num: true },
    ],
  })), [d, c, t]); // eslint-disable-line react-hooks/exhaustive-deps
  const tot = d?.totals;
  const foot = tot ? {
    className: c.foot,
    cells: [
      { node: filtered ? t('joya.bl.totalFiltered', { n: tot.count }) : t('joya.bl.total', { n: tot.count }) },
      { node: '' },
      { node: d.shown < d.count ? <span className={c.dim}>{t('joya.bl.shownOf', { shown: d.shown, n: d.count })}</span> : '' },
      { node: '' },
      { node: <span className={c.in}>{fmtILS(tot.moneyIn)}</span>, num: true },
      { node: <span className={c.out}>{fmtILS(tot.moneyOut)}</span>, num: true },
      { node: <span title={t('joya.bl.net')}>{fmtILS(tot.net)}</span>, num: true },
    ],
  } : null;
  return (
    <Page
      title={t('joya.bl.title')}
      sub={d?.company ? t('joya.bl.sub', { company: d.company.label, accounts: (d.accounts || []).map((a) => a.account || a).join(', ') || '—' }) : null}
      actions={d?.companies?.length > 1 ? (
        <Select value={d.company?.key || ''} onChange={(e) => set({ company: e.target.value })} aria-label={t('joya.bl.company')}>
          {d.companies.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
        </Select>
      ) : null}
    >
      <div className={c.presets}>
        {PRESETS.map((k) => {
          const w = presetWindow(k);
          return <Btn key={k} small kind={preset === k ? 'primary' : 'default'} onClick={() => set({ from: w[0], to: w[1] })}>{t(`joya.bl.preset.${k}`)}</Btn>;
        })}
      </div>
      <div className={c.bar}>
        <Input className={c.date} type="date" value={from} max={to} onChange={(e) => e.target.value && set({ from: e.target.value })} aria-label={t('joya.bl.fromDay')} />
        <Input className={c.date} type="date" value={to} min={from} onChange={(e) => e.target.value && set({ to: e.target.value })} aria-label={t('joya.bl.toDay')} />
        <Input className={c.q} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('joya.bl.search')} dir="auto" aria-label={t('joya.bl.search')} />
        <span className={c.sel}>
          <Select value={action} onChange={(e) => set({ action: e.target.value })} aria-label={t('joya.bl.action')}>
            <option value="">{t('joya.bl.allActions')}</option>
            {(d?.actions || []).map((a) => <option key={a.action} value={a.action}>{a.action} ({a.count})</option>)}
          </Select>
        </span>
        <span className={c.sel}>
          <Select value={side} onChange={(e) => set({ side: e.target.value })} aria-label={t('joya.bl.side')}>
            <option value="">{t('joya.bl.side.all')}</option>
            <option value="in">{t('joya.bl.side.in')}</option>
            <option value="out">{t('joya.bl.side.out')}</option>
          </Select>
        </span>
        {filtered ? <Btn small onClick={() => set({ q: '', action: '', side: '' })}>{t('joya.bl.clear')}</Btn> : null}
      </div>
      {r.loading && !d ? <Loading /> : null}
      {r.error ? <ErrorBox error={r.error} /> : null}
      {d && !d.available ? <Empty>{t('joya.bl.notAvailable', { reason: d.reason })}</Empty> : null}
      {d?.available ? (
        <>
          <div className={c.sum}>
            <span>{t('joya.bl.rows')}: <span className={c.sumVal}>{tot.count.toLocaleString('en-US')}</span>{filtered && d.windowTotals ? <span className={c.dim}> / {d.windowTotals.count.toLocaleString('en-US')}</span> : null}</span>
            <span>{t('joya.bl.in')}: <span className={`${c.sumVal} ${c.in}`}>{fmtILS(tot.moneyIn)}</span></span>
            <span>{t('joya.bl.out')}: <span className={`${c.sumVal} ${c.out}`}>{fmtILS(tot.moneyOut)}</span></span>
            <span>{t('joya.bl.net')}: <span className={c.sumVal}>{fmtILS(tot.net)}</span></span>
            {filtered ? <Badge tone="info">{t('joya.bl.filtered')}</Badge> : null}
          </div>
          <Card>
            {!rows.length ? <Empty>{t('joya.bl.empty')}</Empty> : <DataTable dir={dir} head={[t('joya.bl.col.date'), t('joya.bl.col.action'), t('joya.bl.col.details'), t('joya.bl.col.reference'), t('joya.bl.col.in'), t('joya.bl.col.out'), t('joya.bl.col.balance')]} rows={rows} foot={foot} />}
          </Card>
        </>
      ) : null}
    </Page>
  );
}
