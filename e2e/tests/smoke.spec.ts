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
