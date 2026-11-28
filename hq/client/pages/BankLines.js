// The bank lines page (owner 2026-11-28: "a bank page with the ability to filter by name (details), type of action and an
// extended date filter; add a total to the in and out columns when filtered; a small 📷 icon in the details column, as on the
// bank reconciliation page" — then: "the filter in the table head like we did on bank recon, on the date, action and details
// name; remove the current filter"). Data: GET /api/joya/bank/lines?company&from&to (src/services/bank.js bankLines → every
// stored bank row of the window). The filters are in the column headers (client/HeadFilter.js): the date = preset windows and
// two pickers (the window is read again), the action type and the name = checkbox lists with counts, filtered in the browser
// (lib/bankLines.js). The table is ui.js DataTable (wraps; a card list on a phone — then the three filters sit above the cards).
// The 📷 opens the scanned cheque (client/ChequeCards.js ChequeThumb, icon mode). The window and the picks live in the URL.
import React, { useMemo, useState } from 'react';
import { createUseStyles, useTheme } from 'react-jss';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useT, Term } from '../i18n/index.js';
import { Page, Card, Btn, Badge, Select, Loading, Empty, ErrorBox, DataTable, useLoad, fmtILS, fmtDay } from '../ui.js';
import { ChequeThumb } from '../ChequeCards.js';
import { HeadFilter, DateHeadFilter } from '../HeadFilter.js';
import { totalsOf, actionFacets, nameFacets, filterLines, actionKey, nameKey } from '../../lib/bankLines.js';

const useStyles = createUseStyles((theme) => ({
  sum: { display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.86rem', margin: '0 0 0.5rem', alignItems: 'center' },
  sumVal: { fontWeight: 650 },
  in: { color: '#3fb950' },
  out: { color: '#f2a3a8' },
  dim: { color: theme.textSecondary, fontSize: '0.78rem' },
  payee: { display: 'block', color: theme.textSecondary, fontSize: '0.76rem' },
  foot: { fontWeight: 700 },
  cardsBar: { display: 'flex', gap: '0.9rem', flexWrap: 'wrap', alignItems: 'center', padding: '0.4rem 0.6rem', fontSize: '0.82rem', fontWeight: 650 },
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
const SEP = '|';
const setParam = (v) => (v ? v.split(SEP).filter(Boolean) : []);

export default function BankLines() {
  const theme = useTheme();
  const c = useStyles(theme);
  const { t, dir } = useT();
  const [sp, setSp] = useSearchParams();
  const from = DAY.test(sp.get('from') || '') ? sp.get('from') : monthStart();
  const to = DAY.test(sp.get('to') || '') ? sp.get('to') : today();
  const company = sp.get('company') || '';
  const actions = useMemo(() => new Set(setParam(sp.get('actions'))), [sp]);
  const names = useMemo(() => new Set(setParam(sp.get('names'))), [sp]);
  const set = (patch) => {
    const next = { company, from, to, actions: [...actions].join(SEP), names: [...names].join(SEP), ...patch };
    setSp(Object.fromEntries(Object.entries(next).filter(([, v]) => v)));
  };
  const [cards, setCards] = useState(false);
  const r = useLoad(() => api(`/bank/lines${qs({ company: company || undefined, from, to })}`), [company, from, to]);
  const d = r.data;
  const all = d?.rows || [];
  // the facets are counted over the window (so a picker shows every value while another column is filtered)
  const actionOptions = useMemo(() => actionFacets(all).map((f) => ({ value: f.action, count: f.count })), [all]);
  const nameOptions = useMemo(() => nameFacets(all).map((f) => ({ value: f.name, count: f.count })), [all]);
  const shown = useMemo(() => filterLines(all, { actions, names }), [all, actions, names]);
  const tot = useMemo(() => totalsOf(shown), [shown]);
  const windowTot = d?.windowTotals || totalsOf(all);
  const filtered = actions.size > 0 || names.size > 0;
  const presetKey = PRESETS.find((k) => { const w = presetWindow(k); return w && w[0] === from && w[1] === to; }) || null;
  const payeeLine = (x) => {
    const name = x.payee || x.event?.payee || null;
    if (!name) return null;
    const role = x.payeeRole === 'from' ? t('joya.bl.from') : x.payeeSource === 'bank_file' || x.event ? t('joya.bl.to') : '';
    return `${role ? role + ' ' : ''}${name}${x.payeeSource === 'image_guess' ? ' ?' : ''}${x.payeePurpose ? ` · ${x.payeePurpose}` : ''}`;
  };
  const dateFilter = <DateHeadFilter label={t('joya.bl.col.date')} value={{ from, to }} presets={PRESETS.map((k) => { const w = presetWindow(k); return { key: k, label: t(`joya.bl.preset.${k}`), from: w[0], to: w[1] }; })} activeKey={presetKey} isDefault={presetKey === 'month'} onChange={(w) => set({ from: w.from, to: w.to })} />;
  const actionFilter = <HeadFilter label={t('joya.bl.col.action')} options={actionOptions} selected={actions.size ? actions : null} onChange={(s) => set({ actions: s ? [...s].join(SEP) : '' })} />;
  const nameFilter = <HeadFilter label={t('joya.bl.col.details')} options={nameOptions} selected={names.size ? names : null} onChange={(s) => set({ names: s ? [...s].join(SEP) : '' })} />;
  const rows = useMemo(() => shown.map((x, i) => ({
    key: `${x.date}-${x.reference}-${i}`,
    cells: [
      { node: <Term>{fmtDay(x.date)}</Term>, num: true },
      { node: x.action || '—', title: actionKey(x.action) },
      { node: <>{x.details || ''}{x.imageId ? <> <ChequeThumb row={x} icon /></> : null}{payeeLine(x) ? <span className={c.payee} dir="auto">{payeeLine(x)}</span> : null}</>, title: nameKey(x) },
      { node: x.reference ? <Term>{x.reference}</Term> : '', num: true },
      { node: x.moneyIn ? <span className={c.in}>{fmtILS(x.moneyIn)}</span> : '', num: true },
      { node: x.moneyOut ? <span className={c.out}>{fmtILS(x.moneyOut)}</span> : '', num: true },
      { node: x.balance != null ? fmtILS(x.balance) : '', num: true },
    ],
  })), [shown, c, t]); // eslint-disable-line react-hooks/exhaustive-deps
  const foot = d ? {
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
      {r.loading && !d ? <Loading /> : null}
      {r.error ? <ErrorBox error={r.error} /> : null}
      {d && !d.available ? <Empty>{t('joya.bl.notAvailable', { reason: d.reason })}</Empty> : null}
      {d?.available ? (
        <>
          <div className={c.sum}>
            <span>{t('joya.bl.window')}: <span className={c.sumVal}><Term>{fmtDay(from)}</Term> – <Term>{fmtDay(to)}</Term></span></span>
            <span>{t('joya.bl.rows')}: <span className={c.sumVal}>{tot.count.toLocaleString('en-US')}</span>{filtered ? <span className={c.dim}> / {windowTot.count.toLocaleString('en-US')}</span> : null}</span>
            <span>{t('joya.bl.in')}: <span className={`${c.sumVal} ${c.in}`}>{fmtILS(tot.moneyIn)}</span></span>
            <span>{t('joya.bl.out')}: <span className={`${c.sumVal} ${c.out}`}>{fmtILS(tot.moneyOut)}</span></span>
            <span>{t('joya.bl.net')}: <span className={c.sumVal}>{fmtILS(tot.net)}</span></span>
            {filtered ? <Badge tone="info">{t('joya.bl.filtered')}</Badge> : null}
            {filtered ? <Btn small onClick={() => set({ actions: '', names: '' })}>{t('joya.bl.clear')}</Btn> : null}
          </div>
          <Card>
            {cards ? <div className={c.cardsBar}>{dateFilter}{actionFilter}{nameFilter}</div> : null}
            {!rows.length && !cards ? (
              <>
                <div className={c.cardsBar}>{dateFilter}{actionFilter}{nameFilter}</div>
                <Empty>{t('joya.bl.empty')}</Empty>
              </>
            ) : (
              <DataTable dir={dir} onModeChange={setCards} head={[dateFilter, actionFilter, nameFilter, t('joya.bl.col.reference'), t('joya.bl.col.in'), t('joya.bl.col.out'), t('joya.bl.col.balance')]} rows={rows} foot={foot} />
            )}
          </Card>
        </>
      ) : null}
    </Page>
  );
}
