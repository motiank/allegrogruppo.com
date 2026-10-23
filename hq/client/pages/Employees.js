// /employees — employees as the Allegro admin has them (read-only here: they are changed in Allegro).
// Clock rows Allegro could not match to one employee are listed apart; their hours count for no one.
// Hourly wages are shown only to users with payroll access (the API leaves them out otherwise).
import React, { useMemo, useState } from 'react';
import { createUseStyles, useTheme } from 'react-jss';
import { api, qs } from '../api.js';
import { Page, Card, Grid, Row, Badge, Input, Loading, Empty, ErrorBox, useLoad, fmtDay, Term, Val } from '../ui.js';
import { useJoya } from '../context.js';
import { useT } from '../i18n/index.js';

const useStyles = createUseStyles((theme) => ({
  note: { fontSize: '0.8rem', color: theme.textSecondary, margin: '0 0 0.5rem', lineHeight: 1.5 },
  sub: { fontSize: '0.76rem', color: theme.textSecondary, marginTop: '0.15rem' },
  um: { borderTop: `1px solid ${theme.border}`, padding: '0.45rem 0', fontSize: '0.84rem' },
  umHead: { display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' },
  chips: { display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginTop: '0.25rem' },
  chip: { fontSize: '0.72rem', border: `1px solid ${theme.border}`, borderRadius: 6, padding: '0.1rem 0.4rem' },
}));

export default function Employees() {
  const theme = useTheme();
  const c = useStyles(theme);
  const { t } = useT();
  const j = useJoya();
  const scopeKey = j.scope.join(',');
  const r = useLoad(() => api(`/employees${qs({ locationIds: j.scope })}`), [scopeKey]);
  const [filter, setFilter] = useState('');
  const employees = r.data?.employees || [];
  const unmatched = r.data?.unmatched || [];
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return employees;
    return employees.filter((e) => String(e.name).toLowerCase().includes(f));
  }, [employees, filter]);

  return (
    <Page title={t('joya.emp.title')} sub={t('joya.emp.fromAllegro')}>
      <ErrorBox error={r.error} />
      {r.loading && !r.data ? <Loading /> : null}
      {r.data ? (
        <Card title={t('joya.emp.unmatchedTitle')} right={unmatched.length ? <Badge tone="bad">{unmatched.length}</Badge> : <Badge tone="ok">✓</Badge>}>
          {unmatched.length ? <p className={c.note}>{t('joya.emp.unmatchedHelp')}</p> : <div className={c.sub}>{t('joya.emp.allMatched')}</div>}
          {unmatched.map((u) => (
            <div key={`${u.externalId}:${u.locationId}`} className={c.um}>
              <div className={c.umHead}>
                <span>
                  <bdi dir="auto">{u.externalId}</bdi> · <bdi dir="auto">{j.locName(u.locationId)}</bdi>
                </span>
                <span className={c.sub}>
                  {t('joya.emp.rowsCount', { n: Number(u.rows_) })}
                  {u.first_ ? (
                    <>
                      {' '}
                      · <Term>{fmtDay(u.first_)} – {fmtDay(u.last_)}</Term>
                    </>
                  ) : null}
                </span>
              </div>
            </div>
          ))}
        </Card>
      ) : null}
      {r.data && employees.length ? (
        <Card>
          <Input dir="auto" placeholder={t('joya.emp.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} />
        </Card>
      ) : null}
      {r.data && !employees.length ? <Empty>{t('joya.emp.noEmployees')}</Empty> : null}
      <Grid>
        {shown.map((e) => (
          <Card
            key={e.id}
            title={<bdi dir="auto">{e.name}</bdi>}
            right={
              <span style={{ display: 'flex', gap: '0.3rem' }}>
                {e.contractor ? <Badge>{t('joya.emp.contractor')}</Badge> : null}
                {!e.active ? <Badge>{t('joya.emp.inactive')}</Badge> : null}
              </span>
            }
          >
            <Row label={t('joya.emp.location')}>{e.locationId ? <bdi dir="auto">{j.locName(e.locationId)}</bdi> : '—'}</Row>
            <Row label={t('joya.emp.role')}>{e.roleCode ? j.roleName(e.roleCode) : <span className={c.sub}>{t('joya.emp.roleNotMapped')}</span>}</Row>
            {e.hourlyWage !== undefined ? (
              <Row label={t('joya.emp.wage')}>
                <Val v={e.hourlyWage} fmt={(n) => `₪${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`} />
              </Row>
            ) : null}
            {e.roleNames?.length ? (
              <>
                <div className={c.sub}>{t('joya.emp.allegroRoles')}</div>
                <div className={c.chips}>
                  {e.roleNames.map((n) => (
                    <span key={n} className={c.chip}>
                      <bdi dir="auto">{n}</bdi>
                    </span>
                  ))}
                </div>
              </>
            ) : null}
          </Card>
        ))}
      </Grid>
    </Page>
  );
}
