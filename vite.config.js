import { defineConfig, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    {
      name: 'treat-js-files-as-jsx',
      async transform(code, id) {
        if (!id.match(/src\/.*\.js$/)) return null;

        return transformWithEsbuild(code, id, {
          loader: 'jsx',
          jsx: 'automatic',
        });
      },
    },
    react({
      include: /\.(js|jsx)$/,
      jsxRuntime: 'automatic',
    }),
  ],
  optimizeDeps: {
    esbuildOptions: {
      loader: {
        '.js': 'jsx',
      },
    },
    include: ['react', 'react-dom', 'react-jss', 'react-i18next', 'i18next'],
  },
  build: {
    rollupOptions: {
      input: {
        main: './index.html',
        'eatalia-bsr': './eatalia-bsr.html',
      },
    },
  },
  server: {
    port: 5173,
  },
});

