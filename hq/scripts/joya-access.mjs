// Set or remove a Joya HQ access override from the command line (Settings → Users does the same).
//
//   node scripts/joya-access.mjs list
//   node scripts/joya-access.mjs <username> CHAIN_ADMIN [--payroll]
//   node scripts/joya-access.mjs <username> LOCATION_MANAGER --locations DEMO-TLV,3 [--payroll]
//   node scripts/joya-access.mjs <username> remove
//
// <username> is the Allegro admin e-mail. Without a row the access follows the Allegro role (src/access.js).
import '../lib/env.js';
import { executeSql, getDbPool } from '../lib/dbpool.js';

const q = async (sql, p = {}) => (await executeSql(sql, p))[0];
const [, , user, role, ...rest] = process.argv;
try {
  if (!user || user === 'list') {
    for (const r of await q(`SELECT * FROM joya_user_access ORDER BY role, username`)) console.log(`${r.username}\t${r.role}\tlocations=${JSON.stringify(r.location_ids)}\tpayroll=${r.payroll_access}`);
  } else if (role === 'remove') {
    await q(`DELETE FROM joya_user_access WHERE username=:u`, { u: user });
    console.log(`removed Joya access of ${user}`);
  } else {
    if (!['CHAIN_ADMIN', 'LOCATION_MANAGER'].includes(role)) throw new Error('role must be CHAIN_ADMIN or LOCATION_MANAGER');
    const i = rest.indexOf('--locations');
    const ids = [];
    if (i >= 0) {
      for (const x of String(rest[i + 1] || '').split(',').filter(Boolean)) {
        const row = /^\d+$/.test(x) ? (await q(`SELECT id FROM joya_locations WHERE id=:x`, { x }))[0] : (await q(`SELECT id FROM joya_locations WHERE code=:x`, { x }))[0];
        if (!row) throw new Error(`unknown location ${x}`);
        ids.push(row.id);
      }
    }
    if (role === 'LOCATION_MANAGER' && !ids.length) throw new Error('a LOCATION_MANAGER needs --locations');
    await q(
      `INSERT INTO joya_user_access (username, role, location_ids, payroll_access, updated_by) VALUES (:u, :r, :l, :p, 'cli')
       ON DUPLICATE KEY UPDATE role=VALUES(role), location_ids=VALUES(location_ids), payroll_access=VALUES(payroll_access), updated_by='cli'`,
      { u: user, r: role, l: JSON.stringify(ids), p: rest.includes('--payroll') ? 1 : 0 },
    );
    console.log(`${user}: ${role} locations=${JSON.stringify(ids)} payroll=${rest.includes('--payroll')}`);
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await getDbPool().end();
}
