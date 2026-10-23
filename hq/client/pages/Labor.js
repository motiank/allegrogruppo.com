// /labor — labor cost monitoring: sales, worked hours, sales per labor hour, and
// (payroll access only) labor cost as known from payroll or estimated from hours × wage.
import React, { useState } from 'react';
import { createUseStyles, useTheme } from 'react-jss';
import { api, qs } from '../api.js';
import { useT } from '../i18n/index.js';
import { useJoya } from '../context.js';
import { Page, Card, Grid, Row, Btn, Badge, Field, Input, Loading, Empty, ErrorBox, SourceLine, Val, Details, useLoad, fmtILS, fmtNum, fmtPctPlain, fmtDay, addDays, Term } from '../ui.js';

const useStyles = createUseStyles((theme) => ({
  intro: { fontSize: '0.8rem', lineHeight: 1.55, color: theme.textSecondary },
  two: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', '& > *': { flex: '1 1 140px', minWidth: 0 } },
  presets: { display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '0.4rem' },
  sub: { border: `1px solid ${theme.border}`, borderRadius: 8, padding: '0.5rem 0.6rem', marginTop: '0.5rem' },
  subHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.82rem', fontWeight: 650, marginBottom: '0.25rem' },
  warn: { fontSize: '0.74rem', color: '#d29922', marginTop: '0.2rem' },
  small: { fontSize: '0.74rem', color: theme.textSecondary, marginTop: '0.2rem' },
}));

function presets(today) {
  const y = addDays(today, -1);
  const firstThis = today.slice(0, 8) + '01';
  const lastPrev = addDays(firstThis, -1);
  return {
    d7: [addDays(y, -6), y],
    d30: [addDays(y, -29), y],
    month: [lastPrev.slice(0, 8) + '01', lastPrev],
  };
}

function PctWithWarning({ pct, complete, missingDays }) {
  const { t } = useT();
  const theme = useTheme();
  const c = useStyles(theme);
  return (
    <>
      <Val v={pct} fmt={fmtPctPlain} />
      {complete === false ? <div className={c.warn}>⚠ {t('joya.labor.salesIncomplete', { count: missingDays ?? 0 })}</div> : null}
    </>
  );
}

export default function Labor() {
  const { t } = useT();
  const j = useJoya();
  const theme = useTheme();
  const c = useStyles(theme);
  const p = presets(j.me.today);
  const [range, setRange] = useState(p.d7);
  const [from, to] = range;
  const sum = useLoad(() => api(`/labor/summary${qs({ locationIds: j.scope, from, to })}`), [j.scope.join(','), from, to]);
  const pva = useLoad(() => api(`/labor/planned-vs-actual${qs({ locationIds: j.scope, from, to })}`), [j.scope.join(','), from, to]);
  const data = sum.data;

  return (
    <Page title={t('joya.nav.labor')} sub={t('joya.labor.sub')}>
      <Card>
        <div className={c.presets}>
          <Btn small onClick={() => setRange(p.d7)}>
            {t('joya.labor.last7')}
          </Btn>
          <Btn small onClick={() => setRange(p.d30)}>
            {t('joya.labor.last30')}
          </Btn>
          <Btn small onClick={() => setRange(p.month)}>
            {t('joya.labor.lastMonth')}
          </Btn>
        </div>
        <div className={c.two}>
          <Field label={t('joya.from')}>
            <Input type="date" value={from} onChange={(e) => e.target.value && setRange([e.target.value, to < e.target.value ? e.target.value : to])} />
          </Field>
          <Field label={t('joya.to')}>
            <Input type="date" value={to} onChange={(e) => e.target.value && setRange([from > e.target.value ? e.target.value : from, e.target.value])} />
          </Field>
        </div>
        <Details summary={t('joya.labor.howTitle')}>
          <div className={c.intro}>
            <p>{t('joya.labor.howGross')}</p>
            <p>{t('joya.labor.howKnown')}</p>
            <p>{t('joya.labor.howEstimate')}</p>
          </div>
        </Details>
      </Card>
      <ErrorBox error={sum.error} />
      {sum.loading && !data ? <Loading /> : null}
      {data && !data.payrollVisible ? <div className={c.small} style={{ marginBottom: '0.6rem' }}>{t('joya.labor.noPayroll')}</div> : null}
      {data && !data.locations.length ? <Empty>{t('joya.none')}</Empty> : null}
      <Grid>
        {(data?.locations || []).map((l) => (
          <Card key={l.locationId} title={<bdi dir="auto">{j.locName(l.locationId)}</bdi>} right={j.isDemo(l.locationId) ? <Badge tone="warn">{t('joya.demo')}</Badge> : null}>
            <Row label={t('joya.labor.sales')}>
              <Val v={l.revenue} fmt={fmtILS} />
            </Row>
            {l.salesDaysMissing ? <div className={c.warn}>⚠ {t('joya.labor.salesDaysMissing', { count: l.salesDaysMissing })}</div> : null}
            <Row label={t('joya.labor.hours')}>
              <Val v={l.attendanceRows ? l.hours : null} fmt={(v) => fmtNum(v, 1)} />
            </Row>
            {l.rowsMissingHours ? <div className={c.warn}>⚠ {t('joya.labor.rowsMissingHours', { count: l.rowsMissingHours })}</div> : null}
            <Row label={t('joya.labor.salesPerHour')}>
              <Val v={l.salesPerLaborHour} fmt={fmtILS} />
            </Row>

            {data.payrollVisible && l.estimate ? (
              <div className={c.sub}>
                <div className={c.subHead}>
                  <span>{t('joya.labor.estimateTitle')}</span>
                  <Badge tone="warn">{t('joya.estimate')}</Badge>
                </div>
                <Row label={t('joya.labor.gross')}>
                  <Val v={l.estimate.grossWage} fmt={fmtILS} />
                </Row>
                <Row label={t('joya.labor.employerCostEst', { factor: l.estimate.employerCostFactor })}>
                  <Val v={l.estimate.employerCost} fmt={fmtILS} />
                </Row>
                <Row label={t('joya.labor.laborPct')}>
                  <PctWithWarning pct={l.estimate.laborPctOfSales} complete={l.estimate.salesComplete} missingDays={l.salesDaysMissing} />
                </Row>
                {l.estimate.rowsWithoutWageOrHours ? <div className={c.warn}>⚠ {t('joya.labor.rowsNoWage', { count: l.estimate.rowsWithoutWageOrHours })}</div> : null}
              </div>
            ) : null}

            {data.payrollVisible ? (
              l.known ? (
                <div className={c.sub}>
                  <div className={c.subHead}>
                    <span>{t('joya.labor.knownTitle')}</span>
                    <Badge tone="ok">{t('joya.labor.knownBadge')}</Badge>
                  </div>
                  <div className={c.small}>
                    {t('joya.labor.months')} <Term>{l.known.months.join(', ')}</Term>
                    {l.known.monthsWithPayroll.length < l.known.months.length ? (
                      <>
                        {' '}
                        · {t('joya.labor.monthsWithPayroll')} <Term>{l.known.monthsWithPayroll.join(', ') || '—'}</Term>
                      </>
                    ) : null}
                  </div>
                  <Row label={t('joya.labor.gross')}>
                    <Val v={l.known.grossWage} fmt={fmtILS} />
                  </Row>
                  <Row label={t('joya.labor.employerExtra')}>
                    <Val v={l.known.employerCostIncluded ? l.known.employerCostExtra : null} fmt={fmtILS} />
                  </Row>
                  <Row label={t('joya.labor.totalEmployer')}>
                    <Val v={l.known.employerCostIncluded ? l.known.totalEmployerCost : null} fmt={fmtILS} />
                  </Row>
                  <Row label={t('joya.labor.laborPct')}>
                    <PctWithWarning pct={l.known.laborPctOfSales} complete={l.known.salesComplete} missingDays={l.salesDaysMissing} />
                  </Row>
                  {!l.known.employerCostIncluded ? <div className={c.warn}>⚠ {t('joya.labor.noEmployerLines')}</div> : null}
                </div>
              ) : (
                <div className={c.small}>{t('joya.labor.noKnown')}</div>
              )
            ) : null}
          </Card>
        ))}
      </Grid>
      {data ? <SourceLine source={Object.values(data.sources || {}).join(' · ')} period={data.period} /> : null}

      <Card title={t('joya.labor.pvaTitle')}>
        <ErrorBox error={pva.error} />
        {pva.loading && !pva.data ? <Loading /> : null}
        {pva.data && !pva.data.weeks.length ? <div className={c.small}>{t('joya.labor.pvaNone')}</div> : null}
        {(pva.data?.weeks || []).map((w) => (
          <Row
            key={w.planId}
            label={
              <>
                <bdi dir="auto">{j.locName(w.locationId)}</bdi> · {t('joya.staff.weekOf')} <Term>{fmtDay(w.weekStart)}</Term>
              </>
            }
          >
            <Term>
              {fmtNum(w.plannedHours, 1)} → {w.attendanceRows ? fmtNum(w.actualHours, 1) : '—'}
            </Term>
            {w.rowsMissingHours ? (
              <>
                {' '}
                <Badge tone="warn">{t('joya.staff.rowsMissingHours', { count: w.rowsMissingHours })}</Badge>
              </>
            ) : null}
          </Row>
        ))}
        <div className={c.small}>{t('joya.staff.plannedArrowActual')}</div>
        {pva.data ? <SourceLine source={Object.values(pva.data.sources || {}).join(' · ')} /> : null}
      </Card>
    </Page>
  );
}
