import { defineConfig, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, statSync, copyFileSync, mkdirSync, readdirSync, lstatSync } from 'fs';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@admin': resolve(__dirname, 'admin/client'),
    },
  },
  plugins: [
    {
      name: 'treat-js-files-as-jsx',
      async transform(code, id) {
        if (!id.match(/(order_sys\/src|admin\/client)\/.*\.js$/)) return null;

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
    {
      name: 'serve-admin-files',
      configureServer(server) {
        // This middleware runs EARLY, before Vite's middleware
        // We need to intercept requests before Vite tries to serve them
        server.middlewares.use(async (req, res, next) => {
          const url = req.url || '';
          
          // Debug: Log ALL requests (not just admin) to see what's happening
          console.log(`[DEBUG MIDDLEWARE] Incoming request: ${url}`);
          
          // Serve resources folder in development
          if (url.startsWith('/resources/')) {
            const filePath = resolve(process.cwd(), url.slice(1));
            try {
              const stats = statSync(filePath);
              if (stats.isFile()) {
                const content = readFileSync(filePath);
                // Set appropriate content type based on file extension
                if (url.endsWith('.svg')) {
                  res.setHeader('Content-Type', 'image/svg+xml');
                } else if (url.match(/\.(png|jpg|jpeg|gif|webp)$/)) {
                  res.setHeader('Content-Type', `image/${url.split('.').pop()}`);
                } else if (url.match(/\.(mp3|wav|ogg)$/)) {
                  res.setHeader('Content-Type', `audio/${url.split('.').pop()}`);
                }
                res.end(content);
                return;
              }
            } catch (e) {
              // File doesn't exist, continue to next middleware
            }
          }
          
          // Serve admin.html
          if (url === '/admin.html') {
            console.log(`[DEBUG] Serving admin.html`);
            const htmlFile = resolve(process.cwd(), 'admin.html');
            try {
              const content = readFileSync(htmlFile, 'utf-8');
              res.setHeader('Content-Type', 'text/html');
              res.end(content);
              return;
            } catch (e) {
              console.log(`[DEBUG] Error serving admin.html:`, e.message);
              next();
              return;
            }
          }
          
          // For /admin/client/* files, use Vite's transform API
          if (url.startsWith('/admin/client/')) {
            console.log(`[DEBUG] /admin/client/* request detected: ${url}`);
            const filePath = resolve(process.cwd(), url.slice(1));
            console.log(`[DEBUG] Resolved path: ${filePath}`);
            
            try {
              const stats = statSync(filePath);
              if (stats.isFile()) {
                console.log(`[DEBUG] File exists, using Vite transform`);
                
                // Use Vite's transformRequest to transform the file
                try {
                  const result = await server.transformRequest(url, { ssr: false });
                  if (result) {
                    console.log(`[DEBUG] Transform successful, serving transformed content`);
                    res.setHeader('Content-Type', 'application/javascript');
                    res.end(result.code);
                    return;
                  } else {
                    console.log(`[DEBUG] Transform returned null/undefined`);
                  }
                } catch (transformError) {
                  console.log(`[DEBUG] Transform error: ${transformError.message}`);
                  console.log(`[DEBUG] Transform error stack:`, transformError.stack);
                  // Fall back to serving raw file
                  const content = readFileSync(filePath, 'utf-8');
                  res.setHeader('Content-Type', 'application/javascript');
                  res.end(content);
                  return;
                }
              } else {
                console.log(`[DEBUG] Path exists but is not a file`);
              }
            } catch (e) {
              console.log(`[DEBUG] File check error: ${e.message}`);
              console.log(`[DEBUG] File check error stack:`, e.stack);
              // Don't return 404 here - let Vite handle it
              next();
              return;
            }
          }
          
          next();
        });
      },
    },
    {
      name: 'copy-resources',
      writeBundle() {
        const resourcesDir = resolve(__dirname, 'resources');
        const distDir = resolve(__dirname, 'dist');
        const distResourcesDir = resolve(distDir, 'resources');
        
        // Helper function to copy directory recursively
        const copyDir = (src, dest) => {
          mkdirSync(dest, { recursive: true });
          const entries = readdirSync(src, { withFileTypes: true });
          
          for (const entry of entries) {
            const srcPath = resolve(src, entry.name);
            const destPath = resolve(dest, entry.name);
            
            if (entry.isDirectory()) {
              copyDir(srcPath, destPath);
            } else {
              copyFileSync(srcPath, destPath);
            }
          }
        };
        
        try {
          // Check if resources directory exists
          const stats = lstatSync(resourcesDir);
          if (stats.isDirectory()) {
            copyDir(resourcesDir, distResourcesDir);
            console.log('✅ Copied resources folder to dist');
          }
        } catch (error) {
          // Resources folder doesn't exist, skip
          if (error.code !== 'ENOENT') {
            console.warn('⚠️ Could not copy resources folder:', error.message);
          }
        }
      },
    },
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
        main: './site-index.html',
        'eatalia-bsr': './eatalia-bsr.html',
        'eatalia-labraca': './eatalia-labraca.html',
        'bsr-aff': './bsr-aff.html',
        admin: './admin.html',
      },
    },
  },
  root: process.cwd(),
  publicDir: 'public',
  server: {
    port: 5173,
    proxy: {
      '/auth': {
        target: 'http://localhost:3021',
        changeOrigin: true,
        secure: false,
      },
      // Proxy /admin API routes, but exclude /admin.html and /admin/client/*
      '/admin': {
        target: 'http://localhost:3021',
        changeOrigin: true,
        secure: false,
        // Only proxy API routes, exclude /admin.html and /admin/client/*
        bypass: function(req, res, options) {
          const url = req.url || '';
          console.log(`[DEBUG PROXY] Bypass check for: ${url}`);
          
          // Don't proxy /admin.html - skip proxy, let Vite serve it
          if (url === '/admin.html') {
            console.log(`[DEBUG PROXY] Bypassing /admin.html - returning false`);
            return false;
          }
          // Don't proxy /admin/client/* paths - skip proxy, let Vite serve these
          if (url.startsWith('/admin/client/')) {
            console.log(`[DEBUG PROXY] Bypassing /admin/client/* - returning false`);
            return false;
          }
          // Don't proxy static files - skip proxy, let Vite serve them
          if (url.match(/\.(html|js|jsx|css|png|jpg|jpeg|gif|svg|webp|ico)$/)) {
            console.log(`[DEBUG PROXY] Bypassing static file - returning false`);
            return false;
          }
          // Proxy API routes (everything else under /admin)
          console.log(`[DEBUG PROXY] Proxying request: ${url}`);
          return null; // Use proxy
        },
      },
      '/health': {
        target: 'http://localhost:3021',
        changeOrigin: true,
        secure: false,
      },
      '/pelecard': {
        target: 'http://localhost:3020',
        changeOrigin: true,
        secure: false,
      },
      '/api': {
        target: 'http://localhost:3020',
        changeOrigin: true,
        secure: false,
      },
    }
  }
});

