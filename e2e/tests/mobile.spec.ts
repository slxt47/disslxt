import { expect, test } from '@playwright/test';
import { createGuildViaUi, registerViaUi, sendMessage, uniqueUser } from '../helpers';

test.use({ viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true });

test('mobile layout: drawer navigation and chatting at 375×740', async ({ page }) => {
  await registerViaUi(page, uniqueUser('mobile'));
  await expect(page.getByTestId('empty-state')).toBeVisible();
  await expect(page.getByTestId('mobile-drawer')).toBeHidden();

  await createGuildViaUi(page, 'Mobil');
  await expect(page.getByTestId('message-list')).toBeVisible();
  await expect(page.getByTestId('mobile-drawer')).toBeHidden();
  await expect(page.getByTestId('guild-list')).toBeHidden();
  await expect(page.getByTestId('member-list')).toBeHidden();

  // Open the drawer, pick a channel → the drawer closes.
  const menu = page.getByTestId('mobile-menu-button');
  const box = await menu.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(40);
  await menu.click();
  await expect(page.getByTestId('mobile-drawer')).toBeVisible();
  await expect(page.getByTestId('channel-list')).toBeVisible();
  await page.getByTestId('channel-item-general').click();
  await expect(page.getByTestId('mobile-drawer')).toBeHidden();

  // Tapping the backdrop also closes it.
  await menu.click();
  await expect(page.getByTestId('mobile-drawer')).toBeVisible();
  await page.getByTestId('drawer-backdrop').click({ position: { x: 360, y: 400 } });
  await expect(page.getByTestId('mobile-drawer')).toBeHidden();

  // Chatting works; the textarea is >= 16px (no iOS zoom).
  await sendMessage(page, 'Hallo vom Handy');
  const fontSize = await page
    .getByTestId('composer-input')
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fontSize).toBeGreaterThanOrEqual(16);

  // No horizontal scrolling.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  expect(overflow).toBe(true);
});
