// Test for השלמה אמיתית (admin/server/modules/realCompletion.js).
//
//   $ node scripts/test_real_completion.js
//
// A report shaped like the stored Tabit Shift JSON: per day `total` hours, `tip`, `credit_tip` and blocks
// role_N/start_N/end_N. No network, no DB.

import assert from "node:assert/strict";
import { realCompletionFromReports } from "../admin/server/modules/realCompletion.js";

const day = (date, blocks, extra) => {
  const r = { date, ...extra };
  blocks.forEach(([role, from, to], i) => Object.assign(r, { [`role_${i}`]: role, [`start_${i}`]: `${date}T${from}:00+03:00`, [`end_${i}`]: `${date}T${to}:00+03:00` }));
  return r;
};
const emp = (name, data) => ({ header: { employee: { id: 1, name } }, data });
const report = {
  data: [
    emp("Waiter", [
      day("2026-10-02", [["מלצר", "18:00", "23:00"]], { total: 5, tip: 300, credit_tip: 100 }), // 250 − 300 < 0 → 0
      day("2026-10-03", [["מלצר", "12:00", "16:00"]], { total: 4, tip: 120, credit_tip: 20 }), // 200 − 120 = 80
      day("2026-09-30", [["מלצר", "12:00", "16:00"]], { total: 4, tip: 0, credit_tip: 50 }), // other month
    ]),
    // 2 h dispatcher + 4 h waiter: tip-role hours = 6 × 4/6 = 4 → 4 × 40 − 100 = 60
    emp("Mixed", [day("2026-10-04", [["מוקדן", "10:00", "12:00"], ["מלצר", "12:00", "16:00"]], { total: 6, tip: 100, credit_tip: 30 })]),
    emp("Host", [day("2026-10-04", [["מארחת", "10:00", "16:00"]], { total: 6, tip: 0, credit_tip: 0 })]),
    emp("NoWage", [day("2026-10-05", [["בר", "18:00", "20:00"]], { total: 2, tip: 0 })]),
  ],
};
const wages = { Waiter: 50, Mixed: 40, Host: 50 };
const m = realCompletionFromReports([{ app: 1, report }], "2026-10", (name) => wages[name] ?? null);

assert.deepEqual(m.get("Waiter"), { creditTip: 120, completion: 80, total: 200, tipHours: 9, tips: 420, noWageHours: 0 });
assert.equal(m.get("Mixed").completion, 60);
assert.equal(m.get("Mixed").tipHours, 4);
assert.equal(m.get("Mixed").total, 90);
assert.equal(m.get("Host").total, 0, "no tip role → no top-up");
assert.equal(m.get("NoWage").completion, 0);
assert.equal(m.get("NoWage").noWageHours, 2, "tip-role hours without a wage are reported");

console.log("test_real_completion: OK");
