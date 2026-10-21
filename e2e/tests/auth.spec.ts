import { expect, test } from '@playwright/test';
import {
  confirmViaMail,
  fillRegisterForm,
  loginViaUi,
  registerViaUi,
  uniqueUser,
  verificationLinkPath,
} from '../helpers';

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

test('registering a taken address looks like a normal sign-up', async ({ page }) => {
  const user = uniqueUser('dupe');
  await registerViaUi(page, user);
  await page.getByTestId('logout-button').click();
  await expect(page).toHaveURL(/\/login$/);

  // No "already registered" error: the answer must not reveal which addresses exist.
  await page.goto('/register');
  await fillRegisterForm(page, { ...user, username: 'other_name' });
  await expect(page.getByTestId('check-inbox')).toBeVisible();
  await expect(page.getByTestId('form-error')).toHaveCount(0);

  // Client-side validation from the shared zod schema.
  await page.goto('/register');
  await page.getByTestId('email').fill('kaputt');
  await page.getByTestId('password').fill('kurz');
  await page.getByTestId('register-submit').click();
  await expect(page.getByTestId('form-error')).toContainText('E-Mail');
});

test('no login before the e-mail is confirmed; the link activates the account', async ({
  page,
}) => {
  const user = uniqueUser('verify');
  await page.goto('/register');
  await fillRegisterForm(page, user);
  await expect(page.getByTestId('check-inbox-email')).toHaveText(user.email);

  // Logging in before confirming is refused with a hint and a resend button.
  await page.goto('/login');
  await page.getByTestId('email').fill(user.email);
  await page.getByTestId('password').fill(user.password);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('check-inbox')).toContainText('noch nicht aktiviert');
  await expect(page).toHaveURL(/\/login$/);

  // "Send again" issues a new link; the old one stops working.
  const oldLink = await verificationLinkPath(page, user.email);
  await page.getByTestId('resend-verification').click();
  await expect(page.getByText(/neuen Link geschickt/)).toBeVisible();
  await expect.poll(() => verificationLinkPath(page, user.email)).not.toBe(oldLink);

  await page.goto(oldLink);
  // The token is taken out of the address bar right away.
  await expect(page).toHaveURL(/\/verify-email$/);
  await page.getByTestId('verify-submit').click();
  await expect(page.getByTestId('form-error')).toContainText('ungültig oder abgelaufen');

  await confirmViaMail(page, user.email);
  await expect(page.getByTestId('current-user')).toHaveText(user.username);
});
