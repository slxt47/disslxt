import { expect, test, type Page } from '@playwright/test';
import {
  createGuildViaUi,
  inviteUrl,
  invitePath,
  newUserPage,
  registerViaUi,
  sendMessage,
  uniqueUser,
} from '../helpers';

test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
  permissions: ['microphone'],
});

async function resetLinkPath(page: Page, email: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(async () => {
      const res = await page.request.get('/api/dev/mails');
      const { mails } = (await res.json()) as {
        mails: { to: string; subject: string; text: string }[];
      };
      link = mails
        .filter((m) => m.to === email.toLowerCase() && m.subject.startsWith('Neues Passwort'))
        .at(-1)
        ?.text.match(/https?:\/\/\S+\/reset-password#token=[\w-]{43}/)?.[0];
      return link;
    })
    .toBeTruthy();
  const url = new URL(link!);
  return `${url.pathname}${url.hash}`;
}

test('forgot password: link by mail, new password, signed in', async ({ page }) => {
  const user = uniqueUser('vergesslich');
  await registerViaUi(page, user);
  await page.getByTestId('logout-button').click();
  await page.getByTestId('to-forgot').click();
  await page.getByTestId('email').fill(user.email);
  await page.getByTestId('forgot-submit').click();
  await expect(page.getByTestId('reset-sent')).toBeVisible();

  await page.goto(await resetLinkPath(page, user.email));
  await expect(page).toHaveURL(/\/reset-password$/); // token removed from the address bar
  await page.getByTestId('password').fill('Ganz-Neu-2026');
  await page.getByTestId('password-repeat').fill('Ganz-Neu-2026');
  await page.getByTestId('reset-submit').click();
  await expect(page.getByTestId('current-user')).toBeVisible();

  await page.getByTestId('logout-button').click();
  await page.getByTestId('email').fill(user.email);
  await page.getByTestId('password').fill('Ganz-Neu-2026');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('current-user')).toBeVisible();
});

test('status, server tag and red dot while in a call', async ({ browser }) => {
  const a = { ...(await newUserPage(browser)), user: uniqueUser('tagger') };
  const b = { ...(await newUserPage(browser)), user: uniqueUser('member') };
  await registerViaUi(a.page, a.user);
  await createGuildViaUi(a.page, 'Gamer');
  const invite = await inviteUrl(a.page);
  await a.page.keyboard.press('Escape');

  // Owner gives the server a tag with emoji.
  await a.page.getByTestId('guild-menu-button').click();
  await a.page.getByTestId('guild-settings-button').click();
  await a.page.getByTestId('guild-tag-emoji').click();
  await a.page.getByRole('button', { name: '🎮', exact: true }).click();
  await a.page.getByTestId('guild-tag-input').fill('game');
  await a.page.getByTestId('guild-tag-save').click();
  await expect(a.page.getByText('Gespeichert')).toBeVisible();
  await a.page.keyboard.press('Escape');

  // Member joins, wears the tag and sets a status.
  await registerViaUi(b.page, b.user);
  await b.page.goto(invitePath(invite));
  await b.page.getByTestId('invite-accept').click();
  await b.page.getByTestId('profile-button').click();
  await b.page.getByTestId('tag-select').selectOption({ label: '🎮 GAME – Gamer' });
  await b.page.getByTestId('status-emoji').click();
  await b.page.getByRole('button', { name: '🎧', exact: true }).click();
  await b.page.getByTestId('status-text').fill('Höre Musik');
  await b.page.getByTestId('status-save').click();
  await expect(b.page.getByText('Status gespeichert.')).toBeVisible();
  await b.page.keyboard.press('Escape');
  await sendMessage(b.page, 'Hallo zusammen');

  // The owner sees the tag on the message and the status in the member list.
  const member = a.page.getByTestId(`member-${b.user.username}`);
  await expect(member.getByTestId('status-line')).toHaveText('🎧 Höre Musik');
  await expect(member).toHaveAttribute('data-presence', 'online');
  await expect(a.page.getByTestId('user-tag').first()).toHaveText('🎮GAME');

  // B joins a voice channel → red for A.
  await a.page.getByTestId('create-channel-button').click();
  await a.page.getByTestId('channel-kind-voice').click();
  await a.page.getByTestId('channel-name-input').fill('Lounge');
  await a.page.getByTestId('create-channel-submit').click();
  await b.page.getByTestId('channel-item-lounge').click();
  await b.page.getByTestId('voice-join').click();
  await b.page.getByTestId('voice-setup-join').click();
  await expect(member).toHaveAttribute('data-presence', 'call');
  // Red, really: the dot has the theme's danger colour, not just the attribute.
  const dangerRgb = await a.page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--danger)';
    document.body.append(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();
    return rgb;
  });
  await expect(member.locator('.presence-dot')).toHaveCSS('background-color', dangerRgb);

  await b.page.getByTestId('voice-leave').click();
  await expect(member).toHaveAttribute('data-presence', 'online');
});
