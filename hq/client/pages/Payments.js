// /payments — the Payments area (תשלומים, chain admin): the board of the planned bank transfers (today / this week /
// 30 days / all) on top, the area's chat under it. The board is read-only: payments are added, moved and cancelled in
// the chat (src/services/payments.js, proposal PAYMENT_OPS → Apply); the one button here confirms an unclear bank
// match. A payment is "paid" only when a line of the bank file paid it (owner 2026-11-07).
// The board is a grid with a free `side` slot: the cash-flow panel will sit next to the payments there, later.
import React, { useState } from 'react';
import { createUseStyles, useTheme } from 'react-jss';
import { api, qs } from '../api.js';
import { useT, Term } from '../i18n/index.js';
import { useJoya } from '../context.js';
import ChatArea from '../ChatArea.js';
import { Page, Card, Btn, Badge, Select, Tabs, Loading, Empty, ErrorBox, useLoad, useAction, fmtILS, fmtDay, addDays, weekdayOf, statusTone } from '../ui.js';
import { AREAS } from './Area.js';

const useStyles = createUseStyles((theme) => ({
  board: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: '0.75rem', marginBottom: '1rem', '@media (min-width: 1000px)': { gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' } },
  one: { gridTemplateColumns: 'minmax(0, 1fr) !important' },
  head: { display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.6rem' },
  bank: { fontSize: '0.74rem', color: theme.textSecondary, marginBottom: '0.4rem' },
  group: { marginTop: '0.5rem' },
  groupHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', padding: '0.2rem 0' },
  total: { fontSize: '0.78rem', color: theme.textSecondary },
  openTotal: { marginTop: '0.6rem', fontWeight: 650, textAlign: 'end' },
  line: { display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0', borderTop: `1px solid ${theme.border}`, flexWrap: 'wrap' },
  id: { fontSize: '0.72rem', color: theme.textSecondary, minWidth: 34 },
  payee: { flex: 1, minWidth: 120, fontWeight: 600, overflowWrap: 'anywhere' },
  series: { fontSize: '0.7rem', color: theme.textSecondary, fontWeight: 400 },
  amt: { fontWeight: 650, whiteSpace: 'nowrap' },
  due: { fontSize: '0.8rem', color: theme.textSecondary, whiteSpace: 'nowrap' },
  small: { fontSize: '0.74rem', color: theme.textSecondary, width: '100%' },
  cand: { fontSize: '0.78rem', background: 'rgba(210,153,34,0.14)', borderRadius: 8, padding: '0.35rem 0.5rem', width: '100%', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' },
  candRow: { display: 'inline-flex', gap: '0.4rem', alignItems: 'center' },
  hint: { fontSize: '0.74rem', color: theme.textSecondary, margin: '0.5rem 0 0', lineHeight: 1.5 },
}));

const TABS = ['today', 'week', 'upcoming', 'all'];
const GROUPS = ['overdue', 'today', 'thisWeek', 'upcoming', 'paid', 'cancelled'];
const GROUP_TONE = { overdue: 'bad', today: 'warn', thisWeek: 'info', upcoming: 'info', paid: 'ok', cancelled: 'muted' };
const pad = (n) => String(n).padStart(2, '0');
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
/** The period of a tab (weeks run Sunday–Saturday). "All" also shows what was paid or cancelled in the last two months. */
function rangeOf(tab, today) {
  if (tab === 'today') return { from: today, to: today, status: 'PLANNED' };
  if (tab === 'week') return { from: today, to: addDays(addDays(today, -weekdayOf(today)), 6), status: 'PLANNED' };
  if (tab === 'upcoming') return { from: today, to: addDays(today, 30), status: 'PLANNED' };
  return { from: addDays(today, -60), to: addDays(today, 365), status: 'all' };
}

function PaymentLine({ p, classes: c, t, onConfirm, busy }) {
  return (
    <div className={c.line}>
      <span className={c.id}>
        <Term>#{p.id}</Term>
      </span>
      <span className={c.payee} dir="auto">
        {p.payee}
        {p.seriesId ? <span className={c.series}> ↻ {t('joya.pay.series')}</span> : null}
      </span>
      <span className={c.amt}>{fmtILS(p.amount)}</span>
      <span className={c.due} dir="auto">
        {p.status === 'PAID' && p.paidDate ? t('joya.pay.paidOn', { date: fmtDay(p.paidDate) }) : p.dueText}
      </span>
      <Badge tone={statusTone(p.displayStatus)}>{t(`joya.pay.status.${p.displayStatus}`)}</Badge>
      {p.note ? (
        <div className={c.small} dir="auto">
          {p.note}
        </div>
      ) : null}
      {p.candidates?.length ? (
        <div className={c.cand}>
          <span>{t('joya.pay.candidates')}</span>
          {p.candidates.map((x) => (
            <span key={x.key} className={c.candRow}>
              <Term>{fmtDay(x.date)}</Term> · <bdi dir="auto">{x.name || x.action}</bdi>
              <Btn small kind="primary" disabled={busy} onClick={() => onConfirm(p, x)}>
                {t('joya.pay.confirm')}
              </Btn>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CompanyBoard({ co, many, classes: c, t, onConfirm, busy }) {
  const groups = GROUPS.filter((g) => co[g]?.length);
  return (
    <Card title={many ? co.company : null}>
      {co.bankNote || co.bankUpTo ? <div className={c.bank}>{co.bankNote ? t('joya.pay.bankNote', { note: co.bankNote }) : t('joya.pay.bankUpTo', { date: fmtDay(co.bankUpTo) })}</div> : null}
      {!groups.length ? <Empty>{t('joya.pay.none')}</Empty> : null}
      {groups.map((g) => (
        <div key={g} className={c.group}>
          <div className={c.groupHead}>
            <Badge tone={GROUP_TONE[g]}>{t(`joya.pay.group.${g}`)}</Badge>
            <span className={c.total}>
              {t('joya.pay.total')} {fmtILS(co.totals[g])}
            </span>
          </div>
          {co[g].map((p) => (
            <PaymentLine key={p.id} p={p} classes={c} t={t} onConfirm={onConfirm} busy={busy} />
          ))}
        </div>
      ))}
      {co.totals.open ? (
        <div className={c.openTotal}>
          {t('joya.pay.open')}: {fmtILS(co.totals.open)}
        </div>
      ) : null}
    </Card>
  );
}

/** The board: tabs, the company (when there are several) and the payments grouped by the server. `side` = the panel next to it (the cash flow, later). */
export function PaymentsBoard({ side = null, refreshKey = 0 }) {
  const theme = useTheme();
  const c = useStyles(theme);
  const { t } = useT();
  const j = useJoya();
  const companies = j.companies.filter((x) => x.key);
  const [company, setCompany] = useState(j.companyKey && companies.some((x) => x.key === j.companyKey) ? j.companyKey : companies[0]?.key || '');
  const [tab, setTab] = useState('today');
  const r = rangeOf(tab, localToday());
  const { data, error, loading, reload } = useLoad(() => api(`/payments${qs({ company: company || null, from: r.from, to: r.to, status: r.status })}`), [company, tab, refreshKey]);
  const act = useAction();
  const confirm = (p, cand) =>
    act.run(async () => {
      await api(`/payments/${p.id}/match`, { method: 'POST', body: { bankTxKey: cand.key } });
      reload();
    });
  const cos = data?.companies || [];
  return (
    <div className={`${c.board} ${side ? '' : c.one}`}>
      <div>
        <div className={c.head}>
          <Tabs tabs={TABS.map((k) => [k, t(`joya.pay.tab.${k}`)])} value={tab} onChange={setTab} />
          {companies.length > 1 ? (
            <Select value={company} onChange={(e) => setCompany(e.target.value)} aria-label={t('joya.pay.company')}>
              {companies.map((x) => (
                <option key={x.key} value={x.key}>
                  {x.label || x.key}
                </option>
              ))}
            </Select>
          ) : null}
        </div>
        <ErrorBox error={error || act.error} />
        {loading && !data ? <Loading /> : null}
        {cos.map((co) => (
          <CompanyBoard key={co.companyKey} co={co} many={cos.length > 1} classes={c} t={t} onConfirm={confirm} busy={act.busy} />
        ))}
        <p className={c.hint}>{t('joya.pay.hint')}</p>
      </div>
      {side ? <div>{side}</div> : null}
    </div>
  );
}

export default function Payments() {
  const { t } = useT();
  const j = useJoya();
  const a = AREAS.payments;
  const [refreshKey, setRefreshKey] = useState(0); // the board reloads after a chat change is applied
  const suggestions = Array.from({ length: a.suggestions }, (_, i) => t(`joya.area.payments.s${i + 1}`));
  return (
    <Page>
      <PaymentsBoard refreshKey={refreshKey} />
      <ChatArea key="payments" contextId={a.id} locationId={j.locationId} title={t('joya.area.askTitle')} intro={t('joya.area.payments.intro')} suggestions={suggestions} onChanged={() => setRefreshKey((k) => k + 1)} />
    </Page>
  );
}
