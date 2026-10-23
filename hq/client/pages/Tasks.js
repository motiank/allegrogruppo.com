// /tasks — headquarters tasks: owner, due date, status. Findings elsewhere
// (anomalies, inquiries, data problems) create tasks here.
import React, { useState } from 'react';
import { createUseStyles, useTheme } from 'react-jss';
import { api, qs } from '../api.js';
import { useT } from '../i18n/index.js';
import { useJoya } from '../context.js';
import { Page, Card, Btn, Badge, Field, Input, Select, TextArea, Modal, Tabs, Loading, Empty, ErrorBox, useLoad, useAction, fmtDay, statusTone, Term } from '../ui.js';

const useStyles = createUseStyles((theme) => ({
  meta: { fontSize: '0.76rem', color: theme.textSecondary, marginTop: '0.25rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' },
  late: { color: '#f2a3a8', fontWeight: 600 },
  desc: { fontSize: '0.82rem', marginTop: '0.25rem', whiteSpace: 'pre-wrap' },
  actions: { display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.45rem' },
}));

const STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'];

export default function Tasks() {
  const theme = useTheme();
  const c = useStyles(theme);
  const { t } = useT();
  const j = useJoya();
  const today = j.me?.today;
  const [filter, setFilter] = useState('open');
  const [edit, setEdit] = useState(null);
  const act = useAction();
  const scope = j.scope;

  const params = {
    open: { status: 'OPEN,IN_PROGRESS' },
    overdue: { overdue: 1 },
    mine: { status: 'OPEN,IN_PROGRESS', owner: j.me?.username },
    done: { status: 'DONE,CANCELLED' },
  }[filter];
  const { data, error, loading, reload } = useLoad(() => api(`/tasks${qs({ locationIds: scope, ...params })}`), [filter, scope.join(',')]);

  const save = (task) =>
    act.run(async () => {
      await api('/tasks', { method: 'POST', body: task });
      setEdit(null);
      reload();
    });
  const setStatus = (task, status) => save({ id: task.id, locationId: task.locationId, title: task.title, description: task.description, owner: task.owner, dueDate: task.dueDate, status });

  return (
    <Page
      title={t('joya.tasks.title')}
      actions={
        <Btn kind="primary" onClick={() => setEdit({ locationId: j.locationId ?? (j.me?.isAdmin ? null : j.oneLocationId), title: '', description: '', owner: '', dueDate: '', status: 'OPEN' })}>
          {t('joya.tasks.new')}
        </Btn>
      }
      tabs={
        <Tabs
          value={filter}
          onChange={setFilter}
          tabs={[
            ['open', t('joya.tasks.fOpen')],
            ['overdue', t('joya.tasks.fOverdue')],
            ['mine', t('joya.tasks.fMine')],
            ['done', t('joya.tasks.fDone')],
          ]}
        />
      }
    >
      <ErrorBox error={act.error} />
      {loading && !data ? <Loading /> : null}
      <ErrorBox error={error} />
      {data && data.tasks.length === 0 && <Empty>{t('joya.none')}</Empty>}
      {data?.tasks.map((task) => {
        const late = task.dueDate && task.dueDate < today && ['OPEN', 'IN_PROGRESS'].includes(task.status);
        return (
          <Card key={task.id} title={<span dir="auto">{task.title}</span>} right={<Badge tone={statusTone(task.status)}>{t(`joya.status.${task.status}`)}</Badge>}>
            {task.description ? <div className={c.desc} dir="auto">{task.description}</div> : null}
            <div className={c.meta}>
              <span>{task.locationName || t('joya.tasks.chain')}</span>
              <span>
                {t('joya.tasks.owner')}: {task.owner ? <Term>{task.owner}</Term> : t('joya.tasks.noOwner')}
              </span>
              <span className={late ? c.late : undefined}>
                {t('joya.tasks.due')}: {task.dueDate ? <Term>{fmtDay(task.dueDate)}</Term> : '—'} {late ? `· ${t('joya.tasks.overdue')}` : ''}
              </span>
              {task.sourceKind && task.sourceKind !== 'MANUAL' ? (
                <span>
                  {t('joya.tasks.from')}: {t(`joya.tasks.src.${task.sourceKind}`)} {task.sourceRef ? <Term>{task.sourceRef}</Term> : null}
                </span>
              ) : null}
            </div>
            <div className={c.actions}>
              {task.status === 'OPEN' && <Btn small disabled={act.busy} onClick={() => setStatus(task, 'IN_PROGRESS')}>{t('joya.tasks.start')}</Btn>}
              {['OPEN', 'IN_PROGRESS'].includes(task.status) && <Btn small kind="primary" disabled={act.busy} onClick={() => setStatus(task, 'DONE')}>{t('joya.tasks.done')}</Btn>}
              {['DONE', 'CANCELLED'].includes(task.status) && <Btn small disabled={act.busy} onClick={() => setStatus(task, 'OPEN')}>{t('joya.tasks.reopen')}</Btn>}
              <Btn small onClick={() => setEdit({ ...task, owner: task.owner || '', dueDate: task.dueDate || '', description: task.description || '' })}>{t('joya.edit')}</Btn>
            </div>
          </Card>
        );
      })}

      {edit && (
        <Modal
          title={edit.id ? t('joya.tasks.editTitle') : t('joya.tasks.new')}
          onClose={() => setEdit(null)}
          footer={
            <>
              <Btn onClick={() => setEdit(null)}>{t('joya.cancel')}</Btn>
              <Btn kind="primary" disabled={act.busy || !edit.title.trim() || (!j.me?.isAdmin && edit.locationId == null)} onClick={() => save({ ...edit, owner: edit.owner || null, dueDate: edit.dueDate || null })}>
                {t('joya.save')}
              </Btn>
            </>
          }
        >
          <ErrorBox error={act.error} />
          <Field label={t('joya.tasks.fTitle')}>
            <Input dir="auto" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
          </Field>
          <Field label={t('joya.tasks.fDesc')}>
            <TextArea value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
          </Field>
          <Field label={t('joya.location')}>
            <Select value={edit.locationId ?? ''} onChange={(e) => setEdit({ ...edit, locationId: e.target.value || null })}>
              {j.me?.isAdmin ? <option value="">{t('joya.tasks.chain')}</option> : <option value="">—</option>}
              {j.locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('joya.tasks.owner')} hint={t('joya.tasks.ownerHint')}>
            <Input dir="ltr" value={edit.owner} onChange={(e) => setEdit({ ...edit, owner: e.target.value })} />
          </Field>
          <Field label={t('joya.tasks.due')}>
            <Input type="date" value={edit.dueDate} onChange={(e) => setEdit({ ...edit, dueDate: e.target.value })} />
          </Field>
          <Field label={t('joya.tasks.status')}>
            <Select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{t(`joya.status.${s}`)}</option>
              ))}
            </Select>
          </Field>
        </Modal>
      )}
    </Page>
  );
}
