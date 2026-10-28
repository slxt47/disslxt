import { expect, test } from '@playwright/test';
import { messageContent, newUserPage, registerViaUi, sendMessage, uniqueUser } from '../helpers';

test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
  permissions: ['microphone', 'camera'],
});

// A 1×1 PNG: the browser resizes it to the 256 px profile picture before uploading.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

test('friends: profile, request, private chat with a picture, video call', async ({ browser }) => {
  const a = { ...(await newUserPage(browser)), user: uniqueUser('anna') };
  const b = { ...(await newUserPage(browser)), user: uniqueUser('ben') };
  await registerViaUi(a.page, a.user);
  await registerViaUi(b.page, b.user);

  // Profile: display name and picture.
  await a.page.getByTestId('profile-button').click();
  await a.page.getByTestId('display-name-input').fill('Anna 🌻');
  await a.page.getByTestId('display-name-save').click();
  await expect(a.page.getByTestId('current-user')).toHaveText('Anna 🌻');
  await a.page.getByTestId('avatar-input').setInputFiles({
    name: 'ich.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  await expect(a.page.getByTestId('avatar-remove')).toBeVisible();
  await a.page.keyboard.press('Escape');

  // A sends a request by username; B sees it, with a badge on the home button, and accepts.
  await a.page.getByTestId('home-button').click();
  await expect(a.page).toHaveURL(/\/me$/);
  await a.page.getByTestId('add-friend-input').fill(`@${b.user.username}`);
  await a.page.getByTestId('add-friend-submit').click();
  await expect(a.page.getByText(`Anfrage an @${b.user.username} geschickt.`)).toBeVisible();

  await expect(b.page.getByTestId('home-badge')).toHaveText('1');
  await b.page.getByTestId('home-button').click();
  const request = b.page.getByTestId(`friend-${a.user.username}`);
  await expect(request).toContainText('Anna 🌻');
  await request.getByTestId('friend-accept').click();
  await expect(request).toHaveAttribute('data-status', 'friend');
  await expect(a.page.getByTestId(`friend-${b.user.username}`)).toHaveAttribute(
    'data-status',
    'friend',
  );

  // B opens the private conversation and writes; A gets it live and sees it as unread.
  await b.page.getByTestId(`friend-${a.user.username}`).getByTestId('friend-message').click();
  await expect(b.page).toHaveURL(/\/me\/[0-9a-f-]{36}$/);
  await expect(b.page.getByTestId('channel-title')).toContainText('Anna 🌻');
  await sendMessage(b.page, 'Hey Anna, nur für dich');
  await expect(a.page.getByTestId(`dm-item-${b.user.username}`)).toBeVisible();
  await expect(a.page.getByTestId('home-badge')).toHaveText('1');
  await a.page.getByTestId(`dm-item-${b.user.username}`).click();
  await expect(messageContent(a.page, 'Hey Anna, nur für dich')).toBeVisible();
  await expect(a.page.getByTestId('home-badge')).toHaveCount(0);

  // A shares a picture in the conversation.
  await a.page.getByTestId('file-input').setInputFiles({
    name: 'foto.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  await expect(b.page.getByTestId('file-image')).toBeVisible();

  // Video call: A calls, B gets the ring and answers with video; both see two tiles.
  await a.page.getByTestId('call-start-video').click();
  await expect(a.page.getByTestId('call-ringing')).toBeVisible();
  const ring = b.page.getByTestId('incoming-call');
  await expect(ring).toContainText('Anna 🌻');
  await ring.getByTestId('call-accept-video').click();
  for (const page of [a.page, b.page]) {
    await expect(page.getByTestId('call-panel').locator('.voice-tile')).toHaveCount(2);
    await expect(page.locator('.voice-tile.video video')).not.toHaveCount(0);
  }
  await expect(a.page.getByTestId(`voice-tile-${b.user.username}`)).toHaveAttribute(
    'data-connection',
    'connected',
    { timeout: 20_000 },
  );

  // A hangs up: the call is gone on both sides.
  await a.page.getByTestId('voice-leave').click();
  await b.page.getByTestId('voice-leave').click();
  await expect(a.page.getByTestId('call-panel')).toHaveCount(0);
  await expect(b.page.getByTestId('call-panel')).toHaveCount(0);
});
