// Proves that nothing was dropped: it reads every source row again and compares it with the row rebuilt from the target.
//   node src/verify.js --company pastalina --snapshot-year 2026 [--production]
import { arg, canonRow, connectSource, connectTarget, hashRow, rebuildRow, sourceCatalog, sourceQuery, unpackJson } from './lib.js';
import { CORE_TABLES } from './mapping.js';

const companyCode = arg('company');
const snapshotYear = Number(arg('snapshot-year', new Date().getUTCFullYear()));

const pool = await connectSource();
const { db, database } = await connectTarget();
await db.query('USE `' + database + '`');
const [[{ company_id: companyId }]] = await db.query('SELECT company_id FROM companies WHERE code = ?', [companyCode]);
// Only the years of this source: another source of the same company can hold other years, with the same ids.
const [[lastRun]] = await db.query("SELECT source_years FROM sync_runs WHERE company_id = ? AND status = 'done' ORDER BY sync_run_id DESC LIMIT 1", [companyId]);
if (!lastRun) throw new Error('No finished load to verify');
const ownedYears = lastRun.source_years;
const inYears = `fiscal_year IN (${ownedYears.map(Number).join(',')})`;
const [open] = await db.query(`SELECT fiscal_year FROM fiscal_years WHERE company_id = ? AND status = 'open' AND ${inYears}`, [companyId]);
const copies = open.length;

const counter = (rows) => { const m = new Map(); for (const h of rows) m.set(h, (m.get(h) || 0) + 1); return m; };
const failures = [];
let tablesChecked = 0; let rowsChecked = 0;

const catalog = await sourceCatalog(pool);
const coreBySource = new Map(CORE_TABLES.map((m) => [m.source, m]));

for (const [table] of catalog) {
  const { recordset } = await sourceQuery(pool, `SELECT * FROM [${table}]`);
  const sourceHashes = recordset.map((r) => hashRow(canonRow(r, table)));
  const mapping = coreBySource.get(table);
  let targetHashes;
  if (mapping) {
    // execute() uses the binary protocol: the text protocol of mysql2 rounds DOUBLE values on reading.
    const [rows] = await db.execute(`SELECT * FROM \`${mapping.target}\` WHERE company_id = ? AND ${inYears} AND deleted_at IS NULL`, [companyId]);
    targetHashes = rows.map((r) => hashRow(rebuildRow(mapping, r)));
  } else {
    const [rows] = await db.query('SELECT data FROM source_rows WHERE company_id = ? AND fiscal_year = ? AND source_table = ? AND deleted_at IS NULL',
      [companyId, snapshotYear, table]);
    targetHashes = rows.map((r) => hashRow(unpackJson(r.data)));
  }
  const expected = mapping?.year === 'master' ? copies : 1;
  const source = counter(sourceHashes);
  const target = counter(targetHashes);
  let bad = 0;
  for (const [hash, n] of source) if (target.get(hash) !== n * expected) bad += 1;
  for (const hash of target.keys()) if (!source.has(hash)) bad += 1;
  if (bad || targetHashes.length !== sourceHashes.length * expected) {
    failures.push(`${table}: source ${sourceHashes.length} x${expected}, target ${targetHashes.length}, different ${bad}`);
  }
  tablesChecked += 1; rowsChecked += sourceHashes.length;
}

console.log(`Tables checked: ${tablesChecked}. Source rows compared: ${rowsChecked}. Tables with differences: ${failures.length}`);
for (const f of failures.slice(0, 30)) console.log('  FAIL', f);

const [[columns]] = await db.query('SELECT COUNT(*) n FROM source_columns WHERE company_id = ? AND fiscal_year = ?', [companyId, snapshotYear]);
const sourceColumns = [...catalog.values()].reduce((sum, c) => sum + c.length, 0);
console.log(`Columns in catalog: ${columns.n}, in source: ${sourceColumns}`);

await pool.close();
await db.end();
process.exit(failures.length || columns.n !== sourceColumns ? 1 : 0);
