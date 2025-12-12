import express from 'express';
import { executeSql } from './sources/dbpool.js';

const router = express.Router();

// Map to store orders: ConfirmationKey => order info
// Also temporarily store by orderId until ConfirmationKey is available
const orderStorage = new Map();

/**
 * only for test purposes
 * 


let order_info_test={
   cartItems: [
     {
       id: '5e6784ecc71636f55da44656',
       key: '5e6784ecc71636f55da44656::69032aeedff0f5c7e947be70:',
       quantity: 1,
       selections: [Object],
       unitPrice: 5,
       basePrice: 5,
       optionsPrice: 0
     }
   ],
   locationData: {
     name: 'Moti Ankonina',
     building: 'I',
     floor: '2',
     office: 'דניאל ושות',
     phone: '0526611747',
     notes: '',
     groupName: ''
   },
   menuRevision: '691b061dca26f100029a6794',
   total: '500',
   orderId: '78ec967b-c01c-43c5-9a76-bcd5eb6d7c91',
   currency: '1',
   timestamp: '2025-11-21T21:14:47.904Z'
 }


  orderStorage.set(`confirmationKey:e43449e4b4fe37e4e84bb1a79f5b4547`, order_info_test);

  */

/**
 * Retrieve order data by ConfirmationKey or orderId (UserKey/ParamX)
 * @param {string} confirmationKey - ConfirmationKey from Pelecard
 * @param {string} orderId - UserKey or ParamX (orderId)
 * @returns {Object|null} Order data or null if not found
 */
export function getOrderData(confirmationKey, orderId) {
  // Try ConfirmationKey first
  if (confirmationKey) {
    const order = orderStorage.get(`confirmationKey:${confirmationKey}`);
    if (order) {
      return order;
    }
  }

  // Fallback to orderId
  if (orderId) {
    const order = orderStorage.get(`orderId:${orderId}`);
    if (order && confirmationKey) {
      // Store with ConfirmationKey for future reference
      orderStorage.set(`confirmationKey:${confirmationKey}`, order);
    }
    return order;
  }

  return null;
}



const {
  PELECARD_TERMINAL,
  PELECARD_USER,
  PELECARD_PASSWORD,
  PELECARD_BASE_URL = 'https://gateway21.pelecard.biz',
  PELECARD_PUBLIC_BASE_URL,
  PELECARD_FEEDBACK_BASE_URL,
} = process.env;

const INIT_ENDPOINT = new URL('/PaymentGW/init', PELECARD_BASE_URL).toString();

function getRequestBase(req) {
  const originHeader = req.get?.('origin') || req.headers?.origin;
  if (originHeader) {
    return originHeader;
  }

  const host = req.get?.('host');
  const protocol = req.protocol || 'http';

  if (host) {
    return `${protocol}://${host}`;
  }

  return null;
}

function buildUrl(base, path) {
  if (!base) {
    return null;
  }

  try {
    const url = new URL(path, base);
    return url.toString();
  } catch (error) {
    console.error('[pelecard] Failed to construct URL', path, 'base', base, error);
    return null;
  }
}

function extractIframeUrl(resultData = {}) {
  return (
    resultData.Url ||
    resultData.URL ||
    resultData.IframeUrl ||
    resultData.IframeURL ||
    resultData.PaymentUrl ||
    resultData.PaymentURL ||
    ''
  );
}

router.post('/get-iframe-url', async (req, res) => {
    console.log('[pelecard] Getting iframe URL:', req.body);
  const {
    orderId,
    total,
    currency = '1',
    language = 'HE',
    goodUrl,
    errorUrl,
    cancelUrl,
    qaResultStatus,
    orderData, // Full order data to store for later use
  } = req.body ?? {};

  if (!orderId || total === undefined || total === null) {
    return res.status(400).json({
      error: 'orderId and total are required to create a Pelecard checkout.',
    });
  }

  if (!PELECARD_TERMINAL || !PELECARD_USER || !PELECARD_PASSWORD) {
    return res.status(500).json({
      error:
        'Pelecard credentials are not configured. Set PELECARD_TERMINAL, PELECARD_USER, and PELECARD_PASSWORD.',
    });
  }

  const normalizedTotal =
    typeof total === 'number' ? Math.round(total).toString() : `${total}`;

  const requestBase = getRequestBase(req);
  const landingBase = PELECARD_PUBLIC_BASE_URL || requestBase;

  const landingGoodUrl =
    goodUrl || buildUrl(landingBase, '/pelecard/good');

  const landingErrorUrl =
    errorUrl || buildUrl(landingBase, '/pelecard/bad');

  const landingCancelUrl =
    cancelUrl || buildUrl(landingBase, '/pelecard/cancel');

  if (!landingGoodUrl || !landingErrorUrl) {
    return res.status(400).json({
      error:
        'Missing landing URLs. Provide goodUrl/errorUrl in the request or configure PELECARD_PUBLIC_BASE_URL.',
    });
  }

  const feedbackBase = PELECARD_FEEDBACK_BASE_URL;
  // ServerSideGoodFeedbackURL should point to beecomm endpoint that processes the order
  const feedbackGoodUrl = buildUrl(feedbackBase, '/beecomm/pelecard/placeorder');
  const feedbackErrorUrl = buildUrl(feedbackBase, '/pelecard/feedback/error');

  if (!feedbackGoodUrl || !feedbackErrorUrl) {
    return res.status(500).json({
      error:
        'Server-side feedback URLs are not configured. Set PELECARD_FEEDBACK_BASE_URL to a publicly accessible domain.',
    });
  }

  if (typeof globalThis.fetch !== 'function') {
    return res.status(500).json({
      error:
        'Fetch API is not available in this Node.js version. Please upgrade to Node 18+ or polyfill fetch.',
    });
  }

  const initPayload = {
    terminal: PELECARD_TERMINAL,
    user: PELECARD_USER,
    password: PELECARD_PASSWORD,
    ActionType: 'J4',
    CardHolderName: 'Must',
    Currency: `${currency}`,
    Total: normalizedTotal,
    Language: language,
    GoodURL: landingGoodUrl,
    ErrorURL: landingErrorUrl,
    CancelURL: landingCancelUrl,
    UserKey: `${orderId}`,
    ParamX: `${orderId}`,
    ServerSideGoodFeedbackURL: feedbackGoodUrl,
    ServerSideErrorFeedbackURL: feedbackErrorUrl,
    resultDataKeyName: 'eatalia_res',
  };

  if (qaResultStatus) {
    initPayload.QAResultStatus = qaResultStatus;
  }
console.log('INIT_ENDPOINT', INIT_ENDPOINT);
console.log('initPayload', initPayload);

  try {
    const response = await globalThis.fetch(INIT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(initPayload),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('[pelecard] Init request failed:', response.status, text);
      return res.status(502).json({
        error: `Pelecard init failed with HTTP status ${response.status}.`,
      });
    }

    const result = await response.json();

    if (result.Error?.ErrCode !== 0 && typeof result.URL === "string") {
      console.error('[pelecard] Init request returned error:', result);
      return res.status(502).json({
        error: 'Pelecard init returned a non-success status code.',
        statusCode: result.StatusCode,
        errorMessage: result.ErrorMessage,
      });
    }

    const iframeUrl = extractIframeUrl(result);

    if (!iframeUrl) {
      console.error('[pelecard] Init success but iframe URL missing:', result);
      return res.status(502).json({
        error: 'Pelecard init did not return an iframe URL.',
      });
    }

    // Check if ConfirmationKey is in the response (unlikely but possible)
    const confirmationKey = result.ConfirmationKey || result.ResultData?.ConfirmationKey;

    // Store order data temporarily with orderId
    // If ConfirmationKey is available, also store with ConfirmationKey
    if (orderData) {
      const orderInfo = {
        ...orderData,
        orderId: `${orderId}`,
        total,
        currency,
        timestamp: new Date().toISOString(),
      };
      
      console.log('orderInfo', orderInfo);

      // Store with orderId for retrieval via UserKey/ParamX
      orderStorage.set(`orderId:${orderId}`, orderInfo);

      // If ConfirmationKey is available in init response, store with it too
      if (confirmationKey) {
        orderStorage.set(`confirmationKey:${confirmationKey}`, orderInfo);
        console.log('[pelecard] Stored order with ConfirmationKey from init:', confirmationKey);
      } else {
        console.log('[pelecard] Stored order with orderId (ConfirmationKey will come in feedback):', orderId);
      }

      // Insert order into database
      try {
        const customerName = orderData.locationData?.name || null;
        const phone = orderData.locationData?.phone || null;
        const orderTotal = typeof total === 'number' ? total : parseFloat(total) || 0;
        
        // Prepare orderData JSON - preserve original structure and ensure required fields
        const orderDataJson = {
          ...orderData,
          cartItems: orderData.cartItems || [],
          locationData: orderData.locationData || {},
          menuRevision: orderData.menuRevision || '',
          total: orderData.total !== undefined ? orderData.total : orderTotal,
          orderId: `${orderId}`
        };

        const insertQuery = `
          INSERT INTO allegro.orders (orderId, total, currency, language, customer_name, phone, orderData)
          VALUES (:orderId, :total, :currency, :language, :customer_name, :phone, :orderData)
          ON DUPLICATE KEY UPDATE
            total = VALUES(total),
            currency = VALUES(currency),
            language = VALUES(language),
            customer_name = VALUES(customer_name),
            phone = VALUES(phone),
            orderData = VALUES(orderData),
            updated_at = CURRENT_TIMESTAMP
        `;

        const insertParams = {
          orderId: `${orderId}`,
          total: orderTotal,
          currency: `${currency}`,
          language: language,
          customer_name: customerName,
          phone: phone,
          orderData: JSON.stringify(orderDataJson)
        };

        await executeSql(insertQuery, insertParams);
        console.log('[pelecard] Order inserted into database:', orderId);
      } catch (dbError) {
        // Log error but don't fail the request - order is still stored in memory
        console.error('[pelecard] Failed to insert order into database:', dbError);
      }
    }

    const responseData = {
      iframeUrl,
      orderId: `${orderId}`,
    };

    // Include ConfirmationKey if available
    if (confirmationKey) {
      responseData.confirmationKey = confirmationKey;
    }

    res.json(responseData);
  } catch (error) {
    console.error('[pelecard] Unexpected error during init:', error);
    res.status(500).json({
      error: 'Unexpected error while contacting Pelecard.',
    });
  }
});

router.get('/good', (req, res) => {
  console.log('[pelecard] Landing good URL hit:', req.query);
  
  // Extract approval number from query parameters
  const approvalNo = req.query.ApprovalNo || req.query.DebitApproveNumber || '';
  const statusCode = req.query.PelecardStatusCode || '';
  const userKey = req.query.UserKey || req.query.ParamX || '';
  
  // Return HTML that notifies parent window and closes iframe
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Successful</title>
  <style>
    body {
      margin: 0;
      padding: 20px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      text-align: center;
    }
    .container {
      background: rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(10px);
      padding: 40px;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }
    h1 {
      margin: 0 0 20px 0;
      font-size: 2rem;
    }
    p {
      margin: 10px 0;
      font-size: 1.1rem;
    }
    .spinner {
      border: 3px solid rgba(255, 255, 255, 0.3);
      border-top: 3px solid white;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
      margin: 20px auto;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>✓ Payment Successful</h1>
    <p>Processing your order...</p>
    <div class="spinner"></div>
  </div>
  <script>
    (function() {
      // Extract approval number and status from URL parameters
      const approvalNo = ${JSON.stringify(approvalNo)};
      const statusCode = ${JSON.stringify(statusCode)};
      const userKey = ${JSON.stringify(userKey)};
      
      // Notify parent window to close iframe and proceed
      if (window.parent && window.parent !== window) {
        try {
          window.parent.postMessage({
            type: 'pelecard_payment_success',
            approvalNo: approvalNo,
            statusCode: statusCode,
            userKey: userKey,
            timestamp: Date.now()
          }, '*');
          
          console.log('[pelecard/good] Sent success message to parent:', {
            approvalNo: approvalNo,
            statusCode: statusCode,
            userKey: userKey
          });
        } catch (error) {
          console.error('[pelecard/good] Error sending message to parent:', error);
        }
      } else {
        console.warn('[pelecard/good] No parent window found');
      }
    })();
  </script>
</body>
</html>
  `.trim();
  
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

router.get('/bad', (req, res) => {
  console.log('[pelecard] Landing bad URL hit:', req.query);
  res.json({
    message: 'Payment failed or was cancelled.',
    query: req.query,
  });
});

router.get('/cancel', (req, res) => {
  console.log('[pelecard] Landing cancel URL hit:', req.query);
  res.json({
    message: 'Payment was cancelled by the cardholder.',
    query: req.query,
  });
});

router.post('/feedback/good', (req, res) => {
  console.log('[pelecard] Server-side good feedback received:', req.body);
  
  // Extract ConfirmationKey and UserKey/ParamX from feedback
  let pelecardData = req.body;
  if (req.body.resultDataKeyName && req.body[req.body.resultDataKeyName]) {
    pelecardData = JSON.parse(req.body[req.body.resultDataKeyName]);
  }

  const confirmationKey = pelecardData.ConfirmationKey;
  const userKey = pelecardData.UserKey || pelecardData.ParamX;

  // Try to retrieve order data using ConfirmationKey first, then fallback to orderId
  let orderInfo = null;
  if (confirmationKey) {
    orderInfo = orderStorage.get(`confirmationKey:${confirmationKey}`);
    if (orderInfo) {
      console.log('[pelecard] Retrieved order using ConfirmationKey:', confirmationKey);
    }
  }

  // If not found by ConfirmationKey, try by orderId (UserKey/ParamX)
  if (!orderInfo && userKey) {
    orderInfo = orderStorage.get(`orderId:${userKey}`);
    if (orderInfo) {
      console.log('[pelecard] Retrieved order using orderId (UserKey):', userKey);
      // Now store it with ConfirmationKey for future reference
      if (confirmationKey) {
        orderStorage.set(`confirmationKey:${confirmationKey}`, orderInfo);
        console.log('[pelecard] Stored order with ConfirmationKey from feedback:', confirmationKey);
      }
    }
  }

  if (!orderInfo) {
    console.warn('[pelecard] Order data not found for ConfirmationKey:', confirmationKey, 'UserKey:', userKey);
  }

  // Store the order info in req for the beecomm router to use
  req.orderInfo = orderInfo;
  req.pelecardData = pelecardData;

  res.status(200).json({ received: true });
});

router.post('/feedback/error', (req, res) => {
  console.log('[pelecard] Server-side error feedback received:', req.body);
  res.status(200).json({ received: true });
});

/**
 * Validate a Pelecard transaction using ValidateByUniqueKey
 * @param {string} confirmationKey - ConfirmationKey from Pelecard feedback/landing
 * @param {string} uniqueKey - UserKey or TransactionId
 * @param {string|number} totalX100 - Total amount in agorot (cents)
 * @returns {Promise<boolean>} - true if valid, false otherwise
 */
export async function validateTransaction(confirmationKey, uniqueKey, totalX100) {
  if (!confirmationKey || !uniqueKey || totalX100 === undefined || totalX100 === null) {
    console.error('[pelecard] validateTransaction: missing required parameters');
    return false;
  }

  if (!PELECARD_TERMINAL || !PELECARD_USER || !PELECARD_PASSWORD) {
    console.error('[pelecard] validateTransaction: Pelecard credentials not configured');
    return false;
  }

  const VALIDATE_ENDPOINT = new URL('/PaymentGW/ValidateByUniqueKey', PELECARD_BASE_URL).toString();

  const payload = {
    ConfirmationKey: confirmationKey,
    UniqueKey: uniqueKey,
    TotalX100: `${totalX100}`,
  };

  try {
    const response = await globalThis.fetch(VALIDATE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('[pelecard] ValidateByUniqueKey request failed:', response.status, text);
      return false;
    }

    const result = await response.text();
    // Response is "1" for valid, "0" for invalid
    const isValid = result.trim() === '1';
    
    if (!isValid) {
      console.warn('[pelecard] ValidateByUniqueKey returned invalid:', result);
    }

    return isValid;
  } catch (error) {
    console.error('[pelecard] Unexpected error during ValidateByUniqueKey:', error);
    return false;
  }
}

export default router;


