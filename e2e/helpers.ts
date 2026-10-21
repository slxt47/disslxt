import {
  expect,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';

export interface TestUser {
  email: string;
  username: string;
  password: string;
}

let counter = 0;

/** Unique, schema-valid credentials (username: 3–32 chars of [A-Za-z0-9_]). */
export function uniqueUser(prefix: string): TestUser {
  counter += 1;
  const suffix = `${Date.now().toString(36)}${counter}${Math.floor(Math.random() * 1e4)}`;
  const username = `${prefix}_${suffix}`.slice(0, 32);
  return { email: `${username.toLowerCase()}@example.test`, username, password: 'Tr0cken-Blume-7' };
}

export const uniqueEmail = (prefix = 'user') => uniqueUser(prefix).email;

/** Fills the registration form on the current page (must already be /register). */
export async function fillRegisterForm(page: Page, user: TestUser): Promise<void> {
  await page.getByTestId('email').fill(user.email);
  await page.getByTestId('username').fill(user.username);
  await page.getByTestId('password').fill(user.password);
  await page.getByTestId('register-submit').click();
}

interface CapturedMail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Path of the newest confirmation link sent to `email`, read from the backend's dev mailbox
 * (MAIL_TRANSPORT=log; the endpoint does not exist in production).
 */
export async function verificationLinkPath(page: Page, email: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(async () => {
      const res = await page.request.get('/api/dev/mails');
      expect(res.ok(), 'dev mailbox missing: backend must run with MAIL_TRANSPORT=log').toBe(true);
      const { mails } = (await res.json()) as { mails: CapturedMail[] };
      const mail = mails
        .filter((m) => m.to === email.toLowerCase() && m.subject.startsWith('Bestätige'))
        .at(-1);
      link = mail?.text.match(/https?:\/\/\S+\/verify-email#token=[\w-]{43}/)?.[0];
      return link;
    })
    .toBeTruthy();
  const url = new URL(link!);
  return `${url.pathname}${url.hash}`;
}

/** Opens the confirmation link from the mail and activates the account (logs in). */
export async function confirmViaMail(page: Page, email: string): Promise<void> {
  await page.goto(await verificationLinkPath(page, email));
  await page.getByTestId('verify-submit').click();
  await expect(page).not.toHaveURL(/\/verify-email/);
}

/** Full sign-up: form → "check your inbox" → link from the mail → logged in. */
export async function registerViaUi(page: Page, user: TestUser): Promise<void> {
  await page.goto('/register');
  await fillRegisterForm(page, user);
  await expect(page.getByTestId('check-inbox')).toBeVisible();
  await confirmViaMail(page, user.email);
}

export async function loginViaUi(page: Page, user: TestUser): Promise<void> {
  await page.goto('/login');
  await page.getByTestId('email').fill(user.email);
  await page.getByTestId('password').fill(user.password);
  await page.getByTestId('login-submit').click();
  await expect(page).not.toHaveURL(/\/login/);
}

export interface GuildRef {
  guildId: string;
  channelId: string;
}

export function parseChannelUrl(url: string): GuildRef {
  const m = /\/guilds\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)/.exec(url);
  if (!m?.[1] || !m[2]) throw new Error(`Not a channel URL: ${url}`);
  return { guildId: m[1], channelId: m[2] };
}

/** Creates a guild through the UI and waits until its #general channel is open. */
export async function createGuildViaUi(page: Page, name: string): Promise<GuildRef> {
  const empty = page.getByTestId('empty-create-guild');
  if (await empty.isVisible()) await empty.click();
  else await page.getByTestId('create-guild-button').click();
  await page.getByTestId('guild-name-input').fill(name);
  await page.getByTestId('create-guild-submit').click();
  await expect(page.getByTestId('channel-title')).toHaveText(/general/);
  await expect(page).toHaveURL(/\/guilds\/[^/]+\/channels\/[^/]+$/);
  return parseChannelUrl(page.url());
}

export async function inviteUrl(page: Page): Promise<string> {
  const text = (await page.getByTestId('invite-link').textContent())?.trim() ?? '';
  expect(text).toMatch(/\/invite\/[A-Za-z0-9]+$/);
  return text;
}

/** Path part of an invite URL, so it works with any baseURL. */
export function invitePath(url: string): string {
  return new URL(url).pathname;
}

/** Waits until the server has confirmed the WS subscription for the open channel. */
export async function waitSubscribed(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="message-list"][data-subscribed="true"]')).toBeVisible();
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The `message-<id>` item whose content is exactly `text`. */
export function messageItem(page: Page, text: string): Locator {
  return page.locator('li[data-testid^="message-"]').filter({
    has: page.getByTestId('message-content').filter({
      hasText: new RegExp(`^${escapeRegExp(text)}$`),
    }),
  });
}

export function messageContent(page: Page, text: string): Locator {
  return messageItem(page, text).getByTestId('message-content');
}

export async function sendMessage(page: Page, text: string): Promise<void> {
  const input = page.getByTestId('composer-input');
  await input.fill(text);
  await input.press('Enter');
  await expect(messageContent(page, text)).toBeVisible();
}

/** Opens a fresh browser context + page (separate cookies = separate user). */
export async function newUserPage(
  browser: Browser,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  return { context, page };
}

/**
 * Sets up the success-criterion scenario: A registers and creates a guild, B registers and joins
 * through the invite link; both end up in #general with a live subscription.
 */
export async function twoUsersInGuild(
  browser: Browser,
  guildName: string,
): Promise<{
  a: { context: BrowserContext; page: Page; user: TestUser };
  b: { context: BrowserContext; page: Page; user: TestUser };
  guild: GuildRef;
  invite: string;
}> {
  const a = { ...(await newUserPage(browser)), user: uniqueUser('alice') };
  const b = { ...(await newUserPage(browser)), user: uniqueUser('bob') };

  await registerViaUi(a.page, a.user);
  const guild = await createGuildViaUi(a.page, guildName);
  const invite = await inviteUrl(a.page);

  await registerViaUi(b.page, b.user);
  await b.page.goto(invitePath(invite));
  await expect(b.page.getByTestId('invite-guild-name')).toHaveText(guildName);
  await b.page.getByTestId('invite-accept').click();
  await expect(b.page).toHaveURL(
    new RegExp(`/guilds/${guild.guildId}/channels/${guild.channelId}$`),
  );

  await waitSubscribed(a.page);
  await waitSubscribed(b.page);
  return { a, b, guild, invite };
}
