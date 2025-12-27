import express from 'express';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env, .env_qa, or .envtest depending on command line args and NODE_ENV
let envFileName = '.env';
if (process.argv.includes('qa')) {
  envFileName = '.env_qa';
} else if (process.env.NODE_ENV === 'test') {
  envFileName = '.envtest';
}
dotenv.config({ path: join(__dirname, '../..', envFileName) });

// Import routers after env variables are loaded
const { default: pelecardRouter } = await import('./pelecard.js');
const { default: beecommRouter, menuApiRouter } = await import('./beecomm.js');
const { default: analyticsRouter } = await import('./analytics.js');
const { getState, areOrdersEnabled, getStatusMessage, verifyAuthToken, updateState } = await import('./orderState.js');

const app = express();
const PORT = process.env.PORT || 3020;

// Parse JSON bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Check if orders are enabled (legacy env variable support)
const BSR_ORDERS_ENABLED = process.env.BSR_ORDERS_ENABLED === 'true';

// Helper function to check if orders should be enabled based on URL path
// This is used for UI visibility control only, NOT for blocking order placement
const isOrdersEnabled = (req) => {
  // If path starts with /test/, always enable orders (ignore env variable)
  if (req.path.startsWith('/test/')) {
    return true;
  }
  // Check referer header to see if request came from /test/bsr
  const referer = req.get('referer') || req.get('referrer') || '';
  if (referer.includes('/test/bsr')) {
    return true;
  }
  console.log(`isOrdersEnabled ${BSR_ORDERS_ENABLED} ${req.path}` );
  // Otherwise, respect the BSR_ORDERS_ENABLED environment variable
  return BSR_ORDERS_ENABLED;
};

// API endpoint to check if orders are enabled (for page-level UI control)
// This now checks both legacy env variable and order system state
app.get('/api/orders-enabled', (req, res) => {
  const legacyEnabled = isOrdersEnabled(req);
  const stateEnabled = areOrdersEnabled();
  const enabled = legacyEnabled && stateEnabled;
  
  // Get status message if disabled
  let statusMessage = null;
  if (!stateEnabled) {
    const language = req.query.lang || req.headers['accept-language']?.split(',')[0]?.split('-')[0] || 'he';
    statusMessage = getStatusMessage(language);
  }
  
  res.json({ 
    enabled: enabled,
    state: getState().state,
    statusMessage: statusMessage
  });
});

// API endpoint to get order system state (for admin)
app.get('/api/order-state', (req, res) => {
  const authToken = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
  
  if (!verifyAuthToken(authToken)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  res.json(getState());
});

// API endpoint to update order system state (for admin)
app.post('/api/order-state', (req, res) => {
  const authToken = req.headers.authorization?.replace('Bearer ', '') || req.body.token;
  const { state, updatedBy } = req.body;
  
  if (!state) {
    return res.status(400).json({ error: 'State parameter is required' });
  }
  
  const result = updateState(state, authToken, updatedBy || 'admin');
  
  if (!result.success) {
    return res.status(result.error === 'Unauthorized: Invalid authentication token' ? 401 : 400).json(result);
  }
  
  res.json(result);
});

// Pelecard routes - orders can always be placed regardless of BSR_ORDERS_ENABLED
// BSR_ORDERS_ENABLED only controls UI visibility, not order processing
app.use('/pelecard', pelecardRouter);

// Beecomm routes - orders can always be placed regardless of BSR_ORDERS_ENABLED
// BSR_ORDERS_ENABLED only controls UI visibility, not order processing
app.use('/beecomm', beecommRouter);

// Menu API routes (from beecomm module)
app.use('/api', menuApiRouter);

// Analytics routes
app.use('/api', analyticsRouter);

// Serve static files from dist
app.use(express.static(join(__dirname, '../../dist')));

// CSP headers for iframe embedding
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors 'self' https://www.eatalia-market.co.il/ https://*.allegrogruppo.com;"
  );
  next();
});

// Fallback to index.html for SPA routes (if needed)
app.get('*', (req, res) => {
  // BSR client-side routes (handled by React Router)
  const bsrClientRoutes = ['/welcome', '/cart', '/meal', '/location', '/payment', '/thankYou'];
  const isBSRClientRoute = bsrClientRoutes.some(route => req.path === route || req.path.startsWith(route + '/'));
  
  // BSR entry points
  const isBSREntry = req.path === '/bsr' || req.path === '/test/bsr' || 
                     req.path === '/eatalia-bsr.html' || req.path.startsWith('/test/bsr/');
  
  // Test routes for BSR client-side navigation
  const isTestBSRRoute = req.path.startsWith('/test/welcome') || req.path.startsWith('/test/cart') ||
                         req.path.startsWith('/test/meal') || req.path.startsWith('/test/location') ||
                         req.path.startsWith('/test/payment') || req.path.startsWith('/test/thankYou');
  
  if (isBSRClientRoute || isBSREntry || isTestBSRRoute) {
    return res.sendFile(join(__dirname, '../../dist/eatalia-bsr.html'));
  }
  res.sendFile(join(__dirname, '../../dist/site-index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`BSR Orders Enabled: ${BSR_ORDERS_ENABLED ? 'YES' : 'NO (Coming Soon mode)'}`);
});

