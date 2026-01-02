import express from 'express';
import dotenv from 'dotenv';
import passport from 'passport';
import cookieParser from 'cookie-parser';
import cron from 'node-cron';
import { exec } from 'child_process';
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
console.log('[order_sys] envFileName:', envFileName);
dotenv.config({ path: join(__dirname, '../..', envFileName) });

// Import routers after env variables are loaded
const authModule = await import('./auth/index.js');
const authRouter = authModule.router;
const gateKeeper = authModule.gateKeeper;
const cookieSessionStorage = authModule.cookieSessionStorage;
const managementModule = await import('./auth/management.js');
const managementRouter = managementModule.default;
const { Router: orderSystemRouter } = await import('./modules/orderSystem.js');

const app = express();
const PORT = process.env.ADMIN_PORT || 3021;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Initialize Passport
app.use(passport.initialize());

// Cookie session storage middleware (must be before routes)
app.use(cookieSessionStorage);

// CORS configuration (if needed for admin panel)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', process.env.ADMIN_CORS_ORIGIN || 'http://localhost:5173');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Auth routes (login, logout, register, etc.)
app.use('/auth', authRouter(passport));

// Config endpoint (expose client config like DARKMODE) - public endpoint
app.get('/config', (req, res) => {
  const darkMode = process.env.DARKMODE === 'true';
  res.json({ darkMode });
});

// Protected admin routes - require authentication
app.use('/admin', gateKeeper, managementRouter);

// Order system control routes (also protected)
app.use('/admin/order-system', gateKeeper, orderSystemRouter());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'admin-server', port: PORT });
});

// Serve static files from dist (for admin client)
app.use(express.static(join(__dirname, '../../dist')));

// Fallback to admin.html for SPA routes (only for non-API routes)
app.get('*', (req, res, next) => {
  // Skip API routes
  if (req.path.startsWith('/auth') || req.path.startsWith('/admin') || req.path.startsWith('/health') || req.path.startsWith('/config')) {
    return next();
  }
  res.sendFile(join(__dirname, '../../dist/admin.html'));
});

app.listen(PORT, () => {
  console.log(`Admin server running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  
  // Setup analoader cron job - runs every day at 6:00 AM
  const projectRoot = join(__dirname, '../..');
  
  cron.schedule('0 6 * * *', () => {
    console.log(`[Cron] Starting analoader job at ${new Date().toISOString()}`);
    
    // Execute the analoader script from project root context
    exec(`node ./scripts/server/analoader/index.js`, {
      cwd: projectRoot,
      env: process.env
    }, (error, stdout, stderr) => {
      if (error) {
        console.error(`[Cron] Analoader error: ${error.message}`);
        return;
      }
      if (stderr) {
        console.error(`[Cron] Analoader stderr: ${stderr}`);
      }
      if (stdout) {
        console.log(`[Cron] Analoader output: ${stdout}`);
      }
      console.log(`[Cron] Analoader job completed at ${new Date().toISOString()}`);
    });
  }, {
    scheduled: true,
    timezone: "Asia/Jerusalem" // Adjust timezone as needed
  });
  
  console.log('[Cron] Analoader scheduled to run daily at 6:00 AM');
});
