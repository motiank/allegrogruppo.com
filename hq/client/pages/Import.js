// /import — data arrives by CSV file (with a column mapping) or by typing rows.
// There is no live connection to Bikum, Tabit or the payroll system.
// An optional value that is missing stays empty ("not known"); it is never saved as zero.
import React, { useEffect, useMemo, useState } from 'react';
import { createUseStyles, useTheme } from 'react-jss';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Page, Card, Btn, Badge, Field, Input, Select, Tabs, Loading, ErrorBox, Details, useLoad, useAction, Term } from '../ui.js';
import { useJoya } from '../context.js';
import { useT } from '../i18n/index.js';

const useStyles = createUseStyles((theme) => ({
  note: { fontSize: '0.8rem', color: theme.textSecondary, margin: '0.2rem 0 0.6rem' },
  warn: { fontSize: '0.8rem', color: '#d29922', margin: '0.3rem 0' },
  sample: { display: 'grid', gap: '0.4rem', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 240px), 1fr))', marginTop: '0.4rem' },
  sampleBox: { border: `1px solid ${theme.border}`, borderRadius: 8, padding: '0.4rem 0.55rem', fontSize: '0.75rem', minWidth: 0 },
  sampleRow: { display: 'flex', justifyContent: 'space-between', gap: '0.4rem', padding: '0.05rem 0', '& > span:first-child': { color: theme.textSecondary }, '& > span:last-child': { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' } },
  chips: { display: 'flex', flexWrap: 'wrap', gap: '0.3rem', margin: '0.3rem 0' },
  chip: { fontSize: '0.72rem', border: `1px solid ${theme.border}`, borderRadius: 6, padding: '0.1rem 0.4rem' },
  req: { color: theme.errorText, marginInlineStart: '0.25rem' },
  mapGrid: { display: 'grid', gap: '0 0.8rem', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 240px), 1fr))' },
  err: { fontSize: '0.78rem', padding: '0.15rem 0' },
  rowBox: { border: `1px solid ${theme.border}`, borderRadius: 8, padding: '0.5rem 0.6rem', marginBottom: '0.5rem' },
  rowHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', fontWeight: 650, marginBottom: '0.35rem' },
  actions: { display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.4rem' },
}));

const MANUAL_KINDS = ['SALES_CHECKS', 'SALES_ITEMS', 'ATTENDANCE', 'ORDER_HISTORY', 'PAYROLL'];
const NOTE_LINKS = { RUN_PAYROLL_CHECKS: ['/payroll', 'joya.imp.goPayroll'], PATTERNS_REFRESH: ['/learned', 'joya.imp.goLearned'], UNMATCHED_ITEM_CODES: ['/data', 'joya.nav.dataQuality'] };

function readText(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ''));
    fr.onerror = () => reject(fr.error || new Error('cannot read the file'));
    fr.readAsText(file, 'UTF-8');
  });
}

function LocationSelect({ spec, value, onChange }) {
  const { t } = useT();
  const j = useJoya();
  return (
    <Field label={t('joya.imp.location')}>
      <Select value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
        {!spec?.needsLocation && j.me?.isAdmin ? <option value="">{t('joya.imp.noLocation')}</option> : null}
        {j.locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function Result({ res, c }) {
  const { t } = useT();
  const navigate = useNavigate();
  return (
    <Card title={t('joya.imp.step4')}>
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
        <Badge tone="ok">{t('joya.imp.written', { n: res.written })}</Badge>
        {res.rejected ? <Badge tone="bad">{t('joya.imp.rejectedRows', { n: res.rejected })}</Badge> : null}
      </div>
      {res.errors?.length ? (
        <Details summary={`${t('joya.data.errors')} (${res.errors.length})`}>
          {res.errors.map((e, i) => (
            <div key={i} className={c.err} dir="auto">
              {e.line ? (
                <>
                  {t('joya.data.line')} <Term>{e.line}</Term>
                  {' · '}
                </>
              ) : null}
              {e.field ? (
                <>
                  {t(`joya.imp.field.${e.field}`)}
                  {' · '}
                </>
              ) : null}
              {e.reason}
            </div>
          ))}
        </Details>
      ) : null}
      {(res.notes || []).map((n, i) => (
        <div key={i} className={c.note}>
          {t(`joya.imp.note.${n.code}`, { rows: n.rows ?? '', count: n.count ?? '' })}{' '}
          {NOTE_LINKS[n.code] ? (
            <Btn kind="ghost" small onClick={() => navigate(NOTE_LINKS[n.code][0])}>
              {t(NOTE_LINKS[n.code][1])}
            </Btn>
          ) : null}
        </div>
      ))}
    </Card>
  );
}

function FileImport({ kinds, c }) {
  const { t } = useT();
  const j = useJoya();
  const [kind, setKind] = useState(kinds[0]?.kind || '');
  const spec = kinds.find((k) => k.kind === kind);
  const [source, setSource] = useState(spec?.sources[0] || 'MANUAL');
  const [locationId, setLocationId] = useState(j.oneLocationId);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({});
  const [dateOrder, setDateOrder] = useState('DMY');
  const [result, setResult] = useState(null);
  const act = useAction();

  const reset = () => {
    setFile(null);
    setPreview(null);
    setMapping({});
    setResult(null);
    act.setError(null);
  };
  useEffect(() => {
    if (spec && !spec.sources.includes(source)) setSource(spec.sources[0]);
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const loadPreview = (f, src) =>
    act.run(async () => {
      const p = await api('/import/preview', { method: 'POST', body: { kind, source: src, csv: f.text } });
      setPreview(p);
      setMapping(p.mapping || {});
    });

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setResult(null);
    const text = await readText(f).catch((er) => (act.setError(er), null));
    if (text == null) return;
    const fl = { name: f.name, text };
    setFile(fl);
    loadPreview(fl, source);
  };

  const runImport = () =>
    act.run(async () => {
      const r = await api('/import', { method: 'POST', body: { kind, source, locationId, csv: file.text, mapping, dateOrder, fileName: file.name } });
      setResult(r);
    });

  const inOneOf = new Set((spec?.oneOf || []).flat());
  return (
    <>
      <Card title={t('joya.imp.step1')}>
        <Field label={t('joya.imp.kind')} hint={kind ? t(`joya.imp.kindHelp.${kind}`) : null}>
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            {kinds.map((k) => (
              <option key={k.kind} value={k.kind}>
                {t(`joya.imp.kind.${k.kind}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('joya.imp.source')}>
          <Select
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              if (file) loadPreview(file, e.target.value);
            }}
          >
            {(spec?.sources || []).map((s) => (
              <option key={s} value={s}>
                {t(`joya.src.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <LocationSelect spec={spec} value={locationId} onChange={setLocationId} />
      </Card>

      <Card title={t('joya.imp.step2')}>
        <Field label={t('joya.imp.file')} hint={t('joya.imp.excelHint')}>
          <input type="file" accept=".csv,text/csv,text/plain" onChange={onFile} />
        </Field>
        {act.busy && !preview ? <div className={c.note}>{t('joya.imp.reading')}</div> : null}
        {preview ? (
          <>
            <div className={c.note}>
              <Term>{file?.name}</Term> · {t('joya.imp.rowsInFile', { n: preview.rowCount })}
            </div>
            <div className={c.note}>{t('joya.imp.columns')}:</div>
            <div className={c.chips}>
              {preview.headers.map((h) => (
                <span key={h} className={c.chip}>
                  <bdi dir="auto">{h}</bdi>
                </span>
              ))}
            </div>
            <Details summary={t('joya.imp.sample')}>
              <div className={c.sample}>
                {preview.sample.map((row, i) => (
                  <div key={i} className={c.sampleBox}>
                    {preview.headers.map((h) => (
                      <div key={h} className={c.sampleRow}>
                        <span dir="auto">{h}</span>
                        <span dir="auto">{row[h] || '—'}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </Details>
          </>
        ) : null}
      </Card>

      {preview && spec ? (
        <Card title={t('joya.imp.step3')}>
          <div className={c.note}>{t(`joya.imp.mappingFrom.${preview.mappingFrom}`)}</div>
          {(spec.oneOf || []).map((g) => (
            <div key={g.join()} className={c.warn}>
              {t('joya.imp.oneOf', { fields: g.map((k) => t(`joya.imp.field.${k}`)).join(' / ') })}
            </div>
          ))}
          <div className={c.mapGrid}>
            {spec.fields.map((f) => (
              <Field
                key={f.key}
                label={
                  <>
                    {t(`joya.imp.field.${f.key}`)}
                    {f.required ? <span className={c.req}>* {t('joya.imp.required')}</span> : inOneOf.has(f.key) ? <span className={c.req}>*</span> : null}
                  </>
                }
                hint={t(`joya.imp.type.${f.type}`)}
              >
                <Select value={mapping[f.key] || ''} onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value || undefined }))}>
                  <option value="">{t('joya.imp.notInFile')}</option>
                  {preview.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
          </div>
          <Field label={t('joya.imp.dateOrder')}>
            <Select value={dateOrder} onChange={(e) => setDateOrder(e.target.value)}>
              {['DMY', 'MDY', 'YMD'].map((d) => (
                <option key={d} value={d}>
                  {t(`joya.imp.dateOrder.${d}`)}
                </option>
              ))}
            </Select>
          </Field>
          <div className={c.note}>{t('joya.imp.emptyStaysEmpty')}</div>
          <div className={c.actions}>
            <Btn kind="primary" disabled={act.busy || (spec.needsLocation && !locationId) || !!result} onClick={runImport}>
              {t('joya.imp.run')}
            </Btn>
            {result ? <Btn onClick={reset}>{t('joya.imp.startOver')}</Btn> : null}
          </div>
        </Card>
      ) : null}
      <ErrorBox error={act.error} />
      {result ? <Result res={result} c={c} /> : null}
    </>
  );
}

const nowLocal = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function ManualInput({ f, value, onChange }) {
  const { t } = useT();
  if (f.key === 'cost_type') {
    return (
      <Select value={value || ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {['GROSS_WAGE', 'EMPLOYER_COST', 'OTHER'].map((x) => (
          <option key={x} value={x}>
            {t(`joya.imp.costType.${x}`)}
          </option>
        ))}
      </Select>
    );
  }
  if (f.type === 'bool') {
    return (
      <Select value={value || ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        <option value="yes">{t('joya.imp.yes')}</option>
        <option value="no">{t('joya.imp.no')}</option>
      </Select>
    );
  }
  if (f.type === 'date') return <Input type="date" value={value || ''} onChange={(e) => onChange(e.target.value)} />;
  if (f.type === 'month') return <Input type="month" value={value || ''} onChange={(e) => onChange(e.target.value)} />;
  if (f.type === 'datetime') return <Input type="datetime-local" value={value ? value.replace(' ', 'T') : ''} onChange={(e) => onChange(e.target.value ? e.target.value.replace('T', ' ').slice(0, 16) : '')} />;
  if (f.type === 'int' || f.type === 'num') return <Input inputMode="decimal" dir="ltr" value={value || ''} onChange={(e) => onChange(e.target.value)} />;
  return <Input dir="auto" value={value || ''} onChange={(e) => onChange(e.target.value)} />;
}

function ManualEntry({ kinds, c }) {
  const { t } = useT();
  const j = useJoya();
  const avail = kinds.filter((k) => MANUAL_KINDS.includes(k.kind) && k.sources.includes('MANUAL'));
  const [kind, setKind] = useState(avail[0]?.kind || '');
  const spec = avail.find((k) => k.kind === kind);
  const [locationId, setLocationId] = useState(j.oneLocationId);
  const blank = useMemo(() => {
    const r = {};
    for (const f of spec?.fields || []) if (f.type === 'date') r[f.key] = nowLocal();
    return r;
  }, [spec]);
  const [rows, setRows] = useState([]);
  const [result, setResult] = useState(null);
  const act = useAction();
  useEffect(() => {
    setRows([{ ...blank }]);
    setResult(null);
  }, [kind, blank]);

  const set = (i, key, v) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, [key]: v } : r)));
  const save = () =>
    act.run(async () => {
      const clean = rows.filter((r) => Object.values(r).some((v) => String(v ?? '').trim() !== ''));
      const res = await api('/import', { method: 'POST', body: { kind, source: 'MANUAL', locationId, rows: clean, dateOrder: 'YMD' } });
      setResult(res);
      if (!res.rejected) setRows([{ ...blank }]);
    });

  if (!avail.length) return null;
  return (
    <>
      <Card>
        <div className={c.note}>{t('joya.imp.manualIntro')}</div>
        <Field label={t('joya.imp.kind')} hint={kind ? t(`joya.imp.kindHelp.${kind}`) : null}>
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            {avail.map((k) => (
              <option key={k.kind} value={k.kind}>
                {t(`joya.imp.kind.${k.kind}`)}
              </option>
            ))}
          </Select>
        </Field>
        <LocationSelect spec={spec} value={locationId} onChange={setLocationId} />
        {(spec?.oneOf || []).map((g) => (
          <div key={g.join()} className={c.warn}>
            {t('joya.imp.oneOf', { fields: g.map((k) => t(`joya.imp.field.${k}`)).join(' / ') })}
          </div>
        ))}
      </Card>
      {!rows.length ? <div className={c.note}>{t('joya.imp.noRows')}</div> : null}
      {rows.map((r, i) => (
        <div key={i} className={c.rowBox}>
          <div className={c.rowHead}>
            <span>{t('joya.imp.rowN', { n: i + 1 })}</span>
            <Btn small kind="ghost" onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))}>
              {t('joya.imp.removeRow')}
            </Btn>
          </div>
          <div className={c.mapGrid}>
            {(spec?.fields || []).map((f) => (
              <Field
                key={f.key}
                label={
                  <>
                    {t(`joya.imp.field.${f.key}`)}
                    {f.required ? <span className={c.req}>*</span> : null}
                  </>
                }
              >
                <ManualInput f={f} value={r[f.key]} onChange={(v) => set(i, f.key, v)} />
              </Field>
            ))}
          </div>
        </div>
      ))}
      <div className={c.note}>{t('joya.imp.emptyStaysEmpty')}</div>
      <div className={c.actions}>
        <Btn onClick={() => setRows((rs) => [...rs, { ...blank }])}>{t('joya.imp.addRow')}</Btn>
        <Btn kind="primary" disabled={act.busy || !rows.length || (spec?.needsLocation && !locationId)} onClick={save}>
          {t('joya.imp.saveRows')}
        </Btn>
      </div>
      <ErrorBox error={act.error} />
      {result ? <Result res={result} c={c} /> : null}
    </>
  );
}

export default function Import() {
  const theme = useTheme();
  const c = useStyles(theme);
  const { t } = useT();
  const [tab, setTab] = useState('file');
  const k = useLoad(() => api('/import/kinds'), []);
  return (
    <Page
      title={t('joya.imp.title')}
      sub={t('joya.imp.sub')}
      tabs={
        <Tabs
          tabs={[
            ['file', t('joya.imp.tabFile')],
            ['manual', t('joya.imp.tabManual')],
          ]}
          value={tab}
          onChange={setTab}
        />
      }
    >
      <ErrorBox error={k.error} />
      {k.loading && !k.data ? <Loading /> : null}
      {k.data && tab === 'file' ? <FileImport kinds={k.data.kinds} c={c} /> : null}
      {k.data && tab === 'manual' ? <ManualEntry kinds={k.data.kinds} c={c} /> : null}
    </Page>
  );
}
