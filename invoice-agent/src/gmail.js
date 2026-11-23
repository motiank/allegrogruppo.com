import { google } from 'googleapis';
import { parse } from 'node-html-parser';

const BODY_LIMIT = 60_000;
const MAX_LINKS = 40;
const SKIP_LINK = /unsubscribe|opt-?out|הסר|הסרה|mailto:|tel:/i;

const decode = (data) => Buffer.from(data ?? '', 'base64url');

/** Plain text and links of an HTML body. */
export function htmlToText(html) {
  const doc = parse(html);
  doc.querySelectorAll('style,script,head').forEach((n) => n.remove());
  const links = doc.querySelectorAll('a[href]').map((a) => ({ url: a.getAttribute('href')?.trim(), text: a.text.replace(/\s+/g, ' ').trim().slice(0, 120) }));
  return { text: doc.structuredText, links };
}

/** Keeps web links only: no duplicates, no unsubscribe links. */
export function cleanLinks(links, baseUrl) {
  const seen = new Set();
  const out = [];
  for (const l of links) {
    let url;
    try { url = new URL(l.url, baseUrl).href; } catch { continue; }
    if (!/^https?:/i.test(url) || SKIP_LINK.test(url) || SKIP_LINK.test(l.text ?? '') || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, text: l.text ?? '' });
    if (out.length === MAX_LINKS) break;
  }
  return out;
}

/** A Gmail API message (format=full) → the fields this project needs. */
export function parseMessage(msg) {
  const headers = Object.fromEntries((msg.payload?.headers ?? []).map((h) => [h.name.toLowerCase(), h.value]));
  const plain = [];
  const html = [];
  const attachments = [];
  const walk = (part) => {
    if (part.filename && part.body?.attachmentId) {
      const disposition = (part.headers ?? []).find((h) => h.name.toLowerCase() === 'content-disposition')?.value ?? '';
      attachments.push({ name: part.filename, mimeType: part.mimeType, size: part.body.size, attachmentId: part.body.attachmentId, inline: /^inline/i.test(disposition) });
    } else if (part.mimeType === 'text/plain' && part.body?.data) plain.push(decode(part.body.data).toString('utf8'));
    else if (part.mimeType === 'text/html' && part.body?.data) html.push(decode(part.body.data).toString('utf8'));
    (part.parts ?? []).forEach(walk);
  };
  if (msg.payload) walk(msg.payload);

  const fromHtml = html.map(htmlToText);
  const text = (fromHtml.length ? fromHtml.map((h) => h.text) : plain).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const bare = [...plain.join('\n').matchAll(/https?:\/\/[^\s<>"')\]]+/g)].map((m) => ({ url: m[0], text: '' }));
  return {
    id: msg.id,
    from: headers.from ?? '',
    to: headers.to ?? '',
    subject: headers.subject ?? '',
    date: headers.date ?? '',
    text: text.slice(0, BODY_LIMIT),
    truncated: text.length > BODY_LIMIT,
    links: cleanLinks([...fromHtml.flatMap((h) => h.links), ...bare]),
    attachments,
  };
}

export function createGmail(auth) {
  const api = google.gmail({ version: 'v1', auth }).users;
  return {
    /** Message ids for the search, newest first, one page at a time. */
    async *list(q) {
      let pageToken;
      do {
        const { data } = await api.messages.list({ userId: 'me', q, maxResults: 200, pageToken });
        for (const m of data.messages ?? []) yield m.id;
        pageToken = data.nextPageToken;
      } while (pageToken);
    },
    async get(id) {
      const { data } = await api.messages.get({ userId: 'me', id, format: 'full' });
      return parseMessage(data);
    },
    async attachment(messageId, attachmentId) {
      const { data } = await api.messages.attachments.get({ userId: 'me', messageId, id: attachmentId });
      return decode(data.data);
    },
  };
}
