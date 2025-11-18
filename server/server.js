import express from 'express';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env or .envtest depending on NODE_ENV
const envFileName = process.env.NODE_ENV === 'test' ? '.envtest' : '.env';
dotenv.config({ path: join(__dirname, '..', envFileName) });

// Import routers after env variables are loaded
const { default: pelecardRouter } = await import('./pelecard.js');
const { default: beecommRouter } = await import('./beecomm.js');

const app = express();
const PORT = process.env.PORT || 3020;

// Parse JSON bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Pelecard routes
app.use('/pelecard', pelecardRouter);

// Beecomm routes
app.use('/beecomm', beecommRouter);


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

// Analytics endpoint
app.post('/api/track', (req, res) => {
  const { event, data } = req.body;
  console.log('Analytics event:', event, data);
  // In production, you would save this to a database or analytics service
  res.json({ success: true });
});

// Meal options endpoint
app.get('/api/meal-options', (req, res) => {
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

// Beecomm metadata endpoint
app.get('/api/beecomm-metadata', (req, res) => {
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

// Fallback to index.html for SPA routes (if needed)
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, '../dist/index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

