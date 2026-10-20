import { defineConfig, devices } from '@playwright/test';

/**
 * Default: starts the backend (against the E2E database, relaxed rate limits) and the Vite dev
 * server, then runs all specs against http://localhost:5173.
 *
 * Docker smoke run: `E2E_BASE_URL=https://localhost:8443 pnpm e2e:docker` uses the running
 * `docker compose` stack instead (no web servers, self-signed certificate accepted).
 */
const externalBaseUrl = process.env.E2E_BASE_URL;
const baseURL = externalBaseUrl ?? 'http://localhost:5173';
const e2eDatabaseUrl =
  process.env.E2E_DATABASE_URL ?? 'postgres://chat:chat@localhost:5432/chat_mvp_e2e';
const reuse = !process.env.CI;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './global-setup.ts',
  use: {
    baseURL,
    ignoreHTTPSErrors: !!externalBaseUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: externalBaseUrl
    ? undefined
    : [
        {
          name: 'backend',
          command: 'pnpm --filter @chat-mvp/backend exec tsx src/server.ts',
          cwd: '..',
          url: 'http://127.0.0.1:3000/api/health',
          reuseExistingServer: reuse,
          timeout: 60_000,
          stdout: 'pipe',
          stderr: 'pipe',
          env: {
            NODE_ENV: 'test',
            DATABASE_URL: e2eDatabaseUrl,
            PORT: '3000',
            HOST: '127.0.0.1',
            LOG_LEVEL: 'warn',
            COOKIE_SECURE: 'false',
            TRUST_PROXY: 'false',
            ALLOWED_ORIGINS: 'http://localhost:5173',
            RATE_LIMIT_LOGIN_MAX: '1000',
            RATE_LIMIT_MESSAGE_MAX: '1000',
          },
        },
        {
          name: 'frontend',
          command: 'pnpm --filter @chat-mvp/frontend exec vite --port 5173 --strictPort',
          cwd: '..',
          url: 'http://localhost:5173',
          reuseExistingServer: reuse,
          timeout: 60_000,
          // Vite logs harmless ws-proxy resets whenever a test closes a browser context.
          stdout: 'ignore',
          stderr: 'ignore',
        },
      ],
});
