// Checks the settings in .env: connects to the Hashavshevet SQL Server and to the MySQL target and prints what it finds.
// Exit code 0 means both connections work. For each failure it prints a hint about the usual cause.
//   node src/check.js [--production]
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, connectSource, connectTarget } from './lib.js';

const env = process.env;
let failed = false;

// How the settings file was read. The password is never printed, only its length.
// dotenv cuts an unquoted value at the first #, and turns \n inside double quotes into a line break, so a password
// with such characters must be written in single quotes: HASH_MSSQL_PASSWORD='pa#ss'
function checkEnvFile() {
  const file = env.HASH_ENV_FILE || join(ROOT, '.env');
  console.log(`Settings file ${file}`);
  if (!existsSync(file)) return console.log('WARNING The settings file does not exist. Copy .env.example to .env and fill it in.');
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  for (const key of ['HASH_MSSQL_PASSWORD', 'TARGET_DB_PASSWORD']) {
    const line = lines.find((l) => l.trim().startsWith(`${key}=`));
    const parsed = env[key] || '';
    if (!line) { console.log(`WARNING ${key} is not in the file`); continue; }
    let raw = line.slice(line.indexOf('=') + 1).trim();
    const quoted = /^(['"]).*\1$/.test(raw);
    if (quoted) raw = raw.slice(1, -1);
    if (!parsed) console.log(`WARNING ${key} is empty`);
    else if (raw !== parsed) {
      console.log(`WARNING ${key}: the file has ${raw.length} characters but ${parsed.length} were read` +
        (raw.includes('#') && !quoted ? ' (the # starts a comment)' : '') + `. Write the password in single quotes: ${key}='...'`);
    } else console.log(`        ${key}: ${parsed.length} characters${quoted ? ' (quoted)' : ''}`);
  }
}

function hint(error, hints) {
  const text = `${error.code || ''} ${error.message || error}`;
  for (const [pattern, advice] of hints) if (pattern.test(text)) return advice;
  return null;
}

function fail(what, error, hints) {
  failed = true;
  console.log(`FAILED  ${what}: ${error.message || error}`);
  const advice = hint(error, hints);
  if (advice) console.log(`        Hint: ${advice}`);
}

async function checkSource() {
  const where = env.HASH_MSSQL_INSTANCE ? `${env.HASH_MSSQL_HOST}\\${env.HASH_MSSQL_INSTANCE}` : `${env.HASH_MSSQL_HOST}:${env.HASH_MSSQL_PORT || 1433}`;
  console.log(`\nSQL Server ${where}, database ${env.HASH_MSSQL_DATABASE}, user ${env.HASH_MSSQL_USER}`);
  let pool;
  try {
    pool = await connectSource();
    const version = (await pool.request().query('SELECT @@VERSION AS v')).recordset[0].v.split('\n')[0].trim();
    const count = (await pool.request().query('SELECT COUNT(*) AS n FROM JurnalTrans')).recordset[0].n;
    const dbs = (await pool.request().query('SELECT name FROM sys.databases WHERE database_id > 4 ORDER BY name')).recordset.map((r) => r.name);
    console.log(`OK      ${version}`);
    console.log(`OK      ${count} journal entries in ${env.HASH_MSSQL_DATABASE}`);
    console.log(`        Databases on this server: ${dbs.join(', ')}`);
  } catch (error) {
    fail('SQL Server', error, [
      [/EINSTLOOKUP|instance/i, 'The instance name was not found. Check HASH_MSSQL_INSTANCE and start the "SQL Server Browser" service, or set HASH_MSSQL_INSTANCE empty and HASH_MSSQL_PORT to the fixed port of the instance.'],
      [/ELOGIN|Login failed for user/i, 'The SQL Server answered, but refused the user and password. (1) Each instance has its own sa password: '
        + 'HASH_MSSQL_INSTANCE / HASH_MSSQL_PORT must point at the same instance you connect to from the other computer (there: SELECT @@SERVERNAME; '
        + 'the port: SELECT local_tcp_port FROM sys.dm_exec_connections WHERE session_id = @@SPID). (2) See the password WARNING above, if any: '
        + 'a password with # or quotes must be in single quotes. (3) The real reason is in the SQL Server error log (Management Studio > Management > '
        + 'SQL Server Logs: "Reason: Password did not match" or "Not associated with a trusted SQL Server connection" = Windows logins only).'],
      [/Cannot open database/i, 'The database name is wrong. The list of databases is printed when the login works; try HASH_MSSQL_DATABASE=master to see it.'],
      [/ESOCKET|ETIMEOUT|ECONNREFUSED|ENOTFOUND/i, 'The server does not answer. Enable TCP/IP for the instance in "SQL Server Configuration Manager" > SQL Server Network Configuration > Protocols, restart the SQL Server service, and check HASH_MSSQL_HOST.'],
      [/ECONNRESET|handshake|TLS|ssl|wrong version|protocol/i, 'The server may be an old SQL Server without TLS 1.2. Set HASH_MSSQL_OLD_TLS=1 in .env and try again.'],
      [/Invalid object name 'JurnalTrans'/i, 'The database exists but it is not a Hashavshevet company database. Check HASH_MSSQL_DATABASE (the list above shows the names).'],
    ]);
  } finally {
    await pool?.close();
  }
}

async function checkTarget() {
  console.log(`\nMySQL ${env.TARGET_DB_HOST}:${env.TARGET_DB_PORT || 3306}, database ${env.TARGET_DB_NAME}, user ${env.TARGET_DB_USER}${env.TARGET_DB_SSL_CA ? `, CA ${env.TARGET_DB_SSL_CA}` : ''}`);
  let db;
  try {
    let database;
    ({ db, database } = await connectTarget());
    const [[{ v }]] = await db.query('SELECT VERSION() AS v');
    console.log(`OK      MySQL ${v}`);
    // The connection selects no database (the scripts name it in every query), so the database is checked by name.
    const [[{ exists }]] = await db.query('SELECT COUNT(*) AS `exists` FROM information_schema.schemata WHERE schema_name = ?', [database]);
    const [[{ n }]] = await db.query('SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ?', [database]);
    if (!exists) {
      console.log(`WARNING The database ${database} does not exist on this server. Production uses allegro_finance; check TARGET_DB_NAME. "npm run schema" creates a new one.`);
    } else if (!n) {
      console.log(`WARNING The database ${database} is empty. Run "npm run schema" once to create the tables.`);
    } else {
      const [rows] = await db.query(
        `SELECT c.code, r.snapshot_year, r.status, r.started_at FROM ${database}.sync_runs r JOIN ${database}.companies c USING (company_id) ORDER BY r.sync_run_id DESC LIMIT 3`);
      console.log(`OK      ${n} tables and views`);
      for (const r of rows) console.log(`        last run: ${r.code} ${r.snapshot_year} ${r.status} ${r.started_at}`);
      if (!rows.length) console.log('        No sync has run into this database yet.');
    }
  } catch (error) {
    fail('MySQL', error, [
      [/without --production/, 'Add --production to the command. run-sync.cmd and check.cmd already do this.'],
      [/ENOENT/, 'The CA file in TARGET_DB_SSL_CA was not found. Use ca.crt (the file next to package.json) or a full path.'],
      [/ER_ACCESS_DENIED|Access denied/i, 'The user or password is wrong. Copy TARGET_DB_USER and TARGET_DB_PASSWORD from .env.production on the development machine.'],
      [/certificate|HANDSHAKE|ssl/i, 'The TLS check failed. Check that TARGET_DB_SSL_CA points at the CA certificate of the MySQL server (ca.crt).'],
      [/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH/i, 'The server does not answer. Check the internet connection, the firewall (outgoing port 25060) and that this computer\'s public IP address is in the "Trusted sources" of the DigitalOcean database.'],
    ]);
  } finally {
    await db?.end();
  }
}

checkEnvFile();
await checkSource();
await checkTarget();
console.log(failed ? '\nSomething failed. Fix .env and run the check again.' : '\nAll good. Both connections work.');
process.exit(failed ? 1 : 0);
