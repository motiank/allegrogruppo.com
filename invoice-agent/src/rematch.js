// After a company is added to config/companies.json: moves its invoices out of _unmatched into the company's
// folders and index.json. Nothing is read again from Gmail and Claude is not used: the rows already hold the
// names and tax ids. Safe to repeat.
//
//   npm run rematch -- --dry-run     what would move
//   npm run rematch                  move
import { google } from 'googleapis';
import { loadCompanies, loadTargets, paths } from './config.js';
import { createDrive } from './drive.js';
import { route, safeName, UNMATCHED } from './filing.js';
import { loadClient } from './google.js';
import { freeLock, takeLock } from './state.js';
import { openTargets } from './targets.js';

const digits = (s) => String(s ?? '').replace(/\D/g, '').replace(/^0+/, '');
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** Where each _unmatched row goes now. Rows that still match no company stay. Pure, for the tests. */
export function plan(rows, companies) {
  const moves = [];
  const stay = [];
  for (const row of rows) {
    const places = route({ from_name: row.from, from_tax_id: row.from_tax_id, to_name: row.to, to_tax_id: row.to_tax_id }, companies).filter((p) => p.company !== UNMATCHED);
    if (places.length) moves.push({ row, places }); else stay.push(row);
  }
  return { moves, stay };
}

/** The row as it is written in the company's index. Keeps the same party folder for a known tax id. */
export function placeRow(row, place, index) {
  const taxId = digits(place.partyTaxId);
  const known = taxId ? index.invoices.find((i) => i.direction === place.direction && digits(i.party_tax_id) === taxId) : null;
  const party = known?.party_folder ?? (safeName(place.party || place.partyTaxId) || 'unknown');
  const name = row.file.split('/').pop();
  const duplicate = index.invoices.some((i) => i.direction === place.direction && i.party_folder === party && i.number === row.number);
  const { books, ...rest } = row; // the books flag belongs to a company's books: the admin checks the row again
  return { duplicate, party, name, row: { ...rest, direction: place.direction, party_folder: party, party_tax_id: place.partyTaxId, file: `${place.direction}/${party}/${name}` } };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const companies = loadCompanies();
  const auth = loadClient();
  const store = createDrive(auth);
  const api = google.drive({ version: 'v3', auth }).files;
  const rootOf = await openTargets({ store, companies, targets: loadTargets() });
  const unmatchedId = await store.folder(UNMATCHED, rootOf(UNMATCHED));

  if (!dryRun) while (!takeLock(paths.lock)) await sleep(5_000);
  try {
    const unmatched = (await store.readJson('index.json', unmatchedId)) ?? { invoices: [] };
    const { moves, stay } = plan(unmatched.invoices, companies);
    const count = {};
    for (const m of moves) for (const p of m.places) count[`${p.company} / ${p.direction}`] = (count[`${p.company} / ${p.direction}`] ?? 0) + 1;
    console.log(`${unmatched.invoices.length} rows in ${UNMATCHED}: ${moves.length} belong to a company now, ${stay.length} stay.`, count);
    if (dryRun || !moves.length) return;

    const indexes = new Map(); // company → { id, index }
    const open = async (company) => {
      if (!indexes.has(company)) {
        const id = await store.folder(safeName(company), rootOf(company)); // the company's own Drive folder (config/targets.json)
        indexes.set(company, { id, index: (await store.readJson('index.json', id)) ?? { company, invoices: [] } });
      }
      return indexes.get(company);
    };
    let moved = 0;
    let dup = 0;
    const done = new Set();
    try {
      for (const { row, places } of moves) {
        let fileUsed = false;
        for (const place of places) {
          const { id: companyId, index } = await open(place.company);
          const placed = placeRow(row, place, index);
          if (placed.duplicate) { dup++; continue; }
          const partyId = await store.folder(placed.party, await store.folder(place.direction, companyId));
          let fileId = row.drive_file_id;
          if (!fileUsed) {
            const { data } = await api.get({ fileId, fields: 'parents' });
            await api.update({ fileId, addParents: partyId, removeParents: (data.parents ?? []).join(','), fields: 'id' });
            fileUsed = true;
          } else {
            fileId = (await api.copy({ fileId, requestBody: { name: placed.name, parents: [partyId] }, fields: 'id' })).data.id; // between two of our companies
          }
          index.invoices.push({ ...placed.row, drive_file_id: fileId });
          index.updated_at = new Date().toISOString();
          moved++;
        }
        // Already in the company's folder from another email: the copy in _unmatched is not needed.
        if (!fileUsed) await api.update({ fileId: row.drive_file_id, requestBody: { trashed: true } }).catch(() => {});
        done.add(row);
        if (done.size % 25 === 0) console.log(`  ${done.size} of ${moves.length}`);
      }
    } finally {
      // Written also after a failure in the middle, so the indexes always say where the files are.
      for (const { id, index } of indexes.values()) await store.writeJson('index.json', id, index);
      unmatched.invoices = unmatched.invoices.filter((r) => !done.has(r));
      unmatched.updated_at = new Date().toISOString();
      await store.writeJson('index.json', unmatchedId, unmatched);
    }
    console.log(`done: ${moved} filed in the companies' folders, ${dup} were already there, ${unmatched.invoices.length} rows left in ${UNMATCHED}.`);
  } finally {
    freeLock(paths.lock);
  }
}

if (process.argv[1]?.endsWith('rematch.js')) main().then(() => process.exit(0), (e) => { console.error(`STOPPED: ${e.message}`); process.exit(1); });
