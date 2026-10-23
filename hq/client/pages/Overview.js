// /overview — chain management overview (chain admin).
// One box per location: last 7 days of sales (Bikum checks) with the change split into
// volume (more/fewer checks) and average spend, missing days, what waits for a decision,
// and data alerts. Chain totals on top, pending decisions below.
import React from 'react';
import { createUseStyles, useTheme } from 'react-jss';
import { useNavigate } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useT } from '../i18n/index.js';
import { useJoya } from '../context.js';
import AskBox from '../AskBox.js';
import { Page, Card, Grid, Row, Badge, SourceLine, Val, Loading, ErrorBox, Empty, useLoad, fmtILS, fmtNum, fmtPctSigned, fmtDay, addDays, Term } from '../ui.js';

const useStyles = createUseStyles((theme) => ({
  chips: { display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.45rem' },
  chip: {
    border: `1px solid ${theme.border}`,
    borderRadius: 999,
    padding: '0.22rem 0.6rem',
    background: 'none',
    color: theme.text,
    fontSize: '0.76rem',
    cursor: 'pointer',
    fontFamily: 'inherit',
    '&:hover': { borderColor: theme.primary },
  },
  chipHot: { borderColor: '#d29922', color: '#d29922' },
  sentence: { fontSize: '0.8rem', marginTop: '0.35rem', lineHeight: 1.5 },
  missing: { fontSize: '0.76rem', color: '#d29922', marginTop: '0.3rem' },
  section: { fontSize: '0.95rem', fontWeight: 650, margin: '1rem 0 0.5rem' },
  item: { fontSize: '0.82rem', padding: '0.25rem 0', borderTop: `1px solid ${theme.border}`, cursor: 'pointer' },
}));

/** "Revenue +X%: more visits (+₪a) and higher spend per check (+₪b)". */
export function ChangeSentence({ change, className }) {
  const { t } = useT();
  if (!change) return null;
  const vol = change.volumeEffect;
  const sp = change.spendEffect;
  const signed = (n) => (n == null ? '—' : `\u2066${n >= 0 ? '+' : '−'}${fmtILS(Math.abs(n))}\u2069`);
  return (
    <div className={className}>
      {t('joya.ov.revenueChange')} <Term>{fmtPctSigned(change.revenueChangePct)}</Term>: {t(vol >= 0 ? 'joya.ov.moreVisits' : 'joya.ov.fewerVisits')} (<Term>{signed(vol)}</Term>,{' '}
      <Term>{fmtPctSigned(change.checksChangePct)}</Term> {t('joya.ov.checksWord')}) {t('joya.ov.and')} {t(sp >= 0 ? 'joya.ov.higherSpend' : 'joya.ov.lowerSpend')} (<Term>{signed(sp)}</Term>,{' '}
      <Term>{fmtPctSigned(change.avgCheckChangePct)}</Term>).
    </div>
  );
}

function sumTotals(locs) {
  const t = { revenue: 0, checks: 0, prevRevenue: 0, prevChecks: 0, daysMissing: 0 };
  for (const l of locs) {
    t.revenue += l.current.revenue ?? 0;
    t.checks += l.current.checks ?? 0;
    t.prevRevenue += l.previous.revenue ?? 0;
    t.prevChecks += l.previous.checks ?? 0;
    t.daysMissing += l.current.daysMissing ?? 0;
  }
  t.avgCheck = t.checks ? t.revenue / t.checks : null;
  t.prevAvg = t.prevChecks ? t.prevRevenue / t.prevChecks : null;
  t.change =
    t.avgCheck != null && t.prevAvg != null && t.prevRevenue
      ? {
          revenueChangePct: ((t.revenue - t.prevRevenue) / t.prevRevenue) * 100,
          checksChangePct: ((t.checks - t.prevChecks) / t.prevChecks) * 100,
          avgCheckChangePct: ((t.avgCheck - t.prevAvg) / t.prevAvg) * 100,
          volumeEffect: (t.checks - t.prevChecks) * t.prevAvg,
          spendEffect: (t.avgCheck - t.prevAvg) * t.checks,
        }
      : null;
  return t;
}

export default function Overview() {
  const theme = useTheme();
  const c = useStyles(theme);
  const { t } = useT();
  const j = useJoya();
  const navigate = useNavigate();
  const today = j.me?.today;
  const scope = j.scope;

  const { data, error, loading } = useLoad(async () => {
    const [ov, an, qu] = await Promise.all([
      api(`/overview${qs({ locationIds: scope, days: 7 })}`),
      api(`/sales/anomalies${qs({ locationIds: scope, from: addDays(today, -14), to: addDays(today, -1) })}`).catch(() => null),
      api(`/quality${qs({ locationIds: scope })}`).catch(() => null),
    ]);
    return { ov, an, qu };
  }, [scope.join(','), today]);

  const go = (locationId, path) => {
    if (locationId != null) j.setLocationId(locationId);
    navigate(path);
  };

  if (loading && !data) return <Page title={t('joya.ov.title')}><Loading /></Page>;
  if (error) return <Page title={t('joya.ov.title')}><ErrorBox error={error} /></Page>;
  const { ov, an, qu } = data;
  const sales = ov.sales;
  const tot = sumTotals(sales.locations);
  const pendingFor = (id) => ov.pending.find((p) => p.locationId === id);
  const qualityFor = (id) => qu?.locations?.find((l) => l.locationId === id)?.issues || [];
  const anomaliesFor = (id) => (an?.anomalies || []).filter((a) => a.locationId === id);

  const chipDefs = [
    ['draftLists', '/orders', 'joya.ov.p.draftLists'],
    ['approvedNotOrdered', '/orders', 'joya.ov.p.approvedNotOrdered'],
    ['draftPlans', '/staffing', 'joya.ov.p.draftPlans'],
    ['openPayrollIssues', '/payroll', 'joya.ov.p.openPayrollIssues'],
    ['shortages7d', '/shortages', 'joya.ov.p.shortages7d'],
  ];
  const pendingAll = ov.pending.flatMap((p) => chipDefs.filter(([k]) => p[k] > 0 && k !== 'shortages7d').map(([k, path, label]) => ({ p, k, path, label })));

  return (
    <Page title={t('joya.ov.title')} sub={<>{t('joya.ov.sub')} · <Term>{fmtDay(sales.period.from)} – {fmtDay(sales.period.to)}</Term></>}>
      <Card title={t('joya.ov.chainTotals')}>
        <Row label={t('joya.ov.revenue')}><Val v={tot.revenue} fmt={fmtILS} /></Row>
        <Row label={t('joya.ov.checks')}><Val v={tot.checks} fmt={fmtNum} /></Row>
        <Row label={t('joya.ov.avgCheck')}><Val v={tot.avgCheck} fmt={fmtILS} /></Row>
        <ChangeSentence change={tot.change} className={c.sentence} />
        {tot.daysMissing > 0 && <div className={c.missing}>⚠ {t('joya.ov.chainMissing', { count: tot.daysMissing })}</div>}
        <SourceLine source={sales.source} period={sales.period} />
      </Card>

      <Grid>
        {sales.locations.map((l) => {
          const p = pendingFor(l.locationId);
          const issues = qualityFor(l.locationId);
          const high = issues.filter((i) => i.severity === 'HIGH').length;
          const med = issues.filter((i) => i.severity === 'MEDIUM').length;
          const anom = anomaliesFor(l.locationId);
          return (
            <Card key={l.locationId} title={j.locName(l.locationId)} right={j.isDemo(l.locationId) ? <Badge tone="warn">{t('joya.demo')}</Badge> : null}>
              <Row label={t('joya.ov.revenue')}><Val v={l.current.daysWithData ? l.current.revenue : null} fmt={fmtILS} /></Row>
              <Row label={t('joya.ov.checks')}><Val v={l.current.daysWithData ? l.current.checks : null} fmt={fmtNum} /></Row>
              <Row label={t('joya.ov.diners')}><Val v={l.current.diners} fmt={fmtNum} /></Row>
              <Row label={t('joya.ov.avgCheck')}><Val v={l.current.avgCheck} fmt={fmtILS} /></Row>
              {l.change ? <ChangeSentence change={l.change} className={c.sentence} /> : <div className={c.sentence}>{t('joya.ov.noCompare')}</div>}
              {l.current.daysMissing > 0 && <div className={c.missing}>⚠ {t('joya.ov.daysMissing', { count: l.current.daysMissing })}</div>}
              {anom.length > 0 && (
                <div className={c.missing}>
                  {t('joya.ov.anomalies', { count: anom.length })}{' '}
                  <button className={c.chip} onClick={() => go(l.locationId, '/sales')}>{t('joya.ov.see')}</button>
                </div>
              )}
              <div className={c.chips}>
                {p &&
                  chipDefs.map(([k, path, label]) => (
                    <button key={k} className={`${c.chip} ${p[k] > 0 ? c.chipHot : ''}`} onClick={() => go(l.locationId, path)}>
                      {t(label)}: <Term>{p[k]}</Term>
                    </button>
                  ))}
                <button className={`${c.chip} ${high ? c.chipHot : ''}`} onClick={() => go(l.locationId, '/data')}>
                  {t('joya.ov.dataAlerts')}: <Term>{high + med}</Term>
                </button>
              </div>
              <SourceLine source={sales.source} period={l.current} />
            </Card>
          );
        })}
      </Grid>

      <div className={c.section}>{t('joya.ov.pendingTitle')}</div>
      <Card>
        {pendingAll.length === 0 ? (
          <Empty>{t('joya.ov.noPending')}</Empty>
        ) : (
          pendingAll.map(({ p, k, path, label }) => (
            <div key={`${p.locationId}-${k}`} className={c.item} onClick={() => go(p.locationId, path)}>
              {p.name} · {t(label)}: <Term>{p[k]}</Term>
            </div>
          ))
        )}
      </Card>

      <div style={{ marginTop: '1rem' }}>
        <AskBox contextKind="GENERAL" locationId={j.locationId} examples={[t('joya.ov.ex1'), t('joya.ov.ex2')]} />
      </div>
    </Page>
  );
}
