// /cheques — the שקלפ page (שיקים לפרעון; owner 2026-11-22: "list forward the daily cheques or expenses like known bank
// payments (הוראות קבע) by date; when the date is clicked open a card with the cheques and orders for that day (cheque
// number, beneficiary and sum); move forward (next month) and backward (start of this month and month by month)").
// One month of one company (chain admin): a row per day that has cheques, known bank payments or planned payments, with
// the day's sums and the bank balance (green = real, red = expected); a click opens the day's card. The data is the
// admin's, through GET /api/joya/cheques/month (src/services/finance.js chequesMonth + standingOrders.js); nothing is
// stored here. The chat's future-cheques answer links here with the company and the month.
import React, { useState } from 'react';
import { createUseStyles, useTheme } from 'react-jss';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useT, Term } from '../i18n/index.js';
import { Page, Card, Btn, Badge, Select, Loading, Empty, ErrorBox, useLoad, fmtILS, fmtDay } from '../ui.js';

const useStyles = createUseStyles((theme) => ({
  bar: { display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.8rem' },
  month: { fontWeight: 700, fontSize: '1.05rem', minWidth: 140, textAlign: 'center' },
  grow: { flex: 1 },
  sum: { display: 'flex', gap: '0.6rem 1.2rem', flexWrap: 'wrap', fontSize: '0.84rem', color: theme.textSecondary, marginBottom: '0.8rem', lineHeight: 1.6 },
  sumVal: { color: theme.text, fontWeight: 650 },
  day: { display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.55rem 0.2rem', borderTop: `1px solid ${theme.border}`, cursor: 'pointer', flexWrap: 'wrap', '&:hover': { background: 'rgba(127,127,127,0.06)' } },
  dayOpen: { background: 'rgba(127,127,127,0.08)' },
  past: { opacity: 0.72 },
  today: { borderInlineStart: `3px solid ${theme.primary}`, paddingInlineStart: '0.5rem' },
  date: { minWidth: 118, fontWeight: 650, whiteSpace: 'nowrap' },
  wd: { fontSize: '0.74rem', color: theme.textSecondary, fontWeight: 400, display: 'block' },
  cell: { fontSize: '0.84rem', whiteSpace: 'nowrap' },
  lbl: { color: theme.textSecondary, fontSize: '0.74rem', marginInlineEnd: '0.3rem' },
  bal: { marginInlineStart: 'auto', fontWeight: 650, whiteSpace: 'nowrap', fontSize: '0.9rem' },
  green: { color: '#3fb950' },
  red: { color: '#f2a3a8' },
  card: { margin: '0.2rem 0 0.6rem', padding: '0.6rem 0.8rem', borderRadius: 10, background: theme.cardAlt || 'rgba(127,127,127,0.07)', border: `1px solid ${theme.border}` },
  sec: { fontSize: '0.78rem', color: theme.textSecondary, fontWeight: 650, margin: '0.5rem 0 0.2rem', '&:first-child': { marginTop: 0 } },
  line: { display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.3rem 0', borderTop: `1px dashed ${theme.border}`, fontSize: '0.86rem', flexWrap: 'wrap' },
  no: { minWidth: 70, color: theme.textSecondary, fontSize: '0.8rem' },
  payee: { flex: 1, minWidth: 140, overflowWrap: 'anywhere' },
  amt: { fontWeight: 650, whiteSpace: 'nowrap' },
  total: { display: 'flex', justifyContent: 'space-between', marginTop: '0.4rem', paddingTop: '0.4rem', borderTop: `1px solid ${theme.border}`, fontWeight: 650, fontSize: '0.86rem' },
  hint: { fontSize: '0.76rem', color: theme.textSecondary, lineHeight: 1.5, margin: '0.6rem 0 0' },
  known: { fontSize: '0.8rem', lineHeight: 1.7, margin: 0, paddingInlineStart: '1.1rem' },
  warn: { fontSize: '0.8rem', color: '#f2a3a8', margin: '0.3rem 0' },
}));

const pad = (n) => String(n).padStart(2, '0');
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const shiftMonth = (month, n) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};
const monthLabel = (month, lang) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString(lang === 'en' ? 'en-US' : 'he-IL', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const weekday = (ymd, lang) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString(lang === 'en' ? 'en-US' : 'he-IL', { weekday: 'long', timeZone: 'UTC' });

function DayCard({ d, c, t }) {
  const cheques = d.cheques || [];
  const bank = (d.payments || []).filter((p) => p.kind === 'standing_order');
  const planned = (d.payments || []).filter((p) => p.kind !== 'standing_order');
  const total = cheques.reduce((s, x) => s + (Number(x.amount) || 0), 0) + (d.payments || []).reduce((s, x) => s + (Number(x.amount) || 0), 0);
  return (
    <div className={c.card}>
      {cheques.length ? (
        <>
          <div className={c.sec}>{t('joya.chq.cheques')} ({cheques.length})</div>
          {cheques.map((x, i) => (
            <div key={`${x.reference}-${i}`} className={c.line}>
              <span className={c.no}>
                {t('joya.chq.chequeNo')} <Term>{x.reference ?? '—'}</Term>
              </span>
              <span className={c.payee} dir="auto">{x.payee || '—'}</span>
              <span className={c.amt}>{fmtILS(x.amount)}</span>
              {x.paid ? <Badge tone="ok">{t('joya.chq.paid')}</Badge> : null}
              {x.source === 'priority' ? <Badge tone="muted">{t('joya.chq.priority')}</Badge> : null}
            </div>
          ))}
        </>
      ) : null}
      {bank.length ? (
        <>
          <div className={c.sec}>{t('joya.chq.bankPayments')} ({bank.length})</div>
          {bank.map((x, i) => (
            <div key={`b${i}`} className={c.line}>
              <span className={c.no}>{x.reference != null ? <Term>{x.reference}</Term> : ''}</span>
              <span className={c.payee} dir="auto">{x.payee || '—'}</span>
              <span className={c.amt}>{fmtILS(x.amount)}</span>
              {x.paid ? <Badge tone="ok">{t('joya.chq.paid')}</Badge> : x.late ? <Badge tone="warn">{t('joya.chq.late')}</Badge> : <Badge tone="info">{t('joya.chq.expected')}</Badge>}
            </div>
          ))}
        </>
      ) : null}
      {planned.length ? (
        <>
          <div className={c.sec}>{t('joya.chq.planned')} ({planned.length})</div>
          {planned.map((x, i) => (
            <div key={`p${x.id ?? i}`} className={c.line}>
              <span className={c.no}>{x.id ? <Term>#{x.id}</Term> : t('joya.chq.transfer')}</span>
              <span className={c.payee} dir="auto">{x.payee || '—'}{x.window ? ` (${x.window})` : ''}</span>
              <span className={c.amt}>{fmtILS(x.amount)}</span>
            </div>
          ))}
        </>
      ) : null}
      <div className={c.total}>
        <span>{t('joya.chq.dayTotal')}</span>
        <span>{fmtILS(total)}</span>
      </div>
    </div>
  );
}

export default function Cheques() {
  const theme = useTheme();
  const c = useStyles(theme);
  const { t, lang } = useT();
  const [sp, setSp] = useSearchParams();
  const today = localToday();
  const month = /^\d{4}-\d{2}$/.test(sp.get('month') || '') ? sp.get('month') : today.slice(0, 7);
  const company = sp.get('company') || '';
  const [open, setOpen] = useState(() => new Set());
  const r = useLoad(() => api(`/cheques/month${qs({ company: company || undefined, month })}`), [company, month]);
  const go = (m, co = company) => setSp({ ...(co ? { company: co } : {}), month: m });
  const toggle = (k) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const d = r.data;
  const bal = (x) => (x?.balance ? <span className={`${c.bal} ${x.balance.kind === 'actual' ? c.green : c.red}`} title={x.balance.kind === 'actual' ? t('joya.chq.balanceActual') : t('joya.chq.balanceExpected')}>{x.balance.kind === 'actual' ? '🟢' : '🔴'} {fmtILS(x.balance.amount)}</span> : null);
  const bankSum = (x) => (x.payments || []).filter((p) => p.kind === 'standing_order').reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const plannedSum = (x) => (x.payments || []).filter((p) => p.kind !== 'standing_order').reduce((s, p) => s + (Number(p.amount) || 0), 0);
  return (
    <Page
      title={t('joya.chq.title')}
      sub={d ? (d.lastBankDay ? t('joya.chq.sub', { company: d.company?.label, day: fmtDay(d.lastBankDay) }) : t('joya.chq.subNoBank', { company: d.company?.label })) : null}
      actions={
        d?.companies?.length > 1 ? (
          <Select value={d.company?.key || ''} onChange={(e) => go(month, e.target.value)} aria-label={t('joya.chq.company')}>
            {d.companies.map((x) => (
              <option key={x.key} value={x.key}>{x.label}</option>
            ))}
          </Select>
        ) : null
      }
    >
      <div className={c.bar}>
        <Btn small onClick={() => go(shiftMonth(month, -1))}>{t('joya.chq.prev')}</Btn>
        <span className={c.month}>{monthLabel(month, lang)}</span>
        <Btn small onClick={() => go(shiftMonth(month, 1))}>{t('joya.chq.next')}</Btn>
        <span className={c.grow} />
        <Btn small kind={month === today.slice(0, 7) ? 'default' : 'primary'} onClick={() => go(today.slice(0, 7))} disabled={month === today.slice(0, 7)}>{t('joya.chq.thisMonth')}</Btn>
      </div>
      {r.loading && !d ? <Loading /> : null}
      {r.error ? <ErrorBox error={r.error} /> : null}
      {d && !d.available ? <Empty>{t('joya.chq.notAvailable', { reason: d.reason })}</Empty> : null}
      {d?.available ? (
        <>
          <div className={c.sum}>
            <span>{t('joya.chq.cheques')}: <span className={c.sumVal}>{t('joya.chq.chequesSum', { n: d.totals?.window?.count ?? 0, sum: fmtILS(d.totals?.window?.amount ?? 0) })}</span></span>
            <span>{t('joya.chq.bankPayments')}: <span className={c.sumVal}>{fmtILS((d.bankPayments?.expected?.amount || 0) + (d.bankPayments?.paid?.amount || 0))}</span></span>
            {d.payments?.count ? <span>{t('joya.chq.planned')}: <span className={c.sumVal}>{fmtILS(d.payments.amount)}</span></span> : null}
            {d.balance?.lastActual ? <span className={c.green}>{t('joya.chq.lastActual', { sum: fmtILS(d.balance.lastActual.amount), day: fmtDay(d.balance.lastActual.date), source: d.balance.lastActual.sourceHe || d.balance.lastActual.source })}</span> : <span>{t('joya.chq.noBalance')}</span>}
            {d.balance?.expectedEnd ? <span className={c.red}>{t('joya.chq.expectedEnd', { sum: fmtILS(d.balance.expectedEnd.amount) })}</span> : null}
            {d.balance?.lowest ? <span className={c.red}>{t('joya.chq.lowest', { sum: fmtILS(d.balance.lowest.amount), day: fmtDay(d.balance.lowest.date) })}</span> : null}
          </div>
          {d.warnings?.filter((w) => w.severity === 'high').map((w) => (
            <div key={w.code} className={c.warn} dir="auto">⚠ {w.message}</div>
          ))}
          <Card>
            {!d.byDay?.length ? <Empty>{t('joya.chq.empty')}</Empty> : null}
            {d.byDay?.map((x) => {
              const k = x.dueDate;
              const isOpen = open.has(k);
              const bs = bankSum(x);
              const ps = plannedSum(x);
              return (
                <React.Fragment key={k}>
                  <div className={`${c.day} ${isOpen ? c.dayOpen : ''} ${k < today ? c.past : ''} ${k === today ? c.today : ''}`} onClick={() => toggle(k)} role="button" aria-expanded={isOpen}>
                    <span className={c.date}>
                      <Term>{fmtDay(k)}</Term>
                      <span className={c.wd}>{k === today ? t('joya.chq.today') : weekday(k, lang)}</span>
                    </span>
                    {x.count ? <span className={c.cell}><span className={c.lbl}>{t('joya.chq.cheques')}</span>{t('joya.chq.chequesSum', { n: x.count, sum: fmtILS(x.amount) })}</span> : null}
                    {bs ? <span className={c.cell}><span className={c.lbl}>{t('joya.chq.bankPayments')}</span>{fmtILS(bs)}</span> : null}
                    {ps ? <span className={c.cell}><span className={c.lbl}>{t('joya.chq.planned')}</span>{fmtILS(ps)}</span> : null}
                    {bal(x)}
                  </div>
                  {isOpen ? <DayCard d={x} c={c} t={t} /> : null}
                </React.Fragment>
              );
            })}
          </Card>
          <p className={c.hint}>{t('joya.chq.balanceHint')}</p>
          <p className={c.hint}>{t('joya.chq.bankPaymentsHint')}{d.bankPayments?.available === false && d.bankPayments.reason ? ` (${d.bankPayments.reason})` : ''}</p>
          {d.bankPayments?.known?.length ? (
            <Card title={t('joya.chq.known', { n: d.bankPayments.known.length })}>
              <ul className={c.known}>
                {d.bankPayments.known.map((k, i) => (
                  <li key={i} dir="auto"><b>{k.payee}</b> · {t('joya.chq.knownLine', { day: k.day, sum: fmtILS(k.amount), months: k.months, last: fmtDay(k.lastDate) })}</li>
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      ) : null}
    </Page>
  );
}
