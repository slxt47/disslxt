import { expect, test } from '@playwright/test';
import { messageContent, messageItem, sendMessage, twoUsersInGuild } from '../helpers';

// Success criterion 1: two users chat in realtime in two windows (two browser contexts).
test('two users chat in realtime, incl. edit, delete and channel creation', async ({ browser }) => {
  const { a, b } = await twoUsersInGuild(browser, 'Echtzeit-Test');

  // Desktop layout: server list, channels and chat are visible side by side.
  for (const page of [a.page, b.page]) {
    await expect(page.getByTestId('guild-list')).toBeVisible();
    await expect(page.getByTestId('channel-list')).toBeVisible();
    await expect(page.getByTestId('message-list')).toBeVisible();
  }

  // A → B without reload, within 1 s.
  const input = a.page.getByTestId('composer-input');
  await input.fill('Hallo von A');
  const started = Date.now();
  await input.press('Enter');
  await expect(messageContent(b.page, 'Hallo von A')).toBeVisible({ timeout: 1000 });
  console.log(`A → B delivery observed after ${Date.now() - started} ms`);

  // B → A.
  await sendMessage(b.page, 'Hallo zurück von B');
  await expect(messageContent(a.page, 'Hallo zurück von B')).toBeVisible({ timeout: 1000 });

  // Edit propagates.
  const own = messageItem(a.page, 'Hallo von A');
  await own.hover();
  await own.getByTestId('message-edit').click();
  const edit = a.page.getByTestId('message-edit-input');
  await edit.fill('Hallo von A (korrigiert)');
  await edit.press('Enter');
  const updatedOnB = messageItem(b.page, 'Hallo von A (korrigiert)');
  await expect(updatedOnB).toBeVisible();
  await expect(updatedOnB.getByTestId('message-edited')).toHaveText('(bearbeitet)');

  // Delete propagates.
  const toDelete = messageItem(a.page, 'Hallo von A (korrigiert)');
  await toDelete.hover();
  await toDelete.getByTestId('message-delete').click();
  await toDelete.getByTestId('message-delete-confirm').click();
  await expect(messageItem(a.page, 'Hallo von A (korrigiert)')).toHaveCount(0);
  await expect(messageItem(b.page, 'Hallo von A (korrigiert)')).toHaveCount(0);

  // channel.created reaches the other member.
  await a.page.getByTestId('create-channel-button').click();
  await a.page.getByTestId('channel-name-input').fill('Off Topic');
  await a.page.getByTestId('create-channel-submit').click();
  await expect(a.page.getByTestId('channel-title')).toHaveText(/off-topic/);
  await expect(b.page.getByTestId('channel-item-off-topic')).toBeVisible();
  await expect(b.page.getByTestId('create-channel-button')).toHaveCount(0);

  await a.context.close();
  await b.context.close();
});

test('message list auto-scrolls so the newest of 30 messages is in view', async ({ browser }) => {
  const { a, b } = await twoUsersInGuild(browser, 'Scroll-Test');
  for (let i = 1; i <= 30; i++) {
    const input = a.page.getByTestId('composer-input');
    await input.fill(`Nachricht Nummer ${i}`);
    await input.press('Enter');
  }
  await expect(messageContent(a.page, 'Nachricht Nummer 30')).toBeInViewport();
  await expect(messageContent(b.page, 'Nachricht Nummer 30')).toBeInViewport();
  await a.context.close();
  await b.context.close();
});
