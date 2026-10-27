import { expect, test } from '@playwright/test';
import { registerViaUi, uniqueUser } from '../helpers';

const background = (page: import('@playwright/test').Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test('dark mode in the settings overrides the system and survives a reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await registerViaUi(page, uniqueUser('theme'));
  expect(await background(page)).toBe('rgb(245, 245, 250)');

  await page.getByTestId('settings-button').click();
  await page.getByTestId('theme-dark').click();
  expect(await background(page)).toBe('rgb(14, 14, 21)');

  // Applied before React starts, so a reload shows dark right away.
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  expect(await background(page)).toBe('rgb(14, 14, 21)');

  // "Hell" wins over a dark system, "Automatisch" follows it again.
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByTestId('settings-button').click();
  await page.getByTestId('theme-light').click();
  expect(await background(page)).toBe('rgb(245, 245, 250)');
  await page.getByTestId('theme-system').click();
  expect(await background(page)).toBe('rgb(14, 14, 21)');
});
