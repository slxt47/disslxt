import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  messageItem,
  newUserPage,
  registerViaUi,
  sendMessage,
  twoUsersInGuild,
  uniqueUser,
} from '../helpers';

// The views a11y.spec.ts does not reach: voice channel, screen sharing, a private call, threads
// and the server administration, each in both modes.
test.use({
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--auto-select-desktop-capture-source=Entire screen',
    ],
  },
  permissions: ['microphone', 'camera'],
});

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function check(page: Page, what: string) {
  const { violations } = await new AxeBuilder({ page })
    // Live video frames are pictures, not text: axe cannot judge contrast on them.
    .exclude('video')
    .withTags(TAGS)
    .analyze();
  const list = violations.map(
    (v) =>
      `${what}: ${v.id} (${v.impact}) ${v.nodes.length}x ${v.nodes
        .slice(0, 3)
        .map((n) => `${n.target.join(' ')} ${n.any[0]?.message ?? ''}`)
        .join(' || ')}`,
  );
  expect(list).toEqual([]);
}

async function setTheme(page: Page, theme: 'dark' | 'light') {
  await page.evaluate((t) => {
    const prefs = JSON.parse(localStorage.getItem('disslxt:prefs') ?? '{}') as object;
    localStorage.setItem('disslxt:prefs', JSON.stringify({ ...prefs, theme: t }));
  }, theme);
  await page.reload();
}

for (const theme of ['dark', 'light'] as const) {
  test.describe(theme, () => {
    test('voice channel and screen sharing', async ({ browser }) => {
      const { a, b } = await twoUsersInGuild(browser, 'Sprache');
      await setTheme(a.page, theme);
      await a.page.getByTestId('create-channel-button').click();
      await a.page.getByTestId('channel-kind-voice').click();
      await a.page.getByTestId('channel-name-input').fill('Lounge');
      await a.page.getByTestId('create-channel-submit').click();
      await a.page.getByTestId('voice-join').click();
      await expect(a.page.getByTestId('voice-setup-join')).toBeVisible();
      await check(a.page, 'voice setup');
      await a.page.getByTestId('voice-setup-join').click();
      await expect(a.page.getByTestId('voice-stage')).toHaveAttribute('data-status', 'connected');

      await b.page.getByTestId('channel-item-lounge').click();
      await b.page.getByTestId('voice-join').click();
      await b.page.getByTestId('voice-setup-join').click();
      await expect(a.page.getByTestId(`voice-tile-${b.user.username}`)).toBeVisible();
      await check(a.page, 'voice stage');

      await a.page.getByTestId('voice-screen').click();
      await expect(a.page.getByTestId('screen-own')).toBeVisible();
      await check(a.page, 'screen sharing');

      await a.page.getByTestId('channel-item-general').click();
      await expect(a.page.getByTestId('voice-bar')).toBeVisible();
      await check(a.page, 'voice bar');
    });

    test('private call', async ({ browser }) => {
      const a = { ...(await newUserPage(browser)), user: uniqueUser('ruf') };
      const b = { ...(await newUserPage(browser)), user: uniqueUser('an') };
      await registerViaUi(a.page, a.user);
      await registerViaUi(b.page, b.user);
      await setTheme(a.page, theme);
      await setTheme(b.page, theme);
      await a.page.getByTestId('home-button').click();
      await a.page.getByTestId('add-friend-input').fill(`@${b.user.username}`);
      await a.page.getByTestId('add-friend-submit').click();
      await b.page.getByTestId('home-button').click();
      await b.page.getByTestId(`friend-${a.user.username}`).getByTestId('friend-accept').click();
      await b.page.getByTestId(`friend-${a.user.username}`).getByTestId('friend-message').click();
      await sendMessage(b.page, 'Hallo');
      await a.page.getByTestId(`dm-item-${b.user.username}`).click();

      await a.page.getByTestId('call-start-video').click();
      await expect(a.page.getByTestId('call-ringing')).toBeVisible();
      const ring = b.page.getByTestId('incoming-call');
      await expect(ring).toBeVisible();
      await check(b.page, 'incoming call');
      await check(a.page, 'ringing');
      await ring.getByTestId('call-accept-video').click();
      for (const page of [a.page, b.page]) {
        await expect(page.getByTestId('call-panel').locator('.voice-tile')).toHaveCount(2);
      }
      await check(a.page, 'call');
    });

    test('thread and server administration', async ({ browser }) => {
      const { a, b } = await twoUsersInGuild(browser, 'Verwaltung');
      await setTheme(a.page, theme);
      await sendMessage(b.page, 'Wer kommt mit?');
      const msg = messageItem(a.page, 'Wer kommt mit?');
      await msg.hover();
      await msg.getByTestId('message-thread').click();
      const panel = a.page.getByTestId('thread-panel');
      await panel.getByTestId('composer-input').fill('Ich!');
      await panel.getByTestId('composer-input').press('Enter');
      await expect(panel.getByTestId('thread-replies')).toContainText('Ich!');
      await check(a.page, 'thread');
      await a.page.keyboard.press('Escape');

      await a.page.getByTestId('guild-menu-button').click();
      await a.page.getByTestId('guild-settings-button').click();
      await expect(a.page.getByTestId('guild-settings-dialog')).toBeVisible();
      await check(a.page, 'server settings');
      await a.page.keyboard.press('Escape');

      await a.page.getByTestId('guild-menu-button').click();
      await a.page.getByTestId('server-admin-button').click();
      for (const tab of ['members', 'roles', 'channels', 'bans', 'invite']) {
        await a.page.getByTestId(`admin-tab-${tab}`).click();
        await check(a.page, `admin ${tab}`);
      }
    });
  });
}
