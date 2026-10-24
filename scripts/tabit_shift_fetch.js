// Read the Tabit Shift detailed reports through its API (the same job as the admin's daily 06:30 run).
//
//   $ node scripts/tabit_shift_fetch.js                      dry run: current month, counts only
//   $ node scripts/tabit_shift_fetch.js --month 2026-09      dry run of September
//   $ node scripts/tabit_shift_fetch.js --month 2026-09 --apply   writes tabit_shifts (PRODUCTION DB)
//
// Needs TABIT_SHIFT_COMPANY / TABIT_SHIFT_USER / TABIT_SHIFT_PASSWORD in the root .env.
// Branches and their Tabit apps: "tabit_shift" in shared/restaurants.json.

import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: join(root, ".env") });

const { fetchTabitShift } = await import("../admin/server/modules/files.js");
const { getDbPool } = await import("../admin/server/sources/dbpool.js");

const args = process.argv.slice(2);
const months = args.flatMap((a, i) => (a === "--month" ? [args[i + 1]] : []));
if (months.some((m) => !/^\d{4}-(0[1-9]|1[0-2])$/.test(m || ""))) {
  console.error("--month YYYY-MM");
  process.exit(1);
}
const apply = args.includes("--apply");

try {
  const results = await fetchTabitShift({ months: months.length ? months : undefined, dryRun: !apply, by: "tabit-shift-cli" });
  for (const r of results) console.log(`${r.month}  ${r.branch.padEnd(10)} app ${r.apps.join("+").padEnd(10)} ${r.status}  ${r.error || JSON.stringify(r.result)}`);
  if (!apply) console.log("dry run — nothing written (add --apply to write)");
  process.exitCode = results.some((r) => r.status === "FAILED") ? 1 : 0;
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  if (apply) await (await getDbPool()).end();
}
