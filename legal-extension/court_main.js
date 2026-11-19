// Runs inside the נט המשפט page itself (the page's own JavaScript world), only to read what the page already holds:
// the full list of a case's papers from the grid. It answers questions from court.js and changes nothing.
(() => {
  const api = () => window.presentDocumentGrid?.gridApi || window.presentDocumentGridOptions?.api || null;
  window.addEventListener('message', (ev) => {
    if (ev.source !== window || ev.data?.source !== 'joya-court' || ev.data.type !== 'rows') return;
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
