import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { invitePath, inviteUrl, messageItem, registerViaUi, sendMessage } from '../helpers';

/**
 * Moving picture of disslxt for the portfolio (slxt.dev): a small, made-up conversation in the E2E
 * database, recorded frame by frame from Lena's view (PNG + durations.json per mode). Nothing from
 * real accounts. The portfolio turns the frames into an animated WebP.
 * Only runs on request: PORTFOLIO_BILDER=<output dir> pnpm e2e tests/portfolio-bilder.spec.ts
 */
test.skip(!process.env.PORTFOLIO_BILDER, 'PORTFOLIO_BILDER not set');
test.setTimeout(600_000);
test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

const PASSWORD = 'Tr0cken-Blume-7';
type Mode = 'dunkel' | 'hell';
const THEME: Record<Mode, string> = { dunkel: 'dark', hell: 'light' };

class Film {
  frames: Buffer[] = [];
  ms: number[] = [];
  constructor(private page: Page) {}
  async shot(ms = 120) {
    this.frames.push(await this.page.screenshot());
    this.ms.push(ms);
  }
  async wait(total: number, step = 140) {
    for (let t = 0; t < total; t += step) {
      await this.page.waitForTimeout(step - 60);
      await this.shot(step);
    }
  }
  save(mode: Mode) {
    const dir = `${process.env.PORTFOLIO_BILDER}/disslxt-${mode}`;
    mkdirSync(dir, { recursive: true });
    this.frames.forEach((f, i) => writeFileSync(`${dir}/${String(i).padStart(3, '0')}.png`, f));
    writeFileSync(`${dir}/dauer.json`, JSON.stringify(this.ms));
  }
}

async function setMode(page: Page, mode: Mode) {
  await page.evaluate((t) => {
    const prefs = JSON.parse(localStorage.getItem('disslxt:prefs') ?? '{}') as object;
    localStorage.setItem('disslxt:prefs', JSON.stringify({ ...prefs, theme: t }));
  }, THEME[mode]);
  await page.reload();
  await expect(page.getByTestId('composer-input')).toBeVisible();
}

test('moving picture for the portfolio', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  const lena = { username: 'lena', email: 'lena@example.test', password: PASSWORD };
  const max = { username: 'max', email: 'max@example.test', password: PASSWORD };
  for (const [page, user, name] of [
    [a, lena, 'Lena'],
    [b, max, 'Max'],
  ] as const) {
    await registerViaUi(page, user);
    await page.getByTestId('profile-button').click();
    await page.getByTestId('display-name-input').fill(name);
    await page.getByTestId('display-name-save').click();
    await expect(page.getByTestId('current-user')).toHaveText(name);
    await page.keyboard.press('Escape');
  }
  await a.getByTestId('empty-create-guild').click();
  await a.getByTestId('guild-name-input').fill('Homelab');
  await a.getByTestId('create-guild-submit').click();
  await expect(a.getByTestId('channel-title')).toHaveText(/general/);
  await b.goto(invitePath(await inviteUrl(a)));
  await b.getByTestId('invite-accept').click();
  await expect(b.getByTestId('channel-title')).toHaveText(/general/);

  await sendMessage(b, 'Backup heute Nacht lief sauber durch ✅');
  await sendMessage(a, 'Nice! Dann spiel ich gleich das Update ein');

  for (const mode of ['dunkel', 'hell'] as Mode[]) {
    await setMode(a, mode);
    await a.mouse.move(0, 0);
    const film = new Film(a);
    await film.wait(700);
    // Max tippt – Lena sieht „Max tippt …“
    const text =
      mode === 'dunkel' ? 'Update ist drauf, alles grün 🚀' : 'Läuft wieder, danke dir 🙌';
    const inputB = b.getByTestId('composer-input');
    await inputB.click();
    for (const ch of text) {
      await inputB.pressSequentially(ch);
      await film.shot(110);
    }
    await inputB.press('Enter');
    await expect(messageItem(a, text)).toBeVisible();
    await film.wait(900);
    // Lena reagiert mit 🎉
    const msg = messageItem(a, text);
    await msg.hover();
    await film.shot(300);
    await msg.getByTestId('message-react').click();
    await film.shot(350);
    await a.getByTestId('emoji-panel').getByRole('button', { name: '🎉' }).first().click();
    await a.mouse.move(0, 0);
    await film.wait(700);
    // …und antwortet
    const reply = mode === 'dunkel' ? 'Top, danke! 💜' : 'Perfekt 👌';
    const inputA = a.getByTestId('composer-input');
    await inputA.click();
    for (const ch of reply) {
      await inputA.pressSequentially(ch);
      await film.shot(120);
    }
    await inputA.press('Enter');
    await film.wait(2200);
    film.save(mode);
  }
});
