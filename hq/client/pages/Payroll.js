// /payroll — payroll preparation checks: find problems in attendance (and, with
// payroll access, payroll lines), review each one and document what was done.
// Nothing here approves or pays payroll.
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createUseStyles, useTheme } from 'react-jss';
import { api, qs } from '../api.js';
import { useT } from '../i18n/index.js';
import { useJoya } from '../context.js';
import { Page, Card, Grid, Row, Btn, Badge, Field, Input, TextArea, Modal, Tabs, Loading, Empty, ErrorBox, SourceLine, Val, useLoad, useAction, fmtILS, fmtNum, fmtDay, fmtWhen, statusTone, Term } from '../ui.js';

const STATUS_ORDER = ['OPEN', 'CORRECTED', 'ACCEPTED', 'DISMISSED'];

const useStyles = createUseStyles((theme) => ({
  banner: { border: `1px solid ${theme.primary}`, borderRadius: 8, padding: '0.5rem 0.7rem', fontSize: '0.8rem', marginBottom: '0.7rem', background: 'rgba(74,125,255,0.08)' },
  small: { fontSize: '0.74rem', color: theme.textSecondary, marginTop: '0.2rem' },
  att: { borderTop: `1px solid ${theme.border}`, padding: '0.3rem 0', fontSize: '0.8rem' },
  actions: { display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginTop: '0.4rem' },
  group: { fontSize: '0.8rem', fontWeight: 650, margin: '0.8rem 0 0.4rem' },
  two: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end', '& > *': { flex: '1 1 150px' } },
}));

const lastMonth = (today) => {
  const d = new Date(today.slice(0, 8) + '01T00:00:00Z');
  d.setUTCDate(0);
  return d.toISOString().slice(0, 7);
};
const toLocalInput = (v) => (v ? String(v).replace(' ', 'T').slice(0, 16) : '');

function ActionModal({ mode, issue, row, onClose, onDone }) {
  const { t } = useT();
  const theme = useTheme();
  const c = useStyles(theme);
  const [clockIn, setIn] = useState(toLocalInput(row?.clockIn));
  const [clockOut, setOut] = useState(toLocalInput(row?.clockOut));
  const [note, setNote] = useState('');
  const act = useAction();
  const submit = () =>
    act.run(async () => {
      if (mode === 'SET_TIMES' || mode === 'EXCLUDE') {
        await api('/payroll/corrections', { method: 'POST', body: { attendanceId: row.id, locationId: issue.locationId, date: row.date, issueId: issue.id, action: mode, clockIn: mode === 'SET_TIMES' ? clockIn || null : undefined, clockOut: mode === 'SET_TIMES' ? clockOut || null : undefined, note } });
      } else {
        await api(`/payroll/issues/${issue.id}/resolve`, { method: 'POST', body: { status: mode, note } });
      }
      onDone();
    });
  return (
    <Modal
      title={t(`joya.payroll.act.${mode}`)}
      onClose={onClose}
      footer={
        <Btn kind="primary" disabled={act.busy || (mode !== 'OPEN' && !note.trim())} onClick={submit}>
          {t('joya.save')}
        </Btn>
      }
    >
      {row ? (
        <div className={c.small} style={{ marginBottom: '0.5rem' }}>
          <Term>
            {fmtDay(row.date)} · {row.clockIn ? row.clockIn.slice(11, 16) : '—'}–{row.clockOut ? row.clockOut.slice(11, 16) : '—'}
          </Term>
        </div>
      ) : null}
      {mode === 'SET_TIMES' ? (
        <div className={c.two}>
          <Field label={t('joya.payroll.clockIn')}>
            <Input type="datetime-local" value={clockIn} onChange={(e) => setIn(e.target.value)} />
          </Field>
          <Field label={t('joya.payroll.clockOut')}>
            <Input type="datetime-local" value={clockOut} onChange={(e) => setOut(e.target.value)} />
          </Field>
        </div>
      ) : null}
      {mode === 'EXCLUDE' ? <div className={c.small}>{t('joya.payroll.excludeHelp')}</div> : null}
      {mode !== 'OPEN' ? (
        <Field label={t('joya.payroll.noteRequired')} hint={t('joya.payroll.noteHint')}>
          <TextArea value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      ) : null}
      <div className={c.small}>{t('joya.payroll.rawKept')}</div>
      <ErrorBox error={act.error} />
    </Modal>
  );
}

function IssueCard({ issue, onAction }) {
  const { t } = useT();
  const navigate = useNavigate();
  const theme = useTheme();
  const c = useStyles(theme);
  const d = issue.detail || {};
  const rows = d.rows || [];
  const open = issue.status === 'OPEN';
  return (
    <Card title={t(`joya.payroll.kind.${issue.kind}`)} right={<Badge tone={statusTone(issue.status)}>{t(`joya.status.${issue.status}`)}</Badge>}>
      <div className={c.small}>{t(`joya.payroll.kindHelp.${issue.kind}`, { limit: d.limitHours ?? '' })}</div>
      <Row label={t('joya.payroll.employee')}>
        {issue.employeeName ? (
          <bdi dir="auto">{issue.employeeName}</bdi>
        ) : (
          <Term>
            {d.source || ''}
            {d.source ? ':' : ''}
            {issue.externalId || d.externalId || '—'}
          </Term>
        )}
      </Row>
      <Row label={t('joya.payroll.month')}>
        <Term>{issue.period}</Term> · <bdi dir="auto">{issue.locationName}</bdi>
      </Row>
      {d.rowCount ? (
        <Row label={t('joya.payroll.rowCount')}>
          <Term>{d.rowCount}</Term>
        </Row>
      ) : null}
      {'attendanceHours' in d ? (
        <Row label={t('joya.payroll.attendanceHours')}>
          <Val v={d.attendanceHours} fmt={(v) => fmtNum(v, 2)} />
        </Row>
      ) : null}
      {'payrollHours' in d ? (
        <Row label={t('joya.payroll.payrollHours')}>
          <Val v={d.payrollHours} fmt={(v) => fmtNum(v, 2)} />
        </Row>
      ) : null}
      {'differenceHours' in d ? (
        <Row label={t('joya.payroll.difference')}>
          <Val v={d.differenceHours} fmt={(v) => fmtNum(v, 2)} />
        </Row>
      ) : null}
      {rows.map((r) => (
        <div key={r.id} className={c.att}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.4rem', flexWrap: 'wrap' }}>
            <span>
              <Term>{fmtDay(r.date)}</Term> · <Term>{r.clockIn ? r.clockIn.slice(11, 16) : '—'}</Term>–<Term>{r.clockOut ? r.clockOut.slice(11, 16) : '—'}</Term> · <Val v={r.hours} fmt={(v) => `${fmtNum(v, 2)}h`} />
              {r.corrected ? (
                <>
                  {' '}
                  <Badge tone="info">{t('joya.payroll.corrected')}</Badge>
                </>
              ) : null}
            </span>
            {open && issue.kind !== 'UNMATCHED_EMPLOYEE' ? (
              <span style={{ display: 'flex', gap: '0.25rem' }}>
                <Btn small onClick={() => onAction('SET_TIMES', issue, r)}>
                  {t('joya.payroll.act.SET_TIMES')}
                </Btn>
                {['DUPLICATE', 'OVERLAP'].includes(issue.kind) ? (
                  <Btn small onClick={() => onAction('EXCLUDE', issue, r)}>
                    {t('joya.payroll.act.EXCLUDE')}
                  </Btn>
                ) : null}
              </span>
            ) : null}
          </div>
        </div>
      ))}
      {issue.kind === 'UNMATCHED_EMPLOYEE' ? (
        <Btn kind="ghost" small onClick={() => navigate('/employees')}>
          {t('joya.payroll.mapId')}
        </Btn>
      ) : null}
      {issue.resolutionNote ? (
        <div className={c.small}>
          <span dir="auto">{issue.resolutionNote}</span> ·{' '}
          <Term>
            {issue.resolvedBy || '—'} · {fmtWhen(issue.resolvedAt)}
          </Term>
        </div>
      ) : null}
      <div className={c.actions}>
        {open ? (
          <>
            <Btn small onClick={() => onAction('ACCEPTED', issue)}>
              {t('joya.payroll.act.ACCEPTED')}
            </Btn>
            <Btn small onClick={() => onAction('DISMISSED', issue)}>
              {t('joya.payroll.act.DISMISSED')}
            </Btn>
          </>
        ) : (
          <Btn small kind="ghost" onClick={() => onAction('OPEN', issue)}>
            {t('joya.payroll.act.OPEN')}
          </Btn>
        )}
      </div>
    </Card>
  );
}

function Issues({ period }) {
  const { t } = useT();
  const j = useJoya();
  const theme = useTheme();
  const c = useStyles(theme);
  const [result, setResult] = useState(null);
  const [modal, setModal] = useState(null);
  const run = useAction();
  const { data, error, loading, reload } = useLoad(() => api(`/payroll/issues${qs({ locationIds: j.scope, period })}`), [j.scope.join(','), period]);
  const groups = STATUS_ORDER.map((s) => [s, (data?.issues || []).filter((i) => i.status === s)]).filter(([, l]) => l.length);
  return (
    <>
      <Card>
        <Btn
          kind="primary"
          disabled={run.busy || !j.oneLocationId}
          onClick={() =>
            run.run(async () => {
              setResult(await api('/payroll/checks', { method: 'POST', body: { locationId: j.oneLocationId, period } }));
              reload();
            })
          }
        >
          {t('joya.payroll.run')}
        </Btn>
        <div className={c.small}>
          {t('joya.payroll.runFor')} <bdi dir="auto">{j.locName(j.oneLocationId)}</bdi> · <Term>{period}</Term>
        </div>
        {result ? (
          <div className={c.small}>
            {t('joya.payroll.result', { rows: result.attendanceRows, found: result.found, created: result.created, closed: result.closed })}
            {!result.payrollCompared ? ` ${t('joya.payroll.notCompared')}` : ''}
          </div>
        ) : null}
        <ErrorBox error={run.error} />
      </Card>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : null}
      {data && !data.issues.length ? <Empty>{t('joya.payroll.noIssues')}</Empty> : null}
      {groups.map(([s, list]) => (
        <div key={s}>
          <div className={c.group}>
            {t(`joya.status.${s}`)} · <Term>{list.length}</Term>
          </div>
          <Grid>
            {list.map((i) => (
              <IssueCard key={i.id} issue={i} onAction={(mode, issue, row) => setModal({ mode, issue, row })} />
            ))}
          </Grid>
        </div>
      ))}
      {modal ? (
        <ActionModal
          {...modal}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            reload();
          }}
        />
      ) : null}
    </>
  );
}

function Lines({ period }) {
  const { t } = useT();
  const j = useJoya();
  const loc = j.oneLocationId;
  const { data, error, loading } = useLoad(() => (loc ? api(`/payroll/lines${qs({ locationId: loc, period })}`) : Promise.resolve(null)), [loc, period]);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Empty>{t('joya.chooseLocation')}</Empty>;
  const byEmp = {};
  for (const l of data.lines) (byEmp[l.employeeId ?? `x:${l.externalId}`] ||= []).push(l);
  return (
    <>
      <Card title={t('joya.payroll.totals')}>
        <Row label={t('joya.labor.gross')}>
          <Term>{fmtILS(data.totals.grossWage)}</Term>
        </Row>
        <Row label={t('joya.labor.employerExtra')}>
          <Term>{fmtILS(data.totals.employerCost)}</Term>
        </Row>
        <Row label={t('joya.payroll.other')}>
          <Term>{fmtILS(data.totals.other)}</Term>
        </Row>
        {data.totals.linesWithoutAmount ? <div style={{ fontSize: '0.74rem', color: '#d29922' }}>⚠ {t('joya.payroll.linesNoAmount', { count: data.totals.linesWithoutAmount })}</div> : null}
        <SourceLine source={data.source} />
      </Card>
      {!data.lines.length ? <Empty>{t('joya.payroll.noLines')}</Empty> : null}
      <Grid>
        {Object.values(byEmp).map((ls) => (
          <Card key={ls[0].id} title={ls[0].employeeName ? <bdi dir="auto">{ls[0].employeeName}</bdi> : <Term>{ls[0].externalId}</Term>} right={ls[0].isDemo ? <Badge tone="warn">{t('joya.demo')}</Badge> : null}>
            {ls.map((l) => (
              <Row
                key={l.id}
                label={
                  <>
                    <bdi dir="auto">{l.component}</bdi> · {t(`joya.payroll.costType.${l.costType}`)}
                  </>
                }
              >
                <Val v={l.amount} fmt={fmtILS} />
                {l.hours != null ? <Term> · {fmtNum(l.hours, 1)}h</Term> : null}
              </Row>
            ))}
          </Card>
        ))}
      </Grid>
    </>
  );
}

export default function Payroll() {
  const { t } = useT();
  const j = useJoya();
  const theme = useTheme();
  const c = useStyles(theme);
  const [period, setPeriod] = useState(() => lastMonth(j.me.today));
  const [tab, setTab] = useState('issues');
  const tabs = [['issues', t('joya.payroll.tabIssues')]];
  if (j.me.payroll) tabs.push(['lines', t('joya.payroll.tabLines')]);
  return (
    <Page title={t('joya.nav.payroll')} tabs={<Tabs tabs={tabs} value={tab} onChange={setTab} />}>
      <div className={c.banner}>{t('joya.payroll.banner')}</div>
      <Field label={t('joya.payroll.month')}>
        <Input type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} />
      </Field>
      {tab === 'issues' ? <Issues period={period} /> : null}
      {tab === 'lines' && j.me.payroll ? <Lines period={period} /> : null}
    </Page>
  );
}

