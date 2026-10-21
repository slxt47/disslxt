import { expect, test } from '@playwright/test';
import { messageContent, messageItem, sendMessage, twoUsersInGuild } from '../helpers';

/** Replaces the browser's speech APIs: recognition "hears" a fixed sentence, synthesis records. */
const speechStubs = () => {
  const w = window as unknown as { __spoken: string[] };
  w.__spoken = [];
  class FakeRecognition {
    lang = '';
    continuous = false;
    interimResults = false;
    onresult: ((ev: unknown) => void) | null = null;
    onerror: ((ev: unknown) => void) | null = null;
    onend: (() => void) | null = null;
    start() {
      setTimeout(() => {
        const result = Object.assign([{ transcript: 'Bin in fünf Minuten da' }], {
          isFinal: true,
        });
        this.onresult?.({ resultIndex: 0, results: [result] });
        this.onend?.();
      }, 50);
    }
    stop() {
      this.onend?.();
    }
    abort() {}
  }
  Object.assign(window, {
    SpeechRecognition: FakeRecognition,
    webkitSpeechRecognition: FakeRecognition,
  });
  window.speechSynthesis.speak = (u: SpeechSynthesisUtterance) => {
    w.__spoken.push(u.text);
  };
};

test('dictate a message, read one aloud, and auto-read incoming messages', async ({ browser }) => {
  const { a, b } = await twoUsersInGuild(browser, 'Sprache');
  for (const p of [a.page, b.page]) {
    await p.addInitScript(speechStubs);
    await p.reload();
    await expect(p.locator('[data-testid="message-list"][data-subscribed="true"]')).toBeVisible();
  }
  const spoken = () =>
    b.page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);

  // A dictates; the text lands in the field and is only sent on Enter.
  await a.page.getByTestId('dictate-button').click();
  await expect(a.page.getByTestId('composer-input')).toHaveValue('Bin in fünf Minuten da');
  await a.page.getByTestId('composer-input').press('Enter');
  await expect(messageContent(b.page, 'Bin in fünf Minuten da')).toBeVisible();

  // B reads it aloud by hand.
  const item = messageItem(b.page, 'Bin in fünf Minuten da');
  await item.hover();
  await item.getByTestId('message-speak').click();
  expect(await spoken()).toEqual([`${a.user.username}: Bin in fünf Minuten da`]);

  // B switches auto-read on; the next message from A is read without a click.
  await b.page.getByTestId('settings-button').click();
  await b.page.getByTestId('auto-read-toggle').check();
  await b.page.keyboard.press('Escape');
  await sendMessage(a.page, 'Super, bis gleich');
  await expect.poll(spoken).toContain(`${a.user.username}: Super, bis gleich`);
  await a.context.close();
  await b.context.close();
});
