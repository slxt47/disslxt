import { expect, test } from '@playwright/test';
import { twoUsersInGuild } from '../helpers';

test('a program posts into the channel as a bot', async ({ browser, request }) => {
  const { a, b } = await twoUsersInGuild(browser, 'Bots');
  await a.page.getByTestId('channel-item-general').hover();
  await a.page.getByTestId('channel-edit-general').click();
  await a.page.getByTestId('webhook-name').fill('Server');
  await a.page.getByTestId('webhook-add').click();
  const note = a.page.getByTestId('webhook-secret');
  await expect(note).toContainText('Bearer');
  const text = (await note.textContent()) ?? '';
  const id = /api\/hooks\/([0-9a-f-]{36})/.exec(text)?.[1];
  const token = /Bearer (\S+)/.exec(text)?.[1];
  expect(id && token).toBeTruthy();

  const res = await request.post(`/api/hooks/${id}`, {
    headers: { authorization: `Bearer ${token}` },
    data: { content: 'Backup fertig' },
  });
  expect(res.status()).toBe(204);
  await expect(b.page.getByTestId('message-content').last()).toHaveText('Backup fertig');
  await expect(b.page.getByTestId('message-author').last()).toContainText('Server');
  await expect(b.page.locator('.bot-pill')).toHaveText('BOT');

  await b.page.getByTestId('composer-input').fill('/dienste');
  await b.page.getByTestId('composer-input').press('Enter');
  await expect(b.page.getByTestId('status-dialog')).toContainText('Nur für Admins');
});
