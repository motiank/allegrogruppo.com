// /cheques — the שקלפ page (שיקים לפרעון; owner 2026-11-22: "list forward the daily cheques or expenses like known bank
// payments (הוראות קבע) by date; when the date is clicked open a card with the cheques and orders for that day (cheque
// number, beneficiary and sum); move forward (next month) and backward (start of this month and month by month)" and,
// the same day: "a table — date, cheques, standing orders and balance in one line, with enough space to click; arrows
// for the months; the card floating").
// One month of one company (chain admin): a four-column table with a tall row per day that has something to pay, the
// bank balance green = real / red = expected; a tap opens the day's card in a dialog. The data is the admin's, through
// GET /api/joya/cheques/month (src/services/finance.js chequesMonth + standingOrders.js); nothing is stored here. The
// chat's future-cheques answer links here with the company and the month.
import React, { useState } from 'react';
import { createUseStyles, useTheme } from 'react-jss';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useT, Term } from '../i18n/index.js';
import { Page, Card, Btn, Badge, Select, Modal, Loading, Empty, ErrorBox, useLoad, fmtILS, fmtDay } from '../ui.js';

const useStyles = createUseStyles((theme) => ({
  bar: { display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.6rem' },
  arrow: { minWidth: 44, minHeight: 40, fontSize: '1.3rem', lineHeight: 1, padding: '0 0.6rem' },
  month: { fontWeight: 700, fontSize: '1rem', flex: 1, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  sum: { display: 'flex', gap: '0.3rem 1rem', flexWrap: 'wrap', fontSize: '0.8rem', color: theme.textSecondary, marginBottom: '0.6rem', lineHeight: 1.5 },
  sumVal: { color: theme.text, fontWeight: 650 },
  wrap: { margin: '0 -0.2rem' },
  table: { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: '0.86rem', fontVariantNumeric: 'tabular-nums' },
  th: { textAlign: 'start', fontWeight: 650, color: theme.textSecondary, fontSize: '0.74rem', padding: '0.3rem 0.35rem', borderBottom: `1px solid ${theme.border}`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  num: { textAlign: 'end' },
  row: { cursor: 'pointer', '&:hover td': { background: 'rgba(127,127,127,0.08)' }, '&:active td': { background: 'rgba(127,127,127,0.14)' } },
  td: { padding: '0.55rem 0.35rem', height: 54, borderBottom: `1px solid ${theme.border}`, verticalAlign: 'middle', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  footTd: { padding: '0.55rem 0.35rem', borderTop: `2px solid ${theme.border}`, fontWeight: 700, verticalAlign: 'middle', whiteSpace: 'nowrap' },
  past: { opacity: 0.6 },
  todayRow: { '& td:first-child': { boxShadow: `inset 3px 0 0 ${theme.primary}` } },
  date: { fontWeight: 650 },
  wd: { display: 'block', fontSize: '0.7rem', color: theme.textSecondary, fontWeight: 400 },
  cnt: { display: 'block', fontSize: '0.7rem', color: theme.textSecondary },
  strong: { fontWeight: 650 },
  green: { color: '#3fb950' },
  red: { color: '#f2a3a8' },
  dim: { color: theme.textSecondary },
  // the day's card (in the dialog)
  sec: { fontSize: '0.76rem', color: theme.textSecondary, fontWeight: 650, margin: '0.7rem 0 0.2rem', '&:first-child': { marginTop: 0 } },
  line: { display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0', borderTop: `1px dashed ${theme.border}`, fontSize: '0.88rem', flexWrap: 'wrap' },
  no: { minWidth: 64, color: theme.textSecondary, fontSize: '0.8rem' },
  payee: { flex: 1, minWidth: 120, overflowWrap: 'anywhere' },
  amt: { fontWeight: 650, whiteSpace: 'nowrap' },
  total: { display: 'flex', justifyContent: 'space-between', marginTop: '0.6rem', paddingTop: '0.5rem', borderTop: `1px solid ${theme.border}`, fontWeight: 650 },
  balLine: { marginTop: '0.4rem', fontSize: '0.84rem', display: 'flex', justifyContent: 'space-between' },
  hint: { fontSize: '0.74rem', color: theme.textSecondary, lineHeight: 1.5, margin: '0.6rem 0 0' },
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
const locale = (lang) => (lang === 'en' ? 'en-US' : 'he-IL');
const monthLabel = (month, lang) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString(locale(lang), { month: 'long', year: 'numeric', timeZone: 'UTC' });
const weekday = (ymd, lang, form = 'short') => new Date(`${ymd}T00:00:00Z`).toLocaleDateString(locale(lang), { weekday: form, timeZone: 'UTC' });
const dayMonth = (ymd) => `${Number(ymd.slice(8, 10))}.${Number(ymd.slice(5, 7))}`;
const isBank = (p) => p.kind === 'standing_order';
const sumOf = (xs) => xs.reduce((s, x) => s + (Number(x.amount) || 0), 0);

function DayCard({ d, c, t }) {
  const cheques = d.cheques || [];
  const bank = (d.payments || []).filter(isBank);
  const planned = (d.payments || []).filter((p) => !isBank(p));
  return (
    <>
      {cheques.length ? (
        <>
          <div className={c.sec}>{t('joya.chq.cheques')} ({cheques.length}) · {fmtILS(sumOf(cheques))}</div>
          {cheques.map((x, i) => (
            <div key={`${x.reference}-${i}`} className={c.line}>
              <span className={c.no}><Term>{x.reference ?? '—'}</Term></span>
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
          <div className={c.sec}>{t('joya.chq.bankPayments')} ({bank.length}) · {fmtILS(sumOf(bank))}</div>
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
          <div className={c.sec}>{t('joya.chq.planned')} ({planned.length}) · {fmtILS(sumOf(planned))}</div>
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
        <span>{fmtILS(sumOf(cheques) + sumOf(d.payments || []))}</span>
      </div>
      {d.balance ? (
        <div className={`${c.balLine} ${d.balance.kind === 'actual' ? c.green : c.red}`}>
          <span>{d.balance.kind === 'actual' ? t('joya.chq.balanceActual') : t('joya.chq.balanceExpected')}</span>
          <span className={c.strong}>{fmtILS(d.balance.amount)}</span>
        </div>
      ) : null}
    </>
  );
}

export default function Cheques() {
  const theme = useTheme();
  const c = useStyles(theme);
  const { t, lang } = useT();
  const [sp, setSp] = useSearchParams();
  const today = localToday();
  const thisMonth = today.slice(0, 7);
  const month = /^\d{4}-\d{2}$/.test(sp.get('month') || '') ? sp.get('month') : thisMonth;
  const company = sp.get('company') || '';
  const [openDay, setOpenDay] = useState(null);
  const [sheet, setSheet] = useState({ busy: false, error: null });
  const r = useLoad(() => api(`/cheques/month${qs({ company: company || undefined, month })}`), [company, month]);
  // "גיליון Google בדרייב": rebuild the fixed cheques Google Sheet in the owner's Drive now and open it (on click)
  const makeSheet = async () => {
    if (sheet.busy) return;
    setSheet({ busy: true, error: null });
    try {
      const out = await api('/cheques/sheet', { method: 'POST', body: {} });
      setSheet({ busy: false, error: null });
      if (out?.url) window.open(out.url, '_blank', 'noopener');
    } catch (e) {
      setSheet({ busy: false, error: e });
    }
  };
  const go = (m, co = company) => setSp({ ...(co ? { company: co } : {}), month: m });
  const d = r.data;
  const open = openDay && d?.byDay?.find((x) => x.dueDate === openDay);
  // the month total row: the column sums of the days shown, and the balance at the end of the month (the last day's)
  const days = d?.byDay || [];
  const monthChqAmt = days.reduce((s, x) => s + (x.amount || 0), 0);
  const monthChqN = days.reduce((s, x) => s + (x.count || 0), 0);
  const monthBank = sumOf(days.flatMap((x) => (x.payments || []).filter(isBank)));
  const monthPlanned = sumOf(days.flatMap((x) => (x.payments || []).filter((p) => !isBank(p))));
  const endBal = [...days].reverse().find((x) => x.balance)?.balance || null;
  // ‹ and › are bidi-mirrored glyphs — the browser already flips them in RTL. Do NOT swap them by dir too (that
  // double-flipped them, so the arrows pointed inward). prev = ‹, next = › in both directions; the flex order and the
  // glyph both mirror in RTL, so they always point outward.
  const back = '‹';
  const fwd = '›';
  return (
    <Page
      title={t('joya.chq.title')}
      sub={d ? (d.lastBankDay ? t('joya.chq.sub', { company: d.company?.label, day: fmtDay(d.lastBankDay) }) : t('joya.chq.subNoBank', { company: d.company?.label })) : null}
      actions={
        <>
          {d?.companies?.length > 1 ? (
            <Select value={d.company?.key || ''} onChange={(e) => go(month, e.target.value)} aria-label={t('joya.chq.company')}>
              {d.companies.map((x) => (
                <option key={x.key} value={x.key}>{x.label}</option>
              ))}
            </Select>
          ) : null}
          <Btn small disabled={sheet.busy} onClick={makeSheet}>{sheet.busy ? t('joya.chq.sheetMaking') : t('joya.chq.sheet')}</Btn>
        </>
      }
    >
      <div className={c.bar}>
        <Btn className={c.arrow} onClick={() => go(shiftMonth(month, -1))} aria-label={t('joya.chq.prev')} title={t('joya.chq.prev')}>{back}</Btn>
        <span className={c.month}>{monthLabel(month, lang)}</span>
        <Btn className={c.arrow} onClick={() => go(shiftMonth(month, 1))} aria-label={t('joya.chq.next')} title={t('joya.chq.next')}>{fwd}</Btn>
        {month !== thisMonth ? <Btn small kind="primary" onClick={() => go(thisMonth)}>{t('joya.chq.thisMonth')}</Btn> : null}
      </div>
      {r.loading && !d ? <Loading /> : null}
      {r.error ? <ErrorBox error={r.error} /> : null}
      {sheet.error ? <ErrorBox error={sheet.error} /> : null}
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
            {d.byDay?.length ? (
              <div className={c.wrap}>
                <table className={c.table}>
                  <colgroup>
                    <col style={{ width: '22%' }} />
                    <col style={{ width: '28%' }} />
                    <col style={{ width: '24%' }} />
                    <col style={{ width: '26%' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className={c.th}>{t('joya.chq.date')}</th>
                      <th className={`${c.th} ${c.num}`}>{t('joya.chq.cheques')}</th>
                      <th className={`${c.th} ${c.num}`}>{t('joya.chq.bankPayments')}</th>
                      <th className={`${c.th} ${c.num}`}>{t('joya.chq.balance')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.byDay.map((x) => {
                      const k = x.dueDate;
                      const bank = (x.payments || []).filter(isBank);
                      const planned = (x.payments || []).filter((p) => !isBank(p));
                      return (
                        <tr key={k} className={`${c.row} ${k < today ? c.past : ''} ${k === today ? c.todayRow : ''}`} onClick={() => setOpenDay(k)} role="button" tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setOpenDay(k)}>
                          <td className={c.td}>
                            <span className={c.date}><Term>{dayMonth(k)}</Term></span>
                            <span className={c.wd}>{k === today ? t('joya.chq.today') : weekday(k, lang)}</span>
                          </td>
                          <td className={`${c.td} ${c.num}`}>
                            {x.count ? (
                              <>
                                <span className={c.strong}>{fmtILS(x.amount)}</span>
                                <span className={c.cnt}>{t('joya.chq.n', { n: x.count })}</span>
                              </>
                            ) : <span className={c.dim}>—</span>}
                          </td>
                          <td className={`${c.td} ${c.num}`}>
                            {bank.length ? <span className={c.strong}>{fmtILS(sumOf(bank))}</span> : planned.length ? null : <span className={c.dim}>—</span>}
                            {planned.length ? <span className={c.cnt}>+ {t('joya.chq.plannedShort')} {fmtILS(sumOf(planned))}</span> : null}
                          </td>
                          <td className={`${c.td} ${c.num} ${x.balance ? (x.balance.kind === 'actual' ? c.green : c.red) : c.dim}`} title={x.balance ? (x.balance.kind === 'actual' ? t('joya.chq.balanceActual') : t('joya.chq.balanceExpected')) : undefined}>
                            {x.balance ? <span className={c.strong}>{fmtILS(x.balance.amount)}</span> : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className={c.footTd}>{t('joya.chq.monthTotal')} · <Term>{monthLabel(month, lang)}</Term></td>
                      <td className={`${c.footTd} ${c.num}`}>
                        {monthChqN ? (
                          <>
                            <span>{fmtILS(monthChqAmt)}</span>
                            <span className={c.cnt}>{t('joya.chq.n', { n: monthChqN })}</span>
                          </>
                        ) : <span className={c.dim}>—</span>}
                      </td>
                      <td className={`${c.footTd} ${c.num}`}>
                        {monthBank || monthPlanned ? (
                          <>
                            {monthBank ? <span>{fmtILS(monthBank)}</span> : null}
                            {monthPlanned ? <span className={c.cnt}>+ {t('joya.chq.plannedShort')} {fmtILS(monthPlanned)}</span> : null}
                          </>
                        ) : <span className={c.dim}>—</span>}
                      </td>
                      <td className={`${c.footTd} ${c.num} ${endBal ? (endBal.kind === 'actual' ? c.green : c.red) : c.dim}`} title={endBal ? (endBal.kind === 'actual' ? t('joya.chq.balanceActual') : t('joya.chq.balanceExpected')) : undefined}>
                        {endBal ? fmtILS(endBal.amount) : '—'}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : null}
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
      {open ? (
        <Modal title={<span><Term>{fmtDay(open.dueDate)}</Term> · {open.dueDate === today ? t('joya.chq.today') : weekday(open.dueDate, lang, 'long')}</span>} onClose={() => setOpenDay(null)}>
          <DayCard d={open} c={c} t={t} />
        </Modal>
      ) : null}
    </Page>
  );
}
