import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  // Environment variables load karne ke liye
  const env = loadEnv(mode, process.cwd(), '');

  // Backend URL (Default 127.0.0.1 use karein instead of localhost)
  const backendTarget = env.API_PROXY_TARGET || 'http://127.0.0.1:5000';

  return {
    plugins: [react()],
    resolve: { alias: { '@': path.resolve('./src') } },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            charts: ['recharts'],
            motion: ['gsap'],
            vendor: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
          },
        },
      },
    },
    server: {
      port: Number(env.VITE_PORT) || 5173,
      proxy: {
        '/api': {
          target: backendTarget,
          changeOrigin: true,
          secure: false, // Self-signed SSL ya connection issues rokne ke liye
        },
        '/socket.io': {
          target: backendTarget,
          ws: true,
          secure: false,
        },
      },
    },
  };
});