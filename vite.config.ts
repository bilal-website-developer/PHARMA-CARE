import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'node:url';
import {defineConfig} from 'vite';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'public-receipt-route',
        configureServer(server) {
          server.middlewares.use((request, _response, next) => {
            const pathname = request.url?.split('?')[0] ?? '';
            if (/^\/r\/[A-Za-z0-9_-]{22,128}\/?$/.test(pathname)) {
              request.url = '/receipt.html';
            }
            next();
          });
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(projectRoot, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    build: {
      rollupOptions: {
        input: {
          app: path.resolve(projectRoot, 'index.html'),
          receipt: path.resolve(projectRoot, 'receipt.html'),
        },
      },
    },
  };
});
