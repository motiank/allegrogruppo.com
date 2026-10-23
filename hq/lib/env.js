// Side-effect module: load env before any other import reads process.env.
// Order (later files win):
//   1. the Allegro repo-root `.env` — the DB settings every Allegro service uses (the `allegro` DB)
//   2. `hq/.env`        — Joya's own secrets on the server (JOYA_SESSION_SECRET, JOYA_API_KEY …)
//   3. `hq/.env.local`  — local development settings; it doesn't override DB_* (dev uses the production DB too)
// All three are gitignored.
import dotenv from 'dotenv';
import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SERVICE_ROOT = path.resolve(__dirname, '..');
export const REPO_ROOT = path.resolve(SERVICE_ROOT, '..');

const rootEnv = path.join(REPO_ROOT, '.env');
if (existsSync(rootEnv)) dotenv.config({ path: rootEnv, quiet: true });
for (const file of [path.join(SERVICE_ROOT, '.env'), path.join(SERVICE_ROOT, '.env.local')]) {
  if (!existsSync(file)) continue;
  const parsed = dotenv.parse(readFileSync(file));
  for (const key of Object.keys(parsed)) process.env[key] = parsed[key];
}
