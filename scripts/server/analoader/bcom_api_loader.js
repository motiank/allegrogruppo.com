// index.js
import axios from 'axios';
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
export { getRecord };
