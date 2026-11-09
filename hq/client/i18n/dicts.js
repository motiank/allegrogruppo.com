// Joya Headquarter dictionaries, used by the provider in ./index.js.
// One pair of files per page group so pages can be added without touching each other.
import commonHe from './common.he.js';
import commonEn from './common.en.js';
import ordersHe from './orders.he.js';
import ordersEn from './orders.en.js';
import staffingHe from './staffing.he.js';
import staffingEn from './staffing.en.js';
import mgmtHe from './mgmt.he.js';
import mgmtEn from './mgmt.en.js';
import dataHe from './data.he.js';
import dataEn from './data.en.js';
import paymentsHe from './payments.he.js';
import paymentsEn from './payments.en.js';
import statementsHe from './statements.he.js';
import statementsEn from './statements.en.js';

export const joyaHe = { ...commonHe, ...ordersHe, ...staffingHe, ...mgmtHe, ...dataHe, ...paymentsHe, ...statementsHe };
export const joyaEn = { ...commonEn, ...ordersEn, ...staffingEn, ...mgmtEn, ...dataEn, ...paymentsEn, ...statementsEn };
