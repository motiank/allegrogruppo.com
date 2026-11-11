// Joya Headquarter — the AI headquarters of the Joya restaurant chain. Its own service:
// own port, own logins, own phone app; shares only the MySQL server with the rest of the repo
// (tables joya_*). The AI runner that answers questions lives in hq/runner. See README.md.
import './lib/env.js'; // MUST stay first — loads the env before other imports read it.
import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import path from 'path';
import { existsSync } from 'fs';
import { SERVICE_ROOT } from './lib/env.js';
import log from './lib/log.js';
import { getDbPool } from './lib/dbpool.js';
import sessionRoutes from './src/sessionRoutes.js';
import joyaRoutes from './src/routes.js';

process.on('unhandledRejection', (reason) => {
  log.fatal({ err: reason instanceof Error ? reason : new Error(String(reason)) }, 'unhandledRejection');
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  log.fatal({ err }, 'uncaughtException');
  process.exit(1);
});

if (!process.env.JOYA_SESSION_SECRET) {
  log.fatal('JOYA_SESSION_SECRET is not set (any long random string: openssl rand -hex 32)');
  process.exit(1);
}

const PROD_DIR = path.join(SERVICE_ROOT, 'prod');
const app = express();
app.disable('x-powered-by');
app.use(compression());
// Imports are CSV text posted as JSON (src/services/imports.js), so allow big bodies.
app.use(express.json({ limit: '20mb' }));
app.use(cookieParser());

app.get('/health', async (req, res) => {
  try {
    await getDbPool().query('SELECT 1');
    res.json({ status: 'ok', db: 'ok' });
  } catch (e) {
    res.status(503).json({ status: 'error', db: e.code || e.message });
  }
});

app.use('/api', sessionRoutes);
app.use('/api', joyaRoutes);
app.use('/api', (req, res) => res.status(404).json({ error: `not found: ${req.method} ${req.originalUrl}` }));

// The built phone app (client/ → `npm run build` → prod/). index.html carries no data;
// client/App.js asks GET /api/session and shows the login or the app.
app.use(express.static(PROD_DIR, { index: false }));
app.get('*', (req, res) => {
  const index = path.join(PROD_DIR, 'index.html');
  if (!existsSync(index)) return res.status(500).send('joya-hq: run `npm run build` first (prod/index.html is missing)');
  res.sendFile(index);
});

app.use((err, req, res, _next) => {
  log.error({ err }, `${req.method} ${req.originalUrl}`);
  res.status(500).json({ error: 'server error' });
});

const PORT = Number(process.env.JOYA_HQ_PORT || process.env.PORT || 4300);
const HOST = process.env.JOYA_HQ_HOST || '127.0.0.1';
app.listen(PORT, HOST, () => log.info(`Joya Headquarter listening on ${HOST}:${PORT}`));
