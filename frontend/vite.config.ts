import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/** Backend for the dev-server proxy; E2E points it at its own backend port. */
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3000';
const wsTarget = apiTarget.replace(/^http/, 'ws');

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': apiTarget,
      '/ws': { target: wsTarget, ws: true },
    },
  },
  build: {
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
