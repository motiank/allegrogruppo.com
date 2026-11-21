// Runs inside the Bank Hapoalim business site (biz2.bankhapoalim.co.il), after the USER logged in by himself. It does
// only what the extension's manager (bank-run.js) asks: says where the page is, calls the site's own JSON services with
// the page's login (same-origin fetch — the same calls the site's pages make), and fetches a cheque picture. It never
// reads or touches the login form, never clicks anything.
(() => {
  const ORIGIN = 'https://biz2.bankhapoalim.co.il';

  // the account ids the page itself used in its calls (…?accountId=<id>…) — the site's own id of the open account
  const seenAccountIds = () => {
    const out = new Set();
    try {
      for (const e of performance.getEntriesByType('resource')) {
        const m = /[?&]accountId=([^&]+)/.exec(e.name || '');
        if (m && m[1]) out.add(decodeURIComponent(m[1]));
      }
    } catch {}
    return [...out];
  };
  const looksLoggedOut = () => /login|authenticate|logout/i.test(location.pathname) || !!document.querySelector('input[type="password"]');

  async function getJson(url) {
    const u = new URL(url, ORIGIN).href;
    if (!u.startsWith(ORIGIN + '/')) return { ok: false, error: 'not a bank address' };
    let res;
    try {
      res = await fetch(u, { credentials: 'include', headers: { accept: 'application/json, text/plain, */*' }, redirect: 'follow' });
    } catch (e) {
      return { ok: false, status: 0, error: String(e.message || e) };
    }
    const type = res.headers.get('content-type') || '';
    const txt = await res.text();
    if (!/json/i.test(type)) return { ok: false, status: res.status, html: /<html|<!doctype/i.test(txt.slice(0, 400)), finalUrl: res.url, head: txt.slice(0, 200) };
    try {
      return { ok: res.ok, status: res.status, json: JSON.parse(txt), finalUrl: res.url };
    } catch {
      return { ok: false, status: res.status, error: 'bad JSON', head: txt.slice(0, 200) };
    }
  }

  const bytesToB64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };

  async function getBytes(url) {
    let u;
    try {
      u = new URL(url, ORIGIN);
    } catch {
      return { ok: false, error: 'bad picture address' };
    }
    if (!/\.bankhapoalim\.co\.il$/.test(u.host)) return { ok: false, error: `picture address outside the bank: ${u.host}` };
    let res;
    try {
      res = await fetch(u.href, { credentials: 'include', redirect: 'follow' });
    } catch (e) {
      return { ok: false, status: 0, error: String(e.message || e) };
    }
    const type = res.headers.get('content-type') || '';
    const u8 = new Uint8Array(await res.arrayBuffer());
    const jpeg = u8[0] === 0xff && u8[1] === 0xd8;
    const png = u8[0] === 0x89 && u8[1] === 0x50;
    if (!jpeg && !png) return { ok: false, status: res.status, error: /html/i.test(type) ? 'the site sent a page, not a picture' : `not a picture (${type || 'no type'}, ${u8.length} bytes)` };
    return { ok: true, status: res.status, type: png ? 'image/png' : 'image/jpeg', b64: bytesToB64(u8), bytes: u8.length };
  }

  const handlers = {
    where: () => ({ url: location.href, path: location.pathname, title: document.title, loggedOut: looksLoggedOut(), accountIds: seenAccountIds() }),
    get: ({ url }) => getJson(url),
    bytes: ({ url }) => getBytes(url),
  };

  chrome.runtime.onMessage.addListener((m, _sender, reply) => {
    if (m?.job !== 'bank') return false;
    const fn = handlers[m.cmd];
    if (!fn) return false;
    Promise.resolve().then(() => fn(m)).then(reply, (e) => reply({ ok: false, error: String(e.message || e) }));
    return true;
  });
})();
