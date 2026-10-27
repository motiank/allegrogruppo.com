// /data — where the data comes from, how fresh it is, and what is missing or
// not mapped. Nothing here fills a gap: a missing day is shown as missing, never as zero.
import React from 'react';
import { createUseStyles, useTheme } from 'react-jss';
import { useNavigate } from 'react-router-dom';
import { api, qs } from '../api.js';
import { Page, Card, Row, Btn, Badge, Loading, Empty, ErrorBox, useLoad, fmtDay, statusTone, Term, Val } from '../ui.js';
import { useJoya } from '../context.js';
import { useT } from '../i18n/index.js';

const useStyles = createUseStyles((theme) => ({
  note: { fontSize: '0.82rem', color: theme.textSecondary, margin: '0 0 0.5rem' },
  integ: { borderTop: `1px solid ${theme.border}`, padding: '0.45rem 0', fontSize: '0.84rem' },
  integHead: { display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' },
  sub: { fontSize: '0.75rem', color: theme.textSecondary, marginTop: '0.15rem' },
  section: { fontSize: '0.78rem', fontWeight: 650, color: theme.textSecondary, margin: '0.6rem 0 0.2rem' },
  issue: { borderTop: `1px solid ${theme.border}`, padding: '0.5rem 0', fontSize: '0.84rem' },
  issueHead: { display: 'flex', gap: '0.5rem', alignItems: 'flex-start', justifyContent: 'space-between' },
  chips: { display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginTop: '0.35rem' },
  chip: { fontSize: '0.72rem', border: `1px solid ${theme.border}`, borderRadius: 6, padding: '0.1rem 0.4rem' },
  actions: { display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.4rem' },
  warn: { color: '#d29922', fontSize: '0.78rem', marginTop: '0.3rem' },
}));

const ENV_SOURCES = ['SALES_CHECKS', 'SALES_ITEMS', 'ATTENDANCE', 'PAYROLL'];
const LINKS = {
  UNMATCHED_ITEM_CODES: ['/menu', 'joya.data.goMenu'],
  NO_MENU: ['/menu', 'joya.data.goMenu'],
  DISHES_WITHOUT_INGREDIENTS: ['/menu', 'joya.data.goMenu'],
  UNMATCHED_EMPLOYEE_IDS: ['/employees', 'joya.data.goEmployees'],
  NO_SHIFTS_DEFINED: ['/rules', 'joya.data.goRules'],
  UNMAPPED_ROLE_NAMES: ['/settings?tab=roles', 'joya.data.goRoles'],
  ATTENDANCE_WITHOUT_ROLE: ['/settings?tab=roles', 'joya.data.goRoles'],
};

const issueText = (t, i) => t(`joya.data.issue.${i.code}`, { days: i.days ?? '', count: i.count ?? '', of: i.of ?? '', message: i.message ?? '', source: i.source ?? '', reason: i.reason ?? '' });
/** A data kind's name (SALES_CHECKS…), or the code itself when there is no translation. */
const kindName = (t, k) => (t(`joya.data.kind.${k}`) === `joya.data.kind.${k}` ? k : t(`joya.data.kind.${k}`));
const daysOld = (from, to) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 864e5);

function Integrations({ list, c }) {
  const { t } = useT();
  return (
    <Card title={t('joya.data.integrations')}>
      <p className={c.note}>{t('joya.data.noLive')}</p>
      {list.map((i) => (
        <div key={i.source} className={c.integ}>
          <div className={c.integHead}>
            <Term>{i.name}</Term>
            <span style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
              {i.connected ? <Badge tone="ok">{t('joya.data.connected')}</Badge> : <Badge tone="warn">{t('joya.data.notConnected')}</Badge>}
              <Badge tone="info">{t(`joya.data.method.${i.method}`)}</Badge>
            </span>
          </div>
          <div className={c.sub}>
            {t('joya.data.kinds')}: {(i.kinds || []).map((k) => kindName(t, k)).join(' · ')}
            {i.exportOnly ? <> · {t('joya.data.exportOnly', { what: i.exportOnly })}</> : null}
          </div>
          <div className={c.sub}>{i.credentialsConfigured ? t('joya.data.cred.set') : t('joya.data.cred.notSet')}</div>
        </div>
      ))}
    </Card>
  );
}

function Issue({ issue, c }) {
  const { t } = useT();
  const navigate = useNavigate();
  const link = LINKS[issue.code];
  return (
    <div className={c.issue}>
      <div className={c.issueHead}>
        <span>{issueText(t, issue)}</span>
        <Badge tone={statusTone(issue.severity)}>{t(`joya.data.sev.${issue.severity}`)}</Badge>
      </div>
      {issue.lastDate ? (
        <div className={c.sub}>
          {t('joya.data.lastData')}: <Term>{fmtDay(issue.lastDate)}</Term>
        </div>
      ) : null}
      {issue.code === 'MISSING_SALES_DAYS' && (
        <>
          <div className={c.chips}>
            {(issue.dates || []).map((d) => (
              <span key={d} className={c.chip}>
                <Term>{fmtDay(d)}</Term>
              </span>
            ))}
          </div>
        </>
      )}
      {issue.code === 'UNMATCHED_ITEM_CODES' && (
        <div className={c.chips}>
          {(issue.items || []).map((x) => (
            <span key={x.code} className={c.chip}>
              <Term>{x.code}</Term> · <bdi dir="auto">{x.name || '—'}</bdi> · <Term>{x.rows}</Term> {t('joya.data.rows')}
            </span>
          ))}
        </div>
      )}
      {issue.code === 'UNMATCHED_EMPLOYEE_IDS' && (
        <div className={c.chips}>
          {(issue.ids || []).map((x) => (
            <span key={`${x.source}:${x.id}`} className={c.chip}>
              <bdi dir="auto">{x.id}</bdi> · <Term>{x.rows}</Term> {t('joya.data.rows')}
            </span>
          ))}
        </div>
      )}
      {issue.code === 'UNMAPPED_ROLE_NAMES' && (
        <div className={c.chips}>
          {(issue.names || []).map((x) => (
            <span key={x.name} className={c.chip}>
              <bdi dir="auto">{x.name}</bdi> · <Term>{x.rows}</Term> {t('joya.data.rows')}
            </span>
          ))}
        </div>
      )}
      {link ? (
        <div className={c.actions}>
          <Btn small onClick={() => navigate(link[0])}>
            {t(link[1])}
          </Btn>
        </div>
      ) : null}
    </div>
  );
}

function LocationBox({ L, today, staleDays, c }) {
  const { t } = useT();
  const stale = (d) => d && daysOld(d, today) > staleDays;
  return (
    <Card title={<bdi dir="auto">{L.locationName}</bdi>} right={L.isDemo ? <Badge tone="warn">{t('joya.demo')}</Badge> : null}>
      <div className={c.section}>{t('joya.data.sources')}</div>
      {ENV_SOURCES.filter((k) => L.sources[k]).map((k) => {
        const s = L.sources[k];
        const last = k === 'PAYROLL' ? s.lastPeriod : s.lastDate;
        return (
          <Row key={k} label={kindName(t, k)}>
            {s.rows ? (
              <span style={{ display: 'inline-flex', gap: '0.3rem', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <Term>{k === 'PAYROLL' ? last : fmtDay(last)}</Term>
                <span style={{ fontWeight: 400 }}>
                  · <Term>{s.rows.toLocaleString('en-US')}</Term> {t('joya.data.rows')}
                </span>
                {s.demoRows ? <Badge tone="warn">{t('joya.demo')}</Badge> : null}
                {k !== 'PAYROLL' && stale(last) ? <Badge tone="warn">{t('joya.data.stale')}</Badge> : null}
              </span>
            ) : (
              <Val v={null} title={t('joya.data.noRows')} />
            )}
          </Row>
        );
      })}
      <div className={c.section}>{t('joya.data.issues')}</div>
      {L.issues.length ? (
        L.issues.map((i) => <Issue key={i.code} issue={i} c={c} />)
      ) : (
        <div className={c.sub}>{t('joya.data.noIssues')}</div>
      )}
    </Card>
  );
}

export default function Data() {
  const theme = useTheme();
  const c = useStyles(theme);
  const { t } = useT();
  const j = useJoya();
  const scopeKey = j.scope.join(',');
  const r = useLoad(() => api(`/quality${qs({ locationIds: j.scope })}`), [scopeKey]);

  return (
    <Page title={t('joya.data.title')} sub={t('joya.data.sub')}>
      <Integrations list={r.data?.integrations || j.me?.integrations || []} c={c} />
      <ErrorBox error={r.error} />
      {r.loading && !r.data ? <Loading /> : null}
      {r.data && !r.data.locations.length ? <Empty>{t('joya.none')}</Empty> : null}
      {r.data?.locations.map((L) => (
        <LocationBox key={L.locationId} L={L} today={r.data.today} staleDays={r.data.staleDays} c={c} />
      ))}
    </Page>
  );
}
