import { expect, test } from '@playwright/test';
import { messageContent, sendMessage, twoUsersInGuild } from '../helpers';

test('delete your own account: owned server goes for everyone, sign-in no longer works', async ({
  browser,
}) => {
  const { a, b } = await twoUsersInGuild(browser, 'Abschied');
  await sendMessage(b.page, 'Bob bleibt');
  await sendMessage(a.page, 'Alice war hier');
  await expect(messageContent(b.page, 'Alice war hier')).toBeVisible();

  await a.page.getByTestId('settings-button').click();
  await a.page.getByTestId('account-delete-open').click();
  // The dialog names the server that goes with the account.
  await expect(a.page.getByTestId('account-delete-owned')).toContainText('Abschied');
  const confirm = a.page.getByTestId('account-delete-confirm');
  await expect(confirm).toBeDisabled();

  await a.page.getByTestId('account-delete-password').fill('falsches Passwort 1');
  await confirm.click();
  await expect(a.page.getByRole('alert')).toContainText('Passwort');

  await a.page.getByTestId('account-delete-password').fill(a.user.password);
  await confirm.click();
  await expect(a.page).toHaveURL(/\/login$/);
  await expect(a.page.getByTestId('account-deleted')).toBeVisible();

  // Bob: the server was Alice's, so it is gone for him too, live.
  await expect(b.page.getByTestId('empty-create-guild')).toBeVisible();

  // Signing in again fails: the account no longer exists.
  await a.page.getByTestId('email').fill(a.user.email);
  await a.page.getByTestId('password').fill(a.user.password);
  await a.page.getByTestId('login-submit').click();
  await expect(a.page.getByTestId('form-error')).toBeVisible();
  await expect(a.page).toHaveURL(/\/login$/);
});
