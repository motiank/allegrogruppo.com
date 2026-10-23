// /inquiries — customer inquiries and reviews (Instagram, Google). Entered by hand
// until the accounts are connected; nothing is ever sent from here.
import React, { useState } from 'react';
import { createUseStyles, useTheme } from 'react-jss';
import { useNavigate } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useT } from '../i18n/index.js';
import { useJoya } from '../context.js';
import { Page, Card, Btn, Badge, Field, Input, Select, TextArea, Modal, Tabs, Loading, Empty, ErrorBox, useLoad, useAction, fmtWhen, statusTone, Term } from '../ui.js';

const useStyles = createUseStyles((theme) => ({
  banner: { border: `1px solid ${theme.primary}`, background: 'rgba(74,125,255,0.08)', borderRadius: 8, padding: '0.55rem 0.75rem', fontSize: '0.8rem', marginBottom: '0.7rem', lineHeight: 1.5 },
  content: { fontSize: '0.84rem', marginTop: '0.3rem', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' },
  meta: { fontSize: '0.74rem', color: theme.textSecondary, marginTop: '0.3rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' },
  stars: { color: '#d29922', letterSpacing: '0.05em' },
}));

export const Stars = ({ n, className }) => (n ? <bdi dir="ltr" className={className}>{'★'.repeat(n)}{'☆'.repeat(5 - n)}</bdi> : null);

const FILTERS = {
  open: 'NEW,IN_PROGRESS,DRAFT_READY',
  responded: 'RESPONDED',
  closed: 'CLOSED',
  all: '',
};

export default function Inquiries() {
  const theme = useTheme();
  const c = useStyles(theme);
  const { t } = useT();
  const j = useJoya();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('open');
  const [form, setForm] = useState(null);
  const act = useAction();
  const scope = j.scope;
  const { data, error, loading, reload } = useLoad(() => api(`/inquiries${qs({ locationIds: scope, status: FILTERS[filter] })}`), [filter, scope.join(',')]);

  const create = () =>
    act.run(async () => {
      const body = { ...form, rating: form.kind === 'REVIEW' && form.rating ? Number(form.rating) : null, receivedAt: form.receivedAt || null };
      const r = await api('/inquiries', { method: 'POST', body });
      setForm(null);
      reload();
      navigate(`/inquiries/${r.inquiry.id}`);
    });

  return (
    <Page
      title={t('joya.inq.title')}
      actions={
        <Btn kind="primary" onClick={() => setForm({ source: 'GOOGLE', kind: 'REVIEW', locationId: j.locationId ?? j.oneLocationId, author: '', content: '', rating: '', receivedAt: '', externalRef: '' })}>
          {t('joya.inq.new')}
        </Btn>
      }
      tabs={
        <Tabs
          value={filter}
          onChange={setFilter}
          tabs={[
            ['open', t('joya.inq.fOpen')],
            ['responded', t('joya.inq.fResponded')],
            ['closed', t('joya.inq.fClosed')],
            ['all', t('joya.inq.fAll')],
          ]}
        />
      }
    >
      <div className={c.banner}>{t('joya.inq.notConnected')}</div>
      {loading && !data ? <Loading /> : null}
      <ErrorBox error={error} />
      {data && data.inquiries.length === 0 && <Empty>{t('joya.none')}</Empty>}
      {data?.inquiries.map((q) => (
        <Card
          key={q.id}
          onClick={() => navigate(`/inquiries/${q.id}`)}
          title={
            <span>
              <Badge tone="info">{t(`joya.src.${q.source}`)}</Badge> {t(`joya.inq.kind.${q.kind}`)} {q.author ? <>· <bdi dir="auto">{q.author}</bdi></> : null}
            </span>
          }
          right={<Badge tone={statusTone(q.status)}>{t(`joya.status.${q.status}`)}</Badge>}
        >
          <Stars n={q.rating} className={c.stars} />
          <div className={c.content} dir="auto">{q.content}</div>
          <div className={c.meta}>
            <span>{q.locationName || t('joya.tasks.chain')}</span>
            <span><Term>{fmtWhen(q.receivedAt || q.createdAt)}</Term></span>
            <span>{t('joya.tasks.owner')}: {q.owner ? <Term>{q.owner}</Term> : t('joya.tasks.noOwner')}</span>
            {q.isDemo ? <Badge tone="warn">{t('joya.demo')}</Badge> : null}
          </div>
        </Card>
      ))}

      {form && (
        <Modal
          title={t('joya.inq.new')}
          onClose={() => setForm(null)}
          footer={
            <>
              <Btn onClick={() => setForm(null)}>{t('joya.cancel')}</Btn>
              <Btn kind="primary" disabled={act.busy || !form.content.trim()} onClick={create}>{t('joya.save')}</Btn>
            </>
          }
        >
          <ErrorBox error={act.error} />
          <Field label={t('joya.inq.source')}>
            <Select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
              {['INSTAGRAM', 'GOOGLE', 'OTHER'].map((s) => (
                <option key={s} value={s}>{t(`joya.src.${s}`)}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('joya.inq.kindLabel')}>
            <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {['REVIEW', 'MESSAGE', 'COMMENT'].map((k) => (
                <option key={k} value={k}>{t(`joya.inq.kind.${k}`)}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('joya.location')}>
            <Select value={form.locationId ?? ''} onChange={(e) => setForm({ ...form, locationId: e.target.value || null })}>
              {j.me?.isAdmin && <option value="">{t('joya.tasks.chain')}</option>}
              {j.locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('joya.inq.author')}>
            <Input dir="auto" value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} />
          </Field>
          <Field label={t('joya.inq.content')}>
            <TextArea rows={4} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
          </Field>
          {form.kind === 'REVIEW' && (
            <Field label={t('joya.inq.rating')}>
              <Select value={form.rating} onChange={(e) => setForm({ ...form, rating: e.target.value })}>
                <option value="">—</option>
                {[5, 4, 3, 2, 1].map((n) => (
                  <option key={n} value={n}>{'★'.repeat(n)} ({n})</option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={t('joya.inq.receivedAt')}>
            <Input type="datetime-local" value={form.receivedAt} onChange={(e) => setForm({ ...form, receivedAt: e.target.value })} />
          </Field>
          <Field label={t('joya.inq.ref')} hint={t('joya.inq.refHint')}>
            <Input dir="ltr" value={form.externalRef} onChange={(e) => setForm({ ...form, externalRef: e.target.value })} />
          </Field>
        </Modal>
      )}
    </Page>
  );
}
