// index.js
import axios from 'axios';
import moment from 'moment';
import zlib from 'zlib';

const BCOM_CUBE_URL = 'https://20cs5hma71.execute-api.eu-west-1.amazonaws.com/prod/api';

const bcom_rest_map = {
  '64251a17042cbcc5928813fd': [
    { id: '64be1926335ee46a739a1ba2', branchName: "ג'ויה" },
    { id: '65cda80518611cc1cab248ca', branchName: 'לה בראצ׳ה' },
    { id: '64251a9f37dc3d5093d7ab53', branchName: 'פיאמונטה' },
    { id: '64ddcfdc674a1d497fe49bf8', branchName: 'פסקרה' },
  ],
  '5fd7022862f93c0cf1df8b63': [{ id: '5fd7030f4f421bfe0e2e13bd', branchName: 'הרצליה' }],
  '5ff41825105007954144ed8d': [{ id: '5ff419934676f0fddabaef3a', branchName: "ג'ויה רעננה" }],
  '601261162dd7db3f39ca2049': [{ id: '6012624f0d491ef6429e127c', branchName: 'רמת החיל' }],
  '60335c8306f5f03947387bd0': [{ id: '60335d23cac0e25c17fe0544', branchName: 'תל אביב' }],
  '60b46a83a62b1748e7b3d8a1': [{ id: '60b46ca4e8418d9c860b2b2f', branchName: 'נתניה' }],
  '62f48c2a7f9095f113a7add3': [
    { id: '62f48ec8ab47895a757e1c76', branchName: 'מודיעין' },
    { id: '67b6c458d809d6fa30bbdcaa', branchName: 'רעות' },
  ],
  '6322b7febdafdceae5b84cf9': [{ id: '6322b93aaf5f6e3b92830433', branchName: 'פתח תקווה' }],
  '655eeb44d541bee19f59e444': [{ id: '655ef6eb9df0c279bbfb7482', branchName: 'ראש פינה' }],
  '65bb3fe41ed2912aa9034a18': [{ id: '65bb40ae6729db482e2ed6f2', branchName: 'אור ים' }],
};

const zReports_payload = {
  action: 'createZPOSReport',
  // restaurantId: '65bb3fe41ed2912aa9034a18',
  filter: {
    // startDate: '15/03/2025',
    // endDate: '22/03/2025',
    // branches: ['65bb40ae6729db482e2ed6f2'],
    searchTerm: null,
  },
  // token: '',
};

const getOrderHeaders_payload = {
  action: 'getOrderHeaders',
  filter: {
    searchTerm: null,
    orderNumber: null,
    orderTypes: [],
    clientName: null,
    waiterName: null,
    tableNumber: null,
    dishes: [],
    zNumber: null,
    cardNumber: null,
    orderTotal: null,
    orderSources: [],
    dishesFilterType: 'OR',
    serviceType: 'service',
    serviceFrom: null,
    serviceTo: null,
    serviceFromOperator: '$gte',
    serviceToOperator: '$lte',
    discountType: 'discount',
    discountFrom: null,
    discountTo: null,
    discountFromOperator: '$gte',
    discountToOperator: '$lte',
    profitUnits: [],
    drawers: [],
    memberCardExists: false,
    refundExists: false,
    cashRefundExists: false,
    upsaleExists: false,
    itemFullDiscountExists: false,
    canceledItemExists: false,
    externalsOnly: false,
    clientPhoneNumber: null,
    withCash: false,
    paymentTypes: [],
    optimaGuestName: null,
    optimaRoomNumber: null,
    optimaGuestFolio: null,
  },
};

const exceptionsReport_payload = {
  action: 'createExceptionsReport',
  filter: {
    searchTerm: null,
    secondSearchTerm: null,
    thirdSearchTerm: null,
    strArray: [],
  },
};

const itemsReport_payload = {
  action: 'getAnalyticsItemsReport',
  filter: {
    startTs: null,
    endTs: null,
    searchTerm: null,
    splitHours: false,
    splitBranches: true,
    splitDays: false,
    includeExternalIdentity: false,
    globalTimeSettings: false,
    catalog: { level0Id: null, level1Id: null, level2Id: null, level3Id: null },
  },
};

// Restaurants (bcom restaurantId -> branches) to query, optionally narrowed to the given branch ids.
function restaurantsFor(branchIds) {
  const entries = Object.entries(bcom_rest_map);
  if (!branchIds || branchIds.length === 0) return entries;
  return entries
    .map(([rest_id, branches]) => [rest_id, branches.filter((b) => branchIds.includes(b.id))])
    .filter(([, branches]) => branches.length > 0);
}

// Access tokens live 1h; reuse one until 5 minutes before it expires.
let cachedToken = null;

// Exchange the backoffice (Firebase) refresh token for a short-lived access token.
// The refresh token is taken from the backoffice.beecommcloud.com securetoken request.
async function getBcomAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;
  const { BCOM_BO_API_KEY, BCOM_BO_REFRESH_TOKEN } = process.env;
  if (!BCOM_BO_API_KEY || !BCOM_BO_REFRESH_TOKEN) {
    throw new Error('BCOM_BO_API_KEY and BCOM_BO_REFRESH_TOKEN must be set in .env');
  }
  const { data } = await axios.post(
    `https://securetoken.googleapis.com/v1/token?key=${BCOM_BO_API_KEY}`,
    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: BCOM_BO_REFRESH_TOKEN }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) - 300) * 1000 };
  return data.access_token;
}

async function postCube(path, payload, accessToken) {
  const { data } = await axios.post(
    `${BCOM_CUBE_URL}/${path}`,
    { ...payload, token: `Bearer ${accessToken}` },
    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` } },
  );
  return data;
}

// orders/cube returns its rows as base64-encoded gzipped JSON
function decodeBase64Gzip(encoded) {
  return JSON.parse(zlib.gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8'));
}

async function bcomApiLoad(dates, dal_push) {
  try {
    const accessToken = await getBcomAccessToken();

    for (const rest_id in bcom_rest_map) {
      const payload = {
        ...zReports_payload,
        restaurantId: rest_id,
        filter: {
          ...zReports_payload.filter,
          branches: bcom_rest_map[rest_id].map((branch) => branch.id),
          startDate: dates.startDate,
          endDate: dates.endDate,
        },
      };
      const data = await postCube('zReports/cube', payload, accessToken);
      console.log(`Amazon API Response:${rest_id} ${data.rows.length} days`);
      dal_push('api', data.rows);
    }
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

// Daily Z-report rows for the date range (includes a branchId "900" total row per restaurant).
// options.branchIds limits the query to those branches (default: all).
async function bcomGetZReports(dates, { branchIds } = {}) {
  const accessToken = await getBcomAccessToken();
  const rows = [];

  for (const [rest_id, branches] of restaurantsFor(branchIds)) {
    const payload = {
      ...zReports_payload,
      restaurantId: rest_id,
      filter: {
        ...zReports_payload.filter,
        branches: branches.map((branch) => branch.id),
        startDate: dates.startDate,
        endDate: dates.endDate,
      },
    };
    const data = await postCube('zReports/cube', payload, accessToken);
    for (const row of data.rows || []) rows.push({ ...row, restaurantId: rest_id });
  }
  return rows;
}

// Fetch all order headers for every restaurant/branch in bcom_rest_map.
// dates: { startDate: 'DD/MM/YYYY', endDate: 'DD/MM/YYYY' }
// Each returned order is tagged with restaurantId and branchName.
// options.branchIds limits the query to those branches (default: all).
async function bcomGetOrders(dates, { branchIds } = {}) {
  const accessToken = await getBcomAccessToken();
  const orders = [];

  for (const [rest_id, branches] of restaurantsFor(branchIds)) {
    const payload = {
      ...getOrderHeaders_payload,
      restaurantId: rest_id,
      filter: {
        ...getOrderHeaders_payload.filter,
        branches: branches.map((branch) => branch.id),
        startDate: dates.startDate,
        endDate: dates.endDate,
      },
    };
    const data = await postCube('orders/cube', payload, accessToken);
    const rows = typeof data.orders === 'string' ? decodeBase64Gzip(data.orders) : data.orders || [];
    const branchNames = Object.fromEntries(branches.map((b) => [b.id, b.branchName]));
    for (const order of rows) {
      orders.push({ ...order, restaurantId: rest_id, branchName: branchNames[order.branchId] });
    }
    console.log(`bcom orders:${rest_id} ${rows.length} orders`);
  }
  return orders;
}

// Fetch the exceptions report (discounts, refunds, cancellations...) for every
// restaurant/branch in bcom_rest_map. dates: { startDate: 'DD/MM/YYYY', endDate: 'DD/MM/YYYY' }
// Each returned row is tagged with restaurantId (branchName already comes from the API).
// options.branchIds limits the query to those branches (default: all).
async function bcomGetExceptions(dates, { branchIds } = {}) {
  const accessToken = await getBcomAccessToken();
  const exceptions = [];

  for (const [rest_id, branches] of restaurantsFor(branchIds)) {
    const payload = {
      ...exceptionsReport_payload,
      restaurantId: rest_id,
      filter: {
        ...exceptionsReport_payload.filter,
        branches: branches.map((branch) => branch.id),
        startDate: dates.startDate,
        endDate: dates.endDate,
      },
    };
    const data = await postCube('zReports/cube', payload, accessToken);
    const rows = data.rows || [];
    for (const row of rows) exceptions.push({ ...row, restaurantId: rest_id });
    console.log(`bcom exceptions:${rest_id} ${rows.length} rows`);
  }
  return exceptions;
}

// Orders for the date range, each enriched with its exceptions (empty array when none).
// orderNumber is only unique per branch, so orders and exceptions are matched by branchId + orderNumber.
async function bcomGetOrdersWithExceptions(dates, options = {}) {
  const [orders, exceptions] = await Promise.all([bcomGetOrders(dates, options), bcomGetExceptions(dates, options)]);

  const exceptionsByOrder = new Map();
  for (const exception of exceptions) {
    const key = `${exception.branchId}:${exception.orderNumber}`;
    if (!exceptionsByOrder.has(key)) exceptionsByOrder.set(key, []);
    exceptionsByOrder.get(key).push(exception);
  }

  return orders.map((order) => ({
    ...order,
    exceptions: exceptionsByOrder.get(`${order.branchId}:${order.orderNumber}`) || [],
  }));
}

// Dish sales (quantity, sales, cancels, discounts, menu category) summed over the business days
// of the range, per branch. options.splitHours adds an "hour" per row (one row per dish per hour).
// The report has no per-order lines and no per-date split (splitDays only gives the weekday);
// use bcomGetItemsByDay for one row set per business day.
async function bcomGetItems(dates, { branchIds, splitHours = false } = {}) {
  const accessToken = await getBcomAccessToken();
  const restaurants = restaurantsFor(branchIds);
  const results = await Promise.all(
    restaurants.map(async ([rest_id, branches]) => {
      const payload = {
        ...itemsReport_payload,
        restaurantId: rest_id,
        filter: {
          ...itemsReport_payload.filter,
          branches: branches.map((branch) => branch.id),
          startDate: dates.startDate,
          endDate: dates.endDate,
          splitHours,
        },
      };
      const data = await postCube('zReports/cube', payload, accessToken);
      const branchNames = Object.fromEntries(branches.map((b) => [b.id, b.branchName]));
      return (data.rows || []).map(({ _id, dayOfWeek, ...row }) => ({
        ...row,
        restaurantId: rest_id,
        branchName: branchNames[row.branchId],
      }));
    }),
  );
  return results.flat();
}

// bcomGetItems one business day at a time; each row gets businessDate (YYYY-MM-DD).
async function bcomGetItemsByDay(dates, options = {}) {
  const rows = [];
  const end = moment(dates.endDate, 'DD/MM/YYYY');
  for (let day = moment(dates.startDate, 'DD/MM/YYYY'); !day.isAfter(end); day.add(1, 'days')) {
    const d = day.format('DD/MM/YYYY');
    const businessDate = day.format('YYYY-MM-DD');
    for (const row of await bcomGetItems({ startDate: d, endDate: d }, options)) rows.push({ ...row, businessDate });
  }
  return rows;
}

const paymentsReport_payload = {
  action: 'getPaymentsReport',
  filter: { roles: [], orderNumber: null, cardNumber: null },
};

// The payments report (דוח תשלומים) for one business day, one branch per call: its rows carry no branch
// and no date. Only the payment-type rows (master) and their card-brand rows are kept; the section sums
// ("תשלומים", "תשלומים מחוץ לזד") and the service footers can be summed from them.
// dates: { startDate: 'DD/MM/YYYY', endDate: 'DD/MM/YYYY' }; each row gets businessDate, branchId, restaurantId.
async function bcomGetPaymentsByDay(dates, { branchIds } = {}) {
  const accessToken = await getBcomAccessToken();
  const rows = [];
  const end = moment(dates.endDate, 'DD/MM/YYYY');
  for (let day = moment(dates.startDate, 'DD/MM/YYYY'); !day.isAfter(end); day.add(1, 'days')) {
    const d = day.format('DD/MM/YYYY');
    const businessDate = day.format('YYYY-MM-DD');
    for (const [rest_id, branches] of restaurantsFor(branchIds)) {
      for (const branch of branches) {
        const payload = {
          ...paymentsReport_payload,
          restaurantId: rest_id,
          filter: { ...paymentsReport_payload.filter, branches: [branch.id], startDate: d, endDate: d },
        };
        const data = await postCube('zReports/cube', payload, accessToken);
        for (const row of data.rows || []) {
          if (row.isSum || row.footer || row.paymentType == null) continue;
          rows.push({ ...row, businessDate, branchId: branch.id, restaurantId: rest_id });
        }
      }
    }
  }
  return rows;
}

function getRecord(row) {
  const { branchId, totalIncome, brutoIncom, serviceTotal, discountTotal, dinnersCount, startTs } = row;
  return {
    // branch: branchName,
    branchId,
    openat: moment(startTs).format('YYYY-MM-DD'),
    total: brutoIncom, //totalIncome
    service: serviceTotal,
    discount: discountTotal,
    diners: dinnersCount,
  };
}

// callAmazonApi();
export default bcomApiLoad;
export { getRecord, getBcomAccessToken, bcomGetPaymentsByDay, bcomGetOrders, bcomGetExceptions, bcomGetOrdersWithExceptions, bcomGetZReports,
  bcomGetItems, bcomGetItemsByDay };
