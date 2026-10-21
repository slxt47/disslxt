import { expect, test } from '@playwright/test';
import { twoUsersInGuild } from '../helpers';

// Chromium's fake microphone (a beep) stands in for a real one; no permission prompt.
test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
  permissions: ['microphone'],
});

test('record a voice message, the other member receives and can play it', async ({ browser }) => {
  const { a, b } = await twoUsersInGuild(browser, 'Sprachnachrichten');
  for (const ctx of [a.context, b.context]) await ctx.grantPermissions(['microphone']);

  await a.page.getByTestId('record-voice').click();
  await expect(a.page.getByTestId('recording-bar')).toBeVisible();
  await expect(a.page.getByTestId('recording-time')).toContainText('0:02 / 2:00', {
    timeout: 5000,
  });
  await a.page.getByTestId('voice-send').click();
  await expect(a.page.getByTestId('recording-bar')).toBeHidden();

  // Live on B's side, with the length the sender measured.
  const player = b.page.getByTestId('voice-player');
  await expect(player).toBeVisible();
  await expect(player.getByTestId('voice-time')).toHaveText(/^0:0[2-3]$/);

  // The file is real audio, served to members with range support.
  const src = await player.locator('audio').getAttribute('src');
  expect(src).toMatch(/^\/api\/voice-messages\/\d+$/);
  const res = await b.page.request.get(src!, { headers: { range: 'bytes=0-3' } });
  expect(res.status()).toBe(206);
  expect(res.headers()['content-type']).toMatch(/^audio\//);
  expect([...(await res.body())]).toEqual([0x1a, 0x45, 0xdf, 0xa3]); // WebM header

  // The browser can decode it: playing advances the position.
  await player.getByTestId('voice-play').click();
  await expect
    .poll(() => player.locator('audio').evaluate((el: HTMLAudioElement) => el.currentTime))
    .toBeGreaterThan(0.2);

  // Outsiders cannot fetch it.
  const anon = await b.page.request.get(src!, { headers: { cookie: '' } });
  expect([401, 403]).toContain(anon.status());
  await a.context.close();
  await b.context.close();
});
