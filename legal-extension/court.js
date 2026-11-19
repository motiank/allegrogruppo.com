// Runs inside the נט המשפט personal area. It does the few page steps the update needs, when the extension's manager
// (background.js) asks: find a case with the page's own search box, open its paper folder, read the paper list, and
// hand over the page's own form fields for one paper request. It never reads or touches the login.
(() => {
  const H = '#Header1_CaseLocatorHeaderUC2_';
  const $ = (q) => document.querySelector(q);
  const setValue = (el, v) => { el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  const firstCaseNumber = () => (document.body.innerText.match(/\b\d{1,6}-\d{2}-\d{2}\b/) || [null])[0];
  const generalError = () => /שגיאה כללית/.test(document.body.innerText.slice(0, 4000));

  function askMain(type) {
    return new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2);
      const on = (ev) => { if (ev.source === window && ev.data?.source === 'joya-court-main' && ev.data.id === id) { window.removeEventListener('message', on); resolve(ev.data); } };
      window.addEventListener('message', on);
      window.postMessage({ source: 'joya-court', type, id }, location.origin);
      setTimeout(() => { window.removeEventListener('message', on); resolve(null); }, 4000);
    });
  }

  const handlers = {
    where: () => ({ path: location.pathname, title: document.title, hasSearch: !!$(H + 'BamaCaseNumberTextBoxHT'), generalError: generalError(), firstCase: firstCaseNumber() }),
    openCase: ({ number }) => {
      const m = /^(\d+)-(\d\d)-(\d\d)$/.exec(number);
      const no = $(H + 'BamaCaseNumberTextBoxHT'), my = $(H + 'BamaMonthYearTextBoxHT'), go = $(H + 'SearchHeaderCaseButton');
      if (!m || !no || !my || !go) return { ok: false, error: 'the case search box was not found' };
      setValue(no, m[1]);
      setValue(my, m[2] + m[3]);
      setTimeout(() => go.click(), 150);
      return { ok: true };
    },
    openPaperFolder: () => {
      const a = [...document.querySelectorAll('a')].find((x) => /תיק נייר/.test(x.innerText || ''));
      if (!a) return { ok: false, error: 'the paper folder link was not found' };
      setTimeout(() => a.click(), 150);
      return { ok: true };
    },
    rows: async () => {
      const r = await askMain('rows');
      const href = $('a[href*="btnDownloadDocument"]')?.getAttribute('href') || '';
      const arg = (href.match(/,\s*"([^"]+)"\)/) || [])[1] || '';
      return { ok: !!r?.ready, rows: r?.rows || [], caseId: Number(arg.split('&')[0]) || null, argTail: arg.split('&').slice(2).join('&') || '1', firstCase: firstCaseNumber(), generalError: generalError(), path: location.pathname };
    },
    // the page's own form, set to ask for one paper (the same request the "הורדת מסמך" icon sends)
    formFor: ({ arg }) => {
      const f = document.forms[0];
      if (!f) return { ok: false, error: 'the page form was not found' };
      const fd = new FormData(f);
      fd.set('__EVENTTARGET', '_ctl0:btnDownloadDocument');
      fd.set('__EVENTARGUMENT', arg);
      return { ok: true, action: f.action, body: new URLSearchParams(fd).toString() };
    },
  };

  chrome.runtime.onMessage.addListener((m, _sender, reply) => {
    const fn = handlers[m?.cmd];
    if (!fn) return false;
    Promise.resolve().then(() => fn(m)).then(reply, (e) => reply({ ok: false, error: String(e.message || e) }));
    return true;
  });
})();
