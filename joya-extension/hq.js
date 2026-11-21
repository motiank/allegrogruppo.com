// Runs inside the Joya HQ page. It tells the page that the extension is installed, passes the page's "start" / "stop"
// to the extension, shows the extension's progress to the page, and sends the papers to Joya with the page's own
// login (same-origin requests), so the extension never holds a Joya password or key.
(() => {
  const VERSION = chrome.runtime.getManifest().version;
  const mark = () => { document.documentElement.dataset.joyaLegalExt = VERSION; document.documentElement.dataset.joyaExt = VERSION; window.postMessage({ source: 'joya-ext', type: 'hello', version: VERSION }, location.origin); };
  mark();
  document.addEventListener('DOMContentLoaded', mark);

  let port = null;
  let ping = null;
  const toPage = (m) => window.postMessage({ source: 'joya-ext', ...m }, location.origin);
  const b64ToBytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  async function upload(m) {
    // { reqId, path, json? , b64? [, contentType] } → POST /api/joya<path>; neither json nor b64 → GET
    try {
      const isGet = m.json === undefined && m.b64 == null;
      const res = await fetch('/api/joya' + m.path, {
        method: isGet ? 'GET' : 'POST',
        credentials: 'same-origin',
        headers: isGet ? undefined : { 'content-type': m.b64 != null ? m.contentType || 'application/octet-stream' : 'application/json' },
        body: isGet ? undefined : m.b64 != null ? b64ToBytes(m.b64) : JSON.stringify(m.json ?? {}),
      });
      let data = null;
      try { data = await res.json(); } catch { data = null; }
      port?.postMessage({ type: 'uploaded', reqId: m.reqId, ok: res.ok, status: res.status, data });
    } catch (e) {
      port?.postMessage({ type: 'uploaded', reqId: m.reqId, ok: false, status: 0, data: { error: String(e.message || e) } });
    }
  }

  function connect() {
    if (port) return port;
    port = chrome.runtime.connect({ name: 'joya-hq' });
    port.onMessage.addListener((m) => (m.type === 'upload' ? upload(m) : toPage(m)));
    port.onDisconnect.addListener(() => { port = null; clearInterval(ping); toPage({ type: 'progress', phase: 'stopped', text: 'the extension stopped' }); });
    ping = setInterval(() => port?.postMessage({ type: 'ping' }), 20000); // keeps the extension's worker awake during a run
    return port;
  }

  window.addEventListener('message', (ev) => {
    if (ev.source !== window || ev.origin !== location.origin || ev.data?.source !== 'joya-page') return;
    const m = ev.data;
    if (m.type === 'hello') return mark();
    if (m.type === 'start' || m.type === 'stop' || m.type === 'status') {
      try { connect().postMessage(m); } catch (e) { toPage({ type: 'progress', phase: 'error', text: String(e.message || e) }); }
    }
  });
})();
