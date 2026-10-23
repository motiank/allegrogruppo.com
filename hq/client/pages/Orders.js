// /orders — the order lists of the chosen location(s): recommendations, manual lists,
// approved and ordered lists. Generate a new recommendation or start an empty list.
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, qs } from '../api.js';
import { Page, Card, Row, Btn, Badge, Field, Input, Modal, Tabs, Loading, Empty, ErrorBox, useLoad, useAction, fmtDay, fmtWhen, statusTone, Term } from '../ui.js';
import { useJoya } from '../context.js';
import { useT } from '../i18n/index.js';

const FILTERS = ['open', 'DRAFT', 'APPROVED', 'ORDERED', 'REJECTED', 'all'];
const filterStatus = (f) => (f === 'open' ? 'DRAFT,APPROVED' : f === 'all' ? '' : f);

export default function Orders() {
  const { t } = useT();
  const j = useJoya();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('open');
  const [gen, setGen] = useState(null); // null | { date, existingId? }
  const act = useAction();
  const scopeKey = j.scope.join(',');

  const { data, error, loading } = useLoad(() => api(`/orders${qs({ locationIds: scopeKey, status: filterStatus(filter) })}`), [scopeKey, filter]);

  const generate = (force) =>
    act.run(async () => {
      const out = await api('/orders/generate', { method: 'POST', body: { locationId: j.oneLocationId, date: gen.date, force } });
      if (out.existing && !force) setGen((g) => ({ ...g, existingId: out.listId }));
      else navigate(`/orders/${out.listId}`);
    });
  const manual = () =>
    act.run(async () => {
      const out = await api('/orders/manual', { method: 'POST', body: { locationId: j.oneLocationId, date: j.me.today } });
      navigate(`/orders/${out.listId}`);
    });

  return (
    <Page
      title={t('joya.orders.title')}
      sub={j.locationId == null ? t('joya.orders.subAll') : j.location?.name}
      actions={
        <>
          <Btn kind="primary" onClick={() => setGen({ date: j.me.today })}>
            {t('joya.orders.generate')}
          </Btn>
          <Btn onClick={manual} disabled={act.busy}>
            {t('joya.orders.manual')}
          </Btn>
        </>
      }
      tabs={<Tabs tabs={FILTERS.map((f) => [f, t(`joya.orders.filter.${f}`)])} value={filter} onChange={setFilter} />}
    >
      <ErrorBox error={act.error} />
      {j.locationId == null && j.locations.length > 1 && <div style={{ fontSize: '0.78rem', marginBottom: '0.6rem', opacity: 0.8 }}>{t('joya.orders.newGoesTo', { name: j.locName(j.oneLocationId) })}</div>}
      {loading && <Loading />}
      <ErrorBox error={error} />
      {data && !data.lists.length && <Empty>{t('joya.orders.none')}</Empty>}
      {data?.lists.map((l) => (
        <Card
          key={l.id}
          onClick={() => navigate(`/orders/${l.id}`)}
          title={
            <>
              <Term>{fmtDay(l.date)}</Term> · {l.locationName}
            </>
          }
          right={
            <>
              {l.isDemo && <Badge tone="warn">{t('joya.demo')}</Badge>} <Badge tone={statusTone(l.status)}>{t(`joya.status.${l.status}`)}</Badge>
            </>
          }
        >
          <Row label={t('joya.orders.origin')}>{t(`joya.orders.origin.${l.origin}`)}</Row>
          <Row label={t('joya.orders.lines')}>
            <Term>{l.lines}</Term>
          </Row>
          {l.approvedBy && (
            <Row label={t('joya.orders.approvedBy')}>
              {l.approvedBy} · <Term>{fmtWhen(l.approvedAt)}</Term>
            </Row>
          )}
          {l.orderedBy && (
            <Row label={t('joya.orders.orderedBy')}>
              {l.orderedBy} · <Term>{fmtWhen(l.orderedAt)}</Term>
            </Row>
          )}
        </Card>
      ))}

      {gen && (
        <Modal
          title={t('joya.orders.generate')}
          onClose={() => setGen(null)}
          footer={
            gen.existingId ? (
              <>
                <Btn kind="primary" onClick={() => navigate(`/orders/${gen.existingId}`)}>
                  {t('joya.orders.openExisting')}
                </Btn>
                <Btn onClick={() => generate(true)} disabled={act.busy}>
                  {t('joya.orders.generateAgain')}
                </Btn>
              </>
            ) : (
              <Btn kind="primary" onClick={() => generate(false)} disabled={act.busy || !gen.date}>
                {act.busy ? t('joya.loading') : t('joya.orders.generateGo')}
              </Btn>
            )
          }
        >
          <div style={{ fontSize: '0.85rem', marginBottom: '0.6rem' }}>{t('joya.orders.generateFor', { name: j.locName(j.oneLocationId) })}</div>
          <Field label={t('joya.orders.listDate')}>
            <Input type="date" value={gen.date} onChange={(e) => setGen({ date: e.target.value })} />
          </Field>
          {gen.existingId && <div style={{ fontSize: '0.84rem' }}>{t('joya.orders.existingDraft')}</div>}
          <div style={{ fontSize: '0.75rem', opacity: 0.8 }}>{t('joya.orders.noStockNote')}</div>
          <ErrorBox error={act.error} />
        </Modal>
      )}
    </Page>
  );
}
