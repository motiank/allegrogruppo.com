import { Readable } from 'stream';
import { google } from 'googleapis';

const FOLDER = 'application/vnd.google-apps.folder';
const quote = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

export function createDrive(auth) {
  const api = google.drive({ version: 'v3', auth }).files;
  const folders = new Map();
  const find = async (q) => (await api.list({ q: `${q} and trashed=false`, fields: 'files(id)', pageSize: 1 })).data.files?.[0]?.id ?? null;
  const media = (mimeType, bytes) => ({ mimeType, body: Readable.from([bytes]) });

  const store = {
    /** With no parent: the main folder, found wherever the user moved it. */
    async folder(name, parentId) {
      const key = `${parentId ?? ''}/${name}`;
      if (folders.has(key)) return folders.get(key);
      const inParent = parentId ? ` and ${quote(parentId)} in parents` : '';
      let id = await find(`name=${quote(name)} and mimeType='${FOLDER}'${inParent}`);
      if (!id) id = (await api.create({ requestBody: { name, mimeType: FOLDER, parents: parentId ? [parentId] : undefined }, fields: 'id' })).data.id;
      folders.set(key, id);
      return id;
    },
    /** The folders inside a folder (only those this app made). */
    async folders(parentId) {
      const out = [];
      let pageToken;
      do {
        const { data } = await api.list({ q: `${quote(parentId)} in parents and mimeType='${FOLDER}' and trashed=false`, fields: 'nextPageToken, files(id,name)', pageSize: 200, pageToken });
        out.push(...(data.files ?? []));
        pageToken = data.nextPageToken;
      } while (pageToken);
      return out;
    },
    findFile: (name, parentId) => find(`name=${quote(name)} and ${quote(parentId)} in parents`),
    async upload(name, parentId, mimeType, bytes) {
      return (await api.create({ requestBody: { name, parents: [parentId] }, media: media(mimeType, bytes), fields: 'id' })).data.id;
    },
    async readJson(name, parentId) {
      const id = await store.findFile(name, parentId);
      if (!id) return null;
      return (await api.get({ fileId: id, alt: 'media' }, { responseType: 'json' })).data;
    },
    async writeJson(name, parentId, value) {
      const bytes = Buffer.from(JSON.stringify(value, null, 2));
      const id = await store.findFile(name, parentId);
      if (id) await api.update({ fileId: id, media: media('application/json', bytes) });
      else await store.upload(name, parentId, 'application/json', bytes);
    },
  };
  return store;
}
