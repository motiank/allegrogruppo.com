// Files dropped on a chat area (or picked with the paperclip): the Allegro admin's Upload files code reads each file
// (POST /api/joya/files/recognize → Allegro /files/recognize), the card shows what it is, and "Import" writes it to the
// Allegro tables (POST /api/joya/files/import). Joya keeps nothing. Files that the admin imports with its own loaders
// (employee list, Micpal / Shiklulit index) are shown with a link to the admin's Upload files page.
import React, { useEffect, useRef, useState } from 'react';
import { createUseStyles, useTheme } from 'react-jss';
import { ApiError } from './api.js';
import { useT } from './i18n/index.js';
import { useJoya } from './context.js';

const ADMIN_UPLOAD = 'https://admin.allegrogruppo.com/upload';

const useStyles = createUseStyles((theme) => ({
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 40,
    background: 'rgba(0,0,0,0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  overlayBox: { border: `2px dashed ${theme.primary}`, borderRadius: 16, background: theme.surface, padding: '1.6rem 2rem', fontSize: '1rem', fontWeight: 650, textAlign: 'center' },
  card: { border: `1px solid ${theme.border}`, borderRadius: 12, background: theme.surface, padding: '0.7rem 0.85rem 0.8rem', marginBottom: '0.75rem' },
  head: { display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.92rem', fontWeight: 650 },
  grow: { flex: 1, minWidth: 0 },
  x: { flex: 'none', width: 26, height: 26, borderRadius: 999, border: 0, background: 'none', color: theme.textSecondary, fontSize: '1.05rem', cursor: 'pointer' },
  file: { borderTop: `1px solid ${theme.border}`, padding: '0.5rem 0 0.3rem', fontSize: '0.84rem', lineHeight: 1.5 },
  name: { fontWeight: 600, overflowWrap: 'anywhere' },
  muted: { color: theme.textSecondary, fontSize: '0.78rem' },
  warn: { color: '#e0a030', fontSize: '0.78rem' },
  bad: { color: '#e05050', fontSize: '0.8rem' },
  good: { color: '#3fb070', fontSize: '0.8rem' },
  select: { marginTop: '0.3rem', padding: '0.3rem 0.5rem', borderRadius: 8, border: `1px solid ${theme.border}`, background: theme.background, color: theme.text, fontFamily: 'inherit' },
  actions: { display: 'flex', gap: '0.5rem', marginTop: '0.55rem' },
  btn: {
    border: 0,
    borderRadius: 999,
    padding: '0.45rem 1.1rem',
    background: theme.primary,
    color: '#fff',
    fontFamily: 'inherit',
    fontSize: '0.86rem',
    cursor: 'pointer',
    '&:disabled': { opacity: 0.45, cursor: 'default' },
  },
}));

async function post(path, form) {
  const res = await fetch(`/api/joya/files/${path}`, { method: 'POST', credentials: 'same-origin', body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data.files || [];
}

/** Files dragged over the window: { dragging }. Dropped files go to onFiles. */
export function useWindowDrop(onFiles) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const cb = useRef(onFiles);
  cb.current = onFiles;
  useEffect(() => {
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    const enter = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current++;
      setDragging(true);
    };
    const over = (e) => hasFiles(e) && e.preventDefault();
    const leave = (e) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setDragging(false);
    };
    const drop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      const files = [...(e.dataTransfer.files || [])];
      if (files.length) cb.current(files);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);
  return dragging;
}

export function DropOverlay() {
  const theme = useTheme();
  const c = useStyles(theme);
  const { t } = useT();
  return (
    <div className={c.overlay}>
      <div className={c.overlayBox}>{t('joya.files.dropHere')}</div>
    </div>
  );
}

/** The uploads of a chat: add(files) starts one card per drop. */
export function useUploads() {
  const [uploads, setUploads] = useState([]);
  const set = (key, patch) => setUploads((xs) => xs.map((u) => (u.key === key ? { ...u, ...patch } : u)));
  const add = async (files) => {
    const key = `${Date.now()}-${Math.random()}`;
    setUploads((xs) => [...xs, { key, files, status: 'checking', recognized: null, results: null, error: null }]);
    const form = new FormData();
    for (const f of files) form.append('files', f, f.name);
    try {
      set(key, { status: 'checked', recognized: await post('recognize', form) });
    } catch (e) {
      set(key, { status: 'failed', error: e });
    }
  };
  // rests: hash → the branch chosen for a Tabit report
  const run = async (u, rests) => {
    const pick = u.recognized.map((r, i) => ({ r, f: u.files[i] })).filter(({ r }) => r.importable && r.handler === 'server');
    const form = new FormData();
    for (const { f } of pick) form.append('files', f, f.name);
    form.append('plan', JSON.stringify(pick.map(({ r }) => ({ hash: r.hash, rest: rests[r.hash] || r.rest || null }))));
    set(u.key, { status: 'importing' });
    try {
      set(u.key, { status: 'imported', results: await post('import', form) });
    } catch (e) {
      set(u.key, { status: 'checked', error: e });
    }
  };
  const remove = (key) => setUploads((xs) => xs.filter((u) => u.key !== key));
  return { uploads, add, run, remove };
}

const resultLine = (out) =>
  Object.entries(out || {})
    .filter(([, v]) => typeof v === 'number' || typeof v === 'string')
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ');

export function UploadCard({ u, onImport, onRemove }) {
  const theme = useTheme();
  const c = useStyles(theme);
  const { t } = useT();
  const j = useJoya();
  const [rests, setRests] = useState({});
  const recognized = u.recognized || [];
  const importable = recognized.filter((r) => r.importable && r.handler === 'server');
  const missingBranch = importable.some((r) => r.needsBranch && !(rests[r.hash] || r.rest));
  const resultOf = (r) => (u.results || []).find((x) => x.name === r.name);
  return (
    <div className={c.card}>
      <div className={c.head}>
        <span aria-hidden="true">📎</span>
        <div className={c.grow}>{t(`joya.files.status.${u.status}`, { count: u.files.length })}</div>
        <button type="button" className={c.x} onClick={onRemove} aria-label={t('joya.files.close')} title={t('joya.files.close')}>
          ×
        </button>
      </div>
      {u.error ? <div className={c.bad}>{u.error.message}</div> : null}
      {recognized.map((r, i) => {
        const done = resultOf(r);
        const loader = r.importable && r.handler !== 'server';
        return (
          <div key={`${r.hash || i}-${i}`} className={c.file}>
            <div className={c.name} dir="auto">
              {r.name}
            </div>
            <div dir="auto">{r.label}</div>
            {r.summary ? <div className={c.muted} dir="auto">{r.summary}</div> : null}
            {r.period?.from ? (
              <div className={c.muted}>
                {t('joya.files.period')}: {r.period.from} – {r.period.to}
              </div>
            ) : null}
            {r.previous ? <div className={c.warn}>{t('joya.files.previous', { times: r.previous.times })}</div> : null}
            {(r.warnings || []).map((w) => (
              <div key={w} className={c.warn} dir="auto">
                {w}
              </div>
            ))}
            {!r.importable && r.reason ? <div className={c.bad} dir="auto">{r.reason}</div> : null}
            {loader ? (
              <div className={c.muted}>
                {t('joya.files.useAdmin')}{' '}
                <a href={ADMIN_UPLOAD} target="_blank" rel="noreferrer">
                  {t('joya.files.adminPage')}
                </a>
              </div>
            ) : null}
            {r.needsBranch && r.importable && r.handler === 'server' && !done ? (
              <select className={c.select} value={rests[r.hash] || r.rest || ''} onChange={(e) => setRests((x) => ({ ...x, [r.hash]: e.target.value }))} disabled={u.status !== 'checked'}>
                <option value="">{t('joya.files.chooseBranch')}</option>
                {j.locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            ) : null}
            {done ? (
              <div className={done.status === 'FAILED' ? c.bad : c.good} dir="auto">
                {done.status === 'FAILED' ? `${t('joya.files.failed')}: ${done.error}` : `${t(`joya.files.result.${done.status}`)} — ${resultLine(done.result)}`}
              </div>
            ) : null}
          </div>
        );
      })}
      {u.status === 'checked' && importable.length ? (
        <div className={c.actions}>
          <button type="button" className={c.btn} disabled={missingBranch} onClick={() => onImport(rests)}>
            {t('joya.files.import', { count: importable.length })}
          </button>
        </div>
      ) : null}
    </div>
  );
}
