import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/placer': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/fulfiller': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/proxy': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
    middlewares: [
      (req, res, next) => {
        if (req.url?.startsWith('/l2-keys')) {
          const filePath = path.resolve(__dirname, '../services/keys', req.url.slice('/l2-keys'.length));
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            res.setHeader('Content-Type', 'application/octet-stream');
            res.end(fs.readFileSync(filePath));
          } else {
            res.statusCode = 404;
            res.end('Not found');
          }
        } else {
          next();
        }
      },
    ],
  },
});
