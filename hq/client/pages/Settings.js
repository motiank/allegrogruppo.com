// /settings — users and their access, locations, the numbers the recommendations
// use, and where integration credentials live (the server env file, never this screen).
import React, { useEffect, useState } from 'react';
import { createUseStyles, useTheme } from 'react-jss';
import { api } from '../api.js';
import { Page, Card, Row, Btn, Badge, Field, Input, Select, Modal, Tabs, Loading, Empty, ErrorBox, useLoad, useAction, Term } from '../ui.js';
import { useJoya, companyOf, companiesOf } from '../context.js';
import { useT } from '../i18n/index.js';

const useStyles = createUseStyles((theme) => ({
  note: { fontSize: '0.82rem', color: theme.textSecondary, margin: '0 0 0.6rem', lineHeight: 1.5 },
  coHead: { fontSize: '0.85rem', color: theme.textSecondary, margin: '0.9rem 0.2rem 0.3rem', fontWeight: 600 },
  code: { display: 'block', direction: 'ltr', textAlign: 'left', fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem', background: theme.background, border: `1px solid ${theme.border}`, borderRadius: 6, padding: '0.4rem 0.5rem', margin: '0.3rem 0 0.7rem', overflowX: 'auto', whiteSpace: 'nowrap' },
  sub: { fontSize: '0.76rem', color: theme.textSecondary, marginTop: '0.15rem' },
  check: { display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.86rem', padding: '0.2rem 0', cursor: 'pointer' },
  num: { borderTop: `1px solid ${theme.border}`, padding: '0.45rem 0' },
  numHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem' },
  numInput: { width: '6.5rem', flexShrink: 0 },
  actions: { display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.5rem' },
}));

const ORDER = {
  replenishment: ['historyLists', 'halfLifeLists', 'minExamplesForQty', 'minExamplesForRatio', 'dueFraction', 'shortageBumpPct', 'removedSuppressShare', 'approvedOnlyWeight', 'coldStartDays'],
  staffing: ['historyWeeks', 'minDaysForForecast', 'learnedAdjustMinPlans', 'learnedAdjustWindow'],
  labor: ['employerCostFactorEstimate'],
  dataQuality: ['staleDays', 'longShiftHours'],
};
const ENV = { ALLEGRO: 'ALLEGRO_API_URL', INSTAGRAM: 'JOYA_INSTAGRAM_TOKEN', GOOGLE: 'JOYA_GOOGLE_CREDENTIALS' };

function Check({ checked, onChange, children, c }) {
  return (
    <label className={c.check}>
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

// ---------------------------------------------------------------- users

function Users({ c }) {
  const { t } = useT();
  const j = useJoya();
  const r = useLoad(() => api('/users'), []);
  const [edit, setEdit] = useState(null);
  const [remove, setRemove] = useState(null);
  const act = useAction();
  const save = () =>
    act.run(async () => {
      const out = await api('/users', { method: 'POST', body: { username: edit.username.trim(), role: edit.role, locationIds: edit.role === 'CHAIN_ADMIN' ? [] : edit.locationIds, payroll: edit.payroll } });
      r.setData(out);
      setEdit(null);
    });
  return (
    <>
      <Card>
        <p className={c.note}>{t('joya.set.usersIntro')}</p>
      </Card>
      <ErrorBox error={r.error} />
      {r.loading && !r.data ? <Loading /> : null}
      {r.data && !r.data.users.length ? <Empty>{t('joya.set.noUsers')}</Empty> : null}
      {r.data?.users.map((u) => (
        <Card
          key={u.username}
          title={<Term>{u.username}</Term>}
          right={u.role ? <Badge tone={u.role === 'CHAIN_ADMIN' ? 'info' : 'muted'}>{t(`joya.role.${u.role}`)}</Badge> : <Badge>{t('joya.set.noAccess')}</Badge>}
        >
          <Row label={t('joya.set.allegroRole')}>
            <Term>{u.allegroRole || '—'}</Term>
            {!u.allegroActive ? <> · {t('joya.set.inactiveAllegro')}</> : null}
          </Row>
          <Row label={t('joya.set.accessFrom')}>{u.override ? t('joya.set.overridden') : t('joya.set.fromAllegro')}</Row>
          <Row label={t('joya.set.locations')}>
            {!u.role ? (
              '—'
            ) : u.role === 'CHAIN_ADMIN' ? (
              t('joya.set.allLocations')
            ) : (
              <bdi dir="auto">{u.locationIds.map((id) => j.locName(id)).join(', ') || '—'}</bdi>
            )}
          </Row>
          <Row label={t('joya.set.payroll')}>{u.payroll ? t('joya.set.yes') : t('joya.set.no')}</Row>
          {u.allegroActive ? (
            <div className={c.actions}>
              <Btn small onClick={() => setEdit({ ...u, role: u.role || 'LOCATION_MANAGER', isNew: false })}>
                {t('joya.edit')}
              </Btn>
              {u.override && u.username !== j.me?.username ? (
                <Btn small kind="danger" onClick={() => setRemove(u)}>
                  {t('joya.set.removeUser')}
                </Btn>
              ) : null}
            </div>
          ) : null}
        </Card>
      ))}
      {edit && (
        <Modal
          title={edit.isNew ? t('joya.set.addUser') : t('joya.set.editUser')}
          onClose={() => setEdit(null)}
          footer={
            <>
              <Btn onClick={() => setEdit(null)}>{t('joya.cancel')}</Btn>
              <Btn kind="primary" disabled={act.busy || !edit.username.trim()} onClick={save}>
                {t('joya.save')}
              </Btn>
            </>
          }
        >
          <Field label={t('joya.set.username')}>
            <Input dir="ltr" value={edit.username} disabled={!edit.isNew} onChange={(e) => setEdit({ ...edit, username: e.target.value })} />
          </Field>
          <Field label={t('joya.set.role')}>
            <Select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>
              {['LOCATION_MANAGER', 'CHAIN_ADMIN'].map((r) => (
                <option key={r} value={r}>
                  {t(`joya.role.${r}`)}
                </option>
              ))}
            </Select>
          </Field>
          {edit.role === 'LOCATION_MANAGER' ? (
            <Field label={t('joya.set.locations')}>
              {j.locations.map((l) => (
                <Check
                  key={l.id}
                  c={c}
                  checked={edit.locationIds.includes(l.id)}
                  onChange={(on) => setEdit({ ...edit, locationIds: on ? [...edit.locationIds, l.id] : edit.locationIds.filter((x) => x !== l.id) })}
                >
                  <bdi dir="auto">{l.name}</bdi>
                </Check>
              ))}
            </Field>
          ) : null}
          <Field hint={t('joya.set.payrollHelp')}>
            <Check c={c} checked={edit.payroll} onChange={(on) => setEdit({ ...edit, payroll: on })}>
              {t('joya.set.payroll')}
            </Check>
          </Field>
          <ErrorBox error={act.error} />
        </Modal>
      )}
      {remove && (
        <Modal
          title={t('joya.set.removeTitle', { user: remove.username })}
          onClose={() => setRemove(null)}
          footer={
            <>
              <Btn onClick={() => setRemove(null)}>{t('joya.cancel')}</Btn>
              <Btn
                kind="danger"
                disabled={act.busy}
                onClick={() =>
                  act.run(async () => {
                    const out = await api(`/users/${encodeURIComponent(remove.username)}`, { method: 'DELETE' });
                    r.setData(out);
                    setRemove(null);
                  })
                }
              >
                {t('joya.set.removeUser')}
              </Btn>
            </>
          }
        >
          <p style={{ margin: 0, fontSize: '0.86rem' }}>{t('joya.set.removeText')}</p>
          <ErrorBox error={act.error} />
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------- locations

function Locations({ c }) {
  const { t } = useT();
  const j = useJoya();
  const act = useAction();
  const [refreshed, setRefreshed] = useState(false);
  const setActive = (l, active) =>
    act.run(async () => {
      await api('/locations', { method: 'POST', body: { id: l.id, active } });
      j.reload();
    });
  const refresh = () =>
    act.run(async () => {
      await api('/source/refresh', { method: 'POST', body: {} });
      setRefreshed(true);
      j.reload();
    });
  return (
    <>
      <Card>
        <p className={c.note}>{t('joya.set.locationsIntro')}</p>
        <Btn small disabled={act.busy} onClick={refresh}>
          {t('joya.set.refresh')}
        </Btn>{' '}
        {refreshed ? <Badge tone="ok">{t('joya.set.refreshed')}</Badge> : null}
        <ErrorBox error={act.error} />
      </Card>
      {companiesOf(j.allLocations).map((co, _, all) => (
        <React.Fragment key={co.key}>
          {all.length > 1 ? (
            <h3 className={c.coHead}>
              <bdi dir="auto">{co.label || t('joya.noCompany')}</bdi>
            </h3>
          ) : null}
          {j.allLocations
            .filter((l) => companyOf(l) === co.key)
            .map((l) => (
              <Card
                key={l.id}
                title={<bdi dir="auto">{l.name}</bdi>}
                right={
                  <span style={{ display: 'flex', gap: '0.3rem' }}>
                    {l.isDemo ? <Badge tone="warn">{t('joya.demo')}</Badge> : null}
                    {!l.active ? <Badge>{t('joya.set.inactive')}</Badge> : null}
                  </span>
                }
              >
                <Row label={t('joya.set.branchId')}>
                  <Term>{l.branchId}</Term>
                </Row>
                <div className={c.actions}>
                  <Btn small disabled={act.busy} onClick={() => setActive(l, !l.active)}>
                    {l.active ? t('joya.set.turnOff') : t('joya.set.turnOn')}
                  </Btn>
                </div>
              </Card>
            ))}
        </React.Fragment>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- role names (Allegro → Joya)

function Roles({ c }) {
  const { t } = useT();
  const j = useJoya();
  const r = useLoad(() => api('/role-aliases'), []);
  const act = useAction();
  const admin = !!j.me?.isAdmin;
  const save = (alias, roleCode) =>
    act.run(async () => {
      const out = await api('/role-aliases', { method: 'POST', body: { alias, roleCode: roleCode || null } });
      r.setData(out);
    });
  return (
    <>
      <Card>
        <p className={c.note} style={{ marginBottom: 0 }}>
          {t('joya.set.rolesIntro')} {admin ? null : t('joya.set.readOnly')}
        </p>
      </Card>
      <ErrorBox error={r.error || act.error} />
      {r.loading && !r.data ? <Loading /> : null}
      {(r.data?.aliases || []).map((x) => (
        <Card key={x.alias} title={<bdi dir="auto">{x.alias}</bdi>} right={x.roleCode ? <Badge tone="ok">{j.roleName(x.roleCode)}</Badge> : <Badge tone="warn">{t('joya.set.noJoyaRole')}</Badge>}>
          <div className={c.sub}>{t('joya.set.roleEmployees', { n: x.employees })}</div>
          {admin ? (
            <Select value={x.roleCode || ''} disabled={act.busy} onChange={(e) => save(x.alias, e.target.value)}>
              <option value="">{t('joya.set.noJoyaRole')}</option>
              {(j.me?.roles || []).map((role) => (
                <option key={role.code} value={role.code}>
                  {j.roleName(role.code)}
                </option>
              ))}
            </Select>
          ) : null}
        </Card>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- numbers

function NumberGroup({ name, value, canEdit, onSaved, c }) {
  const { t } = useT();
  const keys = [...(ORDER[name] || []).filter((k) => k in value), ...Object.keys(value).filter((k) => !(ORDER[name] || []).includes(k))];
  const [draft, setDraft] = useState(() => Object.fromEntries(keys.map((k) => [k, String(value[k])])));
  const [saved, setSaved] = useState(false);
  const act = useAction();
  useEffect(() => setDraft(Object.fromEntries(keys.map((k) => [k, String(value[k])]))), [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const bad = keys.filter((k) => !(draft[k] !== '' && Number.isFinite(Number(draft[k])) && Number(draft[k]) >= 0));
  const label = (k) => (t(`joya.set.k.${k}`) === `joya.set.k.${k}` ? k : t(`joya.set.k.${k}`));
  const help = (k) => (t(`joya.set.h.${k}`) === `joya.set.h.${k}` ? null : t(`joya.set.h.${k}`));
  return (
    <Card title={t(`joya.set.group.${name}`)} right={saved ? <Badge tone="ok">{t('joya.set.saved')}</Badge> : null}>
      {keys.map((k) => (
        <div key={k} className={c.num}>
          <div className={c.numHead}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{label(k)}</span>
            {canEdit ? (
              <span className={c.numInput}>
                <Input
                  dir="ltr"
                  inputMode="decimal"
                  value={draft[k] ?? ''}
                  onChange={(e) => {
                    setSaved(false);
                    setDraft({ ...draft, [k]: e.target.value });
                  }}
                />
              </span>
            ) : (
              <Term>{String(value[k])}</Term>
            )}
          </div>
          {help(k) ? <div className={c.sub}>{help(k)}</div> : null}
          {canEdit && bad.includes(k) ? <div className={c.sub} style={{ color: '#d29922' }}>{t('joya.set.badNumber')}</div> : null}
        </div>
      ))}
      {canEdit ? (
        <div className={c.actions}>
          <Btn
            kind="primary"
            disabled={act.busy || bad.length > 0}
            onClick={() =>
              act.run(async () => {
                const out = await api(`/settings/${name}`, { method: 'PUT', body: { value: Object.fromEntries(keys.map((k) => [k, Number(draft[k])])) } });
                setSaved(true);
                onSaved(out.settings);
              })
            }
          >
            {t('joya.save')}
          </Btn>
        </div>
      ) : null}
      <ErrorBox error={act.error} />
    </Card>
  );
}

function Numbers({ c }) {
  const { t } = useT();
  const j = useJoya();
  const r = useLoad(() => api('/settings'), []);
  const canEdit = !!j.me?.isAdmin;
  return (
    <>
      <p className={c.note}>
        {t('joya.set.numbersIntro')} {canEdit ? null : t('joya.set.readOnly')}
      </p>
      <ErrorBox error={r.error} />
      {r.loading && !r.data ? <Loading /> : null}
      {r.data
        ? ['replenishment', 'staffing', 'labor', 'dataQuality']
            .filter((n) => r.data.settings[n])
            .map((n) => <NumberGroup key={n} name={n} value={r.data.settings[n]} canEdit={canEdit} c={c} onSaved={(settings) => r.setData({ settings })} />)
        : null}
    </>
  );
}

// ---------------------------------------------------------------- integrations

function Integrations({ c }) {
  const { t } = useT();
  const j = useJoya();
  const check = useLoad(() => api('/source/check'), []);
  return (
    <>
      <Card>
        <p className={c.note}>{t('joya.set.intText1')}</p>
        <p className={c.note} style={{ marginBottom: 0 }}>
          {t('joya.set.intText2')}
        </p>
      </Card>
      {(j.me?.integrations || []).map((i) => (
        <Card
          key={i.source}
          title={<Term>{i.name}</Term>}
          right={i.source === 'ALLEGRO' && check.data?.connected ? <Badge tone="ok">{t('joya.data.connected')}</Badge> : <Badge tone="warn">{t('joya.data.notConnected')}</Badge>}
        >
          {i.source === 'ALLEGRO' && check.data ? (
            <Row label={t('joya.set.apiUrl')}>
              <Term>{check.data.url}</Term>
            </Row>
          ) : null}
          {i.source === 'ALLEGRO' && check.data?.error ? <div className={c.sub}>{check.data.error}</div> : null}
          <Row label={t('joya.set.envName')}>{ENV[i.source] ? <Term>{ENV[i.source]}</Term> : t('joya.set.noEnv')}</Row>
          <div style={{ margin: '0.2rem 0' }}>
            <Badge tone="info">{t(`joya.data.method.${i.method}`)}</Badge>
          </div>
          <div className={c.sub}>{i.credentialsConfigured ? t('joya.data.cred.set') : t('joya.data.cred.notSet')}</div>
        </Card>
      ))}
    </>
  );
}

export default function Settings() {
  const theme = useTheme();
  const c = useStyles(theme);
  const { t } = useT();
  const j = useJoya();
  const admin = !!j.me?.isAdmin;
  const tabs = [admin && ['users', t('joya.set.tabUsers')], admin && ['locations', t('joya.set.tabLocations')], ['roles', t('joya.set.tabRoles')], ['numbers', t('joya.set.tabNumbers')], ['integrations', t('joya.set.tabIntegrations')]].filter(Boolean);
  const wanted = new URLSearchParams(window.location.search).get('tab');
  const [tab, setTab] = useState(tabs.some((x) => x[0] === wanted) ? wanted : tabs[0][0]);
  return (
    <Page title={t('joya.set.title')} tabs={<Tabs tabs={tabs} value={tab} onChange={setTab} />}>
      {!admin && (tab === 'users' || tab === 'locations') ? <Empty>{t('joya.set.adminOnly')}</Empty> : null}
      {admin && tab === 'users' ? <Users c={c} /> : null}
      {admin && tab === 'locations' ? <Locations c={c} /> : null}
      {tab === 'roles' ? <Roles c={c} /> : null}
      {tab === 'numbers' ? <Numbers c={c} /> : null}
      {tab === 'integrations' ? <Integrations c={c} /> : null}
    </Page>
  );
}
