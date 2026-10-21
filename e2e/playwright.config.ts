import { createRequire } from 'node:module';
import { defineConfig, devices } from '@playwright/test';

/**
 * Default: starts its own backend (against the E2E database, relaxed rate limits) on port 3100 and
 * its own Vite dev server on port 5174 (proxying to that backend), then runs all specs against
 * http://localhost:5174. The ports differ from `pnpm dev` (3000/5173) and running servers are never
 * reused, so E2E never hits the dev database or the real rate limits. Override the ports with
 * E2E_BACKEND_PORT / E2E_FRONTEND_PORT.
 *
 * Docker smoke run: `E2E_BASE_URL=https://disslxt.slxt.org pnpm e2e:docker` runs the read-only
 * smoke spec against the deployed stack through the tunnel (no web servers, no accounts created).
 */
const externalBaseUrl = process.env.E2E_BASE_URL;
const backendPort = process.env.E2E_BACKEND_PORT ?? '3100';
const frontendPort = process.env.E2E_FRONTEND_PORT ?? '5174';
const frontendOrigin = `http://localhost:${frontendPort}`;
const baseURL = externalBaseUrl ?? frontendOrigin;
// Throwaway VAPID keys per run; pushes are recorded by the backend (PUSH_TRANSPORT=memory) and
// read back through /api/dev/pushes, nothing goes to a real push service.
const vapid = createRequire(new URL('../backend/package.json', import.meta.url))(
  'web-push',
).generateVAPIDKeys() as { publicKey: string; privateKey: string };
const e2eDatabaseUrl =
  process.env.E2E_DATABASE_URL ?? 'postgres://chat:chat@localhost:5432/disslxt_e2e';

export default defineConfig({
  testDir: './tests',
  // The smoke spec targets a deployed stack only; local runs cover the same ground and more.
  testIgnore: externalBaseUrl ? [] : ['smoke.spec.ts'],
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
          command: 'pnpm --filter @disslxt/backend exec tsx src/server.ts',
          cwd: '..',
          url: `http://127.0.0.1:${backendPort}/api/health`,
          // Fail if the port is taken instead of silently testing against another server.
          reuseExistingServer: false,
          timeout: 60_000,
          stdout: 'pipe',
          stderr: 'pipe',
          env: {
            NODE_ENV: 'test',
            DATABASE_URL: e2eDatabaseUrl,
            PORT: backendPort,
            HOST: '127.0.0.1',
            LOG_LEVEL: 'warn',
            COOKIE_SECURE: 'false',
            TRUST_PROXY: 'false',
            ALLOWED_ORIGINS: frontendOrigin,
            RATE_LIMIT_LOGIN_MAX: '1000',
            RATE_LIMIT_MESSAGE_MAX: '1000',
            RATE_LIMIT_MAIL_MAX: '1000',
            MAIL_MAX_PER_ADDRESS_PER_HOUR: '1000',
            // Mails stay in memory and are read back via /api/dev/mails.
            MAIL_TRANSPORT: 'log',
            PUBLIC_URL: frontendOrigin,
            VAPID_PUBLIC_KEY: vapid.publicKey,
            VAPID_PRIVATE_KEY: vapid.privateKey,
            PUSH_TRANSPORT: 'memory',
          },
        },
        {
          name: 'frontend',
          command: `pnpm --filter @disslxt/frontend exec vite --port ${frontendPort} --strictPort`,
          cwd: '..',
          url: frontendOrigin,
          reuseExistingServer: false,
          env: { API_PROXY_TARGET: `http://127.0.0.1:${backendPort}` },
          timeout: 60_000,
          // Vite logs harmless ws-proxy resets whenever a test closes a browser context.
          stdout: 'ignore',
          stderr: 'ignore',
        },
      ],
});
