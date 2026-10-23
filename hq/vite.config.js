import { defineConfig, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';

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
  ],
  root: '.',
  publicDir: false,
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
