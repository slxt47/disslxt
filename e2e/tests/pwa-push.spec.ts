import { expect, test, type Page } from '@playwright/test';
import {
  createGuildViaUi,
  registerViaUi,
  sendMessage,
  twoUsersInGuild,
  uniqueUser,
} from '../helpers';

test('manifest, icons and service worker make the app installable', async ({ page, request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest).toMatchObject({ name: 'disslxt', display: 'standalone', start_url: '/' });
  for (const icon of manifest.icons as { src: string; purpose: string }[]) {
    expect((await request.get(icon.src)).ok(), icon.src).toBe(true);
  }
  expect(manifest.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);
  expect((await request.get('/icons/apple-touch-icon.png')).ok()).toBe(true);

  await registerViaUi(page, uniqueUser('pwa'));
  const sw = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return { scope: reg.scope, active: !!reg.active };
  });
  expect(sw.active).toBe(true);
  expect(new URL(sw.scope).pathname).toBe('/');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute(
    'content',
    'yes',
  );
});

test('settings: permission is only requested on click; per-server mute sticks', async ({
  page,
}) => {
  await registerViaUi(page, uniqueUser('settings'));
  await createGuildViaUi(page, 'Leise');
  // Headless Chromium always reports "denied"; simulate a browser that has not asked yet and
  // count the prompts.
  await page.addInitScript(() => {
    const w = window as unknown as { __prompts: number };
    w.__prompts = 0;
    Object.defineProperty(Notification, 'permission', { get: () => 'default' });
    Notification.requestPermission = async () => {
      w.__prompts += 1;
      return 'default';
    };
  });
  await page.reload();
  const prompts = () => page.evaluate(() => (window as unknown as { __prompts: number }).__prompts);

  await page.getByTestId('settings-button').click();
  await expect(page.getByTestId('settings-dialog')).toBeVisible();
  await expect(page.getByTestId('push-state')).toHaveAttribute('data-state', 'off');
  expect(await prompts()).toBe(0);
  await page.getByTestId('push-enable').click();
  await expect.poll(prompts).toBe(1);
  await page.keyboard.press('Escape');

  const toggle = page.getByTestId('guild-mute-toggle');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.getByTestId('guild-mute-toggle')).toHaveAttribute('aria-pressed', 'true');
});

test('a member who is not looking at the channel gets a push; the author does not', async ({
  browser,
}) => {
  const { a, b } = await twoUsersInGuild(browser, 'Push-Test');

  // Register a (fake) push subscription for each, then close B's page: B is not looking.
  const subscribe = async (page: Page, id: string) => {
    const endpoint = `https://fcm.googleapis.com/fcm/send/${id}-${Date.now()}`;
    const res = await page.request.post('/api/push/subscriptions', {
      data: { endpoint, keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } },
    });
    expect(res.status()).toBe(201);
    return endpoint;
  };
  const toA = await subscribe(a.page, 'a');
  const toB = await subscribe(b.page, 'b');
  await b.page.close();

  await sendMessage(a.page, `Kommst du heute? @${b.user.username}`);
  const titlesFor = async (endpoint: string) => {
    const res = await a.page.request.get('/api/dev/pushes');
    const { pushes } = (await res.json()) as {
      pushes: { endpoint: string; payload: { title: string } }[];
    };
    return pushes.filter((p) => p.endpoint === endpoint).map((p) => p.payload.title);
  };
  await expect.poll(() => titlesFor(toB)).toEqual([`${a.user.username} hat dich erwähnt`]);
  expect(await titlesFor(toA)).toEqual([]);
  await a.context.close();
  await b.context.close();
});
