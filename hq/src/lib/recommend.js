// Replenishment recommendation for one location — pure and explainable.
//
// What it learns from: the FINAL order lists of this location (what the manager
// really approved / ordered, including items they added and quantities they changed).
// A final list is a learning example of how this manager orders, not a measurement of
// consumption, and no shortage report does not mean the order was right.
//
// For each item it keeps a few plain numbers (its "pattern"):
//   - how often it appears and the median number of days between orders that had it
//   - the weighted median quantity ordered (newer lists weigh more: half-life in lists)
//   - SALES RATIO: quantity ordered ÷ units sold of the dishes linked to it in the days
//     since the previous order — only when every day of that window has sales data
//   - how often the manager removed it when it was suggested
//
// The quantity, in this order of preference:
//   SALES_RATIO      ratio × linked dish units sold since the last order (needs ≥ minExamplesForRatio ratios)
//   HISTORY_MEDIAN   weighted median of past quantities (needs ≥ minExamplesForQty lists)
//   RECIPE_ESTIMATE  dish units sold × recipe quantity (only when every linked dish has a quantity
//                    in a unit we can convert); always LOW confidence, labelled an estimate
//   NONE             no supported quantity: the line is kept for the manager with qty = null
//
// Sections: SUGGESTED (due, with a quantity), CHECK (due or likely, quantity or decision left
// to the manager), NOT_DUE (known item, not due yet — shown folded so it can be added).

export const RECOMMENDER_VERSION = 'r1';

const DAY = 86400000;
const dnum = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
export const addDays = (d, n) => new Date(dnum(d) + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((dnum(b) - dnum(a)) / DAY);

export function weightedMedian(items) {
  const a = items.filter((x) => x.value != null && Number.isFinite(x.value) && x.weight > 0).sort((x, y) => x.value - y.value);
  if (!a.length) return null;
  const total = a.reduce((s, x) => s + x.weight, 0);
  let acc = 0;
  for (const x of a) {
    acc += x.weight;
    if (acc >= total / 2) return x.value;
  }
  return a[a.length - 1].value;
}

export function median(nums) {
  const a = nums.filter((n) => n != null && Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

const UNIT_FACTORS = { g: ['kg', 0.001], gr: ['kg', 0.001], 'גרם': ['kg', 0.001], kg: ['kg', 1], 'ק"ג': ['kg', 1], ml: ['l', 0.001], 'מ"ל': ['l', 0.001], l: ['l', 1], 'ליטר': ['l', 1], unit: ['unit', 1], 'יח': ['unit', 1], "יח'": ['unit', 1] };
/** Convert qty from one unit to another when both are mass, volume or count. null = cannot. */
export function convert(qty, from, to) {
  if (qty == null) return null;
  const f = UNIT_FACTORS[String(from || '').trim().toLowerCase()];
  const t = UNIT_FACTORS[String(to || '').trim().toLowerCase()];
  if (!from && !to) return qty;
  if (!f || !t || f[0] !== t[0]) return String(from).trim() === String(to).trim() ? qty : null;
  return (qty * f[1]) / t[1];
}

function roundLike(qty, pastQtys) {
  if (qty == null) return null;
  const allInt = pastQtys.length > 0 && pastQtys.every((q) => Number.isInteger(q));
  if (allInt || !pastQtys.length) return Math.max(1, Math.ceil(qty - 1e-9));
  return Math.max(0.1, Math.round(qty * 10) / 10);
}

/**
 * @param {object} input
 * @param {string} input.asOf                  list date 'YYYY-MM-DD'
 * @param {Array}  input.ingredients           [{ id, name, unit }]
 * @param {Array}  input.examples              final lists, NEWEST FIRST:
 *        [{ listId, date, status: 'ORDERED'|'APPROVED'|'HISTORICAL', lines: [{ ingredientId, qty }],
 *           recommended: [ingredientId of SUGGESTED lines] | null }]
 * @param {Function} input.linkedSales         (ingredientId, fromDate, toDate) →
 *        { units: number|null, dishes: number, days: number, daysMissing: number } — sales of the
 *        dishes linked to the ingredient on dates fromDate ≤ d < toDate
 * @param {Function} input.recipeEstimate      (ingredientId, fromDate, toDate, toUnit) →
 *        { qty: number|null, reason } — only when every linked dish has a convertible quantity
 * @param {Object}   input.shortages           ingredientId → ['YYYY-MM-DD', …] reported since the last order of it
 * @param {object}   input.settings
 */
export function recommend({ asOf, ingredients, examples, linkedSales, recipeEstimate, shortages = {}, settings }) {
  const S = {
    historyLists: 8,
    halfLifeLists: 4,
    minExamplesForQty: 2,
    minExamplesForRatio: 3,
    dueFraction: 0.8,
    shortageBumpPct: 15,
    removedSuppressShare: 0.75,
    approvedOnlyWeight: 0.5,
    coldStartDays: 7,
    ...settings,
  };
  const ex = examples.filter((e) => e.date <= asOf).slice(0, S.historyLists);
  const lines = [];
  const patterns = [];

  for (const ing of ingredients) {
    const occ = [];
    ex.forEach((e, idx) => {
      const l = e.lines.find((x) => x.ingredientId === ing.id);
      if (!l) return;
      const statusWeight = e.status === 'APPROVED' ? S.approvedOnlyWeight : 1;
      const recency = Math.pow(0.5, idx / S.halfLifeLists);
      occ.push({ listId: e.listId, date: e.date, status: e.status, qty: l.qty == null ? null : Number(l.qty), weight: statusWeight * recency, idx });
    });
    const withQty = occ.filter((o) => o.qty != null);
    const last = occ[0] || null;
    const daysSince = last ? daysBetween(last.date, asOf) : null;

    // days between consecutive orders that had the item (example lists are newest first)
    const intervals = [];
    for (let i = 0; i + 1 < occ.length; i++) intervals.push(daysBetween(occ[i + 1].date, occ[i].date));
    const medianInterval = median(intervals);

    // the sales ratio of each order: qty ÷ linked dish units sold since the previous order
    const ratios = [];
    for (let i = 0; i + 1 < occ.length; i++) {
      const o = occ[i];
      if (o.qty == null) continue;
      const s = linkedSales(ing.id, occ[i + 1].date, o.date);
      if (s && s.dishes > 0 && s.daysMissing === 0 && s.units > 0) ratios.push({ listId: o.listId, date: o.date, qty: o.qty, units: s.units, from: occ[i + 1].date, value: o.qty / s.units, weight: o.weight });
    }

    // removed by the manager when it was suggested
    const suggestedIn = ex.filter((e) => Array.isArray(e.recommended) && e.recommended.includes(ing.id));
    const removedIn = suggestedIn.filter((e) => !e.lines.some((l) => l.ingredientId === ing.id));
    const removedShare = suggestedIn.length >= 3 ? removedIn.length / suggestedIn.length : null;

    const shortageDates = (shortages[ing.id] || []).filter((d) => !last || d >= last.date).sort();
    const pattern = {
      ingredientId: ing.id,
      examples: occ.length,
      examplesConsidered: ex.length,
      lastOrdered: last ? { date: last.date, qty: last.qty, listId: last.listId } : null,
      daysSince,
      medianInterval,
      intervals,
      weightedMedianQty: weightedMedian(withQty.map((o) => ({ value: o.qty, weight: o.weight }))),
      ratio: ratios.length ? weightedMedian(ratios) : null,
      ratioN: ratios.length,
      removedShare,
      suggestedCount: suggestedIn.length,
      removedCount: removedIn.length,
    };
    patterns.push(pattern);

    // ---- quantity
    const sinceDate = last ? last.date : null;
    // with no order history, look at the dishes sold in the last coldStartDays (information only)
    const current = linkedSales(ing.id, sinceDate || addDays(asOf, -S.coldStartDays), asOf);
    let qty = null;
    let method = 'NONE';
    let confidence = 'NONE';
    const calc = [];
    const notes = [];
    if (pattern.ratio != null && ratios.length >= S.minExamplesForRatio && current && current.dishes > 0) {
      if (current.daysMissing === 0 && current.units != null) {
        qty = pattern.ratio * current.units;
        method = 'SALES_RATIO';
        confidence = ratios.length >= 5 ? 'HIGH' : 'MEDIUM';
        calc.push(`${round3(pattern.ratio)} × ${current.units} = ${round3(qty)}`);
      } else notes.push({ code: 'SALES_WINDOW_INCOMPLETE', daysMissing: current.daysMissing, from: sinceDate, to: asOf });
    }
    if (qty == null && withQty.length >= S.minExamplesForQty) {
      if (pattern.ratio == null && ratios.length === 0 && current && current.dishes === 0) notes.push({ code: 'NO_LINKED_DISHES' });
      qty = pattern.weightedMedianQty;
      method = 'HISTORY_MEDIAN';
      confidence = withQty.length >= 4 ? 'MEDIUM' : 'LOW';
      calc.push(`weighted median of ${withQty.length} past quantities = ${round3(qty)}`);
    }
    if (qty == null && recipeEstimate) {
      const from = sinceDate || null;
      if (from) {
        const est = recipeEstimate(ing.id, from, asOf, ing.unit);
        if (est && est.qty != null && est.qty > 0) {
          qty = est.qty;
          method = 'RECIPE_ESTIMATE';
          confidence = 'LOW';
          calc.push(`recipe estimate ${est.reason}`);
        } else if (est?.reason) notes.push({ code: 'NO_RECIPE_ESTIMATE', reason: est.reason });
      }
    }
    if (qty != null && shortageDates.length && S.shortageBumpPct > 0) {
      const before = qty;
      qty = qty * (1 + S.shortageBumpPct / 100);
      calc.push(`shortage +${S.shortageBumpPct}%: ${round3(before)} → ${round3(qty)}`);
    }
    const pastQtys = withQty.map((o) => o.qty);
    if (qty != null) qty = roundLike(qty, pastQtys);

    // ---- due or not
    let section;
    const reasons = [];
    if (shortageDates.length) reasons.push({ code: 'SHORTAGE', dates: shortageDates });
    if (medianInterval != null && daysSince != null) {
      const due = daysSince >= S.dueFraction * medianInterval;
      reasons.push({ code: due ? 'DUE_BY_INTERVAL' : 'NOT_DUE_BY_INTERVAL', daysSince, medianInterval, threshold: round3(S.dueFraction * medianInterval) });
    } else if (occ.length === 1) reasons.push({ code: 'ORDERED_ONCE', date: last.date, qty: last.qty });
    else if (!occ.length) reasons.push({ code: 'NO_HISTORY' });
    if (current && current.dishes > 0 && current.units != null) reasons.push({ code: 'LINKED_SALES', units: current.units, dishes: current.dishes, from: sinceDate || addDays(asOf, -S.coldStartDays), to: asOf, daysMissing: current.daysMissing });

    const dueByInterval = reasons.some((r) => r.code === 'DUE_BY_INTERVAL');
    const shortage = shortageDates.length > 0;
    if (shortage || dueByInterval) section = qty != null ? 'SUGGESTED' : 'CHECK';
    else if (medianInterval == null) section = 'CHECK'; // 0 or 1 past orders: timing cannot be judged
    else section = 'NOT_DUE';

    if (section === 'SUGGESTED' && removedShare != null && removedShare >= S.removedSuppressShare && !shortage) {
      section = 'CHECK';
      notes.push({ code: 'OFTEN_REMOVED', removed: removedIn.length, suggested: suggestedIn.length });
    }
    if (!occ.length && !shortage && !(current && current.units > 0)) continue; // nothing to say about it
    if (section === 'CHECK' && confidence === 'NONE') qty = null;

    lines.push({
      ingredientId: ing.id,
      section,
      qty,
      unit: ing.unit || null,
      method,
      confidence,
      basis: {
        reasons,
        calc,
        notes,
        examples: occ.map((o) => ({ listId: o.listId, date: o.date, status: o.status, qty: o.qty, weight: round3(o.weight) })),
        ratios: ratios.map((r) => ({ listId: r.listId, date: r.date, from: r.from, qty: r.qty, units: r.units, ratio: round3(r.value) })),
        pattern: { medianInterval, daysSince, weightedMedianQty: pattern.weightedMedianQty, ratio: pattern.ratio == null ? null : round3(pattern.ratio), removedShare },
      },
    });
  }

  const order = { SUGGESTED: 0, CHECK: 1, NOT_DUE: 2 };
  lines.sort((a, b) => order[a.section] - order[b.section] || a.ingredientId - b.ingredientId);
  return { version: RECOMMENDER_VERSION, settings: S, examplesUsed: ex.map((e) => ({ listId: e.listId, date: e.date, status: e.status })), lines, patterns };
}

const round3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
