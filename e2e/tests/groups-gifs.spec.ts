import { expect, test, type Page } from '@playwright/test';
import { messageContent, newUserPage, registerViaUi, sendMessage, uniqueUser } from '../helpers';

async function befriend(a: Page, b: Page, bName: string, aName: string) {
  await a.goto('/me');
  await a.getByTestId('add-friend-input').fill(bName);
  await a.getByTestId('add-friend-submit').click();
  await b.goto('/me');
  await b.getByTestId(`friend-${aName}`).getByTestId('friend-accept').click();
  await expect(b.getByTestId(`friend-${aName}`)).toHaveAttribute('data-status', 'friend');
}

test('group chat: create with two friends, everyone writes, rename, leave', async ({ browser }) => {
  const person = async (name: string) => ({
    ...(await newUserPage(browser)),
    user: uniqueUser(name),
  });
  const a = await person('gina');
  const b = await person('hugo');
  const c = await person('ida');
  for (const p of [a, b, c]) await registerViaUi(p.page, p.user);
  await befriend(a.page, b.page, b.user.username, a.user.username);
  await befriend(a.page, c.page, c.user.username, a.user.username);

  await a.page.goto('/me');
  await a.page.getByTestId('create-group-button').click();
  await a.page.getByTestId('group-name-input').fill('Spieleabend');
  await a.page.getByTestId(`group-pick-${b.user.username}`).check();
  await a.page.getByTestId(`group-pick-${c.user.username}`).check();
  await a.page.getByTestId('group-create-submit').click();
  await expect(a.page.getByTestId('channel-title')).toContainText('Spieleabend');
  const url = a.page.url();

  // Hugo and Ida are not friends with each other, but both are in and can write.
  for (const p of [b.page, c.page]) {
    await expect(p.getByText('Spieleabend')).toBeVisible();
  }
  await b.page.goto(new URL(url).pathname);
  await sendMessage(b.page, 'Ich bring Chips mit');
  await c.page.goto(new URL(url).pathname);
  await expect(messageContent(c.page, 'Ich bring Chips mit')).toBeVisible();
  await sendMessage(c.page, 'Und ich Getränke');
  await expect(messageContent(a.page, 'Und ich Getränke')).toBeVisible();

  // Rename: everyone sees the new name.
  await b.page.getByTestId('group-info-button').click();
  await b.page.getByTestId('group-rename-input').fill('Freitag 20 Uhr');
  await b.page.getByRole('button', { name: 'Speichern' }).click();
  await expect(a.page.getByTestId('channel-title')).toContainText('Freitag 20 Uhr');

  // Ida leaves: it disappears for her, the others see two people.
  await c.page.getByTestId('group-info-button').click();
  await c.page.getByTestId('group-leave').click();
  await c.page.getByTestId('group-leave-confirm').click();
  await expect(c.page).toHaveURL(/\/me$/);
  await expect(c.page.getByText('Freitag 20 Uhr')).toHaveCount(0);
  await expect(a.page.getByTestId('channel-title')).toContainText('2');
});

test('GIF picker: search, pick, shown in the chat (GIPHY simulated)', async ({ page }) => {
  // A real 1×1 GIF stands in for GIPHY's media; the API answers come from here too.
  const gif = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');
  const item = (id: string) => ({
    id,
    mp4: `https://media.giphy.com/media/${id}/giphy.mp4`,
    webp: `https://media.giphy.com/media/${id}/200w.webp`,
    width: 480,
    height: 270,
    title: `Katze ${id}`,
  });
  await page.route('https://media.giphy.com/**', (r) =>
    r.fulfill({ status: 200, contentType: 'image/gif', body: gif }),
  );
  await page.route('**/api/gifs/status', (r) => r.fulfill({ json: { enabled: true } }));
  await page.route('**/api/gifs/search**', (r) =>
    r.fulfill({ json: { gifs: [item('cat111'), item('cat222'), item('cat333')] } }),
  );
  let posted = '';
  await page.route('**/api/channels/*/gifs', async (r) => {
    posted = (r.request().postDataJSON() as { id: string }).id;
    const channelId = new URL(r.request().url()).pathname.split('/')[3];
    await r.fulfill({
      status: 201,
      json: {
        message: {
          id: '999999',
          channelId,
          author: { id: 'x', username: 'gif_test', displayName: null, avatarUrl: null },
          kind: 'gif',
          content: 'Katze cat222',
          audio: null,
          file: null,
          gif: item('cat222'),
          createdAt: new Date().toISOString(),
          editedAt: null,
        },
      },
    });
  });

  await registerViaUi(page, uniqueUser('gifs'));
  await page.getByTestId('empty-create-guild').click();
  await page.getByTestId('guild-name-input').fill('GIF-Test');
  await page.getByTestId('create-guild-submit').click();
  await page.getByTestId('gif-button').click();
  await expect(page.getByTestId('gif-result')).toHaveCount(3);
  await page.getByTestId('gif-search').fill('katze');
  await page.getByTestId('gif-result').nth(1).click();
  await expect(page.getByTestId('gif-picker')).toHaveCount(0);
  await expect(page.getByTestId('gif-message')).toBeVisible();
  expect(posted).toBe('cat222');
});
