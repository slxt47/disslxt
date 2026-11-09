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

test('an event with answers, a message planned for later', async ({ browser }) => {
  const { a, b } = await twoUsersInGuild(browser, 'Termine');
  const input = a.page.getByTestId('composer-input');
  await input.fill('/termin 24.12. 20:00 | Feier');
  await input.press('Enter');
  await expect(b.page.getByTestId('event')).toContainText('Feier');
  await b.page.getByTestId('event-yes').click();
  await expect(a.page.getByTestId('event-yes')).toContainText('(1)');

  await input.fill('/später 2h nachher');
  await input.press('Enter');
  await expect(a.page.getByTestId('composer-note')).toContainText('geplant');
  await a.page.getByTestId('settings-button').click();
  await expect(a.page.getByTestId('scheduled-list')).toContainText('nachher');
});
