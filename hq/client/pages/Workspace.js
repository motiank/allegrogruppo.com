// /workspace — the restaurant manager's home (phone first): today's order list,
// a quick shortage report, next week's shifts, tasks, inquiries, payroll issues and
// yesterday's sales, for one location.
import React, { useState } from 'react';
import { createUseStyles, useTheme } from 'react-jss';
import { useNavigate } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useT } from '../i18n/index.js';
import { useJoya } from '../context.js';
import AskBox from '../AskBox.js';
import { Page, Card, Row, Btn, Badge, Input, Field, Val, Loading, ErrorBox, Empty, SourceLine, useLoad, useAction, fmtILS, fmtNum, fmtPctSigned, fmtDay, addDays, weekdayOf, statusTone, Term } from '../ui.js';

const useStyles = createUseStyles((theme) => ({
  big: { fontSize: '1rem', fontWeight: 650 },
  line: { fontSize: '0.84rem', marginTop: '0.25rem' },
  muted: { fontSize: '0.78rem', color: theme.textSecondary, marginTop: '0.2rem' },
  item: { fontSize: '0.82rem', padding: '0.3rem 0', borderTop: `1px solid ${theme.border}` },
  overdue: { color: '#f2a3a8' },
  ok: { fontSize: '0.8rem', color: '#3fb950', marginTop: '0.3rem' },
  actions: { display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.5rem' },
}));

export default function Workspace() {
  const theme = useTheme();
  const c = useStyles(theme);
  const { t } = useT();
  const j = useJoya();
  const navigate = useNavigate();
  const loc = j.oneLocationId;
  const today = j.me?.today;
  const nextSunday = today ? addDays(today, 7 - weekdayOf(today)) : null;
  const act = useAction();
  const [shortText, setShortText] = useState('');
  const [shortNote, setShortNote] = useState('');
  const [shortDone, setShortDone] = useState(null);

  const { data, error, loading } = useLoad(async () => {
    if (!loc) return null;
    const ids = [loc];
    const [ov, lists, plans, tasks, inq, sales] = await Promise.all([
      api(`/overview${qs({ locationIds: ids, days: 7 })}`),
      api(`/orders${qs({ locationIds: ids, status: 'DRAFT', limit: 10 })}`),
      api(`/staffing/plans${qs({ locationIds: ids, limit: 10 })}`),
      api(`/tasks${qs({ locationIds: ids, status: 'OPEN,IN_PROGRESS' })}`),
      api(`/inquiries${qs({ locationIds: ids, status: 'NEW,IN_PROGRESS,DRAFT_READY' })}`),
      api(`/sales/summary${qs({ locationIds: ids, from: addDays(today, -1), to: addDays(today, -1) })}`),
    ]);
    return { ov, lists: lists.lists, plans: plans.plans, tasks: tasks.tasks, inquiries: inq.inquiries, sales };
  }, [loc, today]);

  if (!loc) return <Page title={t('joya.ws.title')}><Empty>{t('joya.chooseLocation')}</Empty></Page>;
  if (loading && !data) return <Page title={t('joya.ws.title')}><Loading /></Page>;
  if (error) return <Page title={t('joya.ws.title')}><ErrorBox error={error} /></Page>;

  const pend = data.ov.pending.find((p) => p.locationId === loc) || {};
  const todayList = data.lists.find((l) => l.date === today) || null;
  const plan = data.plans.find((p) => p.weekStart === nextSunday && p.status !== 'REJECTED') || null;
  const y = data.sales.locations[0];

  const generateList = () =>
    act.run(async () => {
      const r = await api('/orders/generate', { method: 'POST', body: { locationId: loc, date: today } });
      navigate(`/orders/${r.listId}`);
    });
  const proposePlan = () =>
    act.run(async () => {
      const r = await api('/staffing/plans/propose', { method: 'POST', body: { locationId: loc, weekStart: nextSunday } });
      navigate(`/staffing/${r.planId}`);
    });
  const reportShortage = () =>
    act.run(async () => {
      const r = await api('/shortages', { method: 'POST', body: { locationId: loc, itemText: shortText.trim(), note: shortNote.trim() || null, date: today } });
      setShortDone(r.matched ? 'matched' : 'unmatched');
      setShortText('');
      setShortNote('');
    });

  return (
    <Page title={t('joya.ws.title')} sub={j.locName(loc)}>
      <ErrorBox error={act.error} />

      <Card title={t('joya.ws.orderTitle')} right={todayList ? <Badge tone={statusTone(todayList.status)}>{t(`joya.status.${todayList.status}`)}</Badge> : null}>
        {todayList ? (
          <>
            <div className={c.line}>{t('joya.ws.orderReady', { count: todayList.lines })}</div>
            <div className={c.actions}>
              <Btn kind="primary" onClick={() => navigate(`/orders/${todayList.id}`)}>{t('joya.ws.openList')}</Btn>
            </div>
          </>
        ) : (
          <>
            <div className={c.line}>{t('joya.ws.noOrderToday')}</div>
            <div className={c.actions}>
              <Btn kind="primary" disabled={act.busy} onClick={generateList}>{t('joya.ws.generateList')}</Btn>
              {pend.draftLists > 0 && <Btn onClick={() => navigate('/orders')}>{t('joya.ws.otherDrafts', { count: pend.draftLists })}</Btn>}
            </div>
          </>
        )}
      </Card>

      <Card title={t('joya.ws.shortageTitle')}>
        <Field label={t('joya.ws.shortageItem')}>
          <Input value={shortText} onChange={(e) => setShortText(e.target.value)} dir="auto" placeholder={t('joya.ws.shortagePh')} />
        </Field>
        <Field label={t('joya.noteOptional')}>
          <Input value={shortNote} onChange={(e) => setShortNote(e.target.value)} dir="auto" />
        </Field>
        <Btn kind="primary" disabled={act.busy || !shortText.trim()} onClick={reportShortage}>{t('joya.ws.shortageSend')}</Btn>
        {shortDone && <div className={c.ok}>✓ {t(shortDone === 'matched' ? 'joya.ws.shortageSaved' : 'joya.ws.shortageSavedText')}</div>}
        <div className={c.muted}>
          {t('joya.ws.shortages7d')}: <Term>{pend.shortages7d ?? 0}</Term> ·{' '}
          <Btn kind="ghost" small onClick={() => navigate('/shortages')}>{t('joya.ws.seeAll')}</Btn>
        </div>
      </Card>

      <Card title={t('joya.ws.shiftsTitle')} right={plan ? <Badge tone={statusTone(plan.status)}>{t(`joya.status.${plan.status}`)}</Badge> : null}>
        <div className={c.line}>
          {t('joya.ws.weekOf')} <Term>{fmtDay(nextSunday)}</Term>
        </div>
        {plan ? (
          <>
            <div className={c.muted}>{t('joya.ws.people', { count: plan.people })}</div>
            <div className={c.actions}>
              <Btn kind="primary" onClick={() => navigate(`/staffing/${plan.id}`)}>{t('joya.ws.openPlan')}</Btn>
            </div>
          </>
        ) : (
          <div className={c.actions}>
            <Btn kind="primary" disabled={act.busy} onClick={proposePlan}>{t('joya.ws.proposePlan')}</Btn>
          </div>
        )}
      </Card>

      <Card title={t('joya.ws.salesTitle')}>
        {y && y.current.daysWithData ? (
          <>
            <Row label={t('joya.ov.revenue')}><Val v={y.current.revenue} fmt={fmtILS} /></Row>
            <Row label={t('joya.ov.checks')}><Val v={y.current.checks} fmt={fmtNum} /></Row>
            <Row label={t('joya.ov.diners')}><Val v={y.current.diners} fmt={fmtNum} /></Row>
            <Row label={t('joya.ws.vsDayBefore')}><Val v={y.change?.revenueChangePct} fmt={fmtPctSigned} /></Row>
          </>
        ) : (
          <div className={c.line}>
            <Val v={null} /> — {t('joya.ws.noSalesYesterday')}
          </div>
        )}
        <SourceLine source={data.sales.source} period={data.sales.period} />
      </Card>

      <Card title={t('joya.ws.tasksTitle')} right={<Btn kind="ghost" small onClick={() => navigate('/tasks')}>{t('joya.ws.seeAll')}</Btn>}>
        {data.tasks.length === 0 ? (
          <div className={c.muted}>{t('joya.none')}</div>
        ) : (
          data.tasks.slice(0, 6).map((task) => {
            const late = task.dueDate && task.dueDate < today;
            return (
              <div key={task.id} className={c.item}>
                <span dir="auto">{task.title}</span>
                {task.dueDate ? (
                  <span className={late ? c.overdue : undefined}>
                    {' '}· <Term>{fmtDay(task.dueDate)}</Term> {late ? `(${t('joya.ws.late')})` : ''}
                  </span>
                ) : null}
              </div>
            );
          })
        )}
      </Card>

      <Card title={t('joya.ws.inqTitle')} right={<Btn kind="ghost" small onClick={() => navigate('/inquiries')}>{t('joya.ws.seeAll')}</Btn>}>
        {data.inquiries.length === 0 ? (
          <div className={c.muted}>{t('joya.none')}</div>
        ) : (
          data.inquiries.slice(0, 5).map((q) => (
            <div key={q.id} className={c.item} style={{ cursor: 'pointer' }} onClick={() => navigate(`/inquiries/${q.id}`)}>
              <Badge tone="info">{t(`joya.src.${q.source}`)}</Badge> <Badge tone={statusTone(q.status)}>{t(`joya.status.${q.status}`)}</Badge>{' '}
              <span dir="auto">{String(q.content).slice(0, 80)}</span>
            </div>
          ))
        )}
      </Card>

      <Card title={t('joya.ws.payrollTitle')} onClick={() => navigate('/payroll')}>
        <div className={c.line}>
          {t('joya.ws.payrollOpen')}: <Term>{pend.openPayrollIssues ?? 0}</Term>
        </div>
        <div className={c.muted}>{t('joya.ws.payrollHint')}</div>
      </Card>

      <AskBox contextKind="GENERAL" locationId={loc} examples={[t('joya.ws.ex1'), t('joya.ws.ex2'), t('joya.ws.ex3')]} />
    </Page>
  );
}
