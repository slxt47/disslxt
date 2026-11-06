import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { newUserPage, registerViaUi, sendMessage, twoUsersInGuild, uniqueUser } from '../helpers';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function check(page: Page, what: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const list = violations.map(
    (v) =>
      `${what}: ${v.id} (${v.impact}) ${v.nodes.length}x ${v.nodes
        .slice(0, 3)
        .map((n) => `${n.target.join(' ')} ${n.any[0]?.message ?? ''}`)
        .join(' || ')}`,
  );
  expect(list).toEqual([]);
}

for (const theme of ['dark', 'light'] as const) {
  test.describe(theme, () => {
    const setTheme = async (page: Page) => {
      await page.evaluate((t) => {
        const prefs = JSON.parse(localStorage.getItem('disslxt:prefs') ?? '{}') as object;
        localStorage.setItem('disslxt:prefs', JSON.stringify({ ...prefs, theme: t }));
      }, theme);
      await page.reload();
    };

    test('sign-in pages', async ({ browser }) => {
      const { page } = await newUserPage(browser);
      await page.goto('/login');
      await setTheme(page);
      await check(page, 'login');
      await page.getByTestId('to-register').click();
      await check(page, 'register');
    });

    test('chat, settings and server admin', async ({ browser }) => {
      const { a } = await twoUsersInGuild(browser, 'Barrierefrei');
      await setTheme(a.page);
      await sendMessage(a.page, 'Hallo Welt');
      await a.page
        .getByTestId('composer-input')
        .fill('Mit **fett** und @alle https://example.test');
      await a.page.getByTestId('composer-input').press('Enter');
      await a.page.getByTestId('composer-input').fill('/umfrage Pizza? | Ja | Nein');
      await a.page.getByTestId('composer-input').press('Enter');
      await expect(a.page.getByTestId('poll')).toBeVisible();
      await check(a.page, 'chat');
      await a.page.getByTestId('settings-button').click();
      await expect(a.page.getByTestId('settings-dialog')).toBeVisible();
      await check(a.page, 'settings');
      await a.page.keyboard.press('Escape');

      await a.page.keyboard.press('Control+k');
      await expect(a.page.getByTestId('switcher-input')).toBeVisible();
      await check(a.page, 'switcher');
      await a.page.keyboard.press('Escape');

      await a.page.getByTestId('channel-item-general').hover();
      await a.page.getByTestId('channel-edit-general').click();
      await expect(a.page.getByTestId('channel-settings')).toBeVisible();
      await check(a.page, 'channel settings');
      await a.page.keyboard.press('Escape');

      await a.page.keyboard.press('Control+Shift+F');
      await check(a.page, 'search');
      await a.page.keyboard.press('Escape');

      await a.page.getByTestId('home-button').click();
      await check(a.page, 'friends');
    });

    test('new account', async ({ browser }) => {
      const { page } = await newUserPage(browser);
      await registerViaUi(page, uniqueUser('axe'));
      await setTheme(page);
      await check(page, 'empty');
    });
  });
}

test('the switch changes the mode, keeps it, and starts dark', async ({ browser }) => {
  const { page } = await newUserPage(browser);
  await registerViaUi(page, uniqueUser('modus'));
  const mode = () => page.evaluate(() => document.documentElement.dataset.theme);
  expect(await mode()).toBe('dark');
  await page.getByTestId('mode-switch').click();
  expect(await mode()).toBe('light');
  await page.reload();
  await expect(page.getByTestId('mode-switch')).toHaveAttribute('aria-label', /dunklen/);
  expect(await mode()).toBe('light');
});

test('keyboard focus is always visible', async ({ browser }) => {
  const { page } = await newUserPage(browser);
  await page.goto('/login');
  await expect(page.getByTestId('email')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.activeElement as Element).boxShadow))
    .toContain('0px 0px 0px 3px');
});

test('still and reduced: nothing moves behind the text', async ({ browser }) => {
  const { page } = await newUserPage(browser);
  await page.goto('/login');
  const moving = await page.evaluate(
    () =>
      document
        .getAnimations()
        .filter((a) => (a.effect as KeyframeEffect).target?.closest('.himmel')).length,
  );
  expect(moving).toBe(0);
});
