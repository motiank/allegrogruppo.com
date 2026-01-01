// index.js
import axios from 'axios';
import zlib from 'zlib';
import moment from 'moment';

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
  '62f48c2a7f9095f113a7add3': [{ id: '62f48ec8ab47895a757e1c76', branchName: 'מודיעין' }],
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
  // "restaurantId": "64251a17042cbcc5928813fd",
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
    // "branches": [
    //     "64be1926335ee46a739a1ba2",
    //     "65cda80518611cc1cab248ca",
    //     "64251a9f37dc3d5093d7ab53",
    //     "64ddcfdc674a1d497fe49bf8"
    // ],
    // startDate: "16/03/2025",
    // endDate: "22/03/2025",
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
  token: '',
};

function decodeBase64Gzip(encoded) {
  // 1) Base64 decode -> Buffer
  const buffer = Buffer.from(encoded, 'base64');

  // 2) GZIP decompress (synchronous)
  //    If you prefer async, you can use zlib.gunzip() instead.
  const decompressed = zlib.gunzipSync(buffer);

  // 3) Convert the decompressed data to a string
  return JSON.parse(decompressed.toString('utf8'));
}

async function bcomApiLoad(dates, dal_push) {
  try {
    // 1. Exchange the refresh token for a new access token
    const refreshToken =
      'AMf-vBw559ceQiZB1iLxqJbzI8ctQYYzqpUj9pnRsb9YIN336LOGOpZNcwLXb4Nt8BWy92p36hO-eIlMU4cfmoMuMUgc-N4be6C-bOewySA1H2qXCV2aK7wPSZ9q-nmLnvT88lpxxKxBoi4gs9DQFE-5-u2zpI1nMdBS82X9U6ms7YsEPiV5AqaO96fBtDWfgMiTPahUsVJx3kwDY0RRZsvkAYaL8TJiyQ'; // e.g. "AE...Zxy"
    const apiKey = 'AIzaSyCWThH_TX19GrAxoH7zBLE6OzSx2n1Erps'; // e.g. "AIzaSyCWThH_..."

    const tokenUrl = `https://securetoken.googleapis.com/v1/token?key=${apiKey}`;

    // Make the POST request to exchange the refresh token
    // Google expects x-www-form-urlencoded data
    const tokenResponse = await axios.post(
      tokenUrl,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
    );

    // console.log(`token response : ${JSON.stringify(tokenResponse.data, null, "\t")}`);
    // Extract the access token
    const accessToken = tokenResponse.data.access_token;
    // console.log(`Access Token: ${accessToken}`);

    // 2. Use the access token to call your Amazon API
    // const amazonEndpoint = "https://20cs5hma71.execute-api.eu-west-1.amazonaws.com/prod/api/orders/cube";
    const amazonEndpoint = 'https://20cs5hma71.execute-api.eu-west-1.amazonaws.com/prod/api/zReports/cube';
    let payload = zReports_payload;

    https: for (var rest_id in bcom_rest_map) {
      payload.restaurantId = rest_id;

      payload.filter.branches = bcom_rest_map[rest_id].map((branch) => branch.id);
      payload.filter.startDate = dates.startDate;
      payload.filter.endDate = dates.endDate;

      payload.token = `Bearer ${accessToken}`;
      const amazonResponse = await axios.post(amazonEndpoint, payload, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      });

      // let orders = decodeBase64Gzip(amazonResponse.data.rows);
      // console.log(`Amazon API Response:${rest_id} ${orders.length} orders`);
      // console.log(`Amazon API Response: ${JSON.stringify(amazonResponse.data.rows, null, '\t')}`);
      console.log(`Amazon API Response:${rest_id} ${amazonResponse.data.rows.length} days`);
      dal_push('api', amazonResponse.data.rows);
    }
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

function getRecord_(row) {
  const { id, orderNumber, branchId, branchName, total, serviceAmount, discountAmount, dinnersCount, tableNumber } = row;
  return {
    order_id: id,
    order_no: orderNumber,
    // branch: branchName,
    branchId,
    openat: moment(row.openedAt).format('YYYY-MM-DD HH:mm:ss'),
    closeat: moment(row.closedAt).format('YYYY-MM-DD HH:mm:ss'),
    total,
    service: serviceAmount,
    table_no: tableNumber,
    discount: discountAmount,
    // source: row[csv_fields[4]],
    diners: dinnersCount,
  };
}

function getRecord(row) {
  const { branchId, totalIncome, serviceTotal, discountTotal, dinnersCount, startTs } = row;
  return {
    // branch: branchName,
    branchId,
    openat: moment(startTs).format('YYYY-MM-DD'),
    total: totalIncome,
    service: serviceTotal,
    discount: discountTotal,
    diners: dinnersCount,
  };
}

const day_sum = {
  _id: '67dfb898777f7500086d5fa2',
  branchId: '64251a9f37dc3d5093d7ab53',
  branchName: 'פיאמונטה',
  canceledDinnersCount: 4,
  canceledItemsCount: 15,
  delServiceTotal: 0,
  dinnerAvg: 83.44233630952381,
  dinnersCount: 96,
  discountTotal: 673.1,
  endTs: '2025-03-23T21:34:22.303Z',
  orderAvg: 122.1896338028169,
  orderCancelsCount: 7,
  ordersCount: 71,
  reduceDelServiceFromCash: true,
  reduceServiceFromCash: true,
  restaurantId: '64251a17042cbcc5928813fd',
  serviceTotal: 836.376,
  startTs: '2025-03-23T07:30:32.096Z',
  totalIncome: 8675.464,
  totalItemCancels: 608,
  totalItemCancelsInClosedOrders: 608,
  totalPaymentRefund: 58,
  valueDate: '2025-03-23T06:00:00.000Z',
  workHours: 0,
  zNumber: 633,
  dayOfWeek: 1,
  paymentTypes: [
    {
      _id: '67dfb898777f7500086d5fa25',
      branchId: '64251a9f37dc3d5093d7ab53',
      branchName: 'פיאמונטה',
      calcInTotalZ: false,
      paymentType: 5,
      paymentTypeName: 'הקפה',
      restaurantId: '64251a17042cbcc5928813fd',
      subTypes: [],
      totalChargeTransactions: 1,
      totalCharged: 16,
      totalRefundTransactions: 0,
      totalRefunded: 0,
      totalTransactions: 1,
      valueDate: '2025-03-23T06:00:00.000Z',
      zId: '67dfb898777f7500086d5fa2',
    },
    {
      _id: '67dfb898777f7500086d5fa21',
      branchId: '64251a9f37dc3d5093d7ab53',
      branchName: 'פיאמונטה',
      calcInTotalZ: true,
      paymentType: 1,
      paymentTypeName: 'אשראי',
      restaurantId: '64251a17042cbcc5928813fd',
      subTypes: [
        {
          paymentType: 1,
          cardBrand: 'Visa',
          totalTransactions: 30,
          totalRefundTransactions: 0,
          totalCharged: 4131.040000000001,
          totalRefunded: 0,
          commission: 0,
        },
        {
          paymentType: 1,
          cardBrand: 'Mastercard',
          totalTransactions: 21,
          totalRefundTransactions: 0,
          totalCharged: 1851.56,
          totalRefunded: 0,
          commission: 0,
        },
        {
          paymentType: 1,
          cardBrand: 'Private label brand',
          totalTransactions: 2,
          totalRefundTransactions: 1,
          totalCharged: 121.84,
          totalRefunded: 4,
          commission: 0,
        },
        {
          paymentType: 1,
          cardBrand: 'Amex',
          totalTransactions: 1,
          totalRefundTransactions: 0,
          totalCharged: 247.50000000000003,
          totalRefunded: 0,
          commission: 0,
        },
      ],
      totalChargeTransactions: 54,
      totalCharged: 6351.94,
      totalRefundTransactions: 1,
      totalRefunded: 4,
      totalTransactions: 55,
      valueDate: '2025-03-23T06:00:00.000Z',
      zId: '67dfb898777f7500086d5fa2',
    },
    {
      _id: '67dfb898777f7500086d5fa22',
      branchId: '64251a9f37dc3d5093d7ab53',
      branchName: 'פיאמונטה',
      calcInTotalZ: true,
      paymentType: 2,
      paymentTypeName: 'מזומן',
      restaurantId: '64251a17042cbcc5928813fd',
      subTypes: [],
      totalChargeTransactions: 26,
      totalCharged: 2253.524,
      totalRefundTransactions: 1,
      totalRefunded: 54,
      totalTransactions: 27,
      valueDate: '2025-03-23T06:00:00.000Z',
      zId: '67dfb898777f7500086d5fa2',
    },
    {
      _id: '67dfb898777f7500086d5fa210',
      branchId: '64251a9f37dc3d5093d7ab53',
      branchName: 'פיאמונטה',
      calcInTotalZ: true,
      paymentType: 10,
      paymentTypeName: 'Sodexo',
      restaurantId: '64251a17042cbcc5928813fd',
      subTypes: [
        {
          paymentType: 10,
          cardBrand: 'סיבוס',
          totalTransactions: 2,
          totalRefundTransactions: 0,
          totalCharged: 128,
          totalRefunded: 0,
          commission: 0,
        },
      ],
      totalChargeTransactions: 2,
      totalCharged: 128,
      totalRefundTransactions: 0,
      totalRefunded: 0,
      totalTransactions: 2,
      valueDate: '2025-03-23T06:00:00.000Z',
      zId: '67dfb898777f7500086d5fa2',
    },
  ],
  brutoIncom: 8691.464,
  netoIncom: 7352.09,
  taxAmount: 1323.3739999999998,
};

const res = {
  id: '67da9aadb09f1aba6ea41f99',
  orderNumber: 43340,
  orderDailyNumber: 4,
  ccOrderNumber: null,
  branchId: '64be1926335ee46a739a1ba2',
  closedAt: '2025-03-19T10:22:12.897Z',
  total: 54.4,
  netTotal: 54.4,
  branchName: "ג'ויה",
  comment: null,
  discount: 0,
  discountAmount: 0,
  lastAccess: '2025-03-19T10:22:13.049Z',
  openedAt: '2025-03-19T10:21:33.514Z',
  orderType: 2,
  profitUnit: '653f908c68a76d43b3756d7f',
  service: 0,
  serviceAmount: 0,
  clientName: '',
  clientPhoneNumber: '',
  creator: 'ליעד גולצמן',
  status: 2,
  tableNumber: null,
  orderExceptions: 0,
  zId: '67da8d3eb5164a0008818e8e',
  totalItems: 1,
  totalCanceled: 0,
  externalCompanyName: null,
  externalOrderId: null,
  dinnersCount: 0,
};

// callAmazonApi();
export default bcomApiLoad;
export { getRecord };
