import { createHmac } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { newUserPage, registerViaUi, uniqueUser } from '../helpers';

function base32Decode(text: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of text) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((b) => parseInt(b, 2)));
}

/** Code of the time step `offset` steps from now. */
function totp(secret: string, offset = 0): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const at = digest[digest.length - 1]! & 15;
  return String((digest.readUInt32BE(at) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

const openSettings = async (page: Page) => {
  await page.getByTestId('settings-button').click();
  await expect(page.getByTestId('settings-dialog')).toBeVisible();
};

test('two-factor sign-in from setup to recovery code', async ({ browser }) => {
  const { page, context } = await newUserPage(browser);
  const user = uniqueUser('sicher');
  await registerViaUi(page, user);
  await openSettings(page);

  await page.getByTestId('two-factor-start').click();
  await page.getByTestId('two-factor-password').fill(user.password);
  await page.getByTestId('two-factor-submit').click();
  await expect(page.getByTestId('two-factor-qr')).toBeVisible();
  const secret = (await page.getByTestId('two-factor-secret').textContent()) ?? '';

  await page.getByTestId('two-factor-code').fill(totp(secret, -1));
  await page.getByTestId('two-factor-submit').click();
  await expect(page.getByTestId('recovery-codes')).toBeVisible();
  const codes = await page.getByTestId('recovery-codes').locator('code').allTextContents();
  expect(codes).toHaveLength(10);
  await page.getByTestId('recovery-done').click();
  await expect(page.getByTestId('two-factor-state')).toContainText('Noch 10 Ersatzcodes');
  await page.getByRole('button', { name: 'Fertig' }).click();

  // A second browser: password alone does not get in.
  const other = await newUserPage(browser);
  await other.page.goto('/login');
  await other.page.getByTestId('email').fill(user.email);
  await other.page.getByTestId('password').fill(user.password);
  await other.page.getByTestId('login-submit').click();
  await other.page.getByTestId('login-code').fill('000000');
  await other.page.getByTestId('login-code-submit').click();
  await expect(other.page.getByTestId('form-error')).toContainText('Der Code stimmt nicht');
  await other.page.getByTestId('login-code').fill(codes[0]!);
  await other.page.getByTestId('login-code-submit').click();
  await expect(other.page).not.toHaveURL(/login/);

  // The first browser lists it and signs it out.
  await openSettings(page);
  await expect(page.getByTestId('session-current')).toBeVisible();
  await expect(page.getByTestId('session-other')).toHaveCount(1);
  await page.getByTestId('sessions-end-others').click();
  await expect(page.getByTestId('session-other')).toHaveCount(0);
  await expect(other.page).toHaveURL(/login/);

  // Export.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-data').click(),
  ]);
  expect(download.suggestedFilename()).toBe('disslxt-export.json');

  await page.getByTestId('two-factor-off').click();
  await page.getByTestId('two-factor-password').fill(user.password);
  await page.getByTestId('two-factor-code').fill(totp(secret));
  await page.getByTestId('two-factor-submit').click();
  await expect(page.getByTestId('two-factor-state')).toContainText('Aus.');
  await context.close();
  await other.context.close();
});
