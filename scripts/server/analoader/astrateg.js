import { rest_map } from './const.js';
const sheetId = '1qv5HRJrfLLEqp7niqoeAf4q_YAZ-idRt0EkmJkqiUJg';

let astrateg_names = ['הרצליה', 'רמת-החייל', 'ראש-פינה', 'גיסין', 'אור-ים', "ג'ויה-איטליה", "לה-בראצ'ה", 'פיאמונטה', 'תל-אביב ויצמן', 'רעננה', 'פאסקרה'];
let fields = [
  'שבוע',
  'מקום',
  'מערכת',
  'הקלקות',
  'חשיפה',
  'טלפונים',
  'הצגת תפריט',
  'ניווטים',
  'הזמנת מקום ',
  'הזמנת משלוח',
  'שיתופים ברשתות חברתיות + כניסות לאתר הבית (אונטופו)',
  'תקציב חודשי',
  'עלות',
  '% ניצול תקציב',
  'עלות לפעולה',
  'טלפונים',
];

const getRestId = (venue) => {
  let astrateg_ix = astrateg_names.findIndex((name) => name === venue);
  if (astrateg_ix >= 0) {
    for (const [key, value] of Object.entries(rest_map)) {
      const rest = value.map.find((r) => r.astrateg === astrateg_ix);
      if (rest) {
        return rest.id;
      }
    }
  }
  return null;
};

const dalPush = (dal, row) => {
  row.branchId = getRestId(row[fields[1]]);
  row.week = row[fields[0]];
  row.source = row[fields[2]] || '';
  row.ast_views = parseInt(row[fields[4]].replace(/,/g, ''), 10) || 0;
  row.ast_clicks = parseInt(row[fields[3]]) || 0;
  row.ast_calls = parseInt(row[fields[5]]) || 0;
  row.ast_menu = parseInt(row[fields[6]]) || 0;
  row.ast_nav = parseInt(row[fields[7]]) || 0;
  row.ast_bookings = parseInt(row[fields[8]]) || 0;
  row.ast_share = parseInt(row[fields[9]]) || 0;
  row.ast_cost = parseInt(row[fields[12]].replace(/[^\d.-]/g, '')) || 0;
  dal.push('astrateg', row);
};

export default { sheetId, range: '!A1:M', names: astrateg_names, dalPush };
