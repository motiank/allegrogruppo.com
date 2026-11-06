// Copies one Hashavshevet database into the target. Safe to run again: new rows are added, changed rows are updated with
// their old version in row_history, and rows that left the source are flagged with deleted_at. Nothing is deleted.
//   node src/load.js --company pastalina --name "Pastalina" --snapshot-year 2026 [--production]
import { arg, canonRow, connectSource, connectTarget, hashRow, makeRowKeyer, packJson, rebuildRow, sourceCatalog, sourceQuery, yearOf } from './lib.js';
import { CORE_TABLES, NOT_COPIED } from './mapping.js';

const companyCode = arg('company');
const companyName = arg('name', companyCode);
const snapshotYear = Number(arg('snapshot-year', new Date().getUTCFullYear()));
if (!companyCode) throw new Error('--company is required');

const META = ['first_run_id', 'updated_run_id', 'source_hash'];
const BATCH = 500;

const pool = await connectSource();
const { db, database } = await connectTarget();
await db.query('USE `' + database + '`');

await db.query('INSERT IGNORE INTO companies (code, name) VALUES (?, ?)', [companyCode, companyName]);
const [[{ company_id: companyId }]] = await db.query('SELECT company_id FROM companies WHERE code = ?', [companyCode]);
const sourceLabel = `${process.env.HASH_MSSQL_HOST}/${process.env.HASH_MSSQL_DATABASE}`;
const [{ insertId: runId }] = await db.query('INSERT INTO sync_runs (company_id, snapshot_year, source_label) VALUES (?, ?, ?)',
  [companyId, snapshotYear, sourceLabel]);

const catalog = await sourceCatalog(pool);
const totals = { inserted: 0, updated: 0, flagged: 0, unchanged: 0 };

async function readTable(table) {
  const { recordset } = await sourceQuery(pool, `SELECT * FROM [${table}]`);
  return recordset;
}

// rows: { year, key, values (target columns), extra, hash }
// A row is the same row only with the same company, year and id. IDs can repeat in another year, if a new Hashavshevet
// database restarts them. ownedYears = the years this source holds: a row with the same id in one of those years has moved
// year, and rows in any other year belong to another source and are not touched.
async function syncRows({ sourceTable, target, keyColumns, extraColumn, rows, existingWhere, existingArgs, mapping, scope = {}, ownedYears }) {
  const [existingRows] = await db.query(
    `SELECT fiscal_year, ${keyColumns.map((c) => '`' + c + '`').join(', ')}, source_hash, deleted_at FROM \`${target}\` WHERE ${existingWhere}`,
    existingArgs);
  const keyText = (r) => keyColumns.map((c) => String(r[c])).join('|');
  const id = (year, key) => `${year}|${key}`;
  const owned = existingRows.filter((r) => !ownedYears || ownedYears.has(r.fiscal_year));
  const existing = new Map(owned.map((r) => [id(r.fiscal_year, keyText(r)), r]));
  const incomingIds = new Set(rows.map((r) => id(r.year, r.key)));
  // Rows of the owned years that no source row has in the same year: a new row with the same id means the row moved year.
  const movable = new Map();
  for (const [rowId, r] of existing) if (!incomingIds.has(rowId)) movable.set(keyText(r), r);

  // scope: columns that are part of the row's identity but not of its key text (source_table in source_rows).
  const whereFor = (old) => ({
    where: ['company_id = ?', 'fiscal_year = ?', ...[...Object.keys(scope), ...keyColumns].map((c) => '`' + c + '` = ?')].join(' AND '),
    whereArgs: [companyId, old.fiscal_year, ...Object.values(scope), ...keyColumns.map((c) => old[c])],
  });

  const stats = { inserted: 0, updated: 0, flagged: 0, unchanged: 0 };
  const inserts = [];
  const incoming = new Set();
  const moved = new Set();

  for (const row of rows) {
    const rowId = id(row.year, row.key);
    if (incoming.has(rowId)) throw new Error(`Two source rows have the same key in ${sourceTable}: ${rowId}`);
    incoming.add(rowId);
    const old = existing.get(rowId) || movable.get(row.key);
    if (!old) { inserts.push(row); continue; }
    if (old.fiscal_year !== row.year) { moved.add(id(old.fiscal_year, row.key)); movable.delete(row.key); }
    if (old.source_hash === row.hash && old.fiscal_year === row.year && !old.deleted_at) { stats.unchanged += 1; continue; }

    const { where, whereArgs } = whereFor(old);
    await saveHistory({ sourceTable, target, where, whereArgs, mapping, extraColumn, year: old.fiscal_year, key: row.key,
      change: old.deleted_at ? 'returned' : 'updated' });
    const values = { ...row.values, fiscal_year: row.year, [extraColumn]: JSON.stringify(packJson(row.extra)), source_hash: row.hash,
      updated_run_id: runId, deleted_at: null };
    await db.query(`UPDATE \`${target}\` SET ${Object.keys(values).map((c) => '`' + c + '` = ?').join(', ')} WHERE ${where}`,
      [...Object.values(values), ...whereArgs]);
    stats.updated += 1;
  }

  for (const [rowId, old] of existing) {
    if (incoming.has(rowId) || moved.has(rowId) || old.deleted_at) continue;
    const { where, whereArgs } = whereFor(old);
    await saveHistory({ sourceTable, target, where, whereArgs, mapping, extraColumn, year: old.fiscal_year,
      key: keyText(old), change: 'left_source' });
    await db.query(`UPDATE \`${target}\` SET deleted_at = CURRENT_TIMESTAMP(3), updated_run_id = ? WHERE ${where}`, [runId, ...whereArgs]);
    stats.flagged += 1;
  }

  if (inserts.length) {
    const columns = ['company_id', 'fiscal_year', ...Object.keys(inserts[0].values), extraColumn, ...META];
    for (let i = 0; i < inserts.length; i += BATCH) {
      const chunk = inserts.slice(i, i + BATCH).map((r) => [companyId, r.year, ...Object.values(r.values), JSON.stringify(packJson(r.extra)),
        runId, runId, r.hash]);
      await db.query(`INSERT INTO \`${target}\` (${columns.map((c) => '`' + c + '`').join(', ')}) VALUES ?`, [chunk]);
    }
    stats.inserted = inserts.length;
  }

  await db.query(`INSERT INTO sync_table_audit (sync_run_id, source_table, company_id, fiscal_year, target_table, source_rows,
    inserted_rows, updated_rows, flagged_rows, unchanged_rows) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [runId, sourceTable, companyId, snapshotYear, target, rows.length, stats.inserted, stats.updated, stats.flagged, stats.unchanged]);
  for (const k of Object.keys(totals)) totals[k] += stats[k];
}

async function saveHistory({ sourceTable, target, where, whereArgs, mapping, extraColumn, year, key, change }) {
  // execute() uses the binary protocol: the text protocol of mysql2 rounds DOUBLE values on reading.
  const [[current]] = await db.execute(`SELECT * FROM \`${target}\` WHERE ${where}`, whereArgs);
  const oldRow = mapping ? packJson(rebuildRow(mapping, current)) : current[extraColumn];
  await db.query(`INSERT INTO row_history (company_id, fiscal_year, source_table, row_key, sync_run_id, change_type, old_row)
    VALUES (?, ?, ?, ?, ?, ?, ?)`, [companyId, year, sourceTable, key, runId, change, JSON.stringify(oldRow)]);
}

function toCoreRow(mapping, sourceRow, canon, year) {
  const values = {};
  const extra = { ...canon };
  for (const [column, sourceColumn] of Object.entries(mapping.columns)) {
    let value = canon[sourceColumn] ?? null;
    delete extra[sourceColumn];
    const map = mapping.enums?.[column];
    if (map) {
      if (!(value in map)) throw new Error(`${mapping.source}.${sourceColumn} has unknown value ${value}`);
      value = map[value];
    }
    values[column] = value;
  }
  const key = mapping.key.map((c) => String(values[c])).join('|');
  return { year, key, values, extra, hash: hashRow(canon) };
}

try {
  const coreBySource = new Map(CORE_TABLES.map((m) => [m.source, m]));
  for (const m of CORE_TABLES) if (!catalog.has(m.source)) throw new Error(`Source table ${m.source} is missing`);

  // Clean tables with their own date first, so the years are known for child rows and master copies.
  const read = new Map();
  const parentYears = new Map();
  const years = new Set([snapshotYear]);
  const transactional = CORE_TABLES.filter((m) => m.year !== 'master');
  for (const m of transactional) {
    const rows = await readTable(m.source);
    const prepared = rows.map((r) => {
      const canon = canonRow(r, m.source);
      let year;
      if (typeof m.year === 'string') year = yearOf(r[m.year], snapshotYear);
      else {
        year = parentYears.get(m.year.parent)?.get(r[m.year.via]);
        if (year === undefined) throw new Error(`${m.source} row points to missing parent ${r[m.year.via]}`);
      }
      years.add(year);
      return toCoreRow(m, r, canon, year);
    });
    read.set(m.source, prepared);
    parentYears.set(m.target, new Map(prepared.map((p) => [p.values[m.key[0]], p.year])));
  }

  for (const year of years) await db.query('INSERT IGNORE INTO fiscal_years (company_id, fiscal_year) VALUES (?, ?)', [companyId, year]);
  const [open] = await db.query("SELECT fiscal_year FROM fiscal_years WHERE company_id = ? AND status = 'open'", [companyId]);
  const openYears = open.map((r) => r.fiscal_year).filter((year) => years.has(year));

  // The years of this source, with the years it held in earlier runs (a year can lose its last row).
  const [earlier] = await db.query("SELECT source_years FROM sync_runs WHERE company_id = ? AND source_label = ? AND status = 'done'", [companyId, sourceLabel]);
  const ownedYears = new Set([...years, ...earlier.flatMap((r) => r.source_years || [])]);
  await db.query('UPDATE sync_runs SET source_years = ? WHERE sync_run_id = ?', [JSON.stringify([...ownedYears].sort()), runId]);

  for (const m of CORE_TABLES.filter((t) => t.year === 'master')) {
    const rows = await readTable(m.source);
    const prepared = openYears.flatMap((year) => rows.map((r) => toCoreRow(m, r, canonRow(r, m.source), year)));
    await syncRows({ sourceTable: m.source, target: m.target, keyColumns: m.key, extraColumn: 'extra', mapping: m,
      rows: prepared, existingWhere: `company_id = ? AND fiscal_year IN (${openYears.join(',')})`, existingArgs: [companyId] });
    console.log(m.source, '->', m.target, prepared.length);
  }
  for (const m of transactional) {
    await syncRows({ sourceTable: m.source, target: m.target, keyColumns: m.key, extraColumn: 'extra', mapping: m, ownedYears,
      rows: read.get(m.source), existingWhere: 'company_id = ?', existingArgs: [companyId] });
    console.log(m.source, '->', m.target, read.get(m.source).length);
  }

  // All other tables, including empty ones (they cost nothing and their rows are picked up if they ever fill).
  for (const [table, columns] of catalog) {
    if (coreBySource.has(table)) continue;
    const keyer = makeRowKeyer(columns);
    const rows = (await readTable(table)).map((r) => {
      const canon = canonRow(r, table);
      const hash = hashRow(canon);
      const key = keyer(r, hash);
      return { year: snapshotYear, key, hash, extra: canon, values: { source_table: table, row_key: key } };
    });
    await syncRows({ sourceTable: table, target: 'source_rows', keyColumns: ['row_key'], extraColumn: 'data', rows,
      scope: { source_table: table },
      existingWhere: 'company_id = ? AND fiscal_year = ? AND source_table = ?', existingArgs: [companyId, snapshotYear, table] });
  }

  // The column catalog: where each source column went.
  const catalogRows = [];
  for (const [table, columns] of catalog) {
    const mapping = coreBySource.get(table);
    const reverse = new Map(Object.entries(mapping?.columns || {}).map(([to, from]) => [from, to]));
    for (const c of columns) {
      const left = NOT_COPIED[table]?.includes(c.col);
      catalogRows.push([companyId, snapshotYear, table, c.col, c.ordinal, c.data_type, c.max_length, c.is_nullable ? 1 : 0, c.is_pk, c.is_identity ? 1 : 0,
        left ? 'not_copied' : mapping?.target || 'source_rows', left ? 'none' : reverse.get(c.col) || (mapping ? 'extra' : 'data')]);
    }
  }
  for (let i = 0; i < catalogRows.length; i += BATCH) {
    await db.query(`REPLACE INTO source_columns (company_id, fiscal_year, source_table, column_name, ordinal, data_type, max_length,
      is_nullable, is_primary_key, is_identity, target_table, target_column) VALUES ?`, [catalogRows.slice(i, i + BATCH)]);
  }

  await db.query("UPDATE sync_runs SET status = 'done', finished_at = CURRENT_TIMESTAMP(3) WHERE sync_run_id = ?", [runId]);
  console.log('run', runId, 'done', totals, 'years', [...years].sort());
} catch (error) {
  await db.query("UPDATE sync_runs SET status = 'failed', finished_at = CURRENT_TIMESTAMP(3), error_text = ? WHERE sync_run_id = ?",
    [String(error.stack || error).slice(0, 4000), runId]);
  throw error;
} finally {
  await pool.close();
  await db.end();
}
