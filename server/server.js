import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3020;

// Parse JSON bodies
app.use(express.json());

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

// Fallback to index.html for SPA routes (if needed)
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, '../dist/index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

