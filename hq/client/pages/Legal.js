// /legal — the Legal area (משפטי, chain admin; owner 2026-11-18): the owners' court cases from the legal archive in
// Drive (admin Legal API → /api/joya/legal/*). Three tabs: the area's chat ("what was the story with …", "what was the
// verdict", "when is the next hearing"), the case list (search by a name in Hebrew or Latin letters, a case number or
// words; open / closed; whose archive) and the hearings ahead. /legal/:number — one case: the story, the verdict, the
// last decision, the hearings and every paper, each opened in the browser or downloaded. Read only; Joya keeps nothing.
import React, { useEffect, useMemo, useState } from 'react';
import { createUseStyles, useTheme } from 'react-jss';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useT, Term } from '../i18n/index.js';
import { useJoya } from '../context.js';
import ChatArea from '../ChatArea.js';
import { Page, Card, Badge, Input, Select, Tabs, Btn, Loading, Empty, ErrorBox, useLoad, fmtDay } from '../ui.js';
import { AREAS } from './Area.js';

const useStyles = createUseStyles((theme) => ({
  bar: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', margin: '0.6rem 0' },
  search: { flex: 1, minWidth: 180 },
  count: { fontSize: '0.76rem', color: theme.textSecondary, margin: '0 0 0.5rem' },
  caseName: { fontWeight: 650, overflowWrap: 'anywhere', lineHeight: 1.35 },
  meta: { display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center', fontSize: '0.76rem', color: theme.textSecondary, margin: '0.25rem 0' },
  summary: { fontSize: '0.86rem', lineHeight: 1.55, margin: '0.3rem 0 0', overflowWrap: 'anywhere' },
  story: { fontSize: '0.9rem', lineHeight: 1.7, margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
  label: { fontSize: '0.72rem', color: theme.textSecondary, marginTop: '0.6rem' },
  fact: { fontSize: '0.86rem', lineHeight: 1.55, overflowWrap: 'anywhere' },
  paper: { padding: '0.5rem 0', borderTop: `1px solid ${theme.border}` },
  att: { paddingInlineStart: '1rem', borderInlineStart: `2px solid ${theme.border}`, marginInlineStart: '0.3rem' },
  paperHead: { display: 'flex', gap: '0.5rem', alignItems: 'baseline', flexWrap: 'wrap' },
  paperType: { fontWeight: 600, overflowWrap: 'anywhere' },
  paperSub: { fontSize: '0.76rem', color: theme.textSecondary, overflowWrap: 'anywhere' },
  desc: { fontSize: '0.84rem', lineHeight: 1.6, margin: '0.3rem 0 0', overflowWrap: 'anywhere' },
  links: { display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.35rem' },
  link: { fontSize: '0.78rem', color: theme.primary, border: `1px solid ${theme.border}`, borderRadius: 6, padding: '0.2rem 0.55rem', textDecoration: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit' },
  hearing: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'baseline', padding: '0.45rem 0', borderTop: `1px solid ${theme.border}`, cursor: 'pointer' },
  when: { fontWeight: 650, whiteSpace: 'nowrap' },
  more: { display: 'flex', justifyContent: 'center', margin: '0.8rem 0' },
  hint: { fontSize: '0.74rem', color: theme.textSecondary, lineHeight: 1.5, margin: '0.6rem 0 0' },
}));

const PAGE = 30;
const statusTone = (s) => (s === 'פתוח' ? 'warn' : 'muted');
const fileUrl = (id, download) => `/api/joya/legal/files/${encodeURIComponent(id)}${download ? '?download=1' : ''}`;

function PaperLinks({ id, classes: c, t }) {
  if (!id) return null;
  return (
    <div className={c.links}>
      <a className={c.link} href={fileUrl(id)} target="_blank" rel="noopener noreferrer">
        {t('joya.legal.open')}
      </a>
      <a className={c.link} href={fileUrl(id, true)} download>
        {t('joya.legal.download')}
      </a>
    </div>
  );
}

function CaseCard({ x, classes: c, t, onOpen }) {
  return (
    <Card onClick={() => onOpen(x.number)}>
      <div className={c.caseName} dir="auto">
        {x.name}
      </div>
      <div className={c.meta}>
        <Term>{x.number}</Term>
        <Badge tone={statusTone(x.status)}>{x.status}</Badge>
        <span dir="auto">{x.court}</span>
        {x.documents ? <span>{t('joya.legal.papers', { n: x.documents })}</span> : null}
        {!x.downloaded ? <Badge tone="muted">{t('joya.legal.notDownloaded')}</Badge> : null}
        {x.nextHearing ? (
          <Badge tone="info">
            {t('joya.legal.nextHearing')} <Term>{fmtDay(x.nextHearing.date)}</Term>
          </Badge>
        ) : null}
      </div>
      {x.summary ? (
        <p className={c.summary} dir="auto">
          {x.summary}
        </p>
      ) : x.note ? (
        <p className={c.summary} dir="auto">
          {x.note}
        </p>
      ) : null}
    </Card>
  );
}

function CaseList({ classes: c, t }) {
  const navigate = useNavigate();
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [person, setPerson] = useState('all');
  const [shown, setShown] = useState(PAGE);
  useEffect(() => {
    const id = setTimeout(() => setQ(typed.trim()), 350); // ask the server only when the typing stops
    return () => clearTimeout(id);
  }, [typed]);
  useEffect(() => setShown(PAGE), [q, status, person]);
  const people = useLoad(() => api('/legal/people'), []);
  const { data, error, loading } = useLoad(() => api(`/legal/cases${qs({ q: q || null, status: status === 'all' ? null : status, person: person === 'all' ? null : person })}`), [q, status, person]);
  const rows = data?.cases || [];
  return (
    <div>
      <div className={c.bar}>
        <div className={c.search}>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t('joya.legal.search')} aria-label={t('joya.legal.search')} dir="auto" />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('joya.legal.status')}>
          <option value="all">{t('joya.legal.status.all')}</option>
          <option value="open">{t('joya.legal.status.open')}</option>
          <option value="closed">{t('joya.legal.status.closed')}</option>
        </Select>
        {(people.data?.people || []).length > 1 ? (
          <Select value={person} onChange={(e) => setPerson(e.target.value)} aria-label={t('joya.legal.person')}>
            <option value="all">{t('joya.legal.person.all')}</option>
            {people.data.people.map((p) => (
              <option key={p.person} value={p.person}>
                {t(`joya.legal.person.${p.person}`)} ({p.cases})
              </option>
            ))}
          </Select>
        ) : null}
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : null}
      {data ? <p className={c.count}>{t('joya.legal.count', { n: data.total })}</p> : null}
      {data && !rows.length ? <Empty>{t('joya.legal.none')}</Empty> : null}
      {rows.slice(0, shown).map((x) => (
        <CaseCard key={x.number} x={x} classes={c} t={t} onOpen={(n) => navigate(`/legal/${encodeURIComponent(n)}`)} />
      ))}
      {rows.length > shown ? (
        <div className={c.more}>
          <Btn onClick={() => setShown((n) => n + PAGE)}>{t('joya.legal.more', { n: rows.length - shown })}</Btn>
        </div>
      ) : null}
    </div>
  );
}

function Hearings({ classes: c, t }) {
  const navigate = useNavigate();
  const { data, error, loading } = useLoad(() => api('/legal/hearings'), []);
  const rows = data?.hearings || [];
  return (
    <Card title={t('joya.legal.hearings.title')}>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : null}
      {data && !rows.length ? <Empty>{t('joya.legal.hearings.none')}</Empty> : null}
      {rows.map((h, i) => (
        <div key={`${h.number}-${h.date}-${i}`} className={c.hearing} onClick={() => navigate(`/legal/${encodeURIComponent(h.number)}`)}>
          <span className={c.when}>
            <Term>
              {fmtDay(h.date)}
              {h.time ? ` ${h.time}` : ''}
            </Term>
          </span>
          <span className={c.paperType} dir="auto">
            {h.name}
          </span>
          <Badge tone={h.source === 'court' ? 'info' : 'muted'}>{h.source === 'court' ? h.type || t('joya.legal.hearing') : t('joya.legal.hearings.fromDecision')}</Badge>
          <span className={c.paperSub} dir="auto">
            <Term>{h.number}</Term> · {h.court}
            {h.judge ? ` · ${h.judge}` : ''}
          </span>
          {h.text ? (
            <div className={c.paperSub} dir="auto" style={{ width: '100%' }}>
              {h.text}
            </div>
          ) : null}
        </div>
      ))}
      <p className={c.hint}>{t('joya.legal.hearings.hint')}</p>
    </Card>
  );
}

function KeyPaper({ label, d, classes: c, t }) {
  if (!d) return null;
  return (
    <div>
      <div className={c.label}>
        {label} · <Term>{fmtDay(d.date)}</Term>
      </div>
      {d.result ? (
        <div className={c.fact} dir="auto">
          <strong>{d.result}</strong>
        </div>
      ) : null}
      <p className={c.desc} dir="auto">
        {d.description}
      </p>
      <PaperLinks id={d.file} classes={c} t={t} />
    </div>
  );
}

function Paper({ d, classes: c, t }) {
  const [open, setOpen] = useState(false);
  const long = d.descriptionSource === 'ai' && d.description?.length > 220;
  return (
    <div className={`${c.paper} ${d.kind === 'attachment' ? c.att : ''}`}>
      <div className={c.paperHead}>
        <span className={c.when}>
          <Term>{fmtDay(d.date)}</Term>
        </span>
        <span className={c.paperType} dir="auto">
          {d.type}
        </span>
        {d.key ? <Badge tone="info">{t('joya.legal.keyPaper')}</Badge> : null}
        {d.kind === 'attachment' ? <Badge tone="muted">{t('joya.legal.attachment')}</Badge> : null}
      </div>
      {d.detail || d.by ? (
        <div className={c.paperSub} dir="auto">
          {[d.detail, d.by].filter(Boolean).join(' · ')}
          {d.pages ? ` · ${t('joya.legal.pages', { n: d.pages })}` : ''}
        </div>
      ) : null}
      {d.result ? (
        <div className={c.fact} dir="auto">
          <strong>{d.result}</strong>
        </div>
      ) : null}
      {d.descriptionSource === 'ai' ? (
        <p className={c.desc} dir="auto">
          {long && !open ? `${d.description.slice(0, 220)}… ` : d.description}
          {long ? (
            <button type="button" className={c.link} style={{ border: 0, padding: 0 }} onClick={() => setOpen((v) => !v)}>
              {open ? t('joya.legal.less') : t('joya.legal.readMore')}
            </button>
          ) : null}
        </p>
      ) : null}
      <PaperLinks id={d.driveId} classes={c} t={t} />
    </div>
  );
}

export function LegalCase() {
  const theme = useTheme();
  const c = useStyles(theme);
  const { t } = useT();
  const { number } = useParams();
  const { data, error, loading } = useLoad(() => api(`/legal/cases/${encodeURIComponent(number)}`), [number]);
  const [only, setOnly] = useState('all');
  const [typed, setTyped] = useState('');
  const x = data?.case;
  const docs = useMemo(() => {
    const all = x?.documents || [];
    const w = typed.trim().toLowerCase();
    return all.filter((d) => (only === 'key' ? d.key : only === 'main' ? d.kind !== 'attachment' : true) && (!w || [d.type, d.detail, d.by, d.description].join(' ').toLowerCase().includes(w)));
  }, [x, only, typed]);
  const f = x?.facts;
  return (
    <Page title={x?.name || number} sub={x ? `${x.number} · ${x.court}` : null} back="/legal?tab=cases">
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : null}
      {x ? (
        <>
          <Card>
            <div className={c.meta}>
              <Badge tone={statusTone(x.status)}>{x.status}</Badge>
              <span dir="auto">{[x.type, x.subject].filter(Boolean).join(' · ')}</span>
              {x.opened ? (
                <span>
                  {t('joya.legal.opened')} <Term>{fmtDay(x.opened)}</Term>
                </span>
              ) : null}
              {x.judges ? <span dir="auto">{x.judges}</span> : null}
            </div>
            {x.parties?.length ? (
              <div className={c.fact} dir="auto">
                {x.parties.map((p) => `${p.role}: ${p.name}`).join(' · ')}
              </div>
            ) : null}
            {x.scope === 'claim_and_verdict' ? <p className={c.hint}>{t('joya.legal.partial')}</p> : null}
            {!x.downloaded ? <p className={c.hint}>{x.note || t('joya.legal.notDownloaded')}</p> : null}
          </Card>
          {x.history || x.summary ? (
            <Card title={t('joya.legal.story')}>
              <p className={c.story} dir="auto">
                {x.history || x.summary}
              </p>
              {x.outcome ? (
                <>
                  <div className={c.label}>{t('joya.legal.outcome')}</div>
                  <div className={c.fact} dir="auto">
                    {x.outcome}
                  </div>
                </>
              ) : null}
              {x.amount ? (
                <>
                  <div className={c.label}>{t('joya.legal.amount')}</div>
                  <div className={c.fact} dir="auto">
                    {x.amount}
                  </div>
                </>
              ) : null}
              <p className={c.hint}>{t('joya.legal.aiNote')}</p>
            </Card>
          ) : null}
          {f && (f.verdict || f.lastDecision || f.hearings?.length || f.datesMentioned?.length) ? (
            <Card title={t('joya.legal.facts')}>
              {f.nextHearing ? (
                <div className={c.fact}>
                  <strong>{t('joya.legal.nextHearing')}</strong>{' '}
                  <Term>
                    {fmtDay(f.nextHearing.date)} {f.nextHearing.time}
                  </Term>{' '}
                  <span dir="auto">
                    {f.nextHearing.type}
                    {f.nextHearing.judge ? ` · ${f.nextHearing.judge}` : ''}
                  </span>
                </div>
              ) : null}
              {!f.hearings?.length && f.datesMentioned?.length ? (
                <div>
                  <div className={c.label}>{t('joya.legal.datesMentioned')}</div>
                  {f.datesMentioned.map((m) => (
                    <div key={m.date} className={c.fact} dir="auto">
                      <Term>{fmtDay(m.date)}</Term> — {m.text}
                    </div>
                  ))}
                </div>
              ) : null}
              <KeyPaper label={t('joya.legal.verdict')} d={f.verdict} classes={c} t={t} />
              {f.lastDecision && f.lastDecision.documentID !== f.verdict?.documentID ? <KeyPaper label={t('joya.legal.lastDecision')} d={f.lastDecision} classes={c} t={t} /> : null}
              {f.hearings?.length ? (
                <div>
                  <div className={c.label}>{t('joya.legal.hearings.all')}</div>
                  {f.hearings
                    .slice()
                    .reverse()
                    .map((h, i) => (
                      <div key={i} className={c.fact} dir="auto">
                        <Term>
                          {fmtDay(h.date)} {h.time}
                        </Term>{' '}
                        · {h.type} · {h.status}
                        {h.judge ? ` · ${h.judge}` : ''}
                      </div>
                    ))}
                </div>
              ) : null}
            </Card>
          ) : null}
          {x.documents?.length ? (
            <Card title={t('joya.legal.papersTitle', { n: x.documents.length })}>
              <div className={c.bar}>
                <Tabs tabs={['all', 'main', 'key'].map((k) => [k, t(`joya.legal.filter.${k}`)])} value={only} onChange={setOnly} />
                <div className={c.search}>
                  <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t('joya.legal.searchPapers')} aria-label={t('joya.legal.searchPapers')} dir="auto" />
                </div>
              </div>
              {!docs.length ? <Empty>{t('joya.legal.nonePapers')}</Empty> : null}
              {docs.map((d) => (
                <Paper key={d.documentID} d={d} classes={c} t={t} />
              ))}
              {x.missing?.length ? <p className={c.hint}>{t('joya.legal.missing', { n: x.missing.length })}</p> : null}
            </Card>
          ) : null}
        </>
      ) : null}
    </Page>
  );
}

const TABS = ['ask', 'cases', 'hearings'];

export default function Legal() {
  const theme = useTheme();
  const c = useStyles(theme);
  const { t } = useT();
  const j = useJoya();
  const [sp, setSp] = useSearchParams();
  const tab = TABS.includes(sp.get('tab')) ? sp.get('tab') : 'ask';
  const a = AREAS.legal;
  const suggestions = Array.from({ length: a.suggestions }, (_, i) => t(`joya.area.legal.s${i + 1}`));
  return (
    <Page tabs={<Tabs tabs={TABS.map((k) => [k, t(`joya.legal.tab.${k}`)])} value={tab} onChange={(k) => setSp(k === 'ask' ? {} : { tab: k }, { replace: true })} />}>
      {tab === 'ask' ? <ChatArea key="legal" contextId={a.id} locationId={j.locationId} title={t('joya.area.askTitle')} intro={t('joya.area.legal.intro')} suggestions={suggestions} /> : null}
      {tab === 'cases' ? <CaseList classes={c} t={t} /> : null}
      {tab === 'hearings' ? <Hearings classes={c} t={t} /> : null}
    </Page>
  );
}
