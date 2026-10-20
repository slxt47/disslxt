import { expect, test, type Page } from '@playwright/test';
import { messageContent, sendMessage, twoUsersInGuild, waitSubscribed } from '../helpers';

// D1: more than one page (50) of messages missed while another channel was open or while offline
// must not leave a permanent gap.

/** Sends `count` messages "<prefix> 1..count" through the API with the page's session cookie. */
async function seed(page: Page, channelId: string, prefix: string, count: number): Promise<void> {
  for (let i = 1; i <= count; i++) {
    const res = await page.request.post(`/api/channels/${channelId}/messages`, {
      data: { content: `${prefix} ${i}` },
    });
    expect(res.status()).toBe(201);
  }
}

/** Expects the newest page, then loads older history and expects every message in order. */
async function expectCompleteHistory(page: Page, expected: string[]): Promise<void> {
  await expect(messageContent(page, expected[expected.length - 1]!)).toBeVisible();
  await expect(page.getByTestId('message-content')).toHaveCount(50);
  await expect(page.getByTestId('load-older')).toBeVisible();
  await page.getByTestId('load-older').click();
  await expect(page.getByTestId('message-content')).toHaveCount(expected.length);
  await expect(page.getByTestId('load-older')).toHaveCount(0);
  expect(await page.getByTestId('message-content').allTextContents()).toEqual(expected);
}

test('55 messages missed while another channel was open are all reachable', async ({ browser }) => {
  const { a, b, guild } = await twoUsersInGuild(browser, 'Kanalwechsel');
  const before = ['Vorher 1', 'Vorher 2', 'Vorher 3'];
  for (const t of before) await sendMessage(a.page, t);

  await a.page.getByTestId('create-channel-button').click();
  await a.page.getByTestId('channel-name-input').fill('zwei');
  await a.page.getByTestId('create-channel-submit').click();
  await expect(a.page.getByTestId('channel-title')).toHaveText(/zwei/);
  await waitSubscribed(a.page);

  await seed(b.page, guild.channelId, 'neu', 55);

  await a.page.getByTestId('channel-item-general').click();
  await expect(a.page.getByTestId('channel-title')).toHaveText(/general/);
  const expected = [...before, ...Array.from({ length: 55 }, (_, i) => `neu ${i + 1}`)];
  await expectCompleteHistory(a.page, expected);

  await a.context.close();
  await b.context.close();
});

test('55 messages missed while offline are all reachable after the reconnect', async ({
  browser,
}) => {
  const { a, b, guild } = await twoUsersInGuild(browser, 'Offline-Lücke');
  const before = ['Vorher 1', 'Vorher 2', 'Vorher 3'];
  for (const t of before) await sendMessage(a.page, t);

  await a.context.setOffline(true);
  await expect(a.page.getByTestId('connection-banner')).toBeVisible();
  await seed(b.page, guild.channelId, 'offline', 55);
  await a.context.setOffline(false);
  await expect(a.page.getByTestId('connection-banner')).toBeHidden({ timeout: 15_000 });

  const expected = [...before, ...Array.from({ length: 55 }, (_, i) => `offline ${i + 1}`)];
  await expectCompleteHistory(a.page, expected);

  await a.context.close();
  await b.context.close();
});
