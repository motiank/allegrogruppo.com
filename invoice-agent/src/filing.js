// Where an invoice goes in Drive, and the filing itself.
//   <root>/<company>/index.json
//   <root>/<company>/income/<customer>/<number>.pdf
//   <root>/<company>/expense/<supplier>/<number>.pdf
// An invoice between two of our companies is filed twice: income for one, expense for the other.
export const UNMATCHED = '_unmatched';

const digits = (s) => String(s ?? '').replace(/\D/g, '').replace(/^0+/, '');
const plainName = (s) => String(s ?? '').toLowerCase().replace(/בע["'״׳]?מ|\bltd\.?|\binc\.?|\bllc\b/g, '').replace(/["'״׳.,\-\s]/g, '');

export const safeName = (s) => String(s).replace(/"/g, '״').replace(/[\\/:*?<>|\u0000-\u001f]/g, '-').replace(/^\.+/, '').replace(/\s+/g, ' ').trim().slice(0, 100);

export function findCompany(name, taxId, companies) {
  const id = digits(taxId);
  if (id) {
    const hit = companies.find((c) => (c.taxIds ?? []).some((t) => digits(t) === id));
    if (hit) return hit;
  }
  // The name may have a branch added: פסטה לינה בע"מ (ג'ויה רום רמת החייל).
  const n = plainName(name);
  // taxIdOnly: the company's name is also a branch name of another company, so only its tax id counts.
  return n ? companies.find((c) => !c.taxIdOnly && [c.name, ...(c.aliases ?? [])].some((a) => plainName(a).length >= 5 && n.includes(plainName(a)))) : undefined;
}

export function route(inv, companies) {
  const seller = findCompany(inv.from_name, inv.from_tax_id, companies);
  const buyer = findCompany(inv.to_name, inv.to_tax_id, companies);
  const out = [];
  if (seller) out.push({ company: seller.name, direction: 'income', party: inv.to_name, partyTaxId: inv.to_tax_id });
  if (buyer) out.push({ company: buyer.name, direction: 'expense', party: inv.from_name, partyTaxId: inv.from_tax_id });
  if (!out.length) out.push({ company: UNMATCHED, direction: 'expense', party: inv.from_name, partyTaxId: inv.from_tax_id });
  return out;
}

/** Why an invoice must not be filed, or null if it is fine. */
export function problem(inv, files) {
  if (!safeName(inv.number)) return 'no invoice number';
  if (!inv.from_name && !inv.from_tax_id) return 'no issuer';
  if (!Number.isFinite(inv.total) || inv.total === 0) return 'no total';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inv.date)) return `bad date "${inv.date}"`;
  if (!files.some((f) => f.id === inv.file_id)) return `unknown file "${inv.file_id}"`;
  return null;
}

/** Files one invoice in one place. Safe to repeat after a crash: nothing is filed twice. */
export async function fileInvoice({ store, rootId, place, inv, file, email }) {
  const companyId = await store.folder(safeName(place.company), rootId);
  const index = (await store.readJson('index.json', companyId)) ?? { company: place.company, invoices: [] };
  const taxId = digits(place.partyTaxId);
  const known = taxId ? index.invoices.find((i) => i.direction === place.direction && digits(i.party_tax_id) === taxId) : null;
  const party = known?.party_folder ?? (safeName(place.party || place.partyTaxId) || 'unknown');
  const number = safeName(inv.number);

  if (index.invoices.some((i) => i.direction === place.direction && i.party_folder === party && i.number === number)) return { duplicate: true, company: place.company, number };

  const directionId = await store.folder(place.direction, companyId);
  const partyId = await store.folder(party, directionId);
  const name = `${number}.${file.ext || 'pdf'}`;
  const fileId = (await store.findFile(name, partyId)) ?? (await store.upload(name, partyId, file.mimeType, file.bytes));

  index.invoices.push({
    direction: place.direction,
    party_folder: party,
    party_tax_id: place.partyTaxId,
    from: inv.from_name,
    from_tax_id: inv.from_tax_id,
    to: inv.to_name,
    to_tax_id: inv.to_tax_id,
    number,
    doc_type: inv.doc_type,
    total: inv.total,
    currency: inv.currency,
    date: inv.date,
    allocation_number: inv.allocation_number,
    file: `${place.direction}/${party}/${name}`,
    drive_file_id: fileId,
    gmail_message_id: email.id,
    ...(email.account ? { gmail_account: email.account } : {}),
    filed_at: new Date().toISOString(),
  });
  index.updated_at = new Date().toISOString();
  // The Allegro admin writes a `books` flag into the rows (matched with Hashavshevet or not; admin
  // /finance/invoices/drive-check). It may have done so while this email was read: take its flags from the
  // current copy before writing, so they are not lost. The agent itself never sets or changes `books`.
  const current = await store.readJson('index.json', companyId);
  if (current?.invoices) {
    const flags = new Map(current.invoices.filter((i) => i.books && i.drive_file_id).map((i) => [i.drive_file_id, i.books]));
    for (const i of index.invoices) if (!i.books && flags.has(i.drive_file_id)) i.books = flags.get(i.drive_file_id);
    if (current.books_checked_at && !index.books_checked_at) index.books_checked_at = current.books_checked_at;
  }
  await store.writeJson('index.json', companyId, index);
  return { duplicate: false, company: place.company, number };
}
