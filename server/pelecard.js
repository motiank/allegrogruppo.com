import express from 'express';

const router = express.Router();



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
  const feedbackGoodUrl = buildUrl(feedbackBase, '/pelecard/feedback/good');
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

    res.json({
      iframeUrl,
      // transactionId: result.ResultData?.TransactionId,
      orderId: `${orderId}`,
    });
  } catch (error) {
    console.error('[pelecard] Unexpected error during init:', error);
    res.status(500).json({
      error: 'Unexpected error while contacting Pelecard.',
    });
  }
});

router.get('/good', (req, res) => {
  console.log('[pelecard] Landing good URL hit:', req.query);
  res.json({
    message: 'Payment completed. Validate server-side before marking as paid.',
    query: req.query,
  });
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


