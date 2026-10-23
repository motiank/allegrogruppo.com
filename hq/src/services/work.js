// Headquarters overviews: what waits for a decision, per location.
import { one, todayLocal } from '../db.js';
import { addDays } from '../lib/recommend.js';
import { salesSummary } from './analytics.js';
import { locationNames } from './source.js';

// ---------------------------------------------------------------- overview

/** What waits for a decision, per location. */
export async function pending(access, locationIds) {
  if (!locationIds.length) return [];
  const today = todayLocal();
  const names = await locationNames();
  const out = [];
  for (const loc of locationIds) {
    const r = await one(
      `SELECT
         (SELECT COUNT(*) FROM joya_order_lists o WHERE o.location_id=:l AND o.status='DRAFT') AS draft_lists,
         (SELECT COUNT(*) FROM joya_order_lists o WHERE o.location_id=:l AND o.status='APPROVED') AS approved_not_ordered,
         (SELECT COUNT(*) FROM joya_staffing_plans p WHERE p.location_id=:l AND p.status='DRAFT') AS draft_plans,
         (SELECT COUNT(*) FROM joya_payroll_issues i WHERE i.location_id=:l AND i.status='OPEN') AS open_payroll_issues,
         (SELECT COUNT(*) FROM joya_shortages s WHERE s.location_id=:l AND s.reported_date >= :week) AS shortages_7d`,
      { l: loc, week: addDays(today, -7) },
    );
    out.push({
      locationId: loc,
      name: names.get(loc) ?? loc,
      draftLists: Number(r.draft_lists),
      approvedNotOrdered: Number(r.approved_not_ordered),
      draftPlans: Number(r.draft_plans),
      openPayrollIssues: Number(r.open_payroll_issues),
      shortages7d: Number(r.shortages_7d),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function overview(access, locationIds, { days = 7 } = {}) {
  const today = todayLocal();
  const to = addDays(today, -1);
  const from = addDays(to, -(Number(days) - 1));
  const [sales, pend] = await Promise.all([salesSummary(locationIds, from, to), pending(access, locationIds)]);
  return { today, sales, pending: pend };
}
