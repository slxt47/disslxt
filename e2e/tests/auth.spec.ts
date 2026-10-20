import { expect, test } from '@playwright/test';
import { loginViaUi, registerViaUi, uniqueUser } from '../helpers';

test('guests are redirected to the login page', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/guilds/00000000-0000-4000-8000-000000000000/channels/x');
  await expect(page).toHaveURL(/\/login\?next=%2Fguilds%2F/);
});

test('register, logout, login and wrong password', async ({ page }) => {
  const user = uniqueUser('auth');
  await registerViaUi(page, user);
  await expect(page.getByTestId('empty-state')).toBeVisible();
  await expect(page.getByTestId('current-user')).toHaveText(user.username);

  await page.getByTestId('logout-button').click();
  await expect(page).toHaveURL(/\/login$/);
  // The session is really gone.
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);

  await page.getByTestId('email').fill(user.email);
  await page.getByTestId('password').fill('falsches-passwort');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('form-error')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);

  await loginViaUi(page, user);
  await expect(page.getByTestId('current-user')).toHaveText(user.username);
});

test('registration errors are shown in form-error', async ({ page }) => {
  const user = uniqueUser('dupe');
  await registerViaUi(page, user);
  await page.getByTestId('logout-button').click();
  await expect(page).toHaveURL(/\/login$/);

  await page.goto('/register');
  await page.getByTestId('email').fill(user.email);
  await page.getByTestId('username').fill('other_name');
  await page.getByTestId('password').fill('passwort123');
  await page.getByTestId('register-submit').click();
  await expect(page.getByTestId('form-error')).toContainText('bereits registriert');

  // Client-side validation from the shared zod schema.
  await page.getByTestId('email').fill('kaputt');
  await page.getByTestId('password').fill('kurz');
  await page.getByTestId('register-submit').click();
  await expect(page.getByTestId('form-error')).toContainText('E-Mail');
});
