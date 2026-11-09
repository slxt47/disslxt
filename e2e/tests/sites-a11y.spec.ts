import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// Product page and help (sites/), hell und dunkel. Only when the static sites are reachable:
// SITES_WEB_URL=http://127.0.0.1:8092 SITES_HILFE_URL=http://127.0.0.1:8093
const web = process.env.SITES_WEB_URL;
const hilfe = process.env.SITES_HILFE_URL;
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function check(page: Page, what: string) {
  // Reveal animations start invisible; show everything before measuring contrast.
  await page.evaluate(() =>
    document.querySelectorAll('.reveal').forEach((e) => e.classList.add('in')),
  );
  await page.waitForTimeout(900);
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

test.skip(!web || !hilfe, 'SITES_WEB_URL and SITES_HILFE_URL not set');

for (const modus of ['dunkel', 'hell'] as const) {
  test(`sites in ${modus}`, async ({ page }) => {
    await page.addInitScript((m) => localStorage.setItem('modus', m), modus);
    const pages = [
      [`${web}/`, 'start'],
      [`${web}/impressum.html`, 'impressum'],
      [`${web}/datenschutz.html`, 'datenschutz'],
      [`${web}/gibt-es-nicht`, '404 web'],
      [`${hilfe}/`, 'hilfe'],
      [`${hilfe}/gibt-es-nicht`, '404 hilfe'],
    ];
    for (const [url, what] of pages) {
      await page.goto(url!);
      await expect(page.locator('html')).toHaveAttribute('data-modus', modus);
      await expect(page.locator('[data-modus-schalter]')).toHaveAttribute('aria-label', /Modus/);
      await check(page, what!);
    }
  });
}
