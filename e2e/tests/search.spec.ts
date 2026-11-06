import { expect, test } from '@playwright/test';
import { sendMessage, twoUsersInGuild } from '../helpers';

test('search finds a message and jumps to it, also far back', async ({ browser }) => {
  const { a, b } = await twoUsersInGuild(browser, 'Suche');
  await sendMessage(a.page, 'Das Passwort für den Keller liegt beim Hausmeister');

  // Pushes the first message out of the newest page.
  await a.page.evaluate(async () => {
    const channelId = location.pathname.split('/').pop();
    for (let i = 0; i < 60; i += 1) {
      await fetch(`/api/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'disslxt' },
        body: JSON.stringify({ content: `Füllnachricht ${i}` }),
      });
    }
  });

  await b.page.reload();
  await b.page.getByTestId('search-button').click();
  await b.page.getByTestId('search-input').fill('kell');
  const results = b.page.getByTestId('search-results');
  await expect(results).toContainText('Passwort');
  await expect(results.locator('mark')).toHaveText('Kell');
  await b.page.getByTestId('search-input').fill('gibtsnichtwort');
  await expect(b.page.getByTestId('search-empty')).toBeVisible();

  await b.page.getByTestId('search-input').fill('hausmeister');
  await results.locator('button').first().click();
  await expect(b.page.getByTestId('search-dialog')).toHaveCount(0);
  const target = b.page.getByText('Das Passwort für den Keller');
  await expect(target).toBeInViewport();
});
