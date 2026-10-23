// What the demonstration restaurants are made of. Shared by scripts/fake-allegro.mjs (the source
// data a fake Allegro API serves: orders, dish sales, employees, clock rows, payroll) and
// scripts/joya-seed-demo.mjs (Joya's own records: menu, recipes, rules, past order lists…).
// The numbers are made up. They are NOT Joya's data.

export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
export const weekday = (d) => new Date(d + 'T00:00:00Z').getUTCDay();
const pad = (n) => String(n).padStart(2, '0');
export const hm = (m) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}:00`;

/** A seeded random generator: the same numbers on every run. */
export function seeded(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The company the demo restaurants belong to (src/services/master.js DEMO_COMPANY is the same)
export const DEMO_COMPANY = { key: 'demo', label: 'חברת דמו' };

// Allegro branch ids of the demo restaurants (the fake API serves them; the seed links them)
export const BRANCHES = [
  { id: 'demo-tlv', code: 'DEMO-TLV', name: 'ג׳ויה תל אביב (דמו)', scale: 1.0 },
  { id: 'demo-hfa', code: 'DEMO-HFA', name: 'ג׳ויה חיפה (דמו)', scale: 0.7 },
];

export const INGREDIENTS = [
  ['DM-TOM', 'עגבניות', 'kg', 'ירקות'],
  ['DM-CUC', 'מלפפונים', 'kg', 'ירקות'],
  ['DM-ONI', 'בצל', 'kg', 'ירקות'],
  ['DM-EGG', 'ביצים', 'תבנית', 'מקרר'],
  ['DM-MLK', 'חלב', 'l', 'מקרר'],
  ['DM-FET', 'גבינת פטה', 'kg', 'מקרר'],
  ['DM-BRD', 'לחם מחמצת', 'יח׳', 'מאפים'],
  ['DM-PST', 'פסטה', 'kg', 'יבש'],
  ['DM-OIL', 'שמן זית', 'l', 'יבש'],
  ['DM-COF', 'פולי קפה', 'kg', 'בר'],
  ['DM-CHK', 'חזה עוף', 'kg', 'בשר'],
  ['DM-SAL', 'סלמון', 'kg', 'דגים'],
  ['DM-LEM', 'לימונים', 'kg', 'ירקות'],
  ['DM-HRB', 'עשבי תיבול', 'צרור', 'ירקות'],
  ['DM-NAP', 'מפיות', 'קרטון', 'חד״פ'],
];

// dish: [Beecomm dish id, name, category, price, popularity, recipe [[ingredient, qty|null, unit]]]
export const DISHES = [
  ['D100', 'שקשוקה', 'בוקר', 62, 9, [['DM-TOM', 250, 'g'], ['DM-EGG', null, null], ['DM-ONI', 50, 'g'], ['DM-BRD', 1, 'יח׳']]],
  ['D101', 'ארוחת בוקר ישראלית', 'בוקר', 78, 8, [['DM-EGG', null, null], ['DM-TOM', 100, 'g'], ['DM-CUC', 100, 'g'], ['DM-FET', 60, 'g'], ['DM-BRD', 1, 'יח׳']]],
  ['D102', 'סלט יווני', 'סלטים', 58, 6, [['DM-TOM', 150, 'g'], ['DM-CUC', 150, 'g'], ['DM-FET', 80, 'g'], ['DM-OIL', 20, 'ml']]],
  ['D103', 'פסטה עגבניות', 'עיקריות', 68, 7, [['DM-PST', 150, 'g'], ['DM-TOM', 200, 'g'], ['DM-OIL', 15, 'ml'], ['DM-HRB', null, null]]],
  ['D104', 'סלמון בתנור', 'עיקריות', 98, 4, [['DM-SAL', 220, 'g'], ['DM-LEM', 50, 'g'], ['DM-HRB', null, null]]],
  ['D105', 'שניצל עוף', 'עיקריות', 74, 6, [['DM-CHK', 200, 'g'], ['DM-EGG', null, null], ['DM-OIL', null, null]]],
  ['D106', 'כריך עוף', 'כריכים', 56, 5, [['DM-CHK', 120, 'g'], ['DM-BRD', 1, 'יח׳'], ['DM-TOM', 50, 'g']]],
  ['D200', 'הפוך', 'שתייה חמה', 16, 14, [['DM-COF', 18, 'g'], ['DM-MLK', 200, 'ml']]],
  ['D201', 'אספרסו', 'שתייה חמה', 11, 8, [['DM-COF', 18, 'g']]],
  ['D202', 'לימונדה', 'שתייה קרה', 18, 5, [['DM-LEM', null, null], ['DM-HRB', null, null]]],
  ['D203', 'עוגת שוקולד', 'קינוחים', 42, 3, []],
];
/** The dishes a branch sells (Haifa has no salmon). */
export const dishesOf = (branch) => DISHES.filter(([code]) => !(branch.code === 'DEMO-HFA' && code === 'D104'));

export const ROLES = ['cook', 'checker', 'barista', 'bartender', 'runner', 'waiter'];
// role names as Allegro writes them (all mapped by the default joya_role_aliases rows)
export const ROLE_NAMES = { cook: 'טבח', checker: "צ'קר", barista: 'בריסטה', bartender: 'בר', runner: 'ראנר', waiter: 'מלצר' };
export const TEAM = { cook: 5, checker: 2, barista: 2, bartender: 2, runner: 3, waiter: 7 };
export const WAGES = { cook: 52, checker: 48, barista: 40, bartender: 40, runner: 36, waiter: 34 };
