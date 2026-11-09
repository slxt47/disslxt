import { expect, test } from '@playwright/test';
import { registerViaUi, uniqueUser } from '../helpers';

const background = (page: import('@playwright/test').Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

const DARK = 'rgb(9, 10, 28)';
const LIGHT = 'rgb(238, 236, 248)';

test('starts dark whatever the system says, light survives a reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await registerViaUi(page, uniqueUser('theme'));
  expect(await background(page)).toBe(DARK);

  await page.getByTestId('settings-button').click();
  await page.getByTestId('theme-light').click();
  expect(await background(page)).toBe(LIGHT);

  // Applied before React starts, so a reload shows it right away.
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
  expect(await background(page)).toBe(LIGHT);
});

test('colour themes: a preset and a self-made one, both kept after a reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await registerViaUi(page, uniqueUser('themes'));
  await page.getByTestId('settings-button').click();

  await page.getByTestId('theme-ocean').click();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  const ocean = await background(page);
  expect(ocean).not.toBe(DARK);

  await page.getByTestId('theme-create').click();
  await page.getByTestId('theme-name').fill('Lila Nacht');
  await page.getByTestId('theme-accent').fill('#c026d3');
  await page.getByTestId('theme-save').click();
  await expect(page.getByRole('radio', { name: 'Lila Nacht' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  const accent = () =>
    page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent'));
  // Nudged a little if needed, so text on it stays readable.
  const chosen = (await accent()).trim();
  expect(chosen).toMatch(/^#[c-d][0-9a-f]/);

  await page.reload();
  expect((await accent()).trim()).toBe(chosen);
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
});
