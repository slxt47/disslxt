import { expect, test } from '@playwright/test';
import { twoUsersInGuild } from '../helpers';

test('a poll from the composer, voted on live; Strg+K jumps to a channel', async ({ browser }) => {
  const { a, b } = await twoUsersInGuild(browser, 'Umfrage');
  const input = a.page.getByTestId('composer-input');
  await input.fill('/umfrage Pizza heute? | Ja | Nein');
  await input.press('Enter');
  await expect(b.page.getByTestId('poll')).toContainText('Pizza heute?');
  await b.page.getByTestId('poll-option-0').click();
  await expect(a.page.getByTestId('poll')).toContainText('1 Stimme');

  await a.page.getByTestId('create-channel-button').click();
  await a.page.getByTestId('channel-name-input').fill('zweiter');
  await a.page.getByTestId('create-channel-submit').click();
  await expect(a.page.getByTestId('channel-title')).toContainText('zweiter');
  await a.page.keyboard.press('Control+k');
  await a.page.getByTestId('switcher-input').fill('gener');
  await a.page.getByTestId('switcher-input').press('Enter');
  await expect(a.page.getByTestId('channel-title')).toContainText('general');
});
