import { expect, test } from '@playwright/test';
import { twoUsersInGuild } from '../helpers';

// Real call through Cloudflare TURN (relay only) to prove credentials, relaying and the monthly
// counter. Needs E2E_CLOUDFLARE_TURN_KEY_ID / E2E_CLOUDFLARE_TURN_API_TOKEN; uses < 1 MB of quota.
test.skip(!process.env.E2E_CLOUDFLARE_TURN_KEY_ID, 'no TURN credentials for E2E');
test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
  permissions: ['microphone'],
});

test('a call relayed through TURN connects and is counted against the monthly quota', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { a, b } = await twoUsersInGuild(browser, 'TURN');
  // Force relay candidates only, as behind a symmetric NAT.
  for (const p of [a.page, b.page]) {
    await p.addInitScript(() => {
      const Original = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends Original {
        constructor(config?: RTCConfiguration) {
          super({ ...config, iceTransportPolicy: 'relay' });
        }
      } as typeof RTCPeerConnection;
    });
    await p.reload();
  }
  const before = (await (await a.page.request.get('/api/voice/turn-usage')).json()) as {
    usedBytes: number;
    configured: boolean;
  };
  expect(before.configured).toBe(true);

  await a.page.getByTestId('create-channel-button').click();
  await a.page.getByTestId('channel-kind-voice').click();
  await a.page.getByTestId('channel-name-input').fill('relay');
  await a.page.getByTestId('create-channel-submit').click();
  await a.page.getByTestId('voice-join').click();
  await a.page.getByTestId('voice-setup-join').click();
  await b.page.getByTestId('channel-item-relay').click();
  await b.page.getByTestId('voice-join').click();
  await b.page.getByTestId('voice-setup-join').click();
  await expect(a.page.getByTestId(`voice-tile-${b.user.username}`)).toHaveAttribute(
    'data-connection',
    'connected',
    { timeout: 30_000 },
  );

  // Let audio flow for a moment, then leave: the final measurement is reported on leaving.
  await a.page.waitForTimeout(5000);
  await b.page.getByTestId('voice-leave').click();
  await a.page.getByTestId('voice-leave').click();
  await expect
    .poll(
      async () =>
        (
          (await (await a.page.request.get('/api/voice/turn-usage')).json()) as {
            usedBytes: number;
          }
        ).usedBytes - before.usedBytes,
      { timeout: 15_000 },
    )
    .toBeGreaterThan(10_000);
  await a.context.close();
  await b.context.close();
});
