// The Beecomm update run (owner 2026-11-28: "support the update Beecomm through the Joya extension" — Beecomm's API
// gateway refuses the production server's address, the user's browser in Israel gets through). Loaded into
// background.js with importScripts; started by the Joya HQ System page (hq.js, job 'beecomm'). No tab, no login by the
// user: the server mints a 1-hour Beecomm token from its own login and says exactly what to fetch.
//   1. asks Joya for the plan: { id, dates, cubeUrl, token, requests: [{ key, path, payload }] } — or nothingToDo;
//   2. POSTs every request to Beecomm from this browser (a 401/403 once → a fresh token from Joya) and hands each
//      answer to Joya → the admin keeps it for the replay;
//   3. finish: the admin runs its own loader on the answers (the same saving code as the nightly job) and the run
//      shows in the card's list ("via extension"). Nothing is saved on this computer.
/* global say, toJoya, sleep */
(() => {
  const PAUSE_MS = 120;

  async function update(r, { runId } = {}) {
    const sum = { requests: 0, done: 0, bytes: 0, dates: null, planId: null, stopped: false };
    const prog = (phase, text, extra = {}) => say(r, phase, text, { job: 'beecomm', summary: sum, ...extra });
    let plan = null;
    const cancel = async () => {
      if (!plan?.id) return;
      try { await toJoya(r, `/beecomm/sync/ext/${plan.id}/cancel`, { json: {} }); } catch {}
    };
    try {
      prog('plan', 'asking the server what to fetch from Beecomm');
      plan = await toJoya(r, '/beecomm/sync/ext/plan', { json: { runId: runId || null } });
      sum.dates = plan?.dates || null;
      if (plan?.nothingToDo) return prog('done', `nothing to load — the data reaches ${plan.dates?.to || 'yesterday'}`, { nothingToDo: true });
      if (!plan?.id || !Array.isArray(plan.requests) || !plan.cubeUrl || !plan.token) throw new Error('the server gave no plan');
      sum.planId = plan.id;
      sum.requests = plan.requests.length;
      let token = plan.token;
      for (let i = 0; i < plan.requests.length; i++) {
        if (r.stop) { sum.stopped = true; await cancel(); return prog('stopped', `stopped after ${sum.done} of ${sum.requests} answers — nothing was loaded`); }
        const q = plan.requests[i];
        prog('fetch', `${i + 1}/${plan.requests.length} · ${q.payload?.action || q.path} · ${plan.dates?.from || ''} – ${plan.dates?.to || ''}`, { done: i, total: plan.requests.length });
        let data = null;
        for (let attempt = 0; ; attempt++) {
          const res = await fetch(`${plan.cubeUrl}/${q.path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ ...q.payload, token: `Bearer ${token}` }) });
          if ((res.status === 401 || res.status === 403) && attempt === 0) {
            token = (await toJoya(r, `/beecomm/sync/ext/${plan.id}/token`, { json: {} }))?.token || token; // the hour may be over
            continue;
          }
          if (!res.ok) throw new Error(`Beecomm answered ${res.status} to ${q.payload?.action || q.path}`);
          const text = await res.text();
          sum.bytes += text.length;
          data = JSON.parse(text);
          break;
        }
        await toJoya(r, `/beecomm/sync/ext/${plan.id}/answer`, { json: { key: q.key, data } });
        sum.done++;
        await sleep(PAUSE_MS);
      }
      prog('save', 'the server loads the answers into the tables');
      const run = await toJoya(r, `/beecomm/sync/ext/${plan.id}/finish`, { json: {} });
      prog('done', `${sum.done} answers fetched; the server loads ${plan.dates?.from || ''} – ${plan.dates?.to || ''}`, { run });
    } catch (e) {
      await cancel();
      prog('error', String(e.message || e));
    }
  }

  self.joyaBeecomm = { update };
})();
