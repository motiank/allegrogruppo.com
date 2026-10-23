// /inquiries/:id — one inquiry or review: the text, the reply draft (by a person or
// the AI), who approved the reply and who marked it as responded. Nothing is sent from
// here: the reply is copied and posted on Instagram/Google by a person.
import React, { useEffect, useState } from 'react';
import { createUseStyles, useTheme } from 'react-jss';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useT } from '../i18n/index.js';
import { useJoya } from '../context.js';
import AskBox from '../AskBox.js';
import { Stars } from './Inquiries.js';
import { Page, Card, Row, Btn, Badge, Field, Input, TextArea, Loading, ErrorBox, useLoad, useAction, fmtWhen, addDays, statusTone, Term } from '../ui.js';

const useStyles = createUseStyles((theme) => ({
  content: { fontSize: '0.92rem', lineHeight: 1.6, whiteSpace: 'pre-wrap', marginTop: '0.3rem' },
  stars: { color: '#d29922', fontSize: '1rem' },
  actions: { display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.55rem' },
  note: { fontSize: '0.76rem', color: theme.textSecondary, marginTop: '0.35rem', lineHeight: 1.5 },
  ok: { fontSize: '0.78rem', color: '#3fb950', marginTop: '0.3rem' },
}));

export default function Inquiry() {
  const theme = useTheme();
  const c = useStyles(theme);
  const { t } = useT();
  const { id } = useParams();
  const navigate = useNavigate();
  const j = useJoya();
  const act = useAction();
  const [draft, setDraft] = useState('');
  const [owner, setOwner] = useState('');
  const [copied, setCopied] = useState(false);
  const [taskMade, setTaskMade] = useState(false);
  const { data, error, loading, reload, setData } = useLoad(() => api(`/inquiries/${id}`).then((d) => d.inquiry), [id]);

  useEffect(() => {
    if (data) {
      setDraft(data.draft || '');
      setOwner(data.owner || '');
    }
  }, [data]);

  const action = (body) =>
    act.run(async () => {
      const r = await api(`/inquiries/${id}/action`, { method: 'POST', body });
      setData(r.inquiry);
    });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data.draft || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  const makeTask = () =>
    act.run(async () => {
      await api('/tasks', {
        method: 'POST',
        body: { locationId: data.locationId, title: t('joya.inq.taskTitle', { source: t(`joya.src.${data.source}`) }), description: data.content, dueDate: addDays(j.me.today, 2), sourceKind: 'INQUIRY', sourceRef: String(data.id) },
      });
      setTaskMade(true);
    });

  if (loading && !data) return <Page title={t('joya.inq.one')} back="/inquiries"><Loading /></Page>;
  if (error) return <Page title={t('joya.inq.one')} back="/inquiries"><ErrorBox error={error} /></Page>;
  const q = data;
  const open = !['RESPONDED', 'CLOSED'].includes(q.status);

  return (
    <Page
      title={<>{t(`joya.src.${q.source}`)} · {t(`joya.inq.kind.${q.kind}`)}</>}
      sub={q.locationName || t('joya.tasks.chain')}
      back="/inquiries"
      actions={<Badge tone={statusTone(q.status)}>{t(`joya.status.${q.status}`)}</Badge>}
    >
      <ErrorBox error={act.error} />
      <Card title={q.author ? <bdi dir="auto">{q.author}</bdi> : t('joya.inq.noAuthor')} right={q.isDemo ? <Badge tone="warn">{t('joya.demo')}</Badge> : null}>
        <Stars n={q.rating} className={c.stars} />
        <div className={c.content} dir="auto">{q.content}</div>
        <Row label={t('joya.inq.receivedAt')}><Term>{fmtWhen(q.receivedAt || q.createdAt)}</Term></Row>
        {q.externalRef ? <Row label={t('joya.inq.ref')}><bdi dir="ltr" style={{ wordBreak: 'break-all' }}>{q.externalRef}</bdi></Row> : null}
        <Row label={t('joya.inq.enteredBy')}><Term>{q.createdBy || '—'}</Term> · {t(`joya.inq.via.${q.enteredVia}`)}</Row>
        <div className={c.actions}>
          {q.status === 'NEW' && <Btn small disabled={act.busy} onClick={() => action({ action: 'start' })}>{t('joya.inq.start')}</Btn>}
          {open && <Btn small disabled={act.busy} onClick={() => action({ action: 'close' })}>{t('joya.inq.closeBtn')}</Btn>}
          {!open && <Btn small disabled={act.busy} onClick={() => action({ action: 'reopen' })}>{t('joya.inq.reopen')}</Btn>}
          {taskMade ? <span className={c.ok}>✓ {t('joya.sales.taskCreated')}</span> : <Btn small disabled={act.busy} onClick={makeTask}>{t('joya.sales.createTask')}</Btn>}
        </div>
      </Card>

      <Card title={t('joya.tasks.owner')}>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <Input dir="ltr" value={owner} placeholder={t('joya.tasks.ownerHint')} onChange={(e) => setOwner(e.target.value)} />
          </div>
          <Btn disabled={act.busy || owner === (q.owner || '')} onClick={() => action({ action: 'assign', owner: owner.trim() || null })}>{t('joya.save')}</Btn>
        </div>
      </Card>

      <Card title={t('joya.inq.reply')}>
        <Field label={t('joya.inq.draftLabel')}>
          <TextArea rows={5} value={draft} onChange={(e) => setDraft(e.target.value)} />
        </Field>
        <div className={c.actions}>
          <Btn kind="primary" disabled={act.busy || !draft.trim() || draft === (q.draft || '')} onClick={() => action({ action: 'draft', draft })}>{t('joya.inq.saveDraft')}</Btn>
          {q.draft && !q.responseApprovedBy && <Btn disabled={act.busy || draft !== q.draft} onClick={() => action({ action: 'approve' })}>{t('joya.inq.approveReply')}</Btn>}
          {q.draft && <Btn disabled={!q.draft} onClick={copy}>{copied ? `✓ ${t('joya.inq.copied')}` : t('joya.inq.copy')}</Btn>}
          {q.status !== 'RESPONDED' && (
            <Btn disabled={act.busy} onClick={() => action({ action: 'responded' })}>{t('joya.inq.markResponded')}</Btn>
          )}
        </div>
        {q.draft ? (
          <Row label={t('joya.inq.draftBy')}>
            <Term>{q.draftBy || '—'}</Term>
          </Row>
        ) : null}
        <Row label={t('joya.inq.approvedBy')}>
          {q.responseApprovedBy ? (
            <>
              <Term>{q.responseApprovedBy}</Term> · <Term>{fmtWhen(q.responseApprovedAt)}</Term>
            </>
          ) : (
            t('joya.inq.notYet')
          )}
        </Row>
        <Row label={t('joya.inq.respondedBy')}>
          {q.respondedBy ? (
            <>
              <Term>{q.respondedBy}</Term> · <Term>{fmtWhen(q.respondedAt)}</Term>
            </>
          ) : (
            t('joya.inq.notYet')
          )}
        </Row>
        <div className={c.note}>{t('joya.inq.nothingSent')}</div>
      </Card>

      <AskBox
        contextKind="INQUIRY"
        contextId={Number(id)}
        locationId={q.locationId}
        title={t('joya.inq.askTitle')}
        onApplied={reload}
        examples={[t('joya.inq.ex1'), t('joya.inq.ex2')]}
      />
      <Btn kind="ghost" onClick={() => navigate('/inquiries')}>{t('joya.inq.backList')}</Btn>
    </Page>
  );
}
