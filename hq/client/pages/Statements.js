// /statements — השוואת כרטסת לקוח / ספק (owner 2026-11-10), chain admin only. The user attaches the statement that a
// supplier or a customer sent (PDF, Excel or CSV), says which side it is and, if needed, the party's name in our books,
// and clicks Send. The server keeps only the file's text (POST /api/joya/ai/ask-file); the AI planner extracts the
// rows, the hub compares them with our account card (calc statement_compare) and the answer lists only the
// differences — in this page's chat (area 7), where follow-up questions can be asked.
import React, { useRef, useState } from 'react';
import { createUseStyles, useTheme } from 'react-jss';
import { ApiError } from '../api.js';
import { useT } from '../i18n/index.js';
import { useJoya } from '../context.js';
import ChatArea from '../ChatArea.js';
import { Page, Card, Btn, Field, Input, Select, ErrorBox } from '../ui.js';
import { AREAS } from './Area.js';

const useStyles = createUseStyles((theme) => ({
  form: { display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end' },
  w: { width: 180 },
  wide: { width: 260 },
  file: { fontSize: '0.86rem' },
  hint: { fontSize: '0.76rem', color: theme.textSecondary, margin: '0.3rem 0 0' },
}));

export default function Statements() {
  const theme = useTheme();
  const c = useStyles(theme);
  const { t, lang } = useT();
  const j = useJoya();
  const a = AREAS.statements;
  const push = useRef(null); // ChatArea fills it: push(request) shows the new question at once
  const fileInput = useRef(null);
  const [side, setSide] = useState('supplier');
  const [party, setParty] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const send = async () => {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      const who = side === 'customer' ? t('joya.statements.q.customer') : t('joya.statements.q.supplier');
      form.append('question', [t('joya.statements.q.compare', { who }), party.trim() ? t('joya.statements.q.party', { party: party.trim() }) : '', note.trim()].filter(Boolean).join(' '));
      form.append('contextKind', 'AREA');
      form.append('contextId', String(a.id));
      if (j.locationId) form.append('locationId', j.locationId);
      else if (j.companyKey) form.append('companyKey', j.companyKey);
      form.append('lang', lang);
      const res = await fetch('/api/joya/ai/ask-file', { method: 'POST', body: form, credentials: 'same-origin' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, data);
      push.current?.(data.request);
      setFile(null);
      setNote('');
      if (fileInput.current) fileInput.current.value = '';
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  const suggestions = Array.from({ length: a.suggestions }, (_, i) => t(`joya.area.statements.s${i + 1}`));
  return (
    <Page>
      <Card>
        <div className={c.form}>
          <Field label={t('joya.statements.side')}>
            <Select className={c.w} value={side} onChange={(e) => setSide(e.target.value)}>
              <option value="supplier">{t('joya.statements.side.supplier')}</option>
              <option value="customer">{t('joya.statements.side.customer')}</option>
            </Select>
          </Field>
          <Field label={t('joya.statements.party')} hint={t('joya.statements.partyHint')}>
            <Input className={c.wide} value={party} onChange={(e) => setParty(e.target.value)} placeholder={t('joya.statements.partyPh')} />
          </Field>
          <Field label={t('joya.statements.file')}>
            <input ref={fileInput} className={c.file} type="file" accept=".pdf,.xlsx,.csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </Field>
          <Field label={t('joya.statements.note')}>
            <Input className={c.wide} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('joya.statements.notePh')} />
          </Field>
          <Btn kind="primary" disabled={!file || busy} onClick={send}>
            {busy ? t('joya.statements.sending') : t('joya.statements.send')}
          </Btn>
        </div>
        <p className={c.hint}>{t('joya.statements.hint')}</p>
        {err ? <ErrorBox error={err} /> : null}
      </Card>
      <ChatArea key="statements" contextId={a.id} locationId={j.locationId} title={t('joya.area.askTitle')} intro={t('joya.area.statements.intro')} suggestions={suggestions} pushRef={push} />
    </Page>
  );
}
