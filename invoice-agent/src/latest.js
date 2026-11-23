// The latest invoices the agent FOUND, newest first: sorted by the time the agent filed them (filed_at), not by
// the date printed on the invoice. Reads the index.json of every company folder in every target.
//
//   npm run latest                       the last 20
//   npm run latest -- --n 50             the last 50
//   npm run latest -- --days 3           everything found in the last 3 days
//   npm run latest -- --company אן-קור   only companies whose name has these letters (also _unmatched)
//   npm run latest -- --mailbox main     only the main mailbox (or an address: only that mailbox)
//   npm run latest -- --json             the rows as JSON
import { loadTargets } from './config.js';
import { createDrive } from './drive.js';
import { loadClient } from './google.js';

/** Newest found first. Pure, for the tests. */
export function latest(rows, { n = 20, days, company, mailbox, now = Date.now() } = {}) {
  let list = rows.filter((r) => r.filed_at);
  if (company) list = list.filter((r) => r.company.includes(company));
  // mailbox: an address, or "main" for the main mailbox (its rows carry no gmail_account)
  if (mailbox) list = list.filter((r) => (mailbox === 'main' ? !r.gmail_account : r.gmail_account === mailbox.toLowerCase()));
  if (days) list = list.filter((r) => now - Date.parse(r.filed_at) <= days * 86_400_000);
  list.sort((a, b) => Date.parse(b.filed_at) - Date.parse(a.filed_at));
  return days ? list : list.slice(0, n);
}

/** Every row of every index, with its company and target. */
export async function allRows(store, targets) {
  const rows = [];
  for (const t of targets) {
    const rootId = t.folderId ?? (await store.folder(t.folderName));
    for (const f of await store.folders(rootId)) {
      const index = await store.readJson('index.json', f.id);
      for (const r of index?.invoices ?? []) rows.push({ ...r, company: index.company ?? f.name, target: t.name });
    }
  }
  return rows;
}

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const when = (iso) => new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Jerusalem' }).slice(0, 16);
const money = (r) => `${Number(r.total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${r.currency || ''}`.trim();

async function main() {
  const store = createDrive(loadClient());
  const rows = await allRows(store, loadTargets());
  const list = latest(rows, { n: Number(arg('--n') || 20), days: Number(arg('--days') || 0) || undefined, company: arg('--company'), mailbox: arg('--mailbox') });
  if (process.argv.includes('--json')) return console.log(JSON.stringify(list, null, 2));
  console.log(`${list.length} of ${rows.length} invoices, newest found first (Israel time):\n`);
  for (const r of list) {
    const party = r.direction === 'income' ? `to ${r.to || r.party_folder}` : `from ${r.from || r.party_folder}`;
    console.log(`${when(r.filed_at)} | ${r.company} | ${r.direction} | ${party} | no. ${r.number} | ${money(r)} | invoice date ${r.date}${r.gmail_account ? ` | ${r.gmail_account}` : ''}`);
    console.log(`                   https://drive.google.com/file/d/${r.drive_file_id}/view`);
  }
}

if (process.argv[1]?.endsWith('latest.js')) main().then(() => process.exit(0), (e) => { console.error(`STOPPED: ${e.message}`); process.exit(1); });
