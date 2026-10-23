// /learned — what the system learned per item for one location, from the final order lists.
import React from 'react';
import { api } from '../api.js';
import { Page, Card, Row, Btn, Badge, Val, Loading, Empty, ErrorBox, useLoad, useAction, fmtDay, fmtWhen, Term } from '../ui.js';
import { useJoya } from '../context.js';
import { useT } from '../i18n/index.js';

export default function Learned() {
  const { t } = useT();
  const j = useJoya();
  const loc = j.oneLocationId;
  const { data, error, loading, reload } = useLoad(() => (loc == null ? Promise.resolve({ patterns: [] }) : api(`/patterns?locationId=${loc}`)), [loc]);
  const act = useAction();
  const refresh = () =>
    act.run(async () => {
      await api('/patterns/refresh', { method: 'POST', body: { locationId: loc } });
      reload();
    });
  const patterns = data?.patterns || [];

  return (
    <Page
      title={t('joya.learned.title')}
      sub={j.locName(loc)}
      actions={
        <Btn onClick={refresh} disabled={act.busy || loc == null}>
          {t('joya.refresh')}
        </Btn>
      }
    >
      {j.locationId == null && loc != null && <div style={{ fontSize: '0.8rem', marginBottom: '0.6rem' }}>{t('joya.learned.showingFirst', { name: j.locName(loc) })}</div>}
      <Card title={t('joya.learned.howTitle')}>
        {['how1', 'how2', 'how3', 'how4', 'how5', 'how6'].map((k) => (
          <div key={k} style={{ fontSize: '0.82rem', padding: '0.15rem 0' }}>
            • {t(`joya.learned.${k}`)}
          </div>
        ))}
      </Card>
      <ErrorBox error={act.error} />
      <ErrorBox error={error} />
      {loading && <Loading />}
      {data && !patterns.length && <Empty>{t('joya.learned.none')}</Empty>}
      {patterns.map((p) => {
        const s = p.stats || {};
        return (
          <Card
            key={p.ingredientId}
            title={<span dir="auto">{p.name}</span>}
            right={
              <Badge tone={p.examples >= 4 ? 'ok' : p.examples >= 2 ? 'info' : 'muted'}>
                {t('joya.learned.examples', { count: p.examples })}
              </Badge>
            }
          >
            <Row label={t('joya.learned.lastOrdered')}>
              {s.lastOrdered ? (
                <>
                  <Term>{fmtDay(s.lastOrdered.date)}</Term> · <Val v={s.lastOrdered.qty} /> {p.unit || ''}
                </>
              ) : (
                <Val v={null} />
              )}
            </Row>
            <Row label={t('joya.learned.interval')}>
              <Val v={s.medianInterval} /> {s.medianInterval != null ? t('joya.learned.days') : ''}
            </Row>
            <Row label={t('joya.learned.typicalQty')}>
              <Val v={s.weightedMedianQty} /> {s.weightedMedianQty != null ? p.unit || '' : ''}
            </Row>
            <Row label={t('joya.learned.ratio')}>
              {s.ratio != null ? (
                <>
                  <Term>{Math.round(s.ratio * 1000) / 1000}</Term> · {t('joya.learned.ratioN', { count: s.ratioN })}
                </>
              ) : (
                <Val v={null} title={t('joya.learned.noRatio')} />
              )}
            </Row>
            <Row label={t('joya.learned.removed')}>
              {s.suggestedCount ? (
                <Term>
                  {s.removedCount} / {s.suggestedCount}
                </Term>
              ) : (
                '—'
              )}
            </Row>
            <div style={{ fontSize: '0.7rem', opacity: 0.7, marginTop: '0.3rem' }}>
              {t('joya.updated')}: <Term>{fmtWhen(p.computedAt)}</Term>
            </div>
          </Card>
        );
      })}
    </Page>
  );
}
