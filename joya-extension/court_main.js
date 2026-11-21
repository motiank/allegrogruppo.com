// Runs inside the נט המשפט page itself (the page's own JavaScript world). It answers court.js: it reads the full list
// of a case's papers from the page's grid, and it clicks the case search button and the "תיק נייר" link (the site's
// links are "javascript:" links; the browser lets only the page's own world follow them).
(() => {
  const api = () => window.presentDocumentGrid?.gridApi || window.presentDocumentGridOptions?.api || null;
  window.addEventListener('message', (ev) => {
    if (ev.source !== window || ev.data?.source !== 'joya-court') return;
    if (ev.data.type === 'click') {
      const el = ev.data.what === 'search'
        ? document.querySelector('#Header1_CaseLocatorHeaderUC2_SearchHeaderCaseButton')
        : ev.data.what === 'paper' ? [...document.querySelectorAll('a')].find((x) => /תיק נייר/.test(x.innerText || '')) : null;
      window.postMessage({ source: 'joya-court-main', id: ev.data.id, ok: !!el, error: el ? null : (ev.data.what === 'paper' ? 'the paper folder link was not found' : 'the search button was not found') }, location.origin);
      if (el) setTimeout(() => el.click(), 150);
      return;
    }
    if (ev.data.type !== 'rows') return;
    const out = { source: 'joya-court-main', id: ev.data.id, ready: false, rows: [] };
    const a = api();
    if (a && typeof a.forEachNode === 'function') {
      out.ready = true;
      const pick = (r, parent) => ({
        DocumentID: Number(r.DocumentID) || 0,
        DocumentType: r.DocumentType || '',
        DocumentDesc: r.DocumentDesc || '',
        PresentationDate: r.PresentationDate || '',
        CasePartyDisplayName: r.CasePartyDisplayName || '',
        attachmentOf: parent || 0,
      });
      a.forEachNode((n) => {
        const r = n.data;
        if (!r) return;
        out.rows.push(pick(r, 0));
        for (const x of Array.isArray(r.Attch) ? r.Attch : []) out.rows.push(pick(x, Number(r.DocumentID) || 0));
      });
    }
    window.postMessage(out, location.origin);
  });
})();
