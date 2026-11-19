// The manager of an update run. Started only by the Joya HQ System page (through hq.js):
//   1. opens נט המשפט in a normal tab and waits until the USER has logged in (it never touches the login);
//   2. for every open case of the plan: finds the case, opens its paper folder, reads the paper list;
//   3. asks the site for each paper the archive does not hold (the page's own form request — what the "הורדת מסמך"
//      icon sends; the site answers with a short-lived address of the file) and hands the PDF to the Joya page;
//   4. tells Joya it is done. Nothing is saved on this computer.
const COURT = 'https://securesso.court.gov.il/Ngcs.Web.Secured/';
const START = COURT + 'PersonalAreaPage.aspx';
const CHUNK = 700 * 1024; // pieces small enough for any upload limit on the way
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let run = null; // one run at a time: { port, tabId, stop, ... }
const pending = new Map(); // upload requests waiting for the Joya page's answer

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'joya-hq') return;
  port.onMessage.addListener((m) => {
    if (m.type === 'ping') return;
    if (m.type === 'uploaded') { const p = pending.get(m.reqId); if (p) { pending.delete(m.reqId); p(m); } return; }
    if (m.type === 'status') return port.postMessage({ type: 'progress', phase: run ? 'running' : 'idle', text: run ? run.last : '' });
    if (m.type === 'stop') { if (run) run.stop = true; return; }
    if (m.type === 'start') {
      if (run) return port.postMessage({ type: 'progress', phase: 'error', text: 'an update is already running in this browser' });
      run = { port, stop: false, last: '' };
      const r = run;
      update(r, m).catch((e) => say(r, 'error', String(e.message || e))).finally(() => { if (run === r) run = null; });
    }
  });
  port.onDisconnect.addListener(() => { if (run && run.port === port) run.stop = true; });
});

function say(r, phase, text, extra = {}) {
  r.last = text;
  try { r.port.postMessage({ type: 'progress', phase, text, ...extra }); } catch { r.stop = true; }
}

function toJoya(r, path, body) {
  // body: { json } or { b64 }; answered by hq.js after the same-origin request
  return new Promise((resolve, reject) => {
    const reqId = Math.random().toString(36).slice(2);
    const t = setTimeout(() => { pending.delete(reqId); reject(new Error('Joya did not answer (is the Joya page still open?)')); }, 120000);
    pending.set(reqId, (m) => { clearTimeout(t); m.ok ? resolve(m.data) : reject(new Error(`Joya: ${m.data?.error || m.status}`)); });
    try { r.port.postMessage({ type: 'upload', reqId, path, ...body }); } catch (e) { clearTimeout(t); pending.delete(reqId); reject(e); }
  });
}

const tabInfo = (id) => chrome.tabs.get(id).catch(() => null);
const ask = (tabId, msg) => chrome.tabs.sendMessage(tabId, msg).catch(() => null);

/** Wait until the tab finished loading and the court script answers; returns its "where" answer, or null on timeout. */
async function settled(r, ms = 45000) {
  const end = Date.now() + ms;
  await sleep(1200);
  while (Date.now() < end && !r.stop) {
    const t = await tabInfo(r.tabId);
    if (!t) throw new Error('the נט המשפט tab was closed');
    if (t.status === 'complete' && t.url?.startsWith(COURT)) {
      const w = await ask(r.tabId, { cmd: 'where' });
      if (w) return w;
    }
    await sleep(800);
  }
  return null;
}

/** The user logs in by himself in the tab; wait (up to 15 minutes) until the personal area shows. */
async function waitForLogin(r) {
  const end = Date.now() + 15 * 60 * 1000;
  let told = false;
  while (Date.now() < end && !r.stop) {
    const t = await tabInfo(r.tabId);
    if (!t) throw new Error('the נט המשפט tab was closed');
    if (t.status === 'complete' && t.url?.startsWith(COURT)) {
      const w = await ask(r.tabId, { cmd: 'where' });
      if (w?.hasSearch) return true;
    } else if (!told && t.url && !t.url.startsWith(COURT)) {
      told = true;
      say(r, 'login', 'log in to נט המשפט in the tab that opened');
    }
    await sleep(1500);
  }
  return false;
}

const bytesToB64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };

/** Ask the site for one paper with the page's own form and return its bytes. */
async function fetchPaper(r, arg) {
  const f = await ask(r.tabId, { cmd: 'formFor', arg });
  if (!f?.ok) throw new Error(f?.error || 'the page did not give its form');
  const res = await fetch(f.action, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: f.body, credentials: 'include', redirect: 'follow' });
  if (!res.ok) throw new Error(`the site answered ${res.status}`);
  if (new URL(res.url).host.endsWith('login.gov.il')) throw new Error('LOGIN');
  const u8 = new Uint8Array(await res.arrayBuffer());
  if (String.fromCharCode(...u8.subarray(0, 5)) !== '%PDF-') {
    if (new URL(res.url).host === 'securesso.court.gov.il') throw new Error('the site sent a page, not a file');
    throw new Error('the file is not a PDF');
  }
  return u8;
}

async function sendPaper(r, batchId, caseNumber, doc, u8) {
  const n = Math.max(1, Math.ceil(u8.length / CHUNK));
  for (let i = 0; i < n; i++) {
    const part = u8.subarray(i * CHUNK, (i + 1) * CHUNK);
    await toJoya(r, `/legal/sync/${batchId}/file?doc=${doc}&case=${encodeURIComponent(caseNumber)}&i=${i}&last=${i === n - 1 ? 1 : 0}`, { b64: bytesToB64(part) });
  }
}

/** Open one case's paper folder; returns the rows answer, or throws. Retries once from the personal area. */
async function openCase(r, number) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let w = await ask(r.tabId, { cmd: 'where' });
    if (!w?.hasSearch) {
      await chrome.tabs.update(r.tabId, { url: START });
      w = await settled(r);
      if (!w?.hasSearch) { if (!(await waitForLogin(r))) throw new Error('LOGIN'); }
    }
    const o = await ask(r.tabId, { cmd: 'openCase', number });
    if (!o?.ok) throw new Error(o?.error || 'could not search the case');
    w = await settled(r);
    if (!w || w.generalError) { await sleep(3000); continue; }
    const p = await ask(r.tabId, { cmd: 'openPaperFolder' });
    if (!p?.ok) { if (attempt) throw new Error(p?.error || 'no paper folder'); continue; }
    w = await settled(r);
    if (!w || w.generalError) { await sleep(3000); continue; }
    // the grid fills a moment after the page; the first page after a case switch can still show the old case
    for (let i = 0; i < 15 && !r.stop; i++) {
      const rows = await ask(r.tabId, { cmd: 'rows' });
      if (rows?.ok && rows.firstCase === number && /PresentDocument/i.test(rows.path || '')) return rows;
      await sleep(1500);
    }
  }
  throw new Error('the paper list of the case did not open');
}

async function update(r, { person, batchId, plan, only }) {
  const cases = (plan?.cases || []).filter((c) => c.open && (!only || only.includes(c.number)));
  // newest first: the case number ends with month-year
  const ym = (n) => { const m = /-(\d\d)-(\d\d)$/.exec(n || ''); return m ? Number(m[2]) * 100 + Number(m[1]) : 0; };
  cases.sort((a, b) => ym(b.number) - ym(a.number));
  const sum = { person, casesPlanned: cases.length, casesChecked: 0, newPapers: 0, bytes: 0, failedCases: [], failedPapers: [], stopped: false };

  // However the run ends, Joya is told: papers already fetched go on to processing; a run with none is closed,
  // so the update button is free again at once.
  const close = async (why) => {
    sum.stopped = !!r.stop;
    if (why) sum.error = why;
    r.stop = false; // the closing message must still go out
    try {
      if (!sum.newPapers && (why || sum.stopped)) {
        await toJoya(r, `/legal/sync/${batchId}/cancel`, { json: { why: why || 'stopped by the user' } });
        say(r, why ? 'error' : 'stopped', why || 'stopped', { summary: sum });
      } else {
        const b = await toJoya(r, `/legal/sync/${batchId}/finish`, { json: { summary: sum } });
        say(r, why ? 'error' : 'done', why ? `${why} — ${sum.newPapers} papers were kept` : `checked ${sum.casesChecked} cases, ${sum.newPapers} new papers`, { summary: sum, batch: b });
      }
    } catch (e) {
      say(r, 'error', why || String(e.message || e), { summary: sum });
    }
  };

  try {
  const tab = await chrome.tabs.create({ url: START, active: true });
  r.tabId = tab.id;
  say(r, 'login', 'log in to נט המשפט in the tab that opened');
  if (!(await waitForLogin(r))) return close(r.stop ? '' : 'no login within 15 minutes');

  for (let i = 0; i < cases.length && !r.stop; i++) {
    const c = cases[i];
    say(r, 'case', `${i + 1}/${cases.length} ${c.number}`, { done: i, total: cases.length, newPapers: sum.newPapers });
    try {
      const rows = await openCase(r, c.number);
      const have = new Set(c.ids || []);
      const seen = new Set();
      const missing = rows.rows.filter((x) => x.DocumentID && !have.has(x.DocumentID) && !seen.has(x.DocumentID) && seen.add(x.DocumentID));
      sum.casesChecked++;
      if (!missing.length) continue;
      const caseId = rows.caseId || c.caseID;
      if (!caseId) throw new Error('the case id was not found on the page');
      await toJoya(r, `/legal/sync/${batchId}/case`, { json: { caseID: caseId, number: c.number, name: c.name || '', rows: rows.rows } });
      for (let k = 0; k < missing.length && !r.stop; k++) {
        const d = missing[k];
        say(r, 'paper', `${i + 1}/${cases.length} ${c.number}: ${k + 1}/${missing.length}`, { done: i, total: cases.length, newPapers: sum.newPapers });
        try {
          const u8 = await fetchPaper(r, `${caseId}&${d.DocumentID}&${rows.argTail || '1'}`);
          await sendPaper(r, batchId, c.number, d.DocumentID, u8);
          sum.newPapers++;
          sum.bytes += u8.length;
        } catch (e) {
          if (e.message === 'LOGIN') throw e;
          sum.failedPapers.push({ case: c.number, doc: d.DocumentID, type: d.DocumentType, why: String(e.message || e).slice(0, 120) });
        }
        await sleep(1200);
      }
    } catch (e) {
      if (e.message === 'LOGIN') {
        say(r, 'login', 'the login ended — log in again in the נט המשפט tab');
        if (!(await waitForLogin(r))) break;
        i--; // the same case again
        continue;
      }
      if (/tab was closed/.test(e.message || '')) throw e;
      sum.failedCases.push({ case: c.number, why: String(e.message || e).slice(0, 160) });
    }
  }
  } catch (e) {
    return close(String(e.message || e));
  }
  return close('');
}
