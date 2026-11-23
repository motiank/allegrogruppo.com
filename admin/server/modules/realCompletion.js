// השלמה אמיתית (real completion) of a month, from the stored Tabit Shift detailed reports:
//   credit-card tips (credit_tip of every day) + the top-up of the tip-role hours to the employee's wage.
// Per day: tip-role hours = the day's hours (total) × the share of the tip-role blocks in the day's clock
// time; top-up = wage × tip-role hours − the day's tips (tip), only when positive. Days with no tip-role
// block get no top-up. Wage = the role's own wage, else the employee's (-1 = the national minimum).
// Display only — not exported. Owner's rule, 2026-11-08.

export const TIP_ROLES = new Set(["מלצר", "בר", "ראנר"]);

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const ms = (iso) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
};

/**
 * reports: [{ app, report }] (tabit_shift_reports of one branch and month); month 'YYYY-MM';
 * wageFor(name, role) → hourly wage or null.
 * → Map name → { creditTip, completion, total, tipHours, tips, noWageHours }
 */
export function realCompletionFromReports(reports, month, wageFor) {
  // name → date → { blocks: Map key → {role, from, to}, hours, tip, credit }; the same day can be in two
  // apps (Raanana kitchen + floor): blocks are merged, hours / tips summed.
  const people = new Map();
  for (const { report } of reports) {
    for (const entry of report?.data || []) {
      const name = String(entry.header?.employee?.name || "").trim();
      if (!name) continue;
      if (!people.has(name)) people.set(name, new Map());
      const days = people.get(name);
      for (const r of entry.data || []) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.date || "")) || !r.date.startsWith(`${month}-`)) continue;
        const d = days.get(r.date) || { blocks: new Map(), hours: 0, tip: 0, credit: 0 };
        d.hours += num(r.total);
        d.tip += num(r.tip);
        d.credit += num(r.credit_tip);
        const idx = [...new Set(Object.keys(r).map((k) => k.match(/^(?:role|start|end)_(\d+)$/)?.[1]).filter(Boolean))];
        for (const i of idx) {
          const role = String(r[`role_${i}`] || "").trim();
          if (!role) continue;
          const from = ms(r[`start_${i}`]);
          const to = ms(r[`end_${i}`]);
          d.blocks.set(`${role}|${from}|${to}`, { role, from, to });
        }
        days.set(r.date, d);
      }
    }
  }

  const out = new Map();
  for (const [name, days] of people) {
    const res = { creditTip: 0, completion: 0, total: 0, tipHours: 0, tips: 0, noWageHours: 0 };
    for (const d of days.values()) {
      res.creditTip += d.credit;
      if (!(d.hours > 0)) continue;
      const blocks = [...d.blocks.values()];
      const dur = (b) => (b.from != null && b.to != null && b.to > b.from ? b.to - b.from : null);
      const durs = blocks.map(dur);
      const known = durs.every((x) => x != null);
      const totalDur = known ? durs.reduce((a, x) => a + x, 0) : blocks.length;
      if (!totalDur) continue;
      // tip-role hours and the wage they must reach, per block
      let tipHours = 0;
      let target = 0;
      blocks.forEach((b, i) => {
        if (!TIP_ROLES.has(b.role)) return;
        const h = (d.hours * (known ? durs[i] : 1)) / totalDur;
        const wage = wageFor(name, b.role);
        tipHours += h;
        if (wage == null) res.noWageHours += h;
        else target += wage * h;
      });
      if (!(tipHours > 0)) continue;
      res.tipHours += tipHours;
      res.tips += d.tip;
      res.completion += Math.max(0, target - d.tip);
    }
    const r2 = (x) => Math.round(x * 100) / 100;
    res.creditTip = r2(res.creditTip);
    res.completion = r2(res.completion);
    res.total = r2(res.creditTip + res.completion);
    res.tipHours = r2(res.tipHours);
    res.tips = r2(res.tips);
    res.noWageHours = r2(res.noWageHours);
    out.set(name, res);
  }
  return out;
}
