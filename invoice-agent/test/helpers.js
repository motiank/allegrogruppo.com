export const companies = [
  { name: 'פרימיום איטליה בע"מ', taxIds: ['515000222'], aliases: ['Premium Italia Ltd'] },
  { name: 'פסטה לינה בע"מ', taxIds: ['515000333'] },
];
export const PDF = Buffer.from('%PDF-1.4\nfake');
export const invoice = (over = {}) => ({ file_id: 'f1', doc_type: 'tax_invoice', from_name: 'Acme Supplies Ltd', from_tax_id: '514000111', to_name: 'Premium Italia Ltd', to_tax_id: '515000222', number: '48213', total: 1170, currency: 'ILS', date: '2026-10-30', allocation_number: '202611223344', ...over });

/** Drive in memory. */
export function fakeStore() {
  const items = new Map(); // id → { name, parent, folder, value }
  let next = 1;
  const add = (o) => { const id = `id${next++}`; items.set(id, o); return id; };
  const findIn = (name, parent) => [...items].find(([, o]) => o.name === name && o.parent === parent)?.[0] ?? null;
  return {
    items,
    paths() {
      const full = (id) => { const o = items.get(id); return o.parent ? `${full(o.parent)}/${o.name}` : o.name; };
      return [...items].filter(([, o]) => !o.folder).map(([id]) => full(id)).sort();
    },
    uploads: 0,
    async folder(name, parent) { return findIn(name, parent) ?? add({ name, parent, folder: true }); },
    async findFile(name, parent) { return findIn(name, parent); },
    async upload(name, parent, mimeType, bytes) { this.uploads++; return add({ name, parent, bytes }); },
    async readJson(name, parent) { const id = findIn(name, parent); return id ? structuredClone(items.get(id).value) : null; },
    async writeJson(name, parent, value) { const id = findIn(name, parent); if (id) items.get(id).value = value; else add({ name, parent, value }); },
  };
}

export const fakeGmail = (email, bytes = PDF) => ({ get: async () => ({ id: 'm1', from: 'a@b.c', to: 'me@x.y', subject: 'Invoice', date: '', text: '', truncated: false, links: [], attachments: [], ...email }), attachment: async () => bytes });
export const pdfAttachment = { name: 'scan.pdf', mimeType: 'application/pdf', size: 5000, attachmentId: 'a1', inline: false };
