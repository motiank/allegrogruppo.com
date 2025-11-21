import express from 'express';
import axios from 'axios';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { validateTransaction, getOrderData } from './pelecard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

const {
  BEECOMM_CLIENT_ID,
  BEECOMM_CLIENT_SECRET,
  BEECOMM_API_BASE_URL = 'https://api.beecommcloud.com/v1',
  BEECOMM_RESTAURANT_ID,
  BEECOMM_BRANCH_ID,
} = process.env;

// Create axios instance for Beecomm API
const beecommApi = axios.create({
  baseURL: BEECOMM_API_BASE_URL,
  timeout: 10000,
});

/**
 * Get access token from Beecomm API
 * @returns {Promise<string>} access_token
 */
async function getAccessToken() {
  if (!BEECOMM_CLIENT_ID || !BEECOMM_CLIENT_SECRET) {
    throw new Error('BEECOMM_CLIENT_ID and BEECOMM_CLIENT_SECRET must be set in .env');
  }

  try {
    const params = new URLSearchParams();
    params.append('client_id', BEECOMM_CLIENT_ID);
    params.append('client_secret', BEECOMM_CLIENT_SECRET);

    const { data } = await beecommApi.post('/auth/token', params);

    if (!data.result || !data.access_token) {
      throw new Error(
        `Beecomm auth failed: ${data.message || 'Unknown error'} (requestId=${data.requestId})`
      );
    }

    return data.access_token;
  } catch (error) {
    console.error('[beecomm] getAccessToken error:', error.message);
    throw error;
  }
}

/**
 * Push an order to Beecomm
 * @param {string} accessToken
 * @param {Object} orderPayload
 * @returns {Promise<Object>}
 */
async function pushOrder(accessToken, orderPayload) {
  try {
    const { data } = await beecommApi.post('/order-center/pushOrder', orderPayload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    return data;
  } catch (error) {
    console.error('[beecomm] pushOrder error:', error.message);
    if (error.response) {
      console.error('[beecomm] pushOrder response:', error.response.data);
    }
    throw error;
  }
}

/**
 * Get access list (restaurants & branches) from Beecomm
 * @param {string} accessToken
 * @returns {Promise<Object>}
 */
async function getAccessList(accessToken) {
  try {
    const { data } = await beecommApi.get('/ext/getAccessList', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    return data;
  } catch (error) {
    console.error('[beecomm] getAccessList error:', error.message);
    if (error.response) {
      console.error('[beecomm] getAccessList response:', error.response.data);
    }
    throw error;
  }
}

/**
 * Get full menu from Beecomm
 * @param {string} accessToken
 * @param {string} restaurantId
 * @param {string} branchId
 * @returns {Promise<Object>}
 */
async function getMenu(accessToken, restaurantId, branchId) {
  try {
    const { data } = await beecommApi.post(
      '/order-center/getMenu',
      {
        restaurantId,
        branchId,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    return data;
  } catch (error) {
    console.error('[beecomm] getMenu error:', error.message);
    if (error.response) {
      console.error('[beecomm] getMenu response:', error.response.data);
    }
    throw error;
  }
}

/**
 * Format JSON as pretty HTML
 * @param {Object} data
 * @returns {string}
 */
function formatJsonAsHtml(data) {
  const jsonString = JSON.stringify(data, null, 2);
  const escapedJson = jsonString
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Beecomm Menu</title>
  <style>
    body {
      font-family: 'Courier New', monospace;
      background: #1e1e1e;
      color: #d4d4d4;
      padding: 20px;
      margin: 0;
    }
    pre {
      background: #252526;
      border: 1px solid #3e3e42;
      border-radius: 4px;
      padding: 20px;
      overflow-x: auto;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .key { color: #9cdcfe; }
    .string { color: #ce9178; }
    .number { color: #b5cea8; }
    .boolean { color: #569cd6; }
    .null { color: #569cd6; }
  </style>
</head>
<body>
  <h1>Beecomm Menu</h1>
  <pre>${escapedJson}</pre>
</body>
</html>
  `.trim();
}

/**
 * Structure order data from Pelecard feedback for Beecomm
 * This is a simplified example - you'll need to adapt based on your actual order structure
 * @param {Object} pelecardData - Data from Pelecard feedback
 * @param {Object} orderData - Your internal order data
 * @returns {Object} Beecomm order payload
 */
function structureOrderForBeecomm(pelecardData, orderData) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const purchaseTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate()
  )} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  // Extract amount from Pelecard data (in agorot, convert to NIS)
  const totalInAgorot = parseInt(pelecardData.DebitTotal || pelecardData.Total || '0', 10);
  const orderTotal = totalInAgorot / 100;

  // Build order payload according to Beecomm API spec
  // This is a template - you'll need to adapt based on your actual order structure
  const payload = {
    restaurantId: BEECOMM_RESTAURANT_ID,
    branchId: BEECOMM_BRANCH_ID,
    menuRevision: orderData.menuRevision || '', // You should store this when fetching menu
    orderInfo: {
      orderType: 3, // 2 = takeaway, 3 = delivery
      comments: orderData.comments || `Order from Pelecard transaction ${pelecardData.PelecardTransactionId || ''}`,
      discountAmount: 0,
      internalOrderId: pelecardData.ParamX || pelecardData.UserKey || `order-${now.getTime()}`,
      dinnersCount: 1,
      purchaseTime,
      orderTotal,
      dinners: [
        {
          firstName: orderData.customerFirstName || '',
          lastName: orderData.customerLastName || '',
          phoneNumber: orderData.phoneNumber || '',
          emailAddress: orderData.emailAddress || '',
          items: orderData.items || [], // Array of dish items
        },
      ],
      payments: [
        {
          charged: true, // Already charged via Pelecard
          paymentType: 1, // 1=Credit, 2=Cash, etc.
          paymentSum: orderTotal,
          tip: 0,
          cardInfo: {
            approvalNumber: pelecardData.ApprovalNo || '',
            cardNumber: pelecardData.CreditCardNumber || '',
            cardExpirationDate: pelecardData.CreditCardExpDate || '',
            cardHolderName: pelecardData.CardHolderName || '',
            cvv: 0,
          },
        },
      ],
      deliveryInfo: orderData.deliveryInfo || {},
    },
  };

  return payload;
}

// POST /beecomm/pelecard/placeorder
// This endpoint is called by Pelecard servers (ServerSideGoodFeedbackURL)
router.post('/pelecard/placeorder', async (req, res) => {
  console.log('[beecomm] Pelecard placeorder received:', req.body);

  try {
    // Parse Pelecard feedback data
    // Pelecard may send JSON directly or wrapped in a form field
    let pelecardData = req.body;
    if (req.body.resultDataKeyName && req.body[req.body.resultDataKeyName]) {
      // If wrapped in a form field, parse it
      pelecardData = JSON.parse(req.body[req.body.resultDataKeyName]);
    }

    // Extract key fields
    // Note: ServerSideGoodFeedbackURL is only called for successful transactions,
    // so PelecardStatusCode is NOT included in the payload (it's only in landing page parameters)
    const {
      ConfirmationKey,
      UserKey,
      ParamX,
      PelecardTransactionId,
      TransactionId,
      DebitTotal,
      Total,
    } = pelecardData;

    // Validate transaction with Pelecard
    const totalInAgorot = parseInt(DebitTotal || Total || '0', 10);
    const uniqueKey = UserKey || PelecardTransactionId;

    if (!ConfirmationKey || !uniqueKey) {
      console.error('[beecomm] Missing ConfirmationKey or UniqueKey');
      return res.status(400).json({
        error: 'Missing required Pelecard validation parameters',
      });
    }

    const isValid = await validateTransaction(ConfirmationKey, uniqueKey, totalInAgorot);

    if (!isValid) {
      console.error('[beecomm] Pelecard validation failed');
      return res.status(400).json({
        error: 'Transaction validation failed',
      });
    }

    console.log('[beecomm] Pelecard transaction validated successfully');

    // Retrieve order data from storage using ConfirmationKey and orderId
    const storedOrderData = getOrderData(ConfirmationKey, uniqueKey);

    if (!storedOrderData) {
      console.error('[beecomm] Order data not found in storage for ConfirmationKey:', ConfirmationKey, 'orderId:', uniqueKey);
      return res.status(404).json({
        error: 'Order data not found',
        message: 'Order information was not found in storage. It may have expired or was never stored.',
      });
    }

    console.log('[beecomm] Retrieved order data from storage:', storedOrderData);

    // Get access token
    const accessToken = await getAccessToken();

    // Extract location data for customer info and delivery
    const locationData = storedOrderData.locationData || {};
    const cartItems = storedOrderData.cartItems || [];

    // Convert cartItems to Beecomm items format
    const items = cartItems.map((cartItem) => {
      // Calculate total price for this item
      const unitPrice = cartItem.unitPrice || 0;
      const totalPrice = unitPrice * (cartItem.quantity || 1);

      // Convert selections to toppings format
      // Note: This is a simplified conversion - you may need to adjust based on your menu structure
      const toppings = [];
      if (cartItem.selections) {
        Object.entries(cartItem.selections).forEach(([groupId, optionIds]) => {
          if (Array.isArray(optionIds)) {
            optionIds.forEach((optionId) => {
              toppings.push({
                toppingGroupId: groupId,
                toppingId: optionId,
              });
            });
          }
        });
      }

      return {
        dishId: cartItem.id, // Use the meal/dish ID
        itemName: cartItem.name || cartItem.id, // Use name if available, fallback to ID
        isCombo: false, // Set based on your menu structure
        quantity: cartItem.quantity || 1,
        dishPrice: unitPrice,
        totalPrice: totalPrice,
        preparationComments: '', // Can be added from cartItem if available
        remarks: [],
        toppings: toppings,
        subItems: [], // For combo items
      };
    });

    // Use stored order data, merging with any additional data from Pelecard
    const orderData = {
      menuRevision: storedOrderData.menuRevision || '',
      customerFirstName: locationData.firstName || pelecardData.CardHolderName?.split(' ')[0] || '',
      customerLastName: locationData.lastName || pelecardData.CardHolderName?.split(' ').slice(1).join(' ') || '',
      phoneNumber: locationData.phone || pelecardData.CardHolderPhone || '',
      emailAddress: locationData.email || pelecardData.CardHolderEmail || '',
      items: items,
      deliveryInfo: {
        firstName: locationData.firstName || '',
        lastName: locationData.lastName || '',
        phoneNumber: locationData.phone || '',
        cellular: locationData.phone || '',
        building: locationData.building || '',
        floor: locationData.floor || '',
        office: locationData.office || '',
        // Add other delivery fields as needed
      },
      comments: storedOrderData.comments || `Pelecard transaction: ${PelecardTransactionId}`,
      locationData: locationData,
      cartItems: cartItems,
    };

    // Structure order for Beecomm
    const beecommOrder = structureOrderForBeecomm(pelecardData, orderData);

    // Push order to Beecomm
    const result = await pushOrder(accessToken, beecommOrder);

    if (!result.result) {
      console.error('[beecomm] pushOrder failed:', result);
      return res.status(500).json({
        error: 'Failed to push order to Beecomm',
        message: result.message,
        status: result.status,
      });
    }

    console.log('[beecomm] Order pushed successfully:', result.orderNumber);

    // Return success response to Pelecard
    res.status(200).json({
      success: true,
      orderNumber: result.orderNumber,
      message: result.message,
    });
  } catch (error) {
    console.error('[beecomm] Error processing placeorder:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
});

// GET /beecomm/getaccesslist
router.get('/getaccesslist', async (req, res) => {
  try {
    // Get access token
    const accessToken = await getAccessToken();

    // Get access list from Beecomm
    const accessListData = await getAccessList(accessToken);

    if (!accessListData.result) {
      return res.status(500).json({
        error: 'Failed to fetch access list from Beecomm',
        message: accessListData.message,
        status: accessListData.status,
      });
    }

    // Return JSON response
    res.json(accessListData);
  } catch (error) {
    console.error('[beecomm] Error fetching access list:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
});

// GET /beecomm/getmenu
router.get('/getmenu', async (req, res) => {
  try {
    if (!BEECOMM_RESTAURANT_ID || !BEECOMM_BRANCH_ID) {
      return res.status(500).json({
        error: 'BEECOMM_RESTAURANT_ID and BEECOMM_BRANCH_ID must be set in .env',
      });
    }

    // Get access token
    const accessToken = await getAccessToken();

    // Get menu from Beecomm
    const menuData = await getMenu(accessToken, BEECOMM_RESTAURANT_ID, BEECOMM_BRANCH_ID);

    if (!menuData.result) {
      return res.status(500).json({
        error: 'Failed to fetch menu from Beecomm',
        message: menuData.message,
        status: menuData.status,
      });
    }

    // Format as pretty JSON HTML
    const html = formatJsonAsHtml(menuData);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    console.error('[beecomm] Error fetching menu:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
});

export default router;

// Export a separate router for API endpoints
export const menuApiRouter = express.Router();

// GET /api/meal-options
menuApiRouter.get('/meal-options', (req, res) => {
  try {
    let menuPath;
    if (process.env.MENU_PATH) {
      // If MENU_PATH is absolute, use it as is; otherwise resolve relative to project root
      menuPath = process.env.MENU_PATH.startsWith('/')
        ? process.env.MENU_PATH
        : join(__dirname, '..', process.env.MENU_PATH);
    } else {
      menuPath = join(__dirname, '..', 'menu', 'mealOptions.json');
    }
    const mealOptions = JSON.parse(readFileSync(menuPath, 'utf8'));
    res.json(mealOptions);
  } catch (error) {
    console.error('Error loading meal options:', error);
    res.status(500).json({ error: 'Failed to load meal options' });
  }
});

// GET /api/beecomm-metadata
menuApiRouter.get('/beecomm-metadata', (req, res) => {
  try {
    const metadataPath = join(__dirname, '..', 'menu', 'beecomm_metadata.json');
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
    res.json(metadata);
  } catch (error) {
    console.error('Error loading beecomm metadata:', error);
    // Return empty metadata if file doesn't exist (for backward compatibility)
    res.json({
      menuRevision: '',
      source: 'beecomm',
      dishMappings: {},
    });
  }
});

