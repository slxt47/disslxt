import { expect, test } from '@playwright/test';
import { messageContent, messageItem, sendMessage, twoUsersInGuild } from '../helpers';

test('Enter sends, Shift+Enter adds a newline; own edit/delete; XSS is inert', async ({
  browser,
}) => {
  const { a, b } = await twoUsersInGuild(browser, 'Composer-Test');
  const page = a.page;
  const input = page.getByTestId('composer-input');

  // Shift+Enter then Enter → one message with two lines.
  await input.click();
  await input.pressSequentially('Zeile eins');
  await input.press('Shift+Enter');
  await input.pressSequentially('Zeile zwei');
  await expect(input).toHaveValue('Zeile eins\nZeile zwei');
  const before = await page.getByTestId('message-content').count();
  await input.press('Enter');
  await expect(page.getByTestId('message-content')).toHaveCount(before + 1);
  const multi = page.getByTestId('message-content').last();
  expect(await multi.evaluate((el) => (el as HTMLElement).innerText)).toBe(
    'Zeile eins\nZeile zwei',
  );
  await expect(input).toHaveValue('');

  // Edit own message → "(bearbeitet)".
  await sendMessage(page, 'Tippfehler');
  const own = messageItem(page, 'Tippfehler');
  await own.hover();
  await own.getByTestId('message-edit').click();
  await page.getByTestId('message-edit-input').fill('Korrigiert');
  await page.getByTestId('message-edit-input').press('Enter');
  const edited = messageItem(page, 'Korrigiert');
  await expect(edited.getByTestId('message-edited')).toHaveText('(bearbeitet)');

  // Escape cancels an edit.
  await edited.hover();
  await edited.getByTestId('message-edit').click();
  await page.getByTestId('message-edit-input').fill('verworfen');
  await page.getByTestId('message-edit-input').press('Escape');
  await expect(messageContent(page, 'Korrigiert')).toBeVisible();

  // Delete own message (inline confirm).
  await edited.hover();
  await edited.getByTestId('message-delete').click();
  await edited.getByTestId('message-delete-confirm').click();
  await expect(messageItem(page, 'Korrigiert')).toHaveCount(0);

  // Another user's message has no edit/delete controls.
  await sendMessage(b.page, 'Nachricht von B');
  const foreign = messageItem(page, 'Nachricht von B');
  await expect(foreign).toBeVisible();
  await foreign.hover();
  await expect(foreign.getByTestId('message-edit')).toHaveCount(0);
  await expect(foreign.getByTestId('message-delete')).toHaveCount(0);

  // XSS payload is rendered as literal text.
  const payload = '<b>x</b><img src=x onerror="window.__xss=1">';
  await sendMessage(page, payload);
  await expect(messageContent(b.page, payload)).toBeVisible();
  for (const p of [page, b.page]) {
    const content = messageContent(p, payload);
    await expect(content).toHaveText(payload);
    await expect(content.locator('b')).toHaveCount(0);
    await expect(content.locator('img')).toHaveCount(0);
    expect(await p.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  }

  await a.context.close();
  await b.context.close();
});
