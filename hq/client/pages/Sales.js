// /sales — sales and performance from the Bikum POS: summary (volume vs average
// spend), day by day (missing days are marked, never drawn as zero), by shift, by dish,
// and unusual days.
import React, { useState } from 'react';
import { createUseStyles, useTheme } from 'react-jss';
import { api, qs } from '../api.js';
import { useT } from '../i18n/index.js';
import { useJoya } from '../context.js';
import { ChangeSentence } from './Overview.js';
import { Page, Card, Grid, Row, Btn, Badge, Field, Input, Tabs, SourceLine, Val, Loading, Empty, ErrorBox, useLoad, fmtILS, fmtNum, fmtPctSigned, fmtDay, addDays, Term } from '../ui.js';

const useStyles = createUseStyles((theme) => ({
  picker: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: '0.5rem' },
  pickField: { width: 150 },
  sentence: { fontSize: '0.8rem', marginTop: '0.35rem', lineHeight: 1.5 },
  formula: { fontSize: '0.7rem', color: theme.textSecondary, marginTop: '0.2rem' },
  warn: { fontSize: '0.76rem', color: '#d29922', marginTop: '0.3rem' },
  legend: { display: 'flex', gap: '0.8rem', fontSize: '0.72rem', color: theme.textSecondary, marginTop: '0.3rem', flexWrap: 'wrap' },
  sw: { display: 'inline-block', width: 10, height: 10, marginInlineEnd: 4, verticalAlign: 'middle' },
  days: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.4rem', marginTop: '0.5rem' },
  day: { border: `1px solid ${theme.border}`, borderRadius: 6, padding: '0.35rem 0.5rem', fontSize: '0.76rem' },
  dayMissing: { borderStyle: 'dashed', borderColor: '#d29922', color: '#d29922' },
}));

function Chart({ days }) {
  const theme = useTheme();
  const W = 600;
  const H = 140;
  const max = Math.max(1, ...days.map((d) => d.revenue ?? 0));
  const bw = W / Math.max(1, days.length);
  return (
    <svg viewBox={`0 0 ${W} ${H + 16}`} width="100%" dir="ltr" role="img" style={{ display: 'block', marginTop: '0.4rem' }}>
      <defs>
        <pattern id="joyaHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="#d29922" strokeWidth="2" />
        </pattern>
      </defs>
      {days.map((d, i) => {
        const x = i * bw + bw * 0.12;
        const w = bw * 0.76;
        if (d.missing || d.revenue == null) return <rect key={d.date} x={x} y={0} width={w} height={H} fill="url(#joyaHatch)" opacity="0.35"><title>{`${d.date}: no data`}</title></rect>;
        const h = (d.revenue / max) * (H - 4);
        return (
          <rect key={d.date} x={x} y={H - h} width={w} height={h} fill={theme.primary} rx="1">
            <title>{`${d.date}: ₪${Math.round(d.revenue).toLocaleString('en-US')}`}</title>
          </rect>
        );
      })}
      <line x1="0" y1={H} x2={W} y2={H} stroke={theme.border} />
      {days.length > 0 && (
        <>
          <text x="0" y={H + 13} fontSize="10" fill={theme.textSecondary}>{days[0].date.slice(5)}</text>
          <text x={W} y={H + 13} fontSize="10" fill={theme.textSecondary} textAnchor="end">{days[days.length - 1].date.slice(5)}</text>
        </>
      )}
    </svg>
  );
}

export default function Sales() {
  const theme = useTheme();
  const c = useStyles(theme);
  const { t } = useT();
  const j = useJoya();
  const today = j.me?.today;
  const [to, setTo] = useState(() => addDays(today, -1));
  const [from, setFrom] = useState(() => addDays(today, -7));
  const [tab, setTab] = useState('summary');
  const scope = j.scope;
  const preset = (n) => {
    setTo(addDays(today, -1));
    setFrom(addDays(today, -n));
  };
  const path = { summary: '/sales/summary', daily: '/sales/daily', shifts: '/sales/shifts', dishes: '/sales/dishes', anomalies: '/sales/anomalies' }[tab];
  const { data, error, loading } = useLoad(() => api(`${path}${qs({ locationIds: scope, from, to, limit: tab === 'dishes' ? 60 : undefined })}`), [path, scope.join(','), from, to]);

  const body = () => {
    if (loading) return <Loading />; // the previous tab's data has another shape
    if (error) return <ErrorBox error={error} />;
    if (!data) return null;
    if (tab === 'summary')
      return (
        <Grid>
          {data.locations.map((l) => (
            <Card key={l.locationId} title={j.locName(l.locationId)}>
              <Row label={t('joya.ov.revenue')}><Val v={l.current.daysWithData ? l.current.revenue : null} fmt={fmtILS} /></Row>
              <Row label={t('joya.sales.prevRevenue')}><Val v={l.previous.daysWithData ? l.previous.revenue : null} fmt={fmtILS} /></Row>
              <Row label={t('joya.ov.checks')}><Val v={l.current.daysWithData ? l.current.checks : null} fmt={fmtNum} /></Row>
              <Row label={t('joya.ov.avgCheck')}><Val v={l.current.avgCheck} fmt={fmtILS} /></Row>
              <Row label={t('joya.ov.diners')}><Val v={l.current.diners} fmt={fmtNum} /></Row>
              <Row label={t('joya.sales.avgDiner')}><Val v={l.current.avgPerDiner} fmt={fmtILS} title={t('joya.sales.avgDinerUnknown')} /></Row>
              {l.change ? (
                <>
                  <Row label={t('joya.sales.volumeEffect')}><Val v={l.change.volumeEffect} fmt={fmtILS} /></Row>
                  <Row label={t('joya.sales.spendEffect')}><Val v={l.change.spendEffect} fmt={fmtILS} /></Row>
                  <ChangeSentence change={l.change} className={c.sentence} />
                  <div className={c.formula}>
                    <Term>{l.change.formula}</Term> · {t('joya.sales.formulaHelp')}
                  </div>
                </>
              ) : (
                <div className={c.sentence}>{t('joya.ov.noCompare')}</div>
              )}
              <Row label={t('joya.sales.coverage')}>
                <Term>{l.current.daysWithData}/{l.current.daysWithData + l.current.daysMissing}</Term>
              </Row>
              {l.current.daysMissing > 0 && <div className={c.warn}>⚠ {t('joya.ov.daysMissing', { count: l.current.daysMissing })}</div>}
              <SourceLine source={data.source} period={data.period} />
            </Card>
          ))}
        </Grid>
      );
    if (tab === 'daily')
      return data.series.map((s) => (
        <Card key={s.locationId} title={j.locName(s.locationId)}>
          <Chart days={s.days} />
          <div className={c.legend}>
            <span><span className={c.sw} style={{ background: theme.primary }} />{t('joya.sales.legendRevenue')}</span>
            <span><span className={c.sw} style={{ background: 'repeating-linear-gradient(45deg,#d29922 0 2px,transparent 2px 5px)' }} />{t('joya.sales.legendMissing')}</span>
          </div>
          <div className={c.days}>
            {s.days.map((d) => (
              <div key={d.date} className={`${c.day} ${d.missing ? c.dayMissing : ''}`}>
                <div><Term>{fmtDay(d.date)}</Term> · {t(`joya.wd.${new Date(d.date + 'T00:00:00Z').getUTCDay()}`)}</div>
                {d.missing ? (
                  <div>{t('joya.sales.noData')}</div>
                ) : (
                  <div>
                    <Term>{fmtILS(d.revenue)}</Term> · <Term>{fmtNum(d.checks)}</Term> {t('joya.sales.checksShort')} · <Val v={d.diners} fmt={fmtNum} /> {t('joya.sales.dinersShort')}
                  </div>
                )}
              </div>
            ))}
          </div>
          <SourceLine source={data.source} period={data.period} />
        </Card>
      ));
    if (tab === 'shifts')
      return (
        <Grid>
          {data.locations.map((l) => (
            <Card key={l.locationId} title={j.locName(l.locationId)}>
              {l.shifts.length === 0 && <Empty>{t('joya.sales.noShifts')}</Empty>}
              {l.shifts.map((s) => (
                <div key={s.shiftCode} style={{ marginBottom: '0.45rem' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{s.name}</div>
                  <Row label={t('joya.ov.revenue')}><Val v={s.checks ? s.revenue : null} fmt={fmtILS} /></Row>
                  <Row label={t('joya.ov.checks')}><Term>{fmtNum(s.checks)}</Term></Row>
                  <Row label={t('joya.ov.avgCheck')}><Val v={s.avgCheck} fmt={fmtILS} /></Row>
                  <Row label={t('joya.ov.diners')}><Val v={s.diners} fmt={fmtNum} /></Row>
                </div>
              ))}
              <Row label={t('joya.sales.outside')}>
                <Term>{fmtNum(l.outsideShifts.checks)}</Term> · <Term>{fmtILS(l.outsideShifts.revenue)}</Term>
              </Row>
              <SourceLine source={data.source} period={data.period} />
            </Card>
          ))}
        </Grid>
      );
    if (tab === 'dishes')
      return (
        <>
          <Card>
            {data.coverage.map((cv) => (
              <Row key={cv.locationId} label={`${j.locName(cv.locationId)} · ${t('joya.sales.coverage')}`}>
                <Term>{cv.daysWithData}/{cv.days}</Term> ({t('joya.sales.prevShort')} <Term>{cv.prevDaysWithData}/{cv.days}</Term>)
              </Row>
            ))}
            <SourceLine source={data.source} period={data.period} />
          </Card>
          {data.dishes.length === 0 && <Empty>{t('joya.none')}</Empty>}
          <Grid>
            {data.dishes.map((d) => (
              <Card
                key={`${d.locationId}-${d.code}`}
                title={<span dir="auto">{d.name}</span>}
                right={!d.onMenu ? <Badge tone="warn">{t('joya.sales.notOnMenu')}</Badge> : null}
              >
                {scope.length > 1 && <div style={{ fontSize: '0.75rem', color: theme.textSecondary }}>{j.locName(d.locationId)}</div>}
                <Row label={t('joya.sales.units')}><Term>{fmtNum(d.units, 1)}</Term></Row>
                <Row label={t('joya.ov.revenue')}><Val v={d.revenue} fmt={fmtILS} /></Row>
                <Row label={t('joya.sales.unitsChange')}><Val v={d.unitsChangePct} fmt={fmtPctSigned} title={t('joya.sales.noPrev')} /></Row>
              </Card>
            ))}
          </Grid>
        </>
      );
    // anomalies
    return (
      <>
        <Card>
          <div style={{ fontSize: '0.8rem' }}>
            {t('joya.sales.method')}: <Term>{data.method}</Term>
          </div>
          <SourceLine source={data.source} period={data.period} />
        </Card>
        {data.anomalies.length === 0 && <Empty>{t('joya.sales.noAnomalies')}</Empty>}
        <Grid>
          {data.anomalies.map((a) => (
            <Card key={`${a.locationId}-${a.date}`} title={<><Term>{fmtDay(a.date)}</Term> · {t(`joya.wd.${new Date(a.date + 'T00:00:00Z').getUTCDay()}`)}</>} right={<Badge tone={a.deviationPct < 0 ? 'bad' : 'ok'}><Term>{fmtPctSigned(a.deviationPct)}</Term></Badge>}>
              <div style={{ fontSize: '0.75rem', color: theme.textSecondary }}>{j.locName(a.locationId)}</div>
              <Row label={t('joya.sales.actual')}><Term>{fmtILS(a.revenue)}</Term></Row>
              <Row label={t('joya.sales.expected')}><Term>{fmtILS(a.expected)}</Term></Row>
              <Row label={t('joya.ov.checks')}><Term>{fmtNum(a.checks)}</Term></Row>
              <div className={c.formula}>{t('joya.sales.basis', { weeks: a.basis.weeks })}</div>
            </Card>
          ))}
        </Grid>
        {data.missingDays.length > 0 && (
          <Card title={t('joya.sales.missingTitle')}>
            <div className={c.warn}>{t('joya.sales.missingHelp')}</div>
            {data.missingDays.map((m) => (
              <div key={`${m.locationId}-${m.date}`} style={{ fontSize: '0.8rem' }}>
                {j.locName(m.locationId)} · <Term>{fmtDay(m.date)}</Term>
              </div>
            ))}
          </Card>
        )}
      </>
    );
  };

  return (
    <Page
      title={t('joya.sales.title')}
      sub={t('joya.sales.sub')}
      tabs={
        <>
          <div className={c.picker}>
            <div className={c.pickField}>
              <Field label={t('joya.from')}><Input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></Field>
            </div>
            <div className={c.pickField}>
              <Field label={t('joya.to')}><Input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} /></Field>
            </div>
            <div style={{ display: 'flex', gap: '0.35rem', marginBottom: '0.6rem' }}>
              <Btn small onClick={() => preset(7)}>{t('joya.sales.last7')}</Btn>
              <Btn small onClick={() => preset(28)}>{t('joya.sales.last28')}</Btn>
            </div>
          </div>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              ['summary', t('joya.sales.tabSummary')],
              ['daily', t('joya.sales.tabDaily')],
              ['shifts', t('joya.sales.tabShifts')],
              ['dishes', t('joya.sales.tabDishes')],
              ['anomalies', t('joya.sales.tabAnomalies')],
            ]}
          />
        </>
      }
    >
      {body()}
    </Page>
  );
}
