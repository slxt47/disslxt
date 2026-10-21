import { expect, test } from '@playwright/test';
import {
  createGuildViaUi,
  fillRegisterForm,
  inviteUrl,
  invitePath,
  newUserPage,
  registerViaUi,
  confirmViaMail,
  twoUsersInGuild,
  uniqueUser,
} from '../helpers';

// Success criterion 2: a new user joins through an invite link.
test('a logged-out user follows an invite link, registers and joins the guild', async ({
  browser,
}) => {
  const a = { ...(await newUserPage(browser)), user: uniqueUser('owner') };
  await registerViaUi(a.page, a.user);
  const guild = await createGuildViaUi(a.page, 'Einladungs-Server');
  const invite = invitePath(await inviteUrl(a.page));

  const b = { ...(await newUserPage(browser)), user: uniqueUser('newbie') };
  await b.page.goto(invite);
  // Guests are sent to the login page, which keeps the invite as `next`.
  await expect(b.page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(invite)}`));
  await b.page.getByTestId('to-register').click();
  await expect(b.page).toHaveURL(/\/register\?next=/);
  await fillRegisterForm(b.page, b.user);
  await expect(b.page.getByTestId('check-inbox')).toBeVisible();
  await confirmViaMail(b.page, b.user.email);

  // Back on the invite page after confirming the e-mail.
  await expect(b.page).toHaveURL(new RegExp(`${invite}$`));
  await expect(b.page.getByTestId('invite-guild-name')).toHaveText('Einladungs-Server');
  await expect(b.page.getByTestId('invite-member-count')).toHaveText('1 Mitglied');
  await expect(b.page.getByTestId('invite-accept')).toHaveText('Beitreten');
  await b.page.getByTestId('invite-accept').click();

  await expect(b.page).toHaveURL(
    new RegExp(`/guilds/${guild.guildId}/channels/${guild.channelId}$`),
  );
  await expect(b.page.getByTestId('channel-title')).toHaveText(/general/);
  await expect(b.page.getByTestId(`guild-item-${guild.guildId}`)).toBeVisible();
  // The owner sees the new member appear (member.joined).
  await expect(a.page.getByTestId(`member-${b.user.username}`)).toBeVisible();

  // Opening the invite again offers "Öffnen" instead of joining twice.
  await b.page.goto(invite);
  await expect(b.page.getByTestId('invite-member-count')).toHaveText('2 Mitglieder');
  await expect(b.page.getByTestId('invite-accept')).toHaveText('Öffnen');
  await b.page.getByTestId('invite-accept').click();
  await expect(b.page.getByTestId('channel-title')).toHaveText(/general/);

  // Leaving the server (non-owner only).
  await expect(a.page.getByTestId('leave-guild-button')).toHaveCount(0);
  await b.page.getByTestId('leave-guild-button').click();
  await b.page.getByTestId('leave-guild-confirm').click();
  await expect(b.page.getByTestId('empty-state')).toBeVisible();
  await expect(b.page.getByTestId(`guild-item-${guild.guildId}`)).toHaveCount(0);
  await expect(a.page.getByTestId(`member-${b.user.username}`)).toHaveCount(0);

  await a.context.close();
  await b.context.close();
});

test('an invalid invite code shows an error', async ({ page }) => {
  await registerViaUi(page, uniqueUser('lost'));
  await page.goto('/invite/doesNotExist1');
  await expect(page.getByTestId('invite-invalid')).toBeVisible();
});

test('the owner deletes a server; the member sees it disappear live', async ({ browser }) => {
  const { a, b, guild } = await twoUsersInGuild(browser, 'Kurzlebig');
  await a.page.getByTestId('delete-guild-button').click();
  const confirm = a.page.getByTestId('delete-guild-confirm');
  await expect(confirm).toBeDisabled();
  await a.page.getByTestId('delete-guild-name').fill('Kurzlebig');
  await confirm.click();
  await expect(a.page.getByTestId('empty-state')).toBeVisible();
  await expect(b.page.getByTestId(`guild-item-${guild.guildId}`)).toHaveCount(0);
  await expect(b.page.getByTestId('empty-state')).toBeVisible();
  await a.context.close();
  await b.context.close();
});
