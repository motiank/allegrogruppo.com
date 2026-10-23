// /staffing/:id — one weekly staffing plan: the week by day and shift, the reason
// behind every number, manager edits (never under a mandatory minimum), approval,
// the CSV for Tabit, planned vs actual, the original proposal and the edit log.
import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { createUseStyles, useTheme } from 'react-jss';
import { api } from '../api.js';
import { useT } from '../i18n/index.js';
import { useJoya } from '../context.js';
import AskBox from '../AskBox.js';
import { ruleSentence, scopeText } from './Rules.js';
import { UnitsHelp } from './Staffing.js';
import {
  Page,
  Card,
  Grid,
  Row,
  Btn,
  Badge,
  Field,
  Input,
  Select,
  TextArea,
  Modal,
  Tabs,
  DemoBanner,
  SourceLine,
  Val,
  Loading,
  Empty,
  ErrorBox,
  Details,
  Pre,
  useLoad,
  useAction,
  fmtNum,
  fmtDay,
  fmtWhen,
  hhmm,
  weekdayOf,
  addDays,
  statusTone,
  Term,
} from '../ui.js';

const UNITS = ['DINERS_PER_SHIFT', 'DINERS_PEAK_HOUR', 'CONCURRENT_DINERS_PEAK', 'ORDERS_PER_SHIFT', 'ORDERS_PEAK_HOUR'];

const useStyles = createUseStyles((theme) => ({
  shift: { borderTop: `1px solid ${theme.border}`, paddingTop: '0.45rem', marginTop: '0.45rem' },
  shiftHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.25rem' },
  line: {
    display: 'block',
    width: '100%',
    textAlign: 'start',
    background: 'none',
    border: `1px solid ${theme.border}`,
    borderRadius: 7,
    color: theme.text,
    padding: '0.35rem 0.5rem',
    marginBottom: '0.3rem',
    fontSize: '0.84rem',
    cursor: 'pointer',
    fontFamily: 'inherit',
    '&:hover': { borderColor: theme.primary },
  },
  lineTop: { display: 'flex', justifyContent: 'space-between', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' },
  small: { fontSize: '0.72rem', color: theme.textSecondary, marginTop: '0.15rem' },
  warnBox: { border: '1px solid #d29922', borderRadius: 8, padding: '0.5rem 0.7rem', marginBottom: '0.65rem', fontSize: '0.8rem', color: '#d29922' },
  stepper: { display: 'flex', alignItems: 'center', gap: '0.5rem' },
  count: { fontSize: '1.2rem', fontWeight: 700, minWidth: '2rem', textAlign: 'center' },
  two: { display: 'flex', gap: '0.5rem', '& > *': { flex: 1 } },
}));

const toHHMM = (s) => (s ? String(s).slice(0, 5) : '');

/** Translate a forecast warning into one sentence. */
function warningText(t, w, roleName) {
  const role = w.role ? roleName(w.role) : '';
  const units = (w.units || (w.unit ? [w.unit] : [])).map((u) => t(`joya.unit.${u}`)).join(', ');
  return t(`joya.staff.warn.${w.code}`, { role, units, min: w.min ?? w.minRequired ?? '', max: w.max ?? '' });
}

function LineModal({ line, plan, onClose, onDone }) {
  const { t } = useT();
  const { roleName } = useJoya();
  const theme = useTheme();
  const c = useStyles(theme);
  const draft = plan.status === 'DRAFT';
  const [hc, setHc] = useState(line.headcount);
  const [start, setStart] = useState(toHHMM(line.start));
  const [end, setEnd] = useState(toHHMM(line.end));
  const [note, setNote] = useState('');
  const act = useAction();
  const ex = line.explain;
  const send = (ops) =>
    act.run(async () => {
      await api(`/staffing/plans/${plan.id}/ops`, { method: 'POST', body: { ops } });
      onDone();
    });

  return (
    <Modal
      title={
        <>
          {roleName(line.roleCode)} · {t(`joya.wd.${line.weekday}`)} <Term>{fmtDay(line.date)}</Term>
        </>
      }
      onClose={onClose}
    >
      {ex ? (
        <>
          <div style={{ fontWeight: 650, fontSize: '0.85rem', marginBottom: '0.3rem' }}>{t('joya.staff.why')}</div>
          {ex.calc?.length ? (
            <div style={{ marginBottom: '0.4rem' }}>
              {ex.calc.map((x, i) => (
                <div key={i} style={{ fontSize: '0.82rem' }}>
                  <Term>{x}</Term>
                </div>
              ))}
            </div>
          ) : null}
          {ex.demand ? (
            <Card>
              <Row label={t('joya.staff.demandUsed')}>{t(`joya.unit.${ex.demand.unit}`)}</Row>
              <Row label={t('joya.staff.forecastValue')}>
                <Val v={ex.demand.value} />
              </Row>
              <Row label={t('joya.staff.basedOn')}>{t('joya.staff.nDays', { count: ex.demand.n ?? 0 })}</Row>
              {ex.demand.confidence ? <Row label={t('joya.staff.confidence')}>{t(`joya.conf.${ex.demand.confidence}`)}</Row> : null}
            </Card>
          ) : null}
          {(ex.rules || []).map((r) => (
            <Card key={r.id}>
              <div style={{ fontSize: '0.82rem' }}>
                {ruleSentence(t, r.type, r.unit, r.params)}{' '}
                {r.mandatory ? <Badge tone="bad">{t('joya.rules.mandatory')}</Badge> : null}
              </div>
              <div className={c.small}>{scopeText(t, { loc: r.scope?.location ? t('joya.rules.thisLocation') : null, shift: r.scope?.shift ? t('joya.rules.thisShift') : null, days: r.scope?.days })}</div>
              {r.note ? (
                <div className={c.small} dir="auto">
                  {r.note}
                </div>
              ) : null}
            </Card>
          ))}
          {(ex.notes || []).map((n, i) => (
            <div key={i} className={c.small} style={{ color: '#d29922' }}>
              {t(`joya.staff.note.${n.code}`, { unit: n.unit ? t(`joya.unit.${n.unit}`) : '' })}
            </div>
          ))}
          {ex.learned ? (
            <div className={c.small}>{t('joya.staff.learned', { delta: `${ex.learned.delta > 0 ? '+' : ''}${ex.learned.delta}`, seen: ex.learned.seen, window: ex.learned.window, rule: ex.learned.ruleResult })}</div>
          ) : null}
          {ex.baseline != null ? <div className={c.small}>{t('joya.staff.baseline', { n: ex.baseline })}</div> : null}
        </>
      ) : (
        <div className={c.small}>{t('joya.staff.addedByManager')}</div>
      )}
      {line.proposed && line.proposed.headcount !== line.headcount ? <div className={c.small}>{t('joya.staff.proposedWas', { n: line.proposed.headcount })}</div> : null}
      {line.minRequired > 0 ? <div className={c.small}>{t('joya.staff.minExplain', { n: line.minRequired })}</div> : null}

      {draft ? (
        <div style={{ marginTop: '0.8rem', borderTop: `1px solid ${theme.border}`, paddingTop: '0.6rem' }}>
          <Field label={t('joya.staff.headcount')}>
            <div className={c.stepper}>
              <Btn onClick={() => setHc((x) => Math.max(0, x - 1))}>−</Btn>
              <span className={c.count}>
                <Term>{hc}</Term>
              </span>
              <Btn onClick={() => setHc((x) => x + 1)}>+</Btn>
            </div>
          </Field>
          <div className={c.two}>
            <Field label={t('joya.staff.start')}>
              <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label={t('joya.staff.end')}>
              <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </Field>
          </div>
          <Field label={t('joya.noteOptional')}>
            <TextArea value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <ErrorBox error={act.error} />
          {act.error?.code === 'MANDATORY_MIN' ? <div className={c.small}>{t('joya.staff.minByAdmin')}</div> : null}
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            <Btn kind="primary" disabled={act.busy} onClick={() => send([{ op: 'set', lineId: line.id, headcount: hc, start, end, note: note || undefined }])}>
              {t('joya.save')}
            </Btn>
            <Btn kind="danger" disabled={act.busy} onClick={() => send([{ op: 'remove', lineId: line.id, note: note || undefined }])}>
              {t('joya.staff.removeLine')}
            </Btn>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

function AddModal({ plan, date, shift, onClose, onDone }) {
  const { t } = useT();
  const { me, roleName } = useJoya();
  const theme = useTheme();
  const c = useStyles(theme);
  const [role, setRole] = useState(me.roles.find((r) => r.active)?.code || '');
  const [hc, setHc] = useState(1);
  const [start, setStart] = useState(toHHMM(shift.start));
  const [end, setEnd] = useState(toHHMM(shift.end));
  const [note, setNote] = useState('');
  const act = useAction();
  return (
    <Modal
      title={
        <>
          {t('joya.staff.addRole')} · {t(`joya.wd.${weekdayOf(date)}`)} <Term>{fmtDay(date)}</Term> · <bdi dir="auto">{shift.name}</bdi>
        </>
      }
      onClose={onClose}
      footer={
        <Btn
          kind="primary"
          disabled={act.busy || !role || hc < 1}
          onClick={() =>
            act.run(async () => {
              await api(`/staffing/plans/${plan.id}/ops`, { method: 'POST', body: { ops: [{ op: 'add', date, shiftCode: shift.code, roleCode: role, headcount: hc, start, end, note: note || undefined }] } });
              onDone();
            })
          }
        >
          {t('joya.add')}
        </Btn>
      }
    >
      <Field label={t('joya.staff.role')}>
        <Select value={role} onChange={(e) => setRole(e.target.value)}>
          {me.roles
            .filter((r) => r.active)
            .map((r) => (
              <option key={r.code} value={r.code}>
                {roleName(r.code)}
              </option>
            ))}
        </Select>
      </Field>
      <Field label={t('joya.staff.headcount')}>
        <Input type="number" min="1" step="1" value={hc} onChange={(e) => setHc(Math.max(1, parseInt(e.target.value, 10) || 1))} />
      </Field>
      <div className={c.two}>
        <Field label={t('joya.staff.start')}>
          <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label={t('joya.staff.end')}>
          <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>
      <Field label={t('joya.noteOptional')}>
        <TextArea value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <ErrorBox error={act.error} />
    </Modal>
  );
}

function Week({ data, reload }) {
  const { t } = useT();
  const j = useJoya();
  const theme = useTheme();
  const c = useStyles(theme);
  const { plan, lines } = data;
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(null);
  const slots = plan.forecast?.slots || [];
  const days = Array.from({ length: 7 }, (_, i) => addDays(plan.weekStart, i));

  return (
    <>
      <Grid>
        {days.map((date) => {
          const daySlots = slots.filter((s) => s.date === date).map((s) => ({ code: s.shiftCode, name: s.shiftName, start: s.start, end: s.end }));
          for (const l of lines.filter((x) => x.date === date)) {
            if (!daySlots.some((s) => s.code === l.shiftCode)) daySlots.push({ code: l.shiftCode, name: j.shiftName(plan.locationId, l.shiftCode), start: l.start, end: l.end });
          }
          return (
            <Card
              key={date}
              title={
                <>
                  {t(`joya.wd.${weekdayOf(date)}`)} <Term>{fmtDay(date)}</Term>
                </>
              }
            >
              {!daySlots.length ? <div className={c.small}>{t('joya.staff.closedDay')}</div> : null}
              {daySlots.map((s) => {
                const ls = lines.filter((l) => l.date === date && l.shiftCode === s.code);
                const people = ls.reduce((a, l) => a + l.headcount, 0);
                return (
                  <div key={s.code} className={c.shift}>
                    <div className={c.shiftHead}>
                      <span>
                        <bdi dir="auto">{s.name || j.shiftName(plan.locationId, s.code)}</bdi>{' '}
                        <Term>
                          {hhmm(s.start)}–{hhmm(s.end)}
                        </Term>
                      </span>
                      <span className={c.small}>{t('joya.staff.people', { count: people })}</span>
                    </div>
                    {ls.map((l) => (
                      <button key={l.id} type="button" className={c.line} onClick={() => setOpen(l)}>
                        <div className={c.lineTop}>
                          <span>
                            <b>
                              <Term>{l.headcount}</Term>
                            </b>{' '}
                            {j.roleName(l.roleCode)}{' '}
                            <Term>
                              {hhmm(l.start)}–{hhmm(l.end)}
                            </Term>
                          </span>
                          <span style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                            {l.isPeakExtra ? <Badge tone="info">{t('joya.staff.peak')}</Badge> : null}
                            {l.origin === 'ADDED' ? <Badge tone="warn">{t('joya.staff.added')}</Badge> : null}
                            {l.minRequired > 0 ? <Badge tone="muted">{t('joya.staff.min', { n: l.minRequired })}</Badge> : null}
                          </span>
                        </div>
                        {l.proposed && l.proposed.headcount !== l.headcount ? <div className={c.small}>{t('joya.staff.proposedWas', { n: l.proposed.headcount })}</div> : null}
                        {l.explain?.learned ? (
                          <div className={c.small}>
                            {t('joya.staff.learned', {
                              delta: `${l.explain.learned.delta > 0 ? '+' : ''}${l.explain.learned.delta}`,
                              seen: l.explain.learned.seen,
                              window: l.explain.learned.window,
                              rule: l.explain.learned.ruleResult,
                            })}
                          </div>
                        ) : null}
                        {l.explain?.baseline != null ? <div className={c.small}>{t('joya.staff.baseline', { n: l.explain.baseline })}</div> : null}
                      </button>
                    ))}
                    {plan.status === 'DRAFT' ? (
                      <Btn kind="ghost" small onClick={() => setAdding({ date, shift: s })}>
                        + {t('joya.staff.addRole')}
                      </Btn>
                    ) : null}
                  </div>
                );
              })}
            </Card>
          );
        })}
      </Grid>
      {open ? (
        <LineModal
          line={open}
          plan={plan}
          onClose={() => setOpen(null)}
          onDone={() => {
            setOpen(null);
            reload();
          }}
        />
      ) : null}
      {adding ? (
        <AddModal
          plan={plan}
          date={adding.date}
          shift={adding.shift}
          onClose={() => setAdding(null)}
          onDone={() => {
            setAdding(null);
            reload();
          }}
        />
      ) : null}
    </>
  );
}

function Actual({ planId, locationId }) {
  const { t } = useT();
  const j = useJoya();
  const { data, error, loading } = useLoad(() => api(`/staffing/plans/${planId}/actual`), [planId]);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data.available) return <Empty>{t('joya.staff.weekNotStarted')}</Empty>;
  return (
    <>
      <SourceLine source={`${data.sources.demand} · ${data.sources.hours}`} period={{ from: data.from, to: data.to }} />
      <Card title={t('joya.staff.hoursByRole')}>
        {Object.entries(data.byRole).map(([role, v]) => (
          <Row key={role} label={role === '_unknown' ? t('joya.staff.roleUnknown') : j.roleName(role)}>
            <Term>
              {fmtNum(v.plannedHours, 1)} → {fmtNum(v.actualHours, 1)}
            </Term>
            {v.missingHoursRows ? (
              <>
                {' '}
                <Badge tone="warn">{t('joya.staff.rowsMissingHours', { count: v.missingHoursRows })}</Badge>
              </>
            ) : null}
          </Row>
        ))}
        <div style={{ fontSize: '0.72rem', marginTop: '0.3rem' }}>{t('joya.staff.plannedArrowActual')}</div>
      </Card>
      <Grid>
        {data.slots.map((s) => (
          <Card
            key={`${s.date}-${s.shiftCode}`}
            title={
              <>
                {t(`joya.wd.${weekdayOf(s.date)}`)} <Term>{fmtDay(s.date)}</Term> · {j.shiftName(locationId, s.shiftCode)}
              </>
            }
          >
            {!s.hasData ? <Badge tone="warn">{t('joya.staff.noActualData')}</Badge> : null}
            {UNITS.map((u) => (
              <Row key={u} label={t(`joya.unit.${u}`)}>
                <Val v={s.forecast?.[u]} /> → <Val v={s.actual?.[u]} />
              </Row>
            ))}
            <Row label={t('joya.staff.plannedPeopleHours')}>
              <Term>
                {s.plannedPeople} · {fmtNum(s.plannedHours, 1)}h
              </Term>
            </Row>
          </Card>
        ))}
      </Grid>
      <div style={{ fontSize: '0.72rem' }}>{t('joya.staff.forecastArrowActual')}</div>
    </>
  );
}

function Proposal({ data }) {
  const { t } = useT();
  const j = useJoya();
  const byDate = {};
  for (const l of data.proposal) (byDate[l.date] ||= []).push(l);
  return (
    <>
      <div style={{ fontSize: '0.8rem', marginBottom: '0.5rem' }}>{t('joya.staff.proposalHelp')}</div>
      <Grid>
        {Object.entries(byDate).map(([date, ls]) => (
          <Card
            key={date}
            title={
              <>
                {t(`joya.wd.${weekdayOf(date)}`)} <Term>{fmtDay(date)}</Term>
              </>
            }
          >
            {ls.map((l) => (
              <Row
                key={l.id}
                label={
                  <>
                    {j.shiftName(data.plan.locationId, l.shiftCode)} · {j.roleName(l.roleCode)} {l.isPeakExtra ? <Badge tone="info">{t('joya.staff.peak')}</Badge> : null}
                  </>
                }
              >
                <Term>
                  {l.headcount} · {hhmm(l.start)}–{hhmm(l.end)}
                </Term>
              </Row>
            ))}
          </Card>
        ))}
      </Grid>
    </>
  );
}

function Log({ data }) {
  const { t } = useT();
  if (!data.edits.length) return <Empty>{t('joya.staff.noEdits')}</Empty>;
  return data.edits.map((e) => (
    <Card
      key={e.id}
      title={t(`joya.staff.action.${e.action}`)}
      right={
        <Term>
          {e.by} · {fmtWhen(e.at)}
        </Term>
      }
    >
      <Row label={t('joya.staff.via')}>{t(`joya.staff.via.${e.via}`)}</Row>
      {e.note ? (
        <div dir="auto" style={{ fontSize: '0.8rem' }}>
          {e.note}
        </div>
      ) : null}
      {e.before || e.after ? (
        <Details summary={t('joya.staff.beforeAfter')}>
          <Pre>{{ before: e.before, after: e.after }}</Pre>
        </Details>
      ) : null}
    </Card>
  ));
}

export default function StaffPlan() {
  const { id } = useParams();
  const { t, lang } = useT();
  const j = useJoya();
  const theme = useTheme();
  const c = useStyles(theme);
  const [tab, setTab] = useState('week');
  const [modal, setModal] = useState(null); // 'approve' | 'reject'
  const [note, setNote] = useState('');
  const act = useAction();
  const { data, error, loading, reload } = useLoad(() => api(`/staffing/plans/${id}`), [id]);

  if (loading && !data) return <Page title={t('joya.nav.staffing')} back="/staffing"><Loading /></Page>;
  if (error && !data) return <Page title={t('joya.nav.staffing')} back="/staffing"><ErrorBox error={error} /></Page>;
  const { plan } = data;
  const warnings = plan.forecast?.warnings || [];
  const doAction = (what, body) =>
    act.run(async () => {
      await api(`/staffing/plans/${id}/${what}`, { method: 'POST', body: body || {} });
      setModal(null);
      setNote('');
      reload();
    });

  return (
    <Page
      back="/staffing"
      title={
        <>
          {t('joya.staff.weekOf')} <Term>{fmtDay(plan.weekStart)}</Term>
        </>
      }
      sub={
        <>
          <bdi dir="auto">{plan.locationName}</bdi> · <Badge tone={statusTone(plan.status)}>{t(`joya.status.${plan.status}`)}</Badge> ·{' '}
          {t('joya.staff.proposedByAt', { who: plan.createdBy || '—', when: fmtWhen(plan.createdAt) })}
          {plan.approvedBy ? <> · {t('joya.staff.approvedByAt', { who: plan.approvedBy, when: fmtWhen(plan.approvedAt) })}</> : null}
          {plan.rejectedBy ? <> · {t('joya.staff.rejectedByAt', { who: plan.rejectedBy, when: fmtWhen(plan.rejectedAt) })}</> : null}
        </>
      }
      actions={
        <>
          {plan.status === 'DRAFT' ? (
            <>
              <Btn kind="primary" onClick={() => setModal('approve')}>
                {t('joya.approve')}
              </Btn>
              <Btn kind="danger" onClick={() => setModal('reject')}>
                {t('joya.reject')}
              </Btn>
            </>
          ) : null}
          {plan.status === 'APPROVED' ? (
            <Btn disabled={act.busy} onClick={() => doAction('reopen')}>
              {t('joya.staff.reopen')}
            </Btn>
          ) : null}
        </>
      }
      tabs={
        <Tabs
          tabs={[
            ['week', t('joya.staff.tabWeek')],
            ['actual', t('joya.staff.tabActual')],
            ['proposal', t('joya.staff.tabProposal')],
            ['log', t('joya.staff.tabLog')],
          ]}
          value={tab}
          onChange={setTab}
        />
      }
    >
      {plan.isDemo ? <DemoBanner /> : null}
      <ErrorBox error={act.error} />
      {warnings.length ? (
        <div className={c.warnBox}>
          <b>{t('joya.staff.warningsTitle')}</b>
          {warnings.map((w, i) => (
            <div key={i}>
              {w.date ? (
                <>
                  <Term>{fmtDay(w.date)}</Term> · {j.shiftName(plan.locationId, w.shiftCode)}:{' '}
                </>
              ) : null}
              {warningText(t, w, j.roleName)}
            </div>
          ))}
        </div>
      ) : null}
      {data.violations?.length ? (
        <ErrorBox error={{ message: t('joya.staff.violationsTitle'), details: { violations: data.violations } }} />
      ) : null}
      {data.violations?.length ? <div className={c.small}>{t('joya.staff.minByAdmin')}</div> : null}

      {tab === 'week' ? (
        <>
          <Card>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <a href={`/api/joya/staffing/plans/${id}/export.csv?lang=${lang}`} download style={{ color: theme.primary, fontWeight: 600, fontSize: '0.85rem' }}>
                {t('joya.staff.exportCsv')}
              </a>
            </div>
            <div className={c.small}>{t('joya.staff.exportNote')}</div>
            <UnitsHelp />
          </Card>
          <Week data={data} reload={reload} />
          <AskBox
            contextKind="STAFFING_PLAN"
            contextId={Number(id)}
            locationId={plan.locationId}
            onApplied={reload}
            examples={[t('joya.staff.ex1'), t('joya.staff.ex2'), t('joya.staff.ex3'), t('joya.staff.ex4')]}
          />
        </>
      ) : null}
      {tab === 'actual' ? <Actual planId={id} locationId={plan.locationId} /> : null}
      {tab === 'proposal' ? <Proposal data={data} /> : null}
      {tab === 'log' ? <Log data={data} /> : null}

      {modal ? (
        <Modal
          title={modal === 'approve' ? t('joya.staff.approveTitle') : t('joya.staff.rejectTitle')}
          onClose={() => setModal(null)}
          footer={
            <Btn kind={modal === 'approve' ? 'primary' : 'danger'} disabled={act.busy} onClick={() => doAction(modal, { note: note || undefined })}>
              {modal === 'approve' ? t('joya.approve') : t('joya.reject')}
            </Btn>
          }
        >
          {modal === 'approve' ? <div style={{ fontSize: '0.82rem', marginBottom: '0.5rem' }}>{t('joya.staff.approveHelp')}</div> : null}
          <Field label={t('joya.noteOptional')}>
            <TextArea value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <ErrorBox error={act.error} />
        </Modal>
      ) : null}
    </Page>
  );
}
