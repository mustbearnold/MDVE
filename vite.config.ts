import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = process.env.MDVE_SERVER ?? 'http://127.0.0.1:8787';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: API, changeOrigin: true },
    },
  },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    sourcemap: false,
  },
});
