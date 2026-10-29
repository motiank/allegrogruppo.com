// Read the Tabit Shift work plan (סידור עבודה, the Rota page) through its API → tabit_rota.
//
//   $ node scripts/tabit_rota_fetch.js                         dry run: this week, counts only
//   $ node scripts/tabit_rota_fetch.js --week 2026-10-25        dry run of the week that starts on that Sunday
//   $ node scripts/tabit_rota_fetch.js [--week …] --apply       writes tabit_rota (PRODUCTION DB)
//
// The same Tabit Shift login as tabit_shift_fetch.js (TABIT_SHIFT_* in the root .env). Table:
// scripts/utils/create_tabit_rota_table.sql.

import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: join(root, ".env") });

const { fetchTabitRota } = await import("../admin/server/modules/files.js");
const { getDbPool } = await import("../admin/server/sources/dbpool.js");

const args = process.argv.slice(2);
const week = args.flatMap((a, i) => (a === "--week" ? [args[i + 1]] : []))[0];
if (week !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(week || "")) {
  console.error("--week YYYY-MM-DD (a Sunday)");
  process.exit(1);
}
const apply = args.includes("--apply");

try {
  const results = await fetchTabitRota({ weekStart: week, dryRun: !apply });
  for (const r of results) console.log(`${r.weekStart}  ${r.branch.padEnd(10)} app ${r.apps.join("+").padEnd(10)} ${r.status}  ${r.error || JSON.stringify(r.result)}`);
  if (!apply) console.log("dry run — nothing written (add --apply to write)");
  process.exitCode = results.some((r) => r.status === "FAILED") ? 1 : 0;
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  if (apply) await (await getDbPool()).end();
}
