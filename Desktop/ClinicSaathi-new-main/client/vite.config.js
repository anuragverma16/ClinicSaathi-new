import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve('./src') } },
  build: {
    rollupOptions: {
      output: {
        // Charts and animation are heavy and used on different screens.
        // Separate chunks let the browser cache them independently.
        manualChunks: {
          charts: ['recharts'],
          motion: ['gsap'],
          vendor: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
        },
      },
    },
  },
  server: {
    port: Number(process.env.VITE_PORT) || 5173,
    // API_PROXY_TARGET points the dev server at a different API (e.g. a test instance).
    proxy: {
      '/api': { target: process.env.API_PROXY_TARGET || 'http://localhost:5003', changeOrigin: true },
      '/socket.io': { target: process.env.API_PROXY_TARGET || 'http://localhost:5003', ws: true },
    },
  },
});
