// /shortages — report a shortage in a few taps (item, location, date), and the recent reports.
import React, { useState } from 'react';
import { createUseStyles, useTheme } from 'react-jss';
import { api, qs } from '../api.js';
import { Page, Card, Btn, Badge, Field, Input, Loading, Empty, ErrorBox, useLoad, useAction, fmtDay, Term } from '../ui.js';
import { useJoya } from '../context.js';
import { useT } from '../i18n/index.js';

const useStyles = createUseStyles((theme) => ({
  hit: { display: 'block', width: '100%', textAlign: 'start', padding: '0.45rem 0.5rem', border: 0, borderBottom: `1px solid ${theme.border}`, background: 'none', color: theme.text, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.88rem' },
  small: { fontSize: '0.76rem', color: theme.textSecondary, marginTop: '0.3rem' },
  ok: { fontSize: '0.84rem', color: '#3fb950', marginTop: '0.4rem' },
  warn: { fontSize: '0.84rem', color: '#d29922', marginTop: '0.4rem' },
  item: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' },
}));

export default function Shortages() {
  const theme = useTheme();
  const c = useStyles(theme);
  const { t } = useT();
  const j = useJoya();
  const [search, setSearch] = useState('');
  const [pick, setPick] = useState(null);
  const [date, setDate] = useState(j.me?.today || '');
  const [note, setNote] = useState('');
  const [done, setDone] = useState(null); // { matched }
  const act = useAction();
  const scopeKey = j.scope.join(',');

  const hits = useLoad(() => (search.trim() && !pick ? api(`/ingredients${qs({ search: search.trim() })}`) : Promise.resolve({ ingredients: [] })), [search, pick]);
  const list = useLoad(() => api(`/shortages${qs({ locationIds: scopeKey, days: 30 })}`), [scopeKey]);

  const name = pick ? pick.name : search.trim();
  const submit = () =>
    act.run(async () => {
      const out = await api('/shortages', { method: 'POST', body: { locationId: j.oneLocationId, ingredientId: pick?.id ?? undefined, itemText: pick ? undefined : name, date, note: note || undefined } });
      setDone({ matched: out.matched });
      setSearch('');
      setPick(null);
      setNote('');
      list.reload();
    });
  const remove = (id) =>
    act.run(async () => {
      await api(`/shortages/${id}`, { method: 'DELETE' });
      list.reload();
    });

  return (
    <Page title={t('joya.short.title')} sub={j.locName(j.oneLocationId)}>
      <Card title={t('joya.short.report')}>
        <Field label={t('joya.short.item')} hint={t('joya.short.itemHint')}>
          <Input
            dir="auto"
            value={pick ? pick.name : search}
            onChange={(e) => {
              setPick(null);
              setDone(null);
              setSearch(e.target.value);
            }}
          />
        </Field>
        {!pick &&
          (hits.data?.ingredients || [])
            .filter((i) => i.active)
            .slice(0, 6)
            .map((i) => (
              <button key={i.id} type="button" className={c.hit} onClick={() => setPick(i)}>
                <span dir="auto">{i.name}</span>
              </button>
            ))}
        <Field label={t('joya.short.date')}>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={t('joya.noteOptional')}>
          <Input dir="auto" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Btn kind="primary" disabled={!name || !date || act.busy || j.oneLocationId == null} onClick={submit}>
          {t('joya.short.submit')}
        </Btn>
        {done && <div className={done.matched ? c.ok : c.warn}>{done.matched ? t('joya.short.saved') : t('joya.short.savedFreeText')}</div>}
        <ErrorBox error={act.error} />
        <div className={c.small}>{t('joya.short.noReportNote')}</div>
      </Card>

      <h2 style={{ fontSize: '0.92rem', margin: '1rem 0 0.5rem' }}>{t('joya.short.recent')}</h2>
      {list.loading && <Loading />}
      <ErrorBox error={list.error} />
      {list.data && !list.data.shortages.length && <Empty>{t('joya.short.none')}</Empty>}
      {list.data?.shortages.map((s) => (
        <Card key={s.id}>
          <div className={c.item}>
            <span style={{ minWidth: 0 }}>
              <b dir="auto">{s.name}</b> {s.unmatched && <Badge tone="warn">{t('joya.short.freeText')}</Badge>} {s.isDemo && <Badge tone="warn">{t('joya.demo')}</Badge>}
              <div className={c.small}>
                <Term>{fmtDay(s.date)}</Term> · {s.locationName} {s.by ? `· ${s.by}` : ''}
              </div>
              {s.note && (
                <div className={c.small} dir="auto">
                  {s.note}
                </div>
              )}
            </span>
            <Btn small kind="danger" onClick={() => remove(s.id)} disabled={act.busy}>
              {t('joya.delete')}
            </Btn>
          </div>
        </Card>
      ))}
    </Page>
  );
}
