import { defineConfig, devices } from '@playwright/test';

// Placeholder scaffold. The full config (webServer for backend + vite) comes in plan step 25.
export default defineConfig({
  testDir: './tests',
  workers: 1,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
