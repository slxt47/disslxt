import { expect, test } from '@playwright/test';
import { twoUsersInGuild } from '../helpers';

test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
  permissions: ['microphone'],
});

test('two people talk in a voice channel over a real WebRTC connection', async ({ browser }) => {
  const { a, b, guild } = await twoUsersInGuild(browser, 'Sprachkanal');
  for (const ctx of [a.context, b.context]) await ctx.grantPermissions(['microphone']);

  // A (owner) creates a voice channel.
  await a.page.getByTestId('create-channel-button').click();
  await a.page.getByTestId('channel-kind-voice').click();
  await a.page.getByTestId('channel-name-input').fill('Lounge');
  await a.page.getByTestId('create-channel-submit').click();
  await expect(a.page.getByTestId('voice-join')).toBeVisible();
  const voiceUrl = a.page.url();
  expect(voiceUrl).toMatch(new RegExp(`/guilds/${guild.guildId}/channels/`));

  // B sees it appear live in the channel list.
  await expect(b.page.getByTestId('channel-item-lounge')).toBeVisible();

  // A joins through the device menu: microphones are listed, the level meter reacts.
  await a.page.getByTestId('voice-join').click();
  await expect(a.page.getByTestId('voice-input-select').locator('option')).not.toHaveCount(1);
  await expect(a.page.getByTestId('mic-level')).toHaveAttribute('data-active', 'true');
  await expect(a.page.getByTestId('voice-output-select')).toBeVisible();
  await a.page.getByTestId('voice-setup-join').click();
  await expect(a.page.getByTestId('voice-stage')).toHaveAttribute('data-status', 'connected');
  await expect(b.page.getByTestId(`voice-participant-${a.user.username}`)).toBeVisible();

  // B joins: both ends reach the WebRTC "connected" state.
  await b.page.getByTestId('channel-item-lounge').click();
  await b.page.getByTestId('voice-join').click();
  await b.page.getByTestId('voice-setup-join').click();
  await expect(a.page.getByTestId(`voice-tile-${b.user.username}`)).toHaveAttribute(
    'data-connection',
    'connected',
    { timeout: 20_000 },
  );
  await expect(b.page.getByTestId(`voice-tile-${a.user.username}`)).toHaveAttribute(
    'data-connection',
    'connected',
    { timeout: 20_000 },
  );

  // Audio actually flows: B's player for A receives a live track.
  await expect
    .poll(() =>
      b.page.evaluate(() => {
        const audio = document.querySelector<HTMLAudioElement>(
          '[data-testid="voice-audio-sink"] audio',
        );
        const stream = audio?.srcObject as MediaStream | null;
        return stream?.getAudioTracks()[0]?.readyState ?? 'none';
      }),
    )
    .toBe('live');

  // Switching the microphone mid-call keeps the connection.
  await a.page.getByTestId('voice-devices').click();
  const mics = a.page.getByTestId('voice-input-select');
  const other = await mics.locator('option').nth(1).getAttribute('value');
  await mics.selectOption(other!);
  await a.page.keyboard.press('Escape');
  await expect(b.page.getByTestId(`voice-tile-${a.user.username}`)).toHaveAttribute(
    'data-connection',
    'connected',
  );

  // Mute is visible to the other side.
  await a.page.getByTestId('voice-mute').click();
  await expect(b.page.getByTestId(`voice-tile-${a.user.username}`)).toContainText(
    'Stummgeschaltet',
  );

  // B goes to a text channel and stays in the call (voice bar), then leaves from there.
  await b.page.getByTestId('channel-item-general').click();
  await expect(b.page.getByTestId('voice-bar')).toBeVisible();
  await expect(a.page.getByTestId(`voice-tile-${b.user.username}`)).toHaveAttribute(
    'data-connection',
    'connected',
  );
  await b.page.getByTestId('voice-bar-leave').click();
  await expect(b.page.getByTestId('voice-bar')).toBeHidden();
  await expect(a.page.getByTestId(`voice-tile-${b.user.username}`)).toBeHidden();

  await a.page.getByTestId('voice-leave').click();
  await expect(b.page.getByTestId(`voice-participant-${a.user.username}`)).toBeHidden();
  await a.context.close();
  await b.context.close();
});
