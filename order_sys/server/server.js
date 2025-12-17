import express from 'express';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env or .envtest depending on NODE_ENV
const envFileName = process.env.NODE_ENV === 'test' ? '.envtest' : '.env';
dotenv.config({ path: join(__dirname, '../..', envFileName) });

// Import routers after env variables are loaded
const { default: pelecardRouter } = await import('./pelecard.js');
const { default: beecommRouter, menuApiRouter } = await import('./beecomm.js');
const { default: analyticsRouter } = await import('./analytics.js');

const app = express();
const PORT = process.env.PORT || 3020;

// Parse JSON bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Check if orders are enabled
const BSR_ORDERS_ENABLED = process.env.BSR_ORDERS_ENABLED === 'true';

// Helper function to check if orders should be enabled based on URL path
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
  // Otherwise, respect the BSR_ORDERS_ENABLED environment variable
  return BSR_ORDERS_ENABLED;
};

// Middleware to block order endpoints when orders are disabled
const checkOrdersEnabled = (req, res, next) => {
  if (!isOrdersEnabled(req)) {
    return res.status(503).json({
      error: 'Orders are currently disabled',
      message: 'The ordering system is temporarily unavailable. Please check back soon.',
    });
  }
  next();
};

// API endpoint to check if orders are enabled (must be before middleware)
app.get('/api/orders-enabled', (req, res) => {
  res.json({ enabled: isOrdersEnabled(req) });
});

// Pelecard routes - block if orders disabled
app.use('/pelecard', checkOrdersEnabled, pelecardRouter);

// Beecomm routes - block if orders disabled
app.use('/beecomm', checkOrdersEnabled, beecommRouter);

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
  if(req.path === '/bsr' || req.path === '/test/bsr') {
    return res.sendFile(join(__dirname, '../../dist/eatalia-bsr.html'));
  }
  res.sendFile(join(__dirname, '../../dist/site-index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`BSR Orders Enabled: ${BSR_ORDERS_ENABLED ? 'YES' : 'NO (Coming Soon mode)'}`);
});

