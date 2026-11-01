import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  build: {
    target: ['es2020', 'safari14', 'chrome90', 'firefox90', 'edge90'],
    chunkSizeWarningLimit: 900,
    assetsInlineLimit: 0,
  },
  server: { host: true },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as never);
