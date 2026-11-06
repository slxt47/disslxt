import { expect, test } from '@playwright/test';
import { messageContent, messageItem, sendMessage, twoUsersInGuild } from '../helpers';

test('reactions, answers, formatting and "schreibt gerade" between two people', async ({
  browser,
}) => {
  const { a, b } = await twoUsersInGuild(browser, 'Chat-Features');

  // Formatting and links.
  const field = a.page.getByTestId('composer-input');
  await field.fill('**fett** und https://example.com/x.');
  await field.press('Enter');
  const formatted = messageItem(b.page, 'fett und https://example.com/x.');
  await expect(formatted.locator('strong')).toHaveText('fett');
  await expect(formatted.getByRole('link')).toHaveAttribute('href', 'https://example.com/x');

  // Typing shows up on the other side and ends with the message.
  await a.page.waitForTimeout(700); // The server passes on one notice per half second.
  await a.page.getByTestId('composer-input').pressSequentially('tippe');
  await expect(b.page.getByTestId('typing-line')).toContainText('schreibt gerade');
  await a.page.getByTestId('composer-input').press('Enter');
  await expect(messageContent(b.page, 'tippe')).toBeVisible();
  await expect(b.page.getByTestId('typing-line')).toHaveText('');

  // Reaction from B appears at A, a click on A's side joins it.
  const atB = messageItem(b.page, 'tippe');
  await atB.hover();
  await atB.getByTestId('message-react').click();
  await b.page.getByTestId('emoji-panel').getByRole('button', { name: '🎉' }).first().click();
  const atA = messageItem(a.page, 'tippe');
  await expect(atA.getByTestId('reaction-🎉')).toContainText('1');
  await atA.getByTestId('reaction-🎉').click();
  await expect(atB.getByTestId('reaction-🎉')).toContainText('2');

  // Answer with a quote.
  await atB.hover();
  await atB.getByTestId('message-reply-button').click();
  await expect(b.page.getByTestId('composer-reply')).toContainText('tippe');
  await sendMessage(b.page, 'meine Antwort');
  const answer = messageItem(a.page, 'meine Antwort');
  await expect(answer.getByTestId('message-reply')).toContainText('tippe');
  await expect(b.page.getByTestId('composer-reply')).toHaveCount(0);

  // A was answered: highlighted.
  await expect(answer).toHaveClass(/mentions-me/);
});

test('unread counter, the line above new messages, and a draft', async ({ browser }) => {
  const { a, b } = await twoUsersInGuild(browser, 'Ungelesen');

  // A creates a second channel; B stays in general and A writes there.
  await a.page.getByTestId('create-channel-button').click();
  await a.page.getByTestId('channel-name-input').fill('zweiter');
  await a.page.getByTestId('create-channel-submit').click();
  await expect(a.page.getByTestId('channel-title')).toContainText('zweiter');
  await b.page.getByTestId('channel-item-zweiter').click();
  await expect(b.page.getByTestId('channel-title')).toContainText('zweiter');
  await b.page.getByTestId('composer-input').fill('noch nicht fertig');
  await b.page.getByTestId('channel-item-general').click();
  await expect(b.page.getByTestId('channel-title')).toContainText('general');

  await sendMessage(a.page, 'eins');
  await sendMessage(a.page, 'zwei');
  await expect(b.page.getByTestId('channel-unread-zweiter')).toHaveText('2');

  await b.page.getByTestId('channel-item-zweiter').click();
  await expect(b.page.getByTestId('composer-input')).toHaveValue('noch nicht fertig');
  await expect(b.page.getByTestId('unread-divider')).toBeVisible();
  await expect(b.page.getByTestId('channel-unread-zweiter')).toHaveCount(0);

  // Counted by the server: stays read after a reload.
  await b.page.reload();
  await expect(messageContent(b.page, 'zwei')).toBeVisible();
  await expect(b.page.getByTestId('channel-unread-zweiter')).toHaveCount(0);
});

test('pinning, emoji in the composer, commands, edit with arrow up, greeting', async ({
  browser,
}) => {
  const { a, b } = await twoUsersInGuild(browser, 'Pins');

  // The second person was greeted.
  await expect(a.page.getByTestId('join-line')).toBeVisible();

  await sendMessage(b.page, 'bitte anpinnen');
  const msg = messageItem(a.page, 'bitte anpinnen');
  await msg.hover();
  await msg.getByTestId('message-pin').click();
  await expect(messageItem(b.page, 'bitte anpinnen').getByTestId('message-pinned')).toBeVisible();
  // Only the owner of a server pins.
  await messageItem(b.page, 'bitte anpinnen').hover();
  await expect(b.page.getByTestId('message-pin')).toHaveCount(0);
  await b.page.getByTestId('pins-button').click();
  await expect(b.page.getByTestId('pins-panel')).toContainText('bitte anpinnen');
  await b.page.getByRole('button', { name: 'Fertig' }).click();

  const input = a.page.getByTestId('composer-input');
  await input.pressSequentially('hallo :thumbsup: ');
  await expect(input).toHaveValue('hallo 👍 ');
  await input.fill('');
  await input.pressSequentially('/wü');
  await expect(a.page.getByTestId('suggestion-würfeln')).toBeVisible();
  await input.press('Tab');
  await input.press('Enter');
  await expect(a.page.getByTestId('message-list')).toContainText('gewürfelt');

  await sendMessage(a.page, 'mit Tippfehlr');
  await input.press('ArrowUp');
  const edit = a.page.getByTestId('message-edit-input');
  await edit.fill('ohne Tippfehler');
  await edit.press('Enter');
  await expect(messageContent(b.page, 'ohne Tippfehler')).toBeVisible();
});

test('invite link with a limit stops working', async ({ browser }) => {
  const { a } = await twoUsersInGuild(browser, 'Einladung');
  await a.page.getByTestId('guild-menu-button').click();
  await a.page.getByTestId('guild-settings-button').click();
  await a.page.getByTestId('invite-uses').selectOption('1');
  await a.page.getByTestId('invite-save').click();
  await expect(a.page.getByTestId('invite-status')).toContainText('0 von 1 genutzt');
  await a.page.getByTestId('invite-regenerate').click();
  await expect(a.page.getByText('Neuer Link erstellt')).toBeVisible();
});

test('display settings and the keyboard', async ({ browser }) => {
  const { a } = await twoUsersInGuild(browser, 'Anzeige');
  await a.page.getByTestId('create-channel-button').click();
  await a.page.getByTestId('channel-name-input').fill('nebenan');
  await a.page.getByTestId('create-channel-submit').click();
  await expect(a.page.getByTestId('channel-title')).toContainText('nebenan');
  await a.page.keyboard.press('Alt+ArrowUp');
  await expect(a.page.getByTestId('channel-title')).toContainText('general');
  await a.page.keyboard.press('Alt+ArrowDown');
  await expect(a.page.getByTestId('channel-title')).toContainText('nebenan');

  await a.page.evaluate(() => {
    const raw = localStorage.getItem('disslxt:prefs') ?? '{}';
    localStorage.setItem(
      'disslxt:prefs',
      JSON.stringify({ ...JSON.parse(raw), compact: true, fontSize: 18 }),
    );
  });
  await a.page.reload();
  await expect(a.page.locator('html')).toHaveAttribute('data-density', 'compact');
  const size = await a.page.evaluate(() =>
    document.documentElement.style.getPropertyValue('--chat-font-size'),
  );
  expect(size).toBe('18px');
});

test('a thread: replies beside the channel, live on the other side', async ({ browser }) => {
  const { a, b } = await twoUsersInGuild(browser, 'Threads');
  await sendMessage(a.page, 'Wer kommt mit?');
  const atB = messageItem(b.page, 'Wer kommt mit?');
  await atB.hover();
  await atB.getByTestId('message-thread').click();
  const panel = b.page.getByTestId('thread-panel');
  await panel.getByTestId('composer-input').fill('Ich!');
  await panel.getByTestId('composer-input').press('Enter');
  await expect(panel.getByTestId('thread-replies')).toContainText('Ich!');

  const atA = messageItem(a.page, 'Wer kommt mit?');
  await expect(atA.getByTestId('thread-link')).toHaveText('1 Antwort');
  await expect(a.page.getByTestId('message-list')).not.toContainText('Ich!');
  await atA.getByTestId('thread-link').click();
  const other = a.page.getByTestId('thread-panel');
  await expect(other.getByTestId('thread-replies')).toContainText('Ich!');
  await panel.getByTestId('composer-input').fill('Ich auch');
  await panel.getByTestId('composer-input').press('Enter');
  await expect(other.getByTestId('thread-replies')).toContainText('Ich auch');
  await expect(other.getByTestId('thread-count')).toHaveText('2 Antworten');
});
