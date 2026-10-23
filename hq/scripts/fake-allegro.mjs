/**
 * A fake Allegro admin Local Data API for tests and demos: the same paths, parameters and row shapes
 * as ~/dvlp/allegrogruppo.com/local_api_readme.md, with made-up data for the two demo branches of
 * scripts/demo-defs.mjs (seeded random, the same on every run, dates relative to today).
 *
 *   node scripts/fake-allegro.mjs [port]          (default 4399)
 *   ALLEGRO_API_URL=http://localhost:4399/local-api/v1 JOYA_HQ_PORT=4360 node server.js
 *
 * Problems on purpose, so the checks have something to find: two days with no Beecomm data, one sold
 * dish that is not on the menu, a clock row with no clock-out, a duplicate clock row, a Tabit name
 * Allegro could not match, and a few employees paid for more hours than they clocked.
 */
import http from 'http';
import { BRANCHES, DEMO_COMPANY, dishesOf, ROLES, ROLE_NAMES, TEAM, WAGES, today as todayOf, addDays, weekday, hm, seeded } from './demo-defs.mjs';

const PORT = Number(process.argv[2] || process.env.FAKE_ALLEGRO_PORT || 4399);
const rnd = seeded(20261021);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const T = todayOf();
const lastMonth = addDays(T.slice(0, 7) + '-01', -1).slice(0, 7);
const r2 = (x) => Math.round(x * 100) / 100;

const data = { orders: [], items: [], employees: [], raw: [], payroll: [], summary: [], labor: [] };
let orderSeq = 1;
let empSeq = 1001;
let rawSeq = 1;

for (const B of BRANCHES) {
  const menu = dishesOf(B);
  const popSum = menu.reduce((s, d) => s + d[4], 0);

  // ---- orders and dish sales: 10 weeks; two days left out on purpose (MISSING, not zero sales)
  const skip = new Set([addDays(T, -9), addDays(T, -23)]);
  const dayFactor = [1.0, 0.75, 0.8, 0.85, 1.15, 1.3, 1.05]; // Sun..Sat
  const slots = [];
  for (let m = 7 * 60 + 30; m < 23 * 60 + 30; m += 30) {
    const h = m / 60;
    slots.push({ m, w: h < 11 ? 1.2 : h < 12 ? 0.8 : h < 15 ? 1.6 : h < 18 ? 0.6 : h < 21.5 ? 1.5 : 0.5 });
  }
  const wsum = slots.reduce((s, x) => s + x.w, 0);
  for (let d = addDays(T, -70); d < T; d = addDays(d, 1)) {
    if (skip.has(d)) continue;
    const w = weekday(d);
    const total = Math.round(140 * B.scale * dayFactor[w] * (0.9 + rnd() * 0.2));
    const sold = new Map();
    for (const slot of slots) {
      if (w === 5 && slot.m >= 16 * 60) continue; // Friday: morning only
      if (w === 6 && slot.m < 16 * 60) continue; // Saturday: evening only
      const n = Math.round((total * slot.w) / wsum + (rnd() - 0.5));
      for (let k = 0; k < n; k++) {
        const open = slot.m + Math.floor(rnd() * 30);
        const dur = 35 + Math.floor(rnd() * 60);
        const diners = rnd() < 0.03 ? null : 1 + Math.floor(rnd() * 4);
        let amount = 0;
        const lines = Math.max(1, (diners ?? 2) + Math.floor(rnd() * 2));
        for (let i = 0; i < lines; i++) {
          let x = rnd() * popSum;
          let dish = menu[0];
          for (const m of menu) {
            x -= m[4];
            if (x <= 0) {
              dish = m;
              break;
            }
          }
          amount += dish[3];
          const s = sold.get(dish[0]) || { dish, quantity: 0, totalSales: 0 };
          s.quantity++;
          s.totalSales += dish[3];
          sold.set(dish[0], s);
        }
        const service = r2(amount * 0.1);
        data.orders.push({
          orderId: `fake-${orderSeq}`,
          restaurantId: 'demo',
          branch: B.id,
          orderNumber: orderSeq++,
          businessDate: d,
          openedAt: `${d} ${hm(open)}`,
          closedAt: `${addDays(d, Math.floor((open + dur) / 1440))} ${hm((open + dur) % 1440)}`,
          orderType: 1,
          status: 2,
          diners,
          total: amount + service,
          netTotal: amount + service, // includes the service charge, like Beecomm
          discountRate: 0,
          discountAmount: 0,
          serviceRate: 0.1,
          serviceAmount: service,
        });
      }
    }
    // one cancelled order a day (status 1): never counted
    data.orders.push({ orderId: `fake-${orderSeq}`, branch: B.id, orderNumber: orderSeq++, businessDate: d, openedAt: `${d} 12:00:00`, closedAt: `${d} 12:05:00`, orderType: 1, status: 1, diners: 2, total: 99, netTotal: 99, serviceAmount: 0 });
    for (const s of sold.values()) {
      data.items.push({ branch: B.id, businessDate: d, dishId: s.dish[0], dishName: s.dish[1], isCombo: false, quantity: s.quantity, totalSales: s.totalSales, orderDiscountSum: 0, discountSum: 0, cancelsCount: 0, category0: s.dish[2] });
    }
  }
  // a dish that is not on the menu
  data.items.push({ branch: B.id, businessDate: addDays(T, -2), dishId: 'X999', dishName: 'מנת שף (לא בתפריט)', isCombo: false, quantity: 3, totalSales: 150, orderDiscountSum: 0, discountSum: 0, category0: 'מיוחדים' });

  // ---- employees
  const team = [];
  for (const role of ROLES) {
    for (let i = 0; i < Math.round(TEAM[role] * (B.scale > 0.8 ? 1 : 0.75)); i++) {
      const e = {
        employeeId: empSeq++,
        branch: B.id,
        name: `${ROLE_NAMES[role]} ${pick(['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'])}${i + 1} (דמו)`,
        active: true,
        contractor: false,
        duplicateOf: null,
        wageType: 'hourly_gross',
        wage: WAGES[role] + Math.round(rnd() * 6),
        roles: [{ role: ROLE_NAMES[role], new_wage_type: null, wage: null }],
        role,
      };
      data.employees.push(e);
      team.push(e);
    }
  }

  // ---- raw clock rows (Tabit detailed report) for last month and this month
  const attFrom = `${lastMonth}-01` < addDays(T, -35) ? `${lastMonth}-01` : addDays(T, -35);
  const rows = [];
  for (let d = attFrom; d < T; d = addDays(d, 1)) {
    const w = weekday(d);
    for (const shift of [
      { s: 7 * 60 + 30, e: 16 * 60, on: w !== 6 },
      { s: 16 * 60, e: 23 * 60 + 30, on: w !== 5 },
    ]) {
      if (!shift.on) continue;
      const need = { cook: 3, checker: 1, barista: shift.s < 12 * 60 ? 1 : 0, bartender: shift.s >= 16 * 60 ? 1 : 0, runner: 1, waiter: w >= 4 ? 4 : 3 };
      for (const role of ROLES) {
        const pool = team.filter((x) => x.role === role);
        for (let i = 0; i < Math.min(need[role] || 0, pool.length); i++) {
          const p = pool[(i + Math.floor(rnd() * pool.length)) % pool.length];
          const inM = shift.s - 10 + Math.floor(rnd() * 20);
          const outM = shift.e - 15 + Math.floor(rnd() * 40);
          rows.push({ branch: B.id, date: d, employeeId: p.employeeId, employeeName: `*${p.name} - ${ROLE_NAMES[role]}`, role: ROLE_NAMES[role], clockIn: `${d} ${hm(inM)}`, clockOut: `${addDays(d, Math.floor(outM / 1440))} ${hm(outM % 1440)}` });
        }
      }
    }
  }
  rows[5].clockOut = null; // no clock-out
  rows.push({ ...rows[12] }); // the same row twice
  rows.push({ branch: B.id, date: addDays(T, -3), employeeId: null, employeeName: '*עובד לא מוכר (דמו)', role: 'מלצר', clockIn: `${addDays(T, -3)} 08:00:00`, clockOut: `${addDays(T, -3)} 15:00:00` });
  for (const r of rows) {
    const hours = r.clockIn && r.clockOut ? r2((Date.parse(r.clockOut.replace(' ', 'T') + 'Z') - Date.parse(r.clockIn.replace(' ', 'T') + 'Z')) / 36e5) : null;
    data.raw.push({ id: rawSeq++, branch: r.branch, month: r.date.slice(0, 7), date: r.date, block: 1, employeeId: r.employeeId, matchedBy: r.employeeId ? 'clock_id' : null, employeeName: r.employeeName, clockId: null, role: r.role, clockIn: r.clockIn, clockOut: r.clockOut, hours, note: null, uploadId: 1, loadedAt: `${T}T03:00:00.000Z` });
  }

  // ---- the saved payroll month (last month): hours after the rules = clocked hours, a few paid 6 h more
  const byEmp = new Map();
  for (const r of data.raw.filter((x) => x.branch === B.id && x.month === lastMonth && x.employeeId && x.hours != null)) {
    const e = byEmp.get(r.employeeId) || { hours: 0, dates: new Map() };
    e.hours += r.hours;
    e.dates.set(r.date, (e.dates.get(r.date) || 0) + r.hours);
    byEmp.set(r.employeeId, e);
  }
  const labor = new Map();
  for (const p of team) {
    const e = byEmp.get(p.employeeId);
    if (!e) continue;
    const paid = r2(rnd() < 0.12 ? e.hours + 6 : e.hours);
    data.summary.push({ branch: B.id, month: lastMonth, employeeId: p.employeeId, name: p.name, workdays: e.dates.size, workDates: [...e.dates.keys()], totalHours: paid, roles: [{ role: ROLE_NAMES[p.role], hours: { h100: paid, h125: 0, h150: 0, total: paid }, tip: 0, completion: 0 }] });
    data.payroll.push({ branch: B.id, month: lastMonth, employeeId: p.employeeId, name: p.name, workdays: e.dates.size, isGlobal: false, inAdvance: 0, tlush: { payrollSoft: 'mic', employeeNumber: 5000 + p.employeeId, components: [{ code: 1, label: 'שכר יסוד שעתי', wage: p.wage, quantity: paid, netGross: 'gross' }, { code: 3, label: 'נסיעות', wage: 22, quantity: e.dates.size, netGross: 'gross' }] } });
    for (const [d, h] of e.dates) {
      const x = labor.get(d) || { hours: 0, gross: 0, employees: 0 };
      x.hours += h;
      x.gross += h * p.wage;
      x.employees++;
      labor.set(d, x);
    }
  }
  for (const [d, x] of labor) data.labor.push({ branch: B.id, date: d, revenue: null, hours: { h100: r2(x.hours), h125: 0, h150: 0, total: r2(x.hours) }, gross: { total: r2(x.gross), wages: r2(x.gross), travel: 0, bonus: 0 }, coverage: { employees: x.employees, estimated: 0, globalSalary: 0, unpricedHours: 0 } });
}

// ---------------------------------------------------------------- the API
// /shifts/by-shift as the Allegro admin computes it from the clock rows: per date × shift × role, people with
// ≥ minHours in the window and their hours. morning = work date 00:00 → split, evening = split → next day 06:00.
const ms = (t) => Date.parse(String(t).replace(' ', 'T') + 'Z');
function byShift(raw, split, minHours) {
  const acc = new Map();
  for (const r of raw) {
    if (!r.clockIn || !r.clockOut) continue;
    const windows = { morning: [ms(`${r.date} 00:00:00`), ms(`${r.date} ${split}:00`)], evening: [ms(`${r.date} ${split}:00`), ms(`${addDays(r.date, 1)} 06:00:00`)] };
    for (const [shift, [a, b]] of Object.entries(windows)) {
      const h = Math.max(0, Math.min(b, ms(r.clockOut)) - Math.max(a, ms(r.clockIn))) / 36e5;
      if (!h) continue;
      const k = `${r.branch}|${r.date}|${shift}|${r.role}`;
      const x = acc.get(k) || { branch: r.branch, date: r.date, shift, role: r.role, who: new Map() };
      const who = r.employeeId ?? r.employeeName;
      x.who.set(who, (x.who.get(who) || 0) + h);
      acc.set(k, x);
    }
  }
  return [...acc.values()].map(({ who, ...x }) => ({ ...x, people: [...who.values()].filter((h) => h >= minHours).length, hours: Math.round([...who.values()].reduce((s, h) => s + h, 0) * 100) / 100 }));
}

const branchesParam = (u) => (u.searchParams.get('branch') ? u.searchParams.get('branch').split(',') : null);
const inBranch = (u) => {
  const b = branchesParam(u);
  return (r) => !b || b.includes(r.branch);
};
const inRange = (u, key) => {
  const from = u.searchParams.get('from');
  const to = u.searchParams.get('to') || from;
  return (r) => (!from || r[key] >= from) && (!to || r[key] <= to);
};
const ROUTES = {
  '/health': () => ({ status: 'ok', db: 'ok', time: new Date().toISOString() }),
  '/branches': () => BRANCHES.map((b) => ({ id: b.id, name: b.name, demo: true, company: { ...DEMO_COMPANY, companyId: 'demo', payrollSoft: 'mic' }, bcomRestaurantId: 'demo' })),
  '/status': (u) =>
    BRANCHES.filter((b) => !branchesParam(u) || branchesParam(u).includes(b.id)).map((b) => {
      const o = data.orders.filter((x) => x.branch === b.id).map((x) => x.businessDate).sort();
      const it = data.items.filter((x) => x.branch === b.id).map((x) => x.businessDate).sort();
      return {
        branch: b.id,
        name: b.name,
        beecomm: { orders: { firstDate: o[0], lastDate: o.at(-1), rows: o.length }, items: { firstDate: it[0], lastDate: it.at(-1), rows: it.length } },
        tabitShifts: [{ month: T.slice(0, 7), shifts: data.raw.filter((x) => x.branch === b.id).length }],
        uploads: [],
        payrollMonths: [{ month: lastMonth, employees: data.payroll.filter((x) => x.branch === b.id).length, withTlush: data.payroll.filter((x) => x.branch === b.id).length }],
        employees: { active: data.employees.filter((x) => x.branch === b.id).length, total: data.employees.filter((x) => x.branch === b.id).length },
      };
    }),
  '/employees': (u) => data.employees.filter(inBranch(u)).map(({ role, ...e }) => e),
  '/shifts/raw': (u) => data.raw.filter(inBranch(u)).filter(inRange(u, 'date')),
  '/shifts/by-shift': (u) => byShift(data.raw.filter(inBranch(u)).filter(inRange(u, 'date')), u.searchParams.get('split') || '17:00', Number(u.searchParams.get('minHours') ?? 1)),
  '/shifts/summary': (u) => data.summary.filter(inBranch(u)).filter((r) => r.month === u.searchParams.get('month')),
  '/payroll': (u) => data.payroll.filter(inBranch(u)).filter((r) => r.month === u.searchParams.get('month')),
  '/labor/daily': (u) => data.labor.filter(inBranch(u)).filter(inRange(u, 'date')),
  '/beecomm/orders/stored': (u) => data.orders.filter(inBranch(u)).filter(inRange(u, 'businessDate')),
  '/beecomm/items/stored': (u) => data.items.filter(inBranch(u)).filter(inRange(u, 'businessDate')),
};

http
  .createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    const path = u.pathname.replace(/^\/local-api\/v1/, '');
    const fn = ROUTES[path];
    res.setHeader('content-type', 'application/json');
    if (!fn) {
      res.statusCode = 404;
      return res.end(JSON.stringify({ error: { code: 'not_found', message: `no fake for ${path}` } }));
    }
    const out = fn(u);
    res.end(JSON.stringify({ data: out, meta: { asOf: new Date().toISOString(), sources: {}, ...(Array.isArray(out) ? { count: out.length } : {}) } }));
  })
  .listen(PORT, '127.0.0.1', () => console.log(`fake Allegro API on http://localhost:${PORT}/local-api/v1 — ${data.orders.length} orders, ${data.items.length} dish rows, ${data.employees.length} employees, ${data.raw.length} clock rows`));
