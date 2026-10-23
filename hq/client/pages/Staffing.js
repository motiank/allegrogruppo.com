// /staffing — weekly staffing plans of the chosen location(s), a "propose" action,
// and the demand forecast the proposal is built from.
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useT } from '../i18n/index.js';
import { useJoya } from '../context.js';
import { Page, Card, Grid, Row, Btn, Badge, Field, Input, Tabs, Loading, Empty, ErrorBox, Details, Val, SourceLine, useLoad, useAction, fmtDay, fmtWhen, hhmm, addDays, statusTone, Term } from '../ui.js';

const UNITS = ['DINERS_PER_SHIFT', 'DINERS_PEAK_HOUR', 'CONCURRENT_DINERS_PEAK', 'ORDERS_PER_SHIFT', 'ORDERS_PEAK_HOUR'];
const confTone = { HIGH: 'ok', MEDIUM: 'info', LOW: 'warn', NONE: 'bad' };

function nextSunday(today) {
  const d = today || new Date().toISOString().slice(0, 10);
  const wd = new Date(d + 'T00:00:00Z').getUTCDay();
  return addDays(d, 7 - wd);
}

function Plans() {
  const { t } = useT();
  const j = useJoya();
  const navigate = useNavigate();
  const [week, setWeek] = useState(() => nextSunday(j.me?.today));
  const act = useAction();
  const { data, error, loading } = useLoad(() => api(`/staffing/plans${qs({ locationIds: j.scope })}`), [j.scope.join(',')]);

  const propose = (force) =>
    act.run(async () => {
      const r = await api('/staffing/plans/propose', { method: 'POST', body: { locationId: j.oneLocationId, weekStart: week, force } });
      navigate(`/staffing/${r.planId}`);
    });

  return (
    <>
      <Card title={t('joya.staff.proposeTitle')}>
        <div style={{ fontSize: '0.8rem', marginBottom: '0.5rem' }}>{t('joya.staff.proposeHelp')}</div>
        {j.locationId == null && j.locations.length > 1 ? (
          <div style={{ fontSize: '0.78rem', marginBottom: '0.5rem' }}>
            {t('joya.staff.proposeFor')} <bdi dir="auto">{j.locName(j.oneLocationId)}</bdi>
          </div>
        ) : null}
        <Field label={t('joya.staff.week')} hint={t('joya.staff.weekHint')}>
          <Input type="date" value={week} onChange={(e) => setWeek(e.target.value)} />
        </Field>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          <Btn kind="primary" disabled={act.busy || !j.oneLocationId} onClick={() => propose(false)}>
            {t('joya.staff.propose')}
          </Btn>
          <Btn disabled={act.busy || !j.oneLocationId} onClick={() => propose(true)}>
            {t('joya.staff.proposeAgain')}
          </Btn>
        </div>
        <ErrorBox error={act.error} />
      </Card>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : null}
      {data && !data.plans.length ? <Empty>{t('joya.staff.noPlans')}</Empty> : null}
      <Grid>
        {(data?.plans || []).map((p) => (
          <Card
            key={p.id}
            onClick={() => navigate(`/staffing/${p.id}`)}
            title={
              <>
                {t('joya.staff.weekOf')} <Term>{fmtDay(p.weekStart)}</Term>
              </>
            }
            right={<Badge tone={statusTone(p.status)}>{t(`joya.status.${p.status}`)}</Badge>}
          >
            <Row label={t('joya.location')}>
              <bdi dir="auto">{p.locationName}</bdi> {p.isDemo ? <Badge tone="warn">{t('joya.demo')}</Badge> : null}
            </Row>
            <Row label={t('joya.staff.peopleShifts')}>
              <Term>{p.people}</Term>
            </Row>
            <Row label={t('joya.staff.proposedBy')}>
              <Term>{p.createdBy || '—'}</Term>
            </Row>
            {p.approvedBy ? (
              <Row label={t('joya.staff.approvedBy')}>
                <Term>
                  {p.approvedBy} · {fmtWhen(p.approvedAt)}
                </Term>
              </Row>
            ) : null}
          </Card>
        ))}
      </Grid>
    </>
  );
}

export function UnitsHelp() {
  const { t } = useT();
  return (
    <Details summary={t('joya.staff.unitsHelpTitle')}>
      {UNITS.map((u) => (
        <div key={u} style={{ margin: '0.3rem 0' }}>
          <b>{t(`joya.unit.${u}`)}</b> — {t(`joya.unitHelp.${u}`)}
        </div>
      ))}
    </Details>
  );
}

function Forecast() {
  const { t } = useT();
  const j = useJoya();
  const [week, setWeek] = useState(() => nextSunday(j.me?.today));
  const loc = j.oneLocationId;
  const { data, error, loading } = useLoad(() => (loc ? api(`/staffing/forecast${qs({ locationId: loc, weekStart: week })}`) : Promise.resolve(null)), [loc, week]);
  return (
    <>
      <Card>
        <div style={{ fontSize: '0.8rem', marginBottom: '0.4rem' }}>{t('joya.staff.forecastHelp')}</div>
        <Field label={t('joya.staff.week')}>
          <Input type="date" value={week} onChange={(e) => setWeek(e.target.value)} />
        </Field>
        <UnitsHelp />
      </Card>
      <ErrorBox error={error} />
      {loading ? <Loading /> : null}
      {data ? (
        <>
          <SourceLine source="joya_sales_checks (Bikum)" missing={t('joya.staff.forecastMethod', { weeks: data.historyWeeks, min: data.minDays })} />
          {!data.slots.length ? <Empty>{t('joya.staff.noShifts')}</Empty> : null}
          <Grid>
            {data.slots.map((s) => {
              const missing = s.history.filter((h) => !h.hasData).map((h) => h.date);
              return (
                <Card
                  key={`${s.date}-${s.shiftCode}`}
                  title={
                    <>
                      {t(`joya.wd.${s.weekday}`)} <Term>{fmtDay(s.date)}</Term> · <bdi dir="auto">{s.shiftName}</bdi>
                    </>
                  }
                  right={
                    <Term>
                      {hhmm(s.start)}–{hhmm(s.end)}
                    </Term>
                  }
                >
                  {UNITS.map((u) => {
                    const f = s.demand[u];
                    return (
                      <Row key={u} label={t(`joya.unit.${u}`)}>
                        <Val v={f.value} /> <Badge tone={confTone[f.confidence]}>{t(`joya.conf.${f.confidence}`)}</Badge>{' '}
                        <span style={{ fontWeight: 400, fontSize: '0.75rem' }}>{t('joya.staff.nDays', { count: f.n })}</span>
                      </Row>
                    );
                  })}
                  <Details summary={t('joya.staff.pastDates')}>
                    {s.history.map((h) => (
                      <div key={h.date} style={{ fontSize: '0.75rem', padding: '0.1rem 0' }}>
                        <Term>{fmtDay(h.date)}</Term>:{' '}
                        {h.hasData ? (
                          <>
                            {t('joya.staff.histLine', { checks: h.checks ?? '—' })} <Term>{h.values?.DINERS_PER_SHIFT ?? '—'}</Term>
                          </>
                        ) : (
                          <Badge tone="warn">{t('joya.missing')}</Badge>
                        )}
                      </div>
                    ))}
                    {missing.length ? <div style={{ fontSize: '0.72rem', color: '#d29922' }}>{t('joya.staff.missingNotZero')}</div> : null}
                  </Details>
                </Card>
              );
            })}
          </Grid>
        </>
      ) : null}
    </>
  );
}

export default function Staffing() {
  const { t } = useT();
  const [tab, setTab] = useState('plans');
  return (
    <Page
      title={t('joya.nav.staffing')}
      sub={t('joya.staff.sub')}
      tabs={
        <Tabs
          tabs={[
            ['plans', t('joya.staff.tabPlans')],
            ['forecast', t('joya.staff.tabForecast')],
          ]}
          value={tab}
          onChange={setTab}
        />
      }
    >
      {tab === 'plans' ? <Plans /> : <Forecast />}
    </Page>
  );
}
