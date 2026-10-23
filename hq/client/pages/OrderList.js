// /orders/:id — one order list. The manager edits quantities, removes and adds items,
// then approves; after placing the order they mark it as ordered. The original
// recommendation and every edit stay visible below the working list.
import React, { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { createUseStyles, useTheme } from 'react-jss';
import { api, qs } from '../api.js';
import AskBox from '../AskBox.js';
import { Page, Card, Row, Btn, Badge, Field, Input, TextArea, Modal, DemoBanner, Val, Loading, Empty, ErrorBox, Details, useLoad, useAction, fmtDay, fmtWhen, statusTone, Term } from '../ui.js';
import { useT } from '../i18n/index.js';

const useStyles = createUseStyles((theme) => ({
  note: { fontSize: '0.78rem', color: theme.textSecondary, marginBottom: '0.7rem' },
  line: { border: `1px solid ${theme.border}`, borderRadius: 10, padding: '0.6rem 0.75rem', marginBottom: '0.5rem', background: theme.surface },
  lineBad: { borderColor: '#d29922', boxShadow: '0 0 0 1px #d29922 inset' },
  lineTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' },
  name: { fontWeight: 650, fontSize: '0.92rem', minWidth: 0 },
  badges: { display: 'flex', gap: '0.3rem', flexWrap: 'wrap' },
  qtyRow: { display: 'flex', alignItems: 'center', gap: '0.45rem', marginTop: '0.45rem', flexWrap: 'wrap' },
  qty: { width: '6.5rem', padding: '0.4rem 0.5rem', border: `1px solid ${theme.border}`, borderRadius: 6, background: theme.background, color: theme.text, fontSize: '0.95rem', fontFamily: 'inherit' },
  unit: { fontSize: '0.85rem', color: theme.textSecondary },
  small: { fontSize: '0.76rem', color: theme.textSecondary, marginTop: '0.25rem' },
  warnTxt: { fontSize: '0.78rem', color: '#d29922', marginTop: '0.3rem' },
  why: { marginTop: '0.4rem', fontSize: '0.8rem', borderTop: `1px solid ${theme.border}`, paddingTop: '0.4rem' },
  whyLine: { padding: '0.1rem 0' },
  bar: { position: 'sticky', bottom: 0, zIndex: 10, display: 'flex', gap: '0.5rem', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 0.8rem', marginTop: '0.6rem', border: `1px solid ${theme.primary}`, borderRadius: 10, background: theme.surface, flexWrap: 'wrap' },
  section: { fontSize: '0.86rem', fontWeight: 650, margin: '1rem 0 0.45rem' },
  actions: { display: 'flex', gap: '0.45rem', flexWrap: 'wrap', margin: '0.3rem 0 0.8rem' },
  hit: { display: 'block', width: '100%', textAlign: 'start', padding: '0.45rem 0.5rem', border: 0, borderBottom: `1px solid ${theme.border}`, background: 'none', color: theme.text, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.88rem' },
}));

const num = (v) => (v == null || v === '' ? null : Number(v));

/** The reasons / notes / calc of one recommendation line, in words. */
function Why({ rec, classes }) {
  const { t } = useT();
  if (!rec) return <div className={classes.why}>{t('joya.orders.why.manual')}</div>;
  const b = rec.basis || {};
  return (
    <div className={classes.why}>
      <div className={classes.whyLine}>
        {t('joya.orders.why.method')}: <b>{t(`joya.orders.method.${rec.method}`)}</b> · {t(`joya.conf.${rec.confidence}`)}
      </div>
      {(b.reasons || []).map((r, i) => (
        <div key={i} className={classes.whyLine}>
          • <Reason r={r} />
        </div>
      ))}
      {(b.calc || []).map((c, i) => (
        <div key={i} className={classes.whyLine}>
          ∑ <Term>{c}</Term>
        </div>
      ))}
      {(b.notes || []).map((n, i) => (
        <div key={i} className={classes.whyLine} style={{ color: '#d29922' }}>
          ! {t(`joya.orders.notes.${n.code}`, { daysMissing: n.daysMissing ?? '', from: n.from ?? '', to: n.to ?? '', reason: n.reason ?? '', removed: n.removed ?? '', suggested: n.suggested ?? '' })}
        </div>
      ))}
      {b.examples?.length ? (
        <Details summary={t('joya.orders.why.examples', { count: b.examples.length })}>
          {b.examples.map((e, i) => (
            <div key={i} className={classes.whyLine}>
              <Term>{fmtDay(e.date)}</Term> · {t(`joya.orders.exStatus.${e.status}`)} · {t('joya.orders.qty')} <Val v={e.qty} /> · {t('joya.orders.why.weight')} <Term>{e.weight}</Term>
            </div>
          ))}
        </Details>
      ) : null}
      {b.ratios?.length ? (
        <Details summary={t('joya.orders.why.ratios', { count: b.ratios.length })}>
          {b.ratios.map((r, i) => (
            <div key={i} className={classes.whyLine}>
              <Term>
                {fmtDay(r.from)} – {fmtDay(r.date)}: {r.qty} / {r.units} = {r.ratio}
              </Term>
            </div>
          ))}
        </Details>
      ) : null}
    </div>
  );
}

function Reason({ r }) {
  const { t } = useT();
  const v = { ...r };
  if (r.dates) v.dates = r.dates.map(fmtDay).join(', ');
  if (r.date) v.date = fmtDay(r.date);
  if (r.from) v.from = fmtDay(r.from);
  if (r.to) v.to = fmtDay(r.to);
  if (r.qty == null && r.code === 'ORDERED_ONCE') v.qty = t('joya.unknown');
  let s = t(`joya.orders.reason.${r.code}`, v);
  if (r.code === 'LINKED_SALES' && r.daysMissing) s += ' ' + t('joya.orders.reason.daysMissing', { n: r.daysMissing });
  return <span dir="auto">{s}</span>;
}

export default function OrderList() {
  const theme = useTheme();
  const classes = useStyles(theme);
  const { t } = useT();
  const { id } = useParams();
  const { data, error, loading, reload, setData } = useLoad(() => api(`/orders/${id}`), [id]);
  const act = useAction();
  const [edits, setEdits] = useState({}); // lineId → { qty?, removed?, note? }
  const [added, setAdded] = useState([]); // [{ tmp, ingredientId?, name, qty, unit, note }]
  const [whyOpen, setWhyOpen] = useState({});
  const [noteOpen, setNoteOpen] = useState({});
  const [bad, setBad] = useState([]);
  const [modal, setModal] = useState(null); // 'add' | 'approve' | 'ordered' | 'reject' | 'reopen' | { text }
  const [reason, setReason] = useState('');
  const [copied, setCopied] = useState(false);

  const recByIng = useMemo(() => new Map((data?.recommendation || []).map((r) => [r.ingredientId, r])), [data]);

  if (loading && !data) return <Page title={t('joya.orders.listTitle')} back="/orders"><Loading /></Page>;
  if (error || !data) return <Page title={t('joya.orders.listTitle')} back="/orders"><ErrorBox error={error} /></Page>;

  const { list, lines, recommendation, edits: log } = data;
  const draft = list.status === 'DRAFT';
  const cur = (l) => ({ ...l, ...(edits[l.id] || {}) });
  const view = lines.map(cur);
  const active = view.filter((l) => !l.removed);
  const removed = view.filter((l) => l.removed);
  const dirty = Object.keys(edits).length > 0 || added.length > 0;
  const notDue = recommendation.filter((r) => r.section === 'NOT_DUE' && !lines.some((l) => l.ingredientId === r.ingredientId && !l.removed) && !added.some((a) => a.ingredientId === r.ingredientId));

  const setEdit = (line, patch) =>
    setEdits((e) => {
      const next = { ...(e[line.id] || {}), ...patch };
      // drop a field that is back to the saved value
      for (const k of Object.keys(next)) if (String(next[k] ?? '') === String(line[k] ?? '')) delete next[k];
      const out = { ...e };
      if (Object.keys(next).length) out[line.id] = next;
      else delete out[line.id];
      return out;
    });

  const buildOps = () => {
    const ops = [];
    for (const [lid, e] of Object.entries(edits)) {
      const lineId = Number(lid);
      const orig = lines.find((l) => l.id === lineId);
      if ('note' in e) ops.push({ op: 'note', lineId, note: e.note || null });
      const removedNow = 'removed' in e ? e.removed : orig.removed;
      if ('qty' in e && !removedNow) ops.push({ op: 'set_qty', lineId, qty: num(e.qty) });
      if ('removed' in e) ops.push({ op: e.removed ? 'remove' : 'restore', lineId });
    }
    for (const a of added) ops.push({ op: 'add', ingredientId: a.ingredientId || undefined, name: a.ingredientId ? undefined : a.name, qty: num(a.qty), unit: a.unit || undefined, note: a.note || undefined });
    return ops;
  };
  const invalidQty = Object.entries(edits).some(([lid, e]) => 'qty' in e && !(num(e.qty) > 0) && !(e.removed ?? lines.find((l) => l.id === Number(lid)).removed));

  const save = () =>
    act.run(async () => {
      const out = await api(`/orders/${id}/ops`, { method: 'POST', body: { ops: buildOps() } });
      setData(out);
      setEdits({});
      setAdded([]);
      setBad([]);
    });
  const undo = () => {
    setEdits({});
    setAdded([]);
  };
  const doAction = (what, body = {}) =>
    act.run(async () => {
      try {
        const out = await api(`/orders/${id}/${what}`, { method: 'POST', body });
        setData(out);
        setModal(null);
        setReason('');
        setBad([]);
      } catch (e) {
        if (e.details?.lineIds) setBad(e.details.lineIds);
        setModal(null);
        throw e;
      }
    });
  const copyText = () =>
    act.run(async () => {
      const { text } = await api(`/orders/${id}/text`);
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        setModal({ text });
      }
    });

  const lineBox = (l) => {
    const rec = l.ingredientId ? recByIng.get(l.ingredientId) : null;
    const noQty = !l.removed && (l.qty == null || l.qty === '');
    return (
      <div key={l.id} className={`${classes.line} ${noQty || bad.includes(l.id) ? classes.lineBad : ''}`}>
        <div className={classes.lineTop}>
          <span className={classes.name} dir="auto">
            {l.name}
          </span>
          <span className={classes.badges}>
            <Badge tone={l.origin === 'ADDED' ? 'info' : 'muted'}>{t(`joya.orders.lineOrigin.${l.origin}`)}</Badge>
            {l.recommended && <Badge tone={l.recommended.confidence === 'HIGH' ? 'ok' : l.recommended.confidence === 'NONE' ? 'warn' : 'muted'}>{t(`joya.conf.${l.recommended.confidence}`)}</Badge>}
            {l.freeText && <Badge tone="warn">{t('joya.orders.freeText')}</Badge>}
          </span>
        </div>
        <div className={classes.qtyRow}>
          {draft && !l.removed ? (
            <input
              className={classes.qty}
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={l.qty ?? ''}
              placeholder={t('joya.orders.qtyPh')}
              aria-label={t('joya.orders.qty')}
              onChange={(e) => setEdit(lines.find((x) => x.id === l.id), { qty: e.target.value === '' ? null : e.target.value })}
            />
          ) : (
            <b>
              <Val v={l.qty} />
            </b>
          )}
          <span className={classes.unit}>{l.unit || ''}</span>
          {l.recommended && String(l.recommended.qty ?? '') !== String(l.qty ?? '') && (
            <span className={classes.small}>
              {t('joya.orders.recommended')} <Val v={l.recommended.qty} />
            </span>
          )}
        </div>
        {noQty && <div className={classes.warnTxt}>{t('joya.orders.setQtyOrRemove')}</div>}
        {l.note && !noteOpen[l.id] && (
          <div className={classes.small} dir="auto">
            {t('joya.note')}: {l.note}
          </div>
        )}
        {draft && noteOpen[l.id] && (
          <div style={{ marginTop: '0.4rem' }}>
            <Input dir="auto" value={l.note ?? ''} placeholder={t('joya.noteOptional')} onChange={(e) => setEdit(lines.find((x) => x.id === l.id), { note: e.target.value })} />
          </div>
        )}
        <div className={classes.actions} style={{ margin: '0.4rem 0 0' }}>
          {l.ingredientId && (
            <Btn kind="ghost" small onClick={() => setWhyOpen((w) => ({ ...w, [l.id]: !w[l.id] }))}>
              {t('joya.orders.why')}
            </Btn>
          )}
          {draft && (
            <Btn kind="ghost" small onClick={() => setNoteOpen((w) => ({ ...w, [l.id]: !w[l.id] }))}>
              {t('joya.note')}
            </Btn>
          )}
          {draft &&
            (l.removed ? (
              <Btn small onClick={() => setEdit(lines.find((x) => x.id === l.id), { removed: false })}>
                {t('joya.orders.restore')}
              </Btn>
            ) : (
              <Btn small kind="danger" onClick={() => setEdit(lines.find((x) => x.id === l.id), { removed: true })}>
                {t('joya.orders.remove')}
              </Btn>
            ))}
        </div>
        {whyOpen[l.id] && <Why rec={rec} classes={classes} />}
      </div>
    );
  };

  return (
    <Page
      title={t('joya.orders.listTitle')}
      back="/orders"
      sub={
        <>
          {list.locationName} · <Term>{fmtDay(list.date)}</Term> · {t(`joya.orders.origin.${list.origin}`)}
        </>
      }
      actions={<Badge tone={statusTone(list.status)}>{t(`joya.status.${list.status}`)}</Badge>}
    >
      <DemoBanner show={list.isDemo} />
      <div className={classes.note}>{t('joya.orders.noStockNote')}</div>
      <Card>
        <Row label={t('joya.orders.createdBy')}>
          {list.createdBy || '—'} · <Term>{fmtWhen(list.createdAt)}</Term>
        </Row>
        {list.approvedBy && (
          <Row label={t('joya.orders.approvedBy')}>
            {list.approvedBy} · <Term>{fmtWhen(list.approvedAt)}</Term>
          </Row>
        )}
        {list.orderedBy && (
          <Row label={t('joya.orders.orderedBy')}>
            {list.orderedBy} · <Term>{fmtWhen(list.orderedAt)}</Term>
          </Row>
        )}
        {list.rejectedBy && (
          <Row label={t('joya.orders.rejectedBy')}>
            {list.rejectedBy} · <Term>{fmtWhen(list.rejectedAt)}</Term>
          </Row>
        )}
        {list.note && (
          <Row label={t('joya.note')}>
            <span dir="auto">{list.note}</span>
          </Row>
        )}
      </Card>

      <ErrorBox error={act.error} />
      <div className={classes.actions}>
        {draft && (
          <>
            <Btn kind="primary" disabled={act.busy || dirty} onClick={() => setModal('approve')} title={dirty ? t('joya.orders.saveFirst') : undefined}>
              {t('joya.orders.approveList')}
            </Btn>
            <Btn onClick={() => setModal('add')}>{t('joya.orders.addItem')}</Btn>
            <Btn kind="danger" onClick={() => setModal('reject')}>
              {t('joya.reject')}
            </Btn>
          </>
        )}
        {list.status === 'APPROVED' && (
          <>
            <Btn kind="primary" onClick={() => setModal('ordered')}>
              {t('joya.orders.markOrdered')}
            </Btn>
            <Btn onClick={() => setModal('reopen')}>{t('joya.orders.reopen')}</Btn>
            <Btn kind="danger" onClick={() => setModal('reject')}>
              {t('joya.reject')}
            </Btn>
          </>
        )}
        {(list.status === 'APPROVED' || list.status === 'ORDERED') && <Btn onClick={copyText}>{copied ? t('joya.orders.copied') : t('joya.orders.copyText')}</Btn>}
      </div>

      <div className={classes.section}>
        {t('joya.orders.workingLines')} (<Term>{active.length}</Term>)
      </div>
      {!active.length && !added.length && <Empty>{t('joya.orders.emptyList')}</Empty>}
      {active.map(lineBox)}
      {added.map((a) => (
        <div key={a.tmp} className={classes.line}>
          <div className={classes.lineTop}>
            <span className={classes.name} dir="auto">
              {a.name}
            </span>
            <span className={classes.badges}>
              <Badge tone="info">{t('joya.orders.notSaved')}</Badge>
            </span>
          </div>
          <div className={classes.qtyRow}>
            <b>
              <Val v={num(a.qty)} />
            </b>
            <span className={classes.unit}>{a.unit}</span>
            <Btn small kind="ghost" onClick={() => setAdded((xs) => xs.filter((x) => x.tmp !== a.tmp))}>
              {t('joya.cancel')}
            </Btn>
          </div>
        </div>
      ))}

      {dirty && (
        <div className={classes.bar}>
          <span style={{ fontSize: '0.84rem' }}>{invalidQty ? t('joya.orders.qtyPositive') : t('joya.orders.unsaved')}</span>
          <span style={{ display: 'flex', gap: '0.4rem' }}>
            <Btn kind="primary" disabled={act.busy || invalidQty} onClick={save}>
              {t('joya.save')}
            </Btn>
            <Btn onClick={undo}>{t('joya.orders.undoAll')}</Btn>
          </span>
        </div>
      )}

      {removed.length > 0 && (
        <Details summary={t('joya.orders.removedLines', { count: removed.length })}>
          <div style={{ marginTop: '0.4rem' }}>{removed.map(lineBox)}</div>
        </Details>
      )}

      {draft && notDue.length > 0 && (
        <Details summary={t('joya.orders.notDue', { count: notDue.length })}>
          <div className={classes.small}>{t('joya.orders.notDueHelp')}</div>
          {notDue.map((r) => (
            <div key={r.id} className={classes.line}>
              <div className={classes.lineTop}>
                <span className={classes.name} dir="auto">
                  {r.name}
                </span>
                <Btn small onClick={() => setAdded((xs) => [...xs, { tmp: `n${r.id}`, ingredientId: r.ingredientId, name: r.name, qty: r.qty ?? '', unit: r.unit || '' }])}>
                  {t('joya.orders.addToList')}
                </Btn>
              </div>
              <Btn kind="ghost" small onClick={() => setWhyOpen((w) => ({ ...w, [`r${r.id}`]: !w[`r${r.id}`] }))}>
                {t('joya.orders.why')}
              </Btn>
              {whyOpen[`r${r.id}`] && <Why rec={r} classes={classes} />}
            </div>
          ))}
        </Details>
      )}

      <div style={{ marginTop: '1rem' }}>
        <AskBox
          contextKind="ORDER_LIST"
          contextId={Number(id)}
          locationId={list.locationId}
          onApplied={reload}
          examples={draft ? [t('joya.orders.ex1'), t('joya.orders.ex2'), t('joya.orders.ex3')] : [t('joya.orders.ex2')]}
        />
      </div>

      {recommendation.length > 0 && (
        <Card title={t('joya.orders.original')}>
          <div className={classes.small} style={{ marginBottom: '0.4rem' }}>
            {t('joya.orders.originalHelp')}
          </div>
          {['SUGGESTED', 'CHECK', 'NOT_DUE'].map((sec) => {
            const rs = recommendation.filter((r) => r.section === sec);
            if (!rs.length) return null;
            return (
              <Details key={sec} summary={`${t(`joya.orders.section.${sec}`)} (${rs.length})`}>
                {rs.map((r) => (
                  <Row key={r.id} label={<span dir="auto">{r.name}</span>}>
                    <Val v={r.qty} /> {r.unit || ''} · {t(`joya.orders.method.${r.method}`)}
                  </Row>
                ))}
              </Details>
            );
          })}
        </Card>
      )}

      <Card title={t('joya.orders.editLog')}>
        {!log.length && <div className={classes.small}>{t('joya.none')}</div>}
        {log.map((e) => (
          <div key={e.id} style={{ fontSize: '0.8rem', padding: '0.25rem 0', borderBottom: `1px solid ${theme.border}` }}>
            <b>{t(`joya.orders.act.${e.action}`)}</b> {e.after?.name || e.before?.itemText || (e.lineId ? lineName(lines, e.lineId) : '')}{' '}
            {e.action === 'SET_QTY' && (
              <Term>
                {e.before?.qty ?? '—'} → {e.after?.qty ?? '—'}
              </Term>
            )}
            {e.action === 'ADD' && e.after?.qty != null && <Term>{e.after.qty}</Term>}
            <div className={classes.small}>
              {e.by} · {t(`joya.orders.via.${e.via}`)} · <Term>{fmtWhen(e.at)}</Term>
              {e.note ? (
                <>
                  {' '}
                  · <span dir="auto">{e.note}</span>
                </>
              ) : null}
            </div>
          </div>
        ))}
      </Card>

      {modal === 'add' && <AddItem onClose={() => setModal(null)} onAdd={(a) => setAdded((xs) => [...xs, { ...a, tmp: `a${Date.now()}` }])} />}
      {['approve', 'ordered', 'reject', 'reopen'].includes(modal) && (
        <Modal
          title={t(`joya.orders.confirm.${modal}`)}
          onClose={() => setModal(null)}
          footer={
            <>
              <Btn kind={modal === 'reject' ? 'danger' : 'primary'} disabled={act.busy} onClick={() => doAction(modal, modal === 'reopen' ? {} : { note: reason || undefined })}>
                {t(`joya.orders.confirmBtn.${modal}`)}
              </Btn>
              <Btn onClick={() => setModal(null)}>{t('joya.cancel')}</Btn>
            </>
          }
        >
          <div style={{ fontSize: '0.86rem', marginBottom: '0.6rem' }}>{t(`joya.orders.confirmText.${modal}`)}</div>
          {modal !== 'reopen' && (
            <Field label={t('joya.noteOptional')}>
              <TextArea value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          )}
        </Modal>
      )}
      {modal?.text && (
        <Modal title={t('joya.orders.copyText')} onClose={() => setModal(null)}>
          <TextArea rows={10} readOnly value={modal.text} />
        </Modal>
      )}
    </Page>
  );
}

function lineName(lines, lineId) {
  return lines.find((l) => l.id === lineId)?.name || '';
}

function AddItem({ onClose, onAdd }) {
  const { t } = useT();
  const theme = useTheme();
  const classes = useStyles(theme);
  const [search, setSearch] = useState('');
  const [pick, setPick] = useState(null);
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState('');
  const [note, setNote] = useState('');
  const { data } = useLoad(() => (search.trim().length >= 1 ? api(`/ingredients${qs({ search: search.trim() })}`) : Promise.resolve({ ingredients: [] })), [search]);
  const hits = (data?.ingredients || []).filter((i) => i.active).slice(0, 8);
  const name = pick ? pick.name : search.trim();
  const qtyOk = qty === '' || Number(qty) > 0;

  return (
    <Modal
      title={t('joya.orders.addItem')}
      onClose={onClose}
      footer={
        <Btn
          kind="primary"
          disabled={!name || !qtyOk}
          onClick={() => {
            onAdd({ ingredientId: pick?.id ?? null, name, qty, unit: unit || pick?.unit || '', note });
            onClose();
          }}
        >
          {t('joya.add')}
        </Btn>
      }
    >
      <Field label={t('joya.orders.itemSearch')} hint={t('joya.orders.itemSearchHint')}>
        <Input
          dir="auto"
          value={pick ? pick.name : search}
          onChange={(e) => {
            setPick(null);
            setSearch(e.target.value);
          }}
        />
      </Field>
      {!pick && hits.length > 0 && (
        <div style={{ marginBottom: '0.6rem' }}>
          {hits.map((i) => (
            <button
              key={i.id}
              type="button"
              className={classes.hit}
              onClick={() => {
                setPick(i);
                setUnit(i.unit || '');
              }}
            >
              <span dir="auto">{i.name}</span> {i.unit ? <span style={{ opacity: 0.7 }}>· {i.unit}</span> : null}
            </button>
          ))}
        </div>
      )}
      {!pick && name && <div className={classes.small}>{t('joya.orders.freeTextHint')}</div>}
      <Field label={t('joya.orders.qty')} hint={t('joya.orders.qtyOptional')}>
        <Input type="number" inputMode="decimal" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
      </Field>
      <Field label={t('joya.orders.unit')}>
        <Input dir="auto" value={unit} onChange={(e) => setUnit(e.target.value)} />
      </Field>
      <Field label={t('joya.noteOptional')}>
        <Input dir="auto" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  );
}
