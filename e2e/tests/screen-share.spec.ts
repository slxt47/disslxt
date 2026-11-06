import { expect, test } from '@playwright/test';
import { twoUsersInGuild } from '../helpers';

test.use({
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--auto-select-desktop-capture-source=Entire screen',
    ],
  },
  permissions: ['microphone'],
});

test('a shared screen reaches the other side and goes away again', async ({ browser }) => {
  const { a, b } = await twoUsersInGuild(browser, 'Bildschirm');
  for (const ctx of [a.context, b.context]) await ctx.grantPermissions(['microphone']);

  await a.page.getByTestId('create-channel-button').click();
  await a.page.getByTestId('channel-kind-voice').click();
  await a.page.getByTestId('channel-name-input').fill('Lounge');
  await a.page.getByTestId('create-channel-submit').click();
  await a.page.getByTestId('voice-join').click();
  await a.page.getByTestId('voice-setup-join').click();
  await expect(a.page.getByTestId('voice-stage')).toHaveAttribute('data-status', 'connected');

  await b.page.getByTestId('channel-item-lounge').click();
  await b.page.getByTestId('voice-join').click();
  await b.page.getByTestId('voice-setup-join').click();
  await expect(a.page.getByTestId(`voice-tile-${b.user.username}`)).toHaveAttribute(
    'data-connection',
    'connected',
    { timeout: 20_000 },
  );

  await a.page.getByTestId('voice-screen').click();
  await expect(a.page.getByTestId('screen-own')).toBeVisible();
  await expect(a.page.getByTestId('voice-screen')).toHaveAttribute('aria-pressed', 'true');

  // B sees a real picture, large, and who it comes from.
  const stage = b.page.getByTestId('screen-stage');
  await expect(stage).toContainText(a.user.username);
  await expect(b.page.getByTestId(`voice-tile-${a.user.username}`)).toContainText(
    'Teilt den Bildschirm',
  );
  await expect
    .poll(() => stage.locator('video').evaluate((v: HTMLVideoElement) => v.videoWidth), {
      timeout: 20_000,
    })
    .toBeGreaterThan(0);

  await a.page.getByTestId('voice-screen').click();
  await expect(a.page.getByTestId('screen-own')).toHaveCount(0);
  await expect(b.page.getByTestId('screen-stage')).toHaveCount(0);
});
