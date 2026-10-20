import { expect, test } from '@playwright/test';
import { loginViaUi, newUserPage, twoUsersInGuild } from '../helpers';

test('member list shows the other user going online and offline', async ({ browser }) => {
  const { a, b, guild } = await twoUsersInGuild(browser, 'Präsenz-Test');
  const memberB = a.page.getByTestId(`member-${b.user.username}`);
  const memberA = a.page.getByTestId(`member-${a.user.username}`);

  await expect(a.page.getByTestId('member-list')).toBeVisible();
  await expect(memberA).toHaveAttribute('data-online', 'true');
  await expect(memberB).toHaveAttribute('data-online', 'true');

  // B closes the window → offline.
  await b.context.close();
  await expect(memberB).toHaveAttribute('data-online', 'false');

  // B comes back in a new window → online again.
  const b2 = await newUserPage(browser);
  await loginViaUi(b2.page, b.user);
  await b2.page.goto(`/guilds/${guild.guildId}/channels/${guild.channelId}`);
  await expect(memberB).toHaveAttribute('data-online', 'true');

  await b2.context.close();
  await a.context.close();
});
