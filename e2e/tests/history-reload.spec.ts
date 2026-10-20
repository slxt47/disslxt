import { expect, test } from '@playwright/test';
import {
  createGuildViaUi,
  loginViaUi,
  messageContent,
  registerViaUi,
  sendMessage,
  uniqueUser,
  waitSubscribed,
} from '../helpers';

// Success criterion 3: history survives a reload (and logout/login).
test('messages survive a reload and a new login, in order', async ({ page }) => {
  const user = uniqueUser('history');
  await registerViaUi(page, user);
  await createGuildViaUi(page, 'Verlauf');
  const texts = ['Erste Nachricht', 'Zweite Nachricht', 'Dritte Nachricht'];
  for (const t of texts) await sendMessage(page, t);
  const channelUrl = page.url();

  await page.reload();
  await expect(page.getByTestId('message-content')).toHaveText(texts);

  await page.getByTestId('logout-button').click();
  await expect(page).toHaveURL(/\/login$/);
  await loginViaUi(page, user);
  await page.goto(channelUrl);
  await expect(page.getByTestId('message-content')).toHaveText(texts);
});

test('"Ältere laden" pages in older history', async ({ page }) => {
  await registerViaUi(page, uniqueUser('pager'));
  const { channelId } = await createGuildViaUi(page, 'Viel Verlauf');
  await waitSubscribed(page);

  // Seed 60 messages through the API (same session cookie as the page).
  for (let i = 1; i <= 60; i++) {
    const res = await page.request.post(`/api/channels/${channelId}/messages`, {
      data: { content: `Seed ${i}` },
    });
    expect(res.status()).toBe(201);
  }

  await page.reload();
  await expect(messageContent(page, 'Seed 60')).toBeVisible();
  await expect(page.getByTestId('message-content')).toHaveCount(50);
  await expect(messageContent(page, 'Seed 10')).toHaveCount(0);

  await page.getByTestId('load-older').click();
  await expect(page.getByTestId('message-content')).toHaveCount(60);
  await expect(page.getByTestId('load-older')).toHaveCount(0);
  await messageContent(page, 'Seed 1').scrollIntoViewIfNeeded();
  await expect(messageContent(page, 'Seed 1')).toBeVisible();
  const all = await page.getByTestId('message-content').allTextContents();
  expect(all).toEqual(Array.from({ length: 60 }, (_, i) => `Seed ${i + 1}`));
});
