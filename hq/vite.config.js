import { defineConfig, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// The build id (owner 2026-11-18: the app checks every hour for a new build and offers a reload): <git short sha>-<UTC minute>.
// It goes into the bundle as __JOYA_BUILD__ (client/version.js) and into prod/version.json, which the server answers at
// GET /api/version — the two differ exactly when a newer build was deployed.
const builtAt = new Date().toISOString();
let commit = 'nogit';
try { commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'nogit'; } catch { /* no git on this machine */ }
const BUILD = `${commit}-${builtAt.slice(0, 16).replace(/[-:T]/g, '')}`;

// Same setup as trade-hub/vite.config.js: JSX inside client/*.js (no .jsx extension).
export default defineConfig({
  plugins: [
    {
      name: 'treat-js-files-as-jsx',
      enforce: 'pre',
      async transform(code, id) {
        if (!id.match(/client\/.*\.js$/)) return null;
        return transformWithEsbuild(code, id, { loader: 'jsx', jsx: 'automatic' });
      },
    },
    react(),
    {
      name: 'joya-version-file',
      apply: 'build',
      closeBundle() {
        mkdirSync('prod', { recursive: true });
        writeFileSync(join('prod', 'version.json'), JSON.stringify({ build: BUILD, builtAt, commit }, null, 2));
      },
    },
  ],
  define: { __JOYA_BUILD__: JSON.stringify(BUILD) },
  root: '.',
  // public/ (manifest, service worker, icons) is copied as is to prod/
  publicDir: 'public',
  optimizeDeps: { esbuildOptions: { loader: { '.js': 'jsx' } } },
  build: {
    outDir: 'prod',
    emptyOutDir: true,
    rollupOptions: {
      input: { main: 'index.html' },
      output: {
        entryFileNames: 'js/[name]-[hash].js',
        chunkFileNames: 'js/[name]-[hash].js',
        assetFileNames: (assetInfo) => (/\.css$/i.test(assetInfo.name ?? '') ? 'css/[name]-[hash][extname]' : 'assets/[name]-[hash][extname]'),
      },
    },
    sourcemap: true,
  },
  // `npm run dev:client` (:5175) next to `npm run dev` (:4300).
  server: { port: 5175, proxy: { '/api': 'http://localhost:4300' } },
});
