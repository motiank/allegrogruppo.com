// The bank update run (owner 2026-11-22), loaded into background.js with importScripts. Started by the Joya HQ System
// page (through hq.js, job 'bank'):
//   1. opens the Poalim business site in a normal tab and waits until the USER has logged in (it never touches the login);
//   2. finds the site's id of every account of the plan (the admin's configured accounts);
//   3. per account: asks the site's own transactions service for the days after the last stored day (the plan's
//      window, in short parts) and hands the rows to Joya → the admin stores them (bank_transactions);
//   4. per account: asks Joya which paid cheques have no picture in the Drive archive, fetches each cheque's front
//      picture from the site and hands it to Joya → the admin files it in Drive;
//   5. tells Joya it is done. Nothing is saved on this computer.
// Site facts (owner's sessions 2026-11-15, memory "bank-cheque-images"): the services live under
// /ServerServices/current-account/…, answer JSON only while the login lasts (an HTML answer = logged out; the session
// ends after some minutes without activity); transactions are read in 10-day parts; a cheque picture is found with
// view=paying + the cheque's day and amount. The site's accountId is its own id string — the page's own calls show it
// (bank.js seenAccountIds), and the last number in it is the account number.
/* global say, toJoya, tabInfo, ask, sleep, chrome */
(() => {
  const BANK = 'https://biz2.bankhapoalim.co.il';
  const START = 'https://www.bankhapoalim.biz/he';
  const PART_DAYS = 10;
  const PAGE = 500;

  // ---- pure helpers (tested in hq/test/test_bank_extension.mjs) ----
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const compact = (day) => String(day).replace(/-/g, '');
  /** [from, to] (YYYY-MM-DD, inclusive) → consecutive parts of at most `days` days: [{ from, to }]. */
  function dateParts(from, to, days = PART_DAYS) {
    const out = [];
    let a = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    if (isNaN(a) || isNaN(end) || a > end) return out;
    while (a <= end) {
      const b = new Date(a.getTime() + (days - 1) * 86400000);
      out.push({ from: ymd(a), to: ymd(b > end ? end : b) });
      a = new Date(b.getTime() + 86400000);
    }
    return out;
  }
  /** The digits of an account ("12-584-136663" → { branch: "584", number: "136663" }). */
  const accountDigits = (account) => {
    const parts = String(account || '').split('-').filter(Boolean);
    return { number: parts[parts.length - 1] || '', branch: parts.length >= 2 ? parts[parts.length - 2] : '' };
  };
  /**
   * The site's accountId of a wanted account, from the ids the page used: an id whose last number IS the wanted account
   * number, else the first id with its last number replaced (zero-padded to the same length). null when nothing is known.
   */
  function accountIdFor(seenIds, account) {
    const { number } = accountDigits(account);
    if (!number || !seenIds?.length) return null;
    const tail = (id) => (String(id).match(/(\d+)\D*$/) || [])[1] || '';
    const hit = seenIds.find((id) => String(Number(tail(id))) === String(Number(number)));
    if (hit) return hit;
    const base = seenIds.find((id) => tail(id));
    if (!base) return null;
    const t = tail(base);
    const replaced = t.length > number.length ? number.padStart(t.length, '0') : number;
    return String(base).replace(/(\d+)(\D*)$/, `${replaced}$2`);
  }
  /** The account list of /ServerServices/general/accounts → [{ bankNumber, branchNumber, accountNumber, id? }] (shapes vary). */
  function siteAccounts(json) {
    const arr = Array.isArray(json) ? json : Array.isArray(json?.accounts) ? json.accounts : Array.isArray(json?.list) ? json.list : [];
    return arr.map((a) => ({ bankNumber: a.bankNumber ?? a.bank ?? null, branchNumber: a.branchNumber ?? a.branch ?? null, accountNumber: a.accountNumber ?? a.account ?? null, id: a.accountId ?? a.id ?? null, closed: a.accountClosingReasonCode != null ? Number(a.accountClosingReasonCode) !== 0 : false, keys: Object.keys(a || {}).slice(0, 40) }));
  }
  const matchesAccount = (siteAcc, account) => {
    const { branch, number } = accountDigits(account);
    return siteAcc.accountNumber != null && String(Number(siteAcc.accountNumber)) === String(Number(number)) && (!branch || siteAcc.branchNumber == null || String(Number(siteAcc.branchNumber)) === String(Number(branch)));
  };

  // ---- the run ----
  const bankAsk = (tabId, msg) => ask(tabId, { job: 'bank', ...msg });

  /** The content script's answer to "where", once the tab finished loading a bank page; null on timeout. */
  async function settled(r, ms = 30000) {
    const end = Date.now() + ms;
    while (Date.now() < end && !r.stop) {
      const t = await tabInfo(r.tabId);
      if (!t) throw new Error('the bank tab was closed');
      if (t.status === 'complete' && t.url?.startsWith(BANK + '/')) {
        const w = await bankAsk(r.tabId, { cmd: 'where' });
        if (w) return w;
      }
      await sleep(800);
    }
    return null;
  }

  /** Logged in = the site's account service answers JSON. Returns { accounts, where } or null. */
  async function loggedIn(r) {
    const w = await bankAsk(r.tabId, { cmd: 'where' });
    if (!w || w.loggedOut) return null;
    const a = await bankAsk(r.tabId, { cmd: 'get', url: '/ServerServices/general/accounts?lang=he' });
    if (a?.ok && a.json) return { accounts: siteAccounts(a.json), where: w };
    if (a && !a.html && a.status && a.status !== 401 && a.status !== 403 && a.status !== 302 && /\/ng-portals\/biz\//.test(w.url)) return { accounts: [], where: w, noAccountService: a.status };
    return null;
  }

  /** The user logs in by himself in the tab; wait (up to 15 minutes) until the site answers as logged in. */
  async function waitForLogin(r) {
    const end = Date.now() + 15 * 60 * 1000;
    let told = false;
    while (Date.now() < end && !r.stop) {
      const t = await tabInfo(r.tabId);
      if (!t) throw new Error('the bank tab was closed');
      if (t.status === 'complete' && t.url?.startsWith(BANK + '/')) {
        const li = await loggedIn(r);
        if (li) return li;
      } else if (!told && t.url && !t.url.startsWith(BANK + '/')) {
        told = true;
        say(r, 'login', 'log in to the bank site in the tab that opened', { job: 'bank' });
      }
      await sleep(1500);
    }
    return null;
  }

  /** A JSON call of the site; throws LOGIN when the session ended. */
  async function siteGet(r, url) {
    const a = await bankAsk(r.tabId, { cmd: 'get', url });
    if (!a) throw new Error('the bank page did not answer');
    if (a.html || a.status === 401 || a.status === 403) throw new Error('LOGIN');
    if (!a.ok) throw new Error(a.error || `the site answered ${a.status}`);
    return a.json;
  }

  /** The transactions of one part: { rows, more } — the rows of the site's answer, and whether the page was full. */
  async function transactionsPart(r, accountId, part) {
    const url = `/ServerServices/current-account/transactions?numItemsPerPage=${PAGE}&sortCode=1&retrievalStartDate=${compact(part.from)}&retrievalEndDate=${compact(part.to)}&accountId=${encodeURIComponent(accountId)}&lang=he`;
    const j = await siteGet(r, url);
    const rows = Array.isArray(j?.transactions) ? j.transactions : Array.isArray(j) ? j : [];
    return { rows, more: rows.length >= PAGE, raw: j };
  }

  /** The rows of a window, splitting a part whose page came back full. */
  async function transactionsOf(r, accountId, from, to, days, sum) {
    let rows = [];
    for (const part of dateParts(from, to, days)) {
      if (r.stop) break;
      const p = await transactionsPart(r, accountId, part);
      sum.calls++;
      if (p.more && days > 1) rows = rows.concat(await transactionsOf(r, accountId, part.from, part.to, Math.max(1, Math.floor(days / 2)), sum));
      else rows = rows.concat(p.rows);
      await sleep(350);
    }
    return rows;
  }

  async function relogin(r, why) {
    say(r, 'login', why || 'the bank session ended — log in again in the bank tab', { job: 'bank' });
    await chrome.tabs.update(r.tabId, { url: START, active: true });
    await settled(r, 20000).catch(() => null);
    const li = await waitForLogin(r);
    if (!li) throw new Error('no login within 15 minutes');
    return li;
  }

  /** The work of one run; `r` = { port, stop, tabId, last }. Always tells Joya how it ended. */
  async function update(r, { runId, plan }) {
    const accounts = plan?.accounts || [];
    const sum = { runId, accounts: accounts.length, newRows: 0, rows: 0, images: 0, imagesSkipped: 0, failed: [], calls: 0, siteAccounts: null, accountIds: {}, stopped: false };
    const prog = (phase, text, extra = {}) => say(r, phase, text, { job: 'bank', summary: sum, ...extra });

    const close = async (why) => {
      sum.stopped = !!r.stop;
      r.stop = false; // the closing message must still go out
      try {
        await toJoya(r, `/bank/sync/${runId}/finish`, { json: { summary: sum, error: why && !sum.newRows && !sum.images ? why : null } });
      } catch (e) {
        why = why || String(e.message || e);
      }
      if (why) prog('error', sum.newRows || sum.images ? `${why} — ${sum.newRows} rows and ${sum.images} pictures were kept` : why);
      else if (sum.stopped) prog('stopped', 'stopped');
      else prog('done', `${sum.newRows} new rows, ${sum.images} cheque pictures`);
    };

    try {
      if (!accounts.length) return close('no bank account is configured (shared/restaurants.json bank_accounts)');
      const tab = await chrome.tabs.create({ url: START, active: true });
      r.tabId = tab.id;
      prog('login', 'log in to the bank site in the tab that opened');
      let li = await waitForLogin(r);
      if (!li) return close(r.stop ? '' : 'no login within 15 minutes');

      for (let i = 0; i < accounts.length && !r.stop; i++) {
        const a = accounts[i];
        const label = a.companyLabel || a.account;
        prog('accounts', `${label}`, { done: i, total: accounts.length });
        // the site's id of this account: the account list, else the ids the page used
        let accountId = null;
        for (let attempt = 0; attempt < 2 && !accountId; attempt++) {
          const w = await bankAsk(r.tabId, { cmd: 'where' });
          sum.siteAccounts = li.accounts?.map((x) => ({ bank: x.bankNumber, branch: x.branchNumber, number: x.accountNumber, id: x.id, closed: x.closed, keys: x.keys })) || null;
          const hit = (li.accounts || []).find((x) => matchesAccount(x, a.account) && x.id);
          accountId = hit?.id || accountIdFor(w?.accountIds || [], a.account);
          if (!accountId && attempt === 0) {
            // make the page call its services once, so an accountId shows in its requests
            await chrome.tabs.update(r.tabId, { url: `${BANK}/ng-portals/biz/he/current-account/transactions` });
            await settled(r);
            await sleep(2500);
          }
        }
        if (!accountId) {
          sum.failed.push(`${a.account}: the site's account id was not found (ids seen: ${((await bankAsk(r.tabId, { cmd: 'where' }))?.accountIds || []).join(', ') || 'none'})`);
          continue;
        }
        sum.accountIds[a.account] = accountId;

        // transactions of the window
        let rows;
        try {
          prog('transactions', `${label} ${a.from} – ${a.to}`, { done: i, total: accounts.length });
          rows = await transactionsOf(r, accountId, a.from, a.to, PART_DAYS, sum);
        } catch (e) {
          if (e.message !== 'LOGIN') throw e;
          li = await relogin(r);
          i--; // the same account again
          continue;
        }
        if (r.stop) break;
        const seen = new Set();
        rows = rows.filter((t) => {
          const k = JSON.stringify([t.eventDate, t.referenceNumber, t.eventAmount, t.eventActivityTypeCode, t.activityTypeCode, t.serialNumber]);
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        sum.rows += rows.length;
        try {
          const out = await toJoya(r, `/bank/sync/${runId}/transactions`, { json: { account: a.account, rows, from: a.from, to: a.to } });
          sum.newRows += out?.newRows || 0;
          a.result = out;
        } catch (e) {
          sum.failed.push(`${a.account}: transactions not stored: ${String(e.message || e).slice(0, 160)}`);
          continue;
        }

        // the cheques without a picture (the admin decides — the rows just stored count)
        let want = [];
        try {
          const c = await toJoya(r, `/bank/sync/${runId}/cheques?account=${encodeURIComponent(a.account)}`);
          want = c?.cheques || [];
          if (c?.reason && !want.length) sum.failed.push(`${a.account}: cheque pictures skipped: ${c.reason}`);
        } catch (e) {
          sum.failed.push(`${a.account}: cheque list: ${String(e.message || e).slice(0, 160)}`);
        }
        // the site is asked for the next picture while Joya / Drive still files the previous one (2026-11-22: ~7 s per
        // cheque when everything ran one after the other)
        let pendingUpload = null;
        const settleUpload = async () => {
          if (!pendingUpload) return;
          const { p, ch } = pendingUpload;
          pendingUpload = null;
          try {
            const out = await p;
            if (out?.skipped) sum.imagesSkipped++;
            else sum.images++;
          } catch (e) {
            sum.failed.push(`cheque ${ch.reference} (${ch.date}): not filed: ${String(e.message || e).slice(0, 120)}`);
          }
        };
        for (let k = 0; k < want.length && !r.stop; k++) {
          const ch = want[k];
          prog('cheques', `${label} ${k + 1}/${want.length}`, { done: i, total: accounts.length });
          try {
            const url = `/ServerServices/current-account/cheques/${encodeURIComponent(ch.reference)}?view=paying&originalEventDate=${compact(ch.date)}&chequeAmount=${encodeURIComponent(ch.amount)}&accountId=${encodeURIComponent(accountId)}&lang=he`;
            const j = await siteGet(r, url);
            const list = Array.isArray(j?.list) ? j.list : Array.isArray(j) ? j : [];
            const link = list[0]?.imageFrontLink || list[0]?.frontImageLink || null;
            if (!link) {
              sum.failed.push(`cheque ${ch.reference} (${ch.date}): the site has no picture`);
              continue;
            }
            const img = await bankAsk(r.tabId, { cmd: 'bytes', url: link });
            if (!img?.ok) {
              if (img?.error && /page, not a picture/.test(img.error)) throw new Error('LOGIN');
              sum.failed.push(`cheque ${ch.reference} (${ch.date}): ${img?.error || 'no picture'}`);
              continue;
            }
            await settleUpload(); // one upload in flight at a time, but it overlaps the next site calls
            pendingUpload = { ch, p: toJoya(r, `/bank/sync/${runId}/cheque-image?account=${encodeURIComponent(a.account)}&date=${ch.date}&reference=${encodeURIComponent(ch.reference)}&amount=${encodeURIComponent(ch.amount)}`, { b64: img.b64, contentType: img.type }) };
          } catch (e) {
            if (e.message === 'LOGIN') {
              await settleUpload();
              li = await relogin(r);
              k--; // the same cheque again
              continue;
            }
            sum.failed.push(`cheque ${ch.reference} (${ch.date}): ${String(e.message || e).slice(0, 120)}`);
          }
          await sleep(250);
        }
        await settleUpload();
      }
    } catch (e) {
      return close(String(e.message || e));
    }
    return close('');
  }

  self.joyaBank = { update, dateParts, accountIdFor, siteAccounts, matchesAccount, accountDigits };
})();
