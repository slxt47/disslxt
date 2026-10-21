import { expect, test } from '@playwright/test';

/**
 * Read-only smoke test for a deployed stack (`pnpm e2e:docker`). It creates no accounts: in
 * production every sign-up sends a real e-mail, and there is no dev mailbox to confirm it.
 */
test('deployed stack: app, API, auth errors and WebSocket guard respond', async ({
  page,
  request,
}) => {
  const health = await request.get('/api/health');
  expect(health.ok()).toBe(true);
  expect(await health.json()).toEqual({ status: 'ok' });
  // The dev mailbox must never exist in production.
  expect((await request.get('/api/dev/mails')).status()).toBe(404);

  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page).toHaveTitle('disslxt');

  await page.getByTestId('email').fill('smoke-nobody@example.invalid');
  await page.getByTestId('password').fill('definitely-wrong-1');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('form-error')).toContainText('falsch');
});

test('deployed stack: installable app, caching and security headers', async ({ request }) => {
  // Dev-only endpoints never exist in production.
  expect((await request.get('/api/dev/pushes')).status()).toBe(404);

  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.headers()['content-type']).toContain('application/manifest+json');
  const icons = ((await manifest.json()) as { icons: { src: string }[] }).icons;
  for (const icon of [...icons.map((i) => i.src), '/icons/apple-touch-icon.png']) {
    expect((await request.get(icon)).ok(), icon).toBe(true);
  }

  // Service worker and shell must always revalidate, or a deploy would not reach installed apps.
  const sw = await request.get('/sw.js');
  expect(sw.ok()).toBe(true);
  expect(sw.headers()['cache-control']).toBe('no-cache');
  expect((await request.get('/theme-init.js')).ok()).toBe(true);

  const page = await request.get('/login');
  const h = page.headers();
  expect(h['cache-control']).toBe('no-cache');
  expect(h['content-security-policy']).toContain("script-src 'self'");
  expect(h['content-security-policy']).toContain("worker-src 'self'");
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['permissions-policy']).toContain('microphone=(self)');
  expect(h['x-content-type-options']).toBe('nosniff');
  // Cloudflare adds its own Server header at the edge; Caddy's must not leak through.
  expect(h['server'] ?? '').not.toMatch(/caddy/i);

  // Everything personal needs a session.
  for (const path of [
    '/api/push/config',
    '/api/voice/ice-servers',
    '/api/voice/turn-usage',
    '/api/voice-messages/1',
  ]) {
    expect((await request.get(path)).status(), path).toBe(401);
  }
});
