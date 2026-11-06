import { expect, test } from '@playwright/test';
import { sendMessage, twoUsersInGuild } from '../helpers';

test('renaming, describing, sorting into categories and deleting channels', async ({ browser }) => {
  const { a, b } = await twoUsersInGuild(browser, 'Kanäle');
  const add = async (name: string) => {
    await a.page.getByTestId('create-channel-button').click();
    await a.page.getByTestId('channel-name-input').fill(name);
    await a.page.getByTestId('create-channel-submit').click();
    await expect(a.page.getByTestId('channel-title')).toContainText(name);
  };
  await add('zweiter');
  await add('dritter');

  // Members cannot edit.
  await b.page.getByTestId('channel-item-zweiter').hover();
  await expect(b.page.getByTestId('channel-edit-zweiter')).toHaveCount(0);

  // Rename and describe: the other side sees it live.
  await a.page.getByTestId('channel-item-zweiter').hover();
  await a.page.getByTestId('channel-edit-zweiter').click();
  await a.page.getByTestId('channel-edit-name').fill('neuer name');
  await a.page.getByTestId('channel-edit-description').fill('Alles zum Testen');
  await a.page.getByTestId('channel-edit-save').click();
  await expect(b.page.getByTestId('channel-item-neuer-name')).toBeVisible();
  await b.page.getByTestId('channel-item-neuer-name').click();
  await expect(b.page.getByTestId('channel-description')).toHaveText('Alles zum Testen');

  // A category, and a channel moved into it by dragging.
  await a.page.getByTestId('guild-menu-button').click();
  await a.page.getByTestId('server-admin-button').click();
  await a.page.getByTestId('admin-tab-channels').click();
  await a.page.getByTestId('category-name').fill('Spiele');
  await a.page.getByTestId('category-add').click();
  await a.page.getByTestId('order-dritter').dragTo(a.page.getByTestId('group-Spiele'));
  await expect(a.page.getByTestId('group-Spiele').getByTestId('order-dritter')).toBeVisible();
  await a.page.getByRole('button', { name: 'Fertig' }).click();
  await expect(
    b.page.getByTestId('category-Spiele').getByTestId('channel-item-dritter'),
  ).toBeVisible();

  // Folding away stays after a reload.
  await b.page.getByTestId('category-toggle-Spiele').click();
  await expect(b.page.getByTestId('channel-item-dritter')).toHaveCount(0);
  await b.page.reload();
  await expect(b.page.getByTestId('category-Spiele')).toBeVisible();
  await expect(b.page.getByTestId('channel-item-dritter')).toHaveCount(0);

  // Deleting while someone reads it: they land elsewhere.
  await sendMessage(a.page, 'wird gelöscht');
  await b.page.getByTestId('category-toggle-Spiele').click();
  await b.page.getByTestId('channel-item-dritter').click();
  await expect(b.page.getByTestId('channel-title')).toContainText('dritter');
  await a.page.getByTestId('channel-item-dritter').hover();
  await a.page.getByTestId('channel-edit-dritter').click();
  await a.page.getByTestId('channel-delete').click();
  await expect(a.page.getByTestId('channel-delete-confirm')).toBeDisabled();
  await a.page.getByTestId('channel-delete-name').fill('dritter');
  await a.page.getByTestId('channel-delete-confirm').click();
  await expect(b.page.getByTestId('channel-title')).not.toContainText('dritter');
  await expect(b.page.getByTestId('channel-item-dritter')).toHaveCount(0);
  await expect(a.page.getByTestId('channel-title')).not.toContainText('dritter');
});
