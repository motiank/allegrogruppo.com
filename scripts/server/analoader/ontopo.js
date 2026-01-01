import { rest_map } from './const.js';
const sheetId = '1cR5CnQ_TAtQUILn3hRojvhsFBL2mfcN5Z2D-n5LUZuI';

let ontopo_names = [
  "ג'ויה תל אביב ",
  "ג'ויה תל אביב הכשרה",
  "ג'ויה הרצליה ",
  "ג'ויה רעננה ", //3
  "ג'ויה פתח תקווה", //4
  "joya d'eatalia", //5
  "piemonte d'eatalia", //6
  "לה בראצ'ה ", //7
  "pescara d'eatalia", //8
  "ג'ויה אור ים", //9
  "ג'ויה עיר ימים", //10
  "ג'ויה מודיעין", //11
];

const getRestId = (venue) => {
  let ontopo_ix = ontopo_names.findIndex((name) => name === venue);
  if (ontopo_ix >= 0) {
    for (const [key, value] of Object.entries(rest_map)) {
      const rest = value.map.find((r) => r.ontopo === ontopo_ix);
      if (rest) {
        return rest.id;
      }
    }
  }
  return null;
};

const dalPush = (dal, row) => {
  row.branchId = getRestId(row.venue);
  row.Bookings = parseInt(row.Bookings) || 0;
  row.Diners = parseInt(row.Diners) || 0;
  dal.push('ontopo', row);
};

export default { sheetId, range: '!A1:E', names: ontopo_names, dalPush };
