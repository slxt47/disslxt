import { expect, test } from '@playwright/test';
import { messageContent, sendMessage, twoUsersInGuild, waitSubscribed } from '../helpers';

test('connection loss shows the banner; reconnect refetches missed messages', async ({
  browser,
}) => {
  const { a, b } = await twoUsersInGuild(browser, 'Reconnect-Test');

  await b.context.setOffline(true);
  await expect(b.page.getByTestId('connection-banner')).toBeVisible();
  await expect(b.page.getByTestId('connection-banner')).toHaveText(
    'Verbindung getrennt – verbinde neu…',
  );

  // Sent while B is offline.
  await sendMessage(a.page, 'Verpasst während offline');

  await b.context.setOffline(false);
  await expect(b.page.getByTestId('connection-banner')).toBeHidden({ timeout: 15_000 });
  // Fetched after the reconnect.
  await expect(messageContent(b.page, 'Verpasst während offline')).toBeVisible();

  // Live events resume.
  await waitSubscribed(b.page);
  await sendMessage(a.page, 'Wieder live');
  await expect(messageContent(b.page, 'Wieder live')).toBeVisible({ timeout: 2000 });

  await a.context.close();
  await b.context.close();
});
