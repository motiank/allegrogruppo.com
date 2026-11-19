// /system — how fresh every data source is (owner 2026-11-18: "a system option in the main menu which displays this
// data"): the Hashavshevet copy, the bank files uploaded in the admin, Tabit, Beecomm, the Drive indexes and the fixed
// files — up to which date each one reaches, when it was last loaded, how many rows, and a state (fresh / late / stale).
// The admin computes it (admin/server/modules/dataFreshness.js) through /api/joya/system/freshness; chain admin only.
import React from 'react';
import { createUseStyles, useTheme } from 'react-jss';
import { api } from '../api.js';
import { useT } from '../i18n/index.js';
import { Page, Card, Btn, Badge, Loading, ErrorBox, useLoad, fmtDay, fmtWhen } from '../ui.js';
import { BUILD, checkForUpdate, reloadApp } from '../version.js';
import LegalUpdate from '../LegalUpdate.js';

const useStyles = createUseStyles((theme) => ({
  note: { fontSize: '0.82rem', color: theme.textSecondary, margin: '0 0 0.6rem', lineHeight: 1.5 },
  notes: { margin: 0, paddingInlineStart: '1.2rem', fontSize: '0.86rem', lineHeight: 1.6 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' },
  th: { textAlign: 'start', fontWeight: 650, color: theme.textSecondary, padding: '0.35rem 0.4rem', borderBottom: `1px solid ${theme.border}`, whiteSpace: 'nowrap' },
  td: { padding: '0.4rem 0.4rem', borderBottom: `1px solid ${theme.border}`, verticalAlign: 'top' },
  num: { whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  detail: { color: theme.textSecondary, fontSize: '0.78rem', maxWidth: 420 },
  err: { color: '#f2a3a8', fontSize: '0.78rem' },
  age: { color: theme.textSecondary, fontSize: '0.74rem', display: 'block' },
  wrap: { overflowX: 'auto' },
  ver: { display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', fontSize: '0.86rem', marginBottom: '0.3rem' },
  ok: { color: '#3fb950' },
}));

const TONE = { ok: 'ok', late: 'warn', stale: 'bad', missing: 'bad', error: 'bad', fixed: 'muted' };

// the app's own version: this bundle's build id against the server's (client/version.js); the button checks now and loads
// the new build when there is one (owner 2026-11-18: "an app update button in the System page")
function AppVersion({ c }) {
  const { t } = useT();
  const [state, setState] = React.useState({ busy: false, result: null, error: null });
  const check = async () => {
    setState({ busy: true, result: null, error: null });
    try {
      const r = await checkForUpdate();
      if (r.isNew) { await reloadApp(); return; }
      setState({ busy: false, result: r, error: null });
    } catch (e) {
      setState({ busy: false, result: null, error: e });
    }
  };
  return (
    <Card title={t('joya.update.cardTitle')} right={<Btn small kind="primary" onClick={check} disabled={state.busy}>{state.busy ? t('joya.update.checking') : t('joya.update.button')}</Btn>}>
      <div className={c.ver}>
        <span>{t('joya.update.current')}: <bdi dir="ltr">{BUILD}</bdi></span>
        {state.result ? <span className={c.ok}>{t('joya.update.upToDate', { when: state.result.builtAt ? fmtWhen(state.result.builtAt) : '' })}</span> : null}
        {state.error ? <span className={c.err}>{String(state.error.message || state.error)}</span> : null}
      </div>
      <p className={c.note}>{t('joya.update.hint')}</p>
    </Card>
  );
}

export default function System() {
  const theme = useTheme();
  const c = useStyles(theme);
  const { t, lang } = useT();
  const r = useLoad(() => api('/system/freshness'), []);
  const label = (x) => (lang === 'en' && x.labelEn ? x.labelEn : x.label);
  const age = (x) => (x.ageDays == null ? '' : x.ageDays === 0 ? t('joya.system.today') : t('joya.system.ago', { n: x.ageDays }));
  return (
    <Page
      title={t('joya.system.title')}
      sub={r.data ? t('joya.system.sub', { when: fmtWhen(r.data.generatedAt) }) : null}
      actions={<Btn small onClick={r.reload} disabled={r.loading}>{t('joya.system.refresh')}</Btn>}
    >
      {r.loading && !r.data ? <Loading /> : null}
      {r.error ? <ErrorBox error={r.error} /> : null}
      <AppVersion c={c} />
      <LegalUpdate />
      {r.data ? (
        <>
          {r.data.notes?.length ? (
            <Card title={t('joya.system.notes')}>
              <ul className={c.notes}>{r.data.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </Card>
          ) : null}
          {r.data.groups.map((g) => (
            <Card key={g.key} title={label(g)}>
              <div className={c.wrap}>
                <table className={c.table}>
                  <thead>
                    <tr>
                      <th className={c.th}>{t('joya.system.col.source')}</th>
                      <th className={c.th}>{t('joya.system.col.lastDate')}</th>
                      <th className={c.th}>{t('joya.system.col.lastUpdate')}</th>
                      <th className={c.th}>{t('joya.system.col.count')}</th>
                      <th className={c.th}>{t('joya.system.col.state')}</th>
                      <th className={c.th}>{t('joya.system.col.detail')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map((x) => (
                      <tr key={x.key}>
                        <td className={c.td}>{label(x)}</td>
                        <td className={`${c.td} ${c.num}`}>
                          {x.lastDate ? fmtDay(x.lastDate) : '—'}
                          {x.lastDate ? <span className={c.age}>{age(x)}</span> : null}
                        </td>
                        <td className={`${c.td} ${c.num}`}>
                          {x.lastUpdate ? fmtWhen(x.lastUpdate) : '—'}
                          {!x.lastDate && x.lastUpdate ? <span className={c.age}>{age(x)}</span> : null}
                        </td>
                        <td className={`${c.td} ${c.num}`}>{x.count == null ? '—' : Number(x.count).toLocaleString('en-US')}</td>
                        <td className={c.td}>
                          <Badge tone={TONE[x.state] || 'muted'} title={x.expectedDays != null ? t('joya.system.expected', { n: x.expectedDays }) : undefined}>
                            {t(`joya.system.state.${x.state}`)}
                          </Badge>
                        </td>
                        <td className={`${c.td} ${c.detail}`}>
                          {x.detail || ''}
                          {x.error ? <div className={c.err}>{x.error}</div> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
          <p className={c.note}>{t('joya.system.legend')}</p>
        </>
      ) : null}
    </Page>
  );
}
