// Downloads a link from an email. The link comes from outside, so this is careful:
// public web addresses only (never this machine or its network), a size limit, a time limit.
import dns from 'dns';
import net from 'net';
import { Agent, fetch } from 'undici';
import { cleanLinks, htmlToText } from './gmail.js';

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 30_000;
const PAGE_TEXT_LIMIT = 20_000;

const blocked = new net.BlockList();
for (const [a, n] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]]) blocked.addSubnet(a, n, 'ipv4');
for (const [a, n] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) blocked.addSubnet(a, n, 'ipv6');

export function isPrivate(ip) {
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return blocked.check(mapped[1], 'ipv4');
  const family = net.isIP(ip);
  if (!family) return true;
  return blocked.check(ip, family === 4 ? 'ipv4' : 'ipv6') || (family === 6 && /^::ffff:/i.test(ip));
}

// The check runs at connect time, on the address really used, so a name cannot change after it was checked.
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, options, (err, address, family) => {
    if (err) return callback(err);
    const list = Array.isArray(address) ? address : [{ address, family }];
    const bad = list.find((a) => isPrivate(a.address));
    if (bad) return callback(new Error(`blocked private address for ${hostname}`));
    callback(null, address, family);
  });
}
const dispatcher = new Agent({ connect: { lookup: safeLookup, timeout: 10_000 } });

function checkUrl(raw) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('only http and https links are allowed');
  if (url.username || url.password) throw new Error('links with a login inside are not allowed');
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('only the normal web ports are allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && isPrivate(host)) throw new Error('blocked private address');
  if (/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)) throw new Error('blocked private address');
  return url;
}

async function readLimited(res) {
  const chunks = [];
  let size = 0;
  for await (const c of res.body) {
    size += c.length;
    if (size > MAX_BYTES) throw new Error('the file is too large');
    chunks.push(Buffer.from(c));
  }
  return Buffer.concat(chunks);
}

function fileNameOf(res, url) {
  const cd = res.headers.get('content-disposition') ?? '';
  const star = cd.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  if (star) { try { return decodeURIComponent(star[1].replace(/"/g, '').trim()); } catch { /* use the next form */ } }
  const plain = cd.match(/filename="?([^";]+)"?/i);
  if (plain) return plain[1].trim();
  return decodeURIComponent(url.pathname.split('/').pop() || 'download');
}

/** @returns {{ type:'file', name, bytes } | { type:'page', url, text, links }} */
export async function fetchLink(raw) {
  let url = checkUrl(raw);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(url, { dispatcher, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'user-agent': 'invoice-agent/1.0' } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      await res.body?.cancel();
      url = checkUrl(new URL(res.headers.get('location'), url).href);
      continue;
    }
    if (!res.ok) { await res.body?.cancel(); throw new Error(`the site answered ${res.status}`); }
    const type = res.headers.get('content-type') ?? '';
    const bytes = await readLimited(res);
    if (/text\/html|application\/xhtml/i.test(type) && !/attachment/i.test(res.headers.get('content-disposition') ?? '')) {
      const page = htmlToText(bytes.toString('utf8'));
      return { type: 'page', url: url.href, text: page.text.slice(0, PAGE_TEXT_LIMIT), links: cleanLinks(page.links, url.href) };
    }
    let name = fileNameOf(res, url);
    if (!/\.\w{2,5}$/.test(name) && /pdf/i.test(type)) name += '.pdf';
    return { type: 'file', name, bytes };
  }
  throw new Error('too many redirects');
}
