import { expect, test } from '@playwright/test';
import { messageItem, sendMessage, twoUsersInGuild } from '../helpers';

test('roles: moderator rights, a restricted channel, kick and ban', async ({ browser }) => {
  const { a, b } = await twoUsersInGuild(browser, 'Rollen');
  const open = async () => {
    await a.page.getByTestId('guild-menu-button').click();
    await a.page.getByTestId('server-admin-button').click();
  };

  // B has no rights: no menu entry, no create button, no delete on foreign messages.
  await sendMessage(a.page, 'vom Besitzer');
  await sendMessage(b.page, 'von Bob');
  await b.page.getByTestId('guild-menu-button').click();
  await expect(b.page.getByTestId('server-admin-button')).toHaveCount(0);
  await b.page.getByTestId('guild-menu-button').click();
  await expect(b.page.getByTestId('create-channel-button')).toHaveCount(0);
  await messageItem(b.page, 'vom Besitzer').hover();
  await expect(messageItem(b.page, 'vom Besitzer').getByTestId('message-delete')).toHaveCount(0);

  // A second channel, only for a role.
  await a.page.getByTestId('create-channel-button').click();
  await a.page.getByTestId('channel-name-input').fill('team');
  await a.page.getByTestId('create-channel-submit').click();
  await expect(b.page.getByTestId('channel-item-team')).toBeVisible();

  await open();
  await a.page.getByTestId('admin-tab-roles').click();
  const fresh = a.page.getByTestId('role-new');
  await fresh.getByTestId('role-name').fill('Moderation');
  await fresh.getByTestId('perm-manage_messages').check();
  await fresh.getByTestId('role-save').click();
  await expect(a.page.getByTestId('role-Moderation')).toBeVisible();

  await a.page.getByTestId('admin-tab-channels').click();
  await a.page.getByTestId('access-team').getByTestId('access-restricted').check();
  await expect(b.page.getByTestId('channel-item-team')).toHaveCount(0);
  await expect(a.page.getByTestId('channel-item-team')).toBeVisible();

  await a.page.getByTestId('access-team').getByTestId('access-role-Moderation').check();

  // Handing out the role opens the channel for B, live, and gives the delete button.
  await a.page.getByTestId('admin-tab-members').click();
  const row = a.page.getByTestId(`admin-member-${b.user.username}`);
  await row.getByTestId('member-role-Moderation').check();
  await expect(b.page.getByTestId('channel-item-team')).toBeVisible();
  await expect(b.page.getByTestId('create-channel-button')).toHaveCount(0);
  await messageItem(b.page, 'vom Besitzer').hover();
  await expect(messageItem(b.page, 'vom Besitzer').getByTestId('message-delete')).toBeVisible();

  // Taking it away while B is inside sends B out of the channel.
  await b.page.getByTestId('channel-item-team').click();
  await expect(b.page.getByTestId('channel-title')).toContainText('team');
  await row.getByTestId('member-role-Moderation').uncheck();
  await expect(b.page.getByTestId('channel-title')).toContainText('general');

  // Ban: B is out, sees why, and the list shows it.
  await row.getByTestId('member-ban').click();
  await a.page.getByTestId('member-confirm').click();
  await expect(b.page.getByText('Du wurdest von diesem Server gesperrt.')).toBeVisible();
  await a.page.getByTestId('admin-tab-bans').click();
  await expect(a.page.getByTestId(`ban-${b.user.username}`)).toBeVisible();
});
