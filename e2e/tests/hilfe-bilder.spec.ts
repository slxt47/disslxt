import { writeFileSync, mkdirSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { invitePath, inviteUrl, messageItem, registerViaUi, sendMessage } from '../helpers';

/**
 * Pictures for the help site (sites/hilfe/bilder/<name>-<hell|dunkel>.webp), made from a small
 * example round in the E2E database: nothing from real accounts lands on the public site.
 * Only runs on request: HILFE_BILDER=1 pnpm e2e tests/hilfe-bilder.spec.ts
 */
test.skip(!process.env.HILFE_BILDER, 'HILFE_BILDER not set');
test.setTimeout(600_000);
test.use({
  viewport: { width: 1200, height: 900 },
  deviceScaleFactor: 2,
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--auto-select-desktop-capture-source=Entire screen',
    ],
  },
  permissions: ['microphone', 'camera'],
});

const OUT = new URL('../../sites/hilfe/bilder/', import.meta.url);
const PASSWORD = 'Tr0cken-Blume-7';
type Mode = 'dunkel' | 'hell';
const THEME: Record<Mode, string> = { dunkel: 'dark', hell: 'light' };

async function setMode(page: Page, mode: Mode) {
  await page.evaluate((t) => {
    const prefs = JSON.parse(localStorage.getItem('disslxt:prefs') ?? '{}') as object;
    localStorage.setItem('disslxt:prefs', JSON.stringify({ ...prefs, theme: t }));
  }, THEME[mode]);
  await page.reload();
  await expect(
    page.getByTestId('composer-input').or(page.getByTestId('voice-stage')),
  ).toBeVisible();
}

/** PNG from Playwright → WebP through the browser's own encoder (no image tools on the host). */
async function save(page: Page, png: Buffer, name: string) {
  const conv = await page.context().newPage();
  const dataUrl = await conv.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d')!.drawImage(img, 0, 0);
    return c.toDataURL('image/webp', 0.82);
  }, png.toString('base64'));
  await conv.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(new URL(`${name}.webp`, OUT), Buffer.from(dataUrl.split(',')[1]!, 'base64'));
}

/** Screenshot of the area around all given elements, with a little room. */
async function shootArea(page: Page, name: string, parts: Locator[], pad = 12) {
  await parts[0]!.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
  const boxes = [];
  for (const p of parts) {
    const b = await p.boundingBox();
    if (b) boxes.push(b);
  }
  const vp = page.viewportSize()!;
  const x = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad);
  const y = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
  const r = Math.min(vp.width, Math.max(...boxes.map((b) => b.x + b.width)) + pad);
  const bt = Math.min(vp.height, Math.max(...boxes.map((b) => b.y + b.height)) + pad);
  await save(page, await page.screenshot({ clip: { x, y, width: r - x, height: bt - y } }), name);
}

async function shootPage(page: Page, name: string) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
  await save(page, await page.screenshot(), name);
}

test('pictures for the help site', async ({ browser, request }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const mia = { username: 'mia', email: 'mia@example.test', password: PASSWORD };
  const jonas = { username: 'jonas', email: 'jonas@example.test', password: PASSWORD };

  // --- Example round: Mia owns "Freundeskreis", Jonas joins ---
  for (const [page, user, name] of [
    [a, mia, 'Mia'],
    [b, jonas, 'Jonas'],
  ] as const) {
    await registerViaUi(page, user);
    await page.getByTestId('profile-button').click();
    await page.getByTestId('display-name-input').fill(name);
    await page.getByTestId('display-name-save').click();
    await expect(page.getByTestId('current-user')).toHaveText(name);
    await page.keyboard.press('Escape');
  }
  await a.getByTestId('empty-create-guild').click();
  await a.getByTestId('guild-name-input').fill('Freundeskreis');
  await a.getByTestId('create-guild-submit').click();
  await expect(a.getByTestId('channel-title')).toHaveText(/general/);
  const channelUrl = a.url();
  await b.goto(invitePath(await inviteUrl(a)));
  await b.getByTestId('invite-accept').click();
  await expect(b.getByTestId('channel-title')).toHaveText(/general/);

  await a.getByTestId('create-channel-button').click();
  await a.getByTestId('channel-kind-voice').click();
  await a.getByTestId('channel-name-input').fill('Treffpunkt');
  await a.getByTestId('create-channel-submit').click();
  await a.goto(channelUrl);

  // --- Conversation ---
  await sendMessage(a, 'Die Hütte ist gebucht! 🏔️');
  await sendMessage(b, 'Wahnsinn, wie viele Betten hat sie?');
  const hut = messageItem(b, 'Die Hütte ist gebucht! 🏔️');
  await hut.hover();
  await hut.getByTestId('message-react').click();
  await b.getByTestId('emoji-panel').getByRole('button', { name: '🎉' }).first().click();
  await hut.hover();
  await hut.getByTestId('message-reply-button').click();
  await b.getByTestId('composer-input').fill('Ich bring **Brettspiele** mit');
  await b.getByTestId('composer-input').press('Enter');
  await expect(messageItem(a, 'Ich bring Brettspiele mit')).toBeVisible();

  // Thread
  await sendMessage(a, 'Wer fährt mit dem Auto?');
  const car = messageItem(b, 'Wer fährt mit dem Auto?');
  await car.hover();
  await car.getByTestId('message-thread').click();
  const panelB = b.getByTestId('thread-panel');
  await panelB.getByTestId('composer-input').fill('Ich, zwei Plätze sind frei');
  await panelB.getByTestId('composer-input').press('Enter');
  await expect(panelB.getByTestId('thread-replies')).toContainText('zwei Plätze');
  await b.getByTestId('thread-close').click();

  // Poll and event
  await a.getByTestId('composer-input').fill('/umfrage Wann fahren wir los? | Freitag | Samstag');
  await a.getByTestId('composer-input').press('Enter');
  await b.getByTestId('poll-option-0').click();
  await a.getByTestId('composer-input').fill('/termin 24.12. 20:00 | Spieleabend');
  await a.getByTestId('composer-input').press('Enter');
  await b.getByTestId('event-yes').click();
  await expect(a.getByTestId('event-yes')).toContainText('(1)');

  // Planned message
  await a.getByTestId('composer-input').fill('/später 2h Nicht vergessen: Schlafsack!');
  await a.getByTestId('composer-input').press('Enter');
  await expect(a.getByTestId('composer-note')).toContainText('geplant');

  // Webhook → bot message
  await a.getByTestId('channel-item-general').hover();
  await a.getByTestId('channel-edit-general').click();
  await a.getByTestId('webhook-name').fill('Wetter');
  await a.getByTestId('webhook-add').click();
  const note = (await a.getByTestId('webhook-secret').textContent()) ?? '';
  const hookId = /api\/hooks\/([0-9a-f-]{36})/.exec(note)?.[1];
  const token = /Bearer (\S+)/.exec(note)?.[1];
  await a.keyboard.press('Escape');
  const res = await request.post(`/api/hooks/${hookId}`, {
    headers: { authorization: `Bearer ${token}` },
    data: { content: 'Am Wochenende: Sonne, 12 °C ☀️' },
  });
  expect(res.status()).toBe(204);
  await expect(a.locator('.bot-pill')).toBeVisible();

  // Example service list for /dienste (shown only, no real services).
  await a.route('**/api/admin/status', (route) =>
    route.fulfill({
      json: {
        entries: [
          { name: 'Webseite', up: true, ms: 84 },
          { name: 'Dateiablage', up: true, ms: 132 },
          { name: 'Backup', up: false, ms: null },
        ],
      },
    }),
  );

  const settingsSection = (id: string) =>
    a.locator('section.settings-section', { has: a.locator(`#${id}`) });

  for (const mode of ['dunkel', 'hell'] as const) {
    await a.goto(channelUrl);
    await setMode(a, mode);
    await expect(a.locator('.bot-pill')).toBeVisible();

    await shootPage(a, `ueberblick-${mode}`);
    await shootArea(a, `reaktionen-${mode}`, [
      messageItem(a, 'Die Hütte ist gebucht! 🏔️'),
      messageItem(a, 'Ich bring Brettspiele mit'),
    ]);
    await shootArea(a, `umfragen-${mode}`, [a.getByTestId('poll')]);
    await shootArea(a, `termine-${mode}`, [a.getByTestId('event')]);
    await shootArea(a, `webhooks-${mode}`, [messageItem(a, 'Am Wochenende: Sonne, 12 °C ☀️')]);

    await messageItem(a, 'Wer fährt mit dem Auto?').getByTestId('thread-link').click();
    await expect(a.getByTestId('thread-panel')).toContainText('zwei Plätze');
    await shootPage(a, `threads-${mode}`);
    await a.getByTestId('thread-close').click();

    await a.keyboard.press('Control+k');
    await expect(a.getByTestId('switcher-input')).toBeVisible();
    await shootArea(a, `springen-${mode}`, [
      a.getByTestId('switcher-input').locator('xpath=ancestor::*[@role="dialog"][1]'),
    ]);
    await a.keyboard.press('Escape');

    await a.keyboard.press('Control+Shift+F');
    await a.getByTestId('search-input').fill('Hütte');
    await expect(a.getByTestId('search-results')).toContainText('Hütte');
    await shootArea(a, `suche-${mode}`, [
      a.getByTestId('search-input').locator('xpath=ancestor::*[@role="dialog"][1]'),
    ]);
    await a.keyboard.press('Escape');

    await a.getByTestId('composer-input').fill('/dienste');
    await a.getByTestId('composer-input').press('Enter');
    await expect(a.getByTestId('status-dialog')).toContainText('Backup');
    await shootArea(a, `dienste-${mode}`, [a.getByTestId('status-dialog')]);
    await a.keyboard.press('Escape');

    await a.getByTestId('channel-item-general').hover();
    await a.getByTestId('channel-edit-general').click();
    await expect(a.getByTestId('channel-settings')).toBeVisible();
    await shootArea(a, `kanaele-${mode}`, [a.getByTestId('channel-settings')]);
    await a.keyboard.press('Escape');

    await a.getByTestId('guild-menu-button').click();
    await a.getByTestId('server-admin-button').click();
    await a.getByTestId('admin-tab-roles').click();
    await shootArea(a, `rollen-${mode}`, [a.getByTestId('server-admin')]);
    await a.keyboard.press('Escape');

    await a.getByTestId('settings-button').click();
    await expect(a.getByTestId('settings-dialog')).toBeVisible();
    for (const [id, name] of [
      ['settings-appearance', 'darstellung'],
      ['settings-scheduled', 'planen'],
      ['settings-security', 'sicherheit'],
    ] as const) {
      const section = settingsSection(id);
      await section.scrollIntoViewIfNeeded();
      await a.locator(`#${id}`).evaluate((h) => h.scrollIntoView({ block: 'start' }));
      await shootArea(a, `${name}-${mode}`, [section]);
    }
    await a.keyboard.press('Escape');

    // Voice channel with both, then screen sharing.
    for (const p of [a, b]) {
      await p.getByTestId('channel-item-treffpunkt').click();
      await p.getByTestId('voice-join').click();
      await p.getByTestId('voice-setup-join').click();
    }
    await expect(a.getByTestId('voice-tile-jonas')).toBeVisible();
    await shootPage(a, `sprachkanal-${mode}`);
    await a.getByTestId('voice-screen').click();
    await expect(a.getByTestId('screen-own')).toBeVisible();
    await a.waitForTimeout(1500);
    await shootPage(a, `bildschirm-${mode}`);
    await a.getByTestId('voice-screen').click();
    await a.getByTestId('voice-leave').click();
    await b.getByTestId('voice-leave').click();
  }
});
