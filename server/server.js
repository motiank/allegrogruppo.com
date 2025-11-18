import express from 'express';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env or .envtest depending on NODE_ENV
const envFileName = process.env.NODE_ENV === 'test' ? '.envtest' : '.env';
dotenv.config({ path: join(__dirname, '..', envFileName) });

// Import routers after env variables are loaded
const { default: pelecardRouter } = await import('./pelecard.js');
const { default: beecommRouter, menuApiRouter } = await import('./beecomm.js');
const { default: analyticsRouter } = await import('./analytics.js');

const app = express();
const PORT = process.env.PORT || 3020;

// Parse JSON bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Pelecard routes
app.use('/pelecard', pelecardRouter);

// Beecomm routes
app.use('/beecomm', beecommRouter);

// Menu API routes (from beecomm module)
app.use('/api', menuApiRouter);

// Analytics routes
app.use('/api', analyticsRouter);

// Serve static files from dist
app.use(express.static(join(__dirname, '../dist')));

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
  res.sendFile(join(__dirname, '../dist/index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

