import type { AddressInfo } from 'node:net';
import { sql } from 'drizzle-orm';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import WebSocket from 'ws';
import type { UserDto, WsServerMessage } from '@disslxt/shared';
import { buildApp, type BuildAppOptions } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';
import { createDb, type DbHandle } from '../src/db/client.js';
import { sessions, users } from '../src/db/schema.js';
import { MemoryMailer, type MailMessage } from '../src/lib/mailer.js';
import { hashPassword } from '../src/lib/password.js';
import { randomToken, sha256 } from '../src/lib/tokens.js';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://chat:chat@localhost:5432/disslxt_test';

export const ALLOWED_TEST_ORIGIN = 'http://allowed.example';

let dbHandle: DbHandle | null = null;

/** One shared pool per test file. */
export function getDb(): DbHandle {
  dbHandle ??= createDb(TEST_DATABASE_URL);
  return dbHandle;
}

export async function closeDb(): Promise<void> {
  if (dbHandle) {
    await dbHandle.close();
    dbHandle = null;
  }
}

export async function resetDb(): Promise<void> {
  await getDb().db.execute(
    sql`TRUNCATE users, sessions, guilds, guild_members, channels, messages, pending_registrations, mail_log RESTART IDENTITY CASCADE`,
  );
}

export type ConfigOverrides = Partial<Omit<Config, 'rateLimit'>> & {
  rateLimit?: Partial<Config['rateLimit']>;
};

/** Test config: generous rate limits unless overridden. */
export function testConfig(overrides: ConfigOverrides = {}): Config {
  const base = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    LOG_LEVEL: 'silent',
    ALLOWED_ORIGINS: ALLOWED_TEST_ORIGIN,
    RATE_LIMIT_LOGIN_MAX: '10000',
    RATE_LIMIT_MESSAGE_MAX: '10000',
    RATE_LIMIT_MAIL_MAX: '10000',
    MAIL_MAX_PER_ADDRESS_PER_HOUR: '10000',
    PUBLIC_URL: 'https://disslxt.test',
  });
  return {
    ...base,
    ...overrides,
    rateLimit: { ...base.rateLimit, ...overrides.rateLimit },
  };
}

export async function buildTestApp(
  overrides: ConfigOverrides = {},
  extra: Partial<Omit<BuildAppOptions, 'config' | 'db'>> = {},
): Promise<FastifyInstance> {
  const app = await buildApp({
    config: testConfig(overrides),
    db: getDb().db,
    logger: false,
    mailer: new MemoryMailer(),
    ...extra,
  });
  await app.ready();
  return app;
}

/** Shared plaintext for bulk-created test users (test-only, not a secret). */
const BULK_PW = 'bulk-pw-123';

let counter = 0;
export function uniqueSuffix(): string {
  counter += 1;
  return `${Date.now().toString(36)}${counter}`;
}

export interface TestUser {
  user: UserDto;
  cookie: string;
  token: string;
  password: string;
}

export function sidFromSetCookie(res: LightMyRequestResponse): string | undefined {
  const c = res.cookies.find((x) => x.name === 'sid');
  return c?.value;
}

/** Mails captured by the test app's MemoryMailer. */
export function sentMails(app: FastifyInstance): MailMessage[] {
  if (!(app.mailer instanceof MemoryMailer)) throw new Error('test app has no MemoryMailer');
  return app.mailer.sent;
}

/** Confirmation token from the newest verification mail to this address. */
export function verificationToken(app: FastifyInstance, email: string): string {
  const mail = sentMails(app)
    .filter((m) => m.to === email.toLowerCase() && m.subject.startsWith('Bestätige'))
    .at(-1);
  const token = mail?.text.match(/#token=([A-Za-z0-9_-]{43})/)?.[1];
  if (!token) throw new Error(`no verification mail for ${email}`);
  return token;
}

/** Registers through the real flow: sign-up → read the mail → redeem the link. */
export async function registerUser(
  app: FastifyInstance,
  data: Partial<{ email: string; username: string; password: string }> = {},
): Promise<TestUser> {
  const suffix = uniqueSuffix();
  const payload = {
    email: data.email ?? `user_${suffix}@example.com`,
    username: data.username ?? `u_${suffix}`.slice(0, 32),
    password: data.password ?? 'correct horse battery',
  };
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload });
  if (res.statusCode !== 202) throw new Error(`register failed: ${res.statusCode} ${res.body}`);
  const verify = await app.inject({
    method: 'POST',
    url: '/api/auth/verify-email',
    payload: { token: verificationToken(app, payload.email) },
  });
  if (verify.statusCode !== 200)
    throw new Error(`verify failed: ${verify.statusCode} ${verify.body}`);
  const token = sidFromSetCookie(verify);
  if (!token) throw new Error('no sid cookie');
  return { user: verify.json().user, cookie: `sid=${token}`, token, password: payload.password };
}

/** Bulk-creates users with sessions directly in the DB (one shared password hash). */
export async function bulkCreateUsers(n: number): Promise<TestUser[]> {
  const password = BULK_PW;
  const passwordHash = await hashPassword(password);
  const suffix = uniqueSuffix();
  const rows = await getDb()
    .db.insert(users)
    .values(
      Array.from({ length: n }, (_, i) => ({
        email: `bulk_${suffix}_${i}@example.com`,
        username: `b${i}_${suffix}`.slice(0, 32),
        passwordHash,
        emailVerifiedAt: new Date(),
      })),
    )
    .returning();
  const tokens = rows.map(() => randomToken());
  const expiresAt = new Date(Date.now() + 86_400_000);
  await getDb()
    .db.insert(sessions)
    .values(rows.map((r, i) => ({ userId: r.id, tokenHash: sha256(tokens[i]!), expiresAt })));
  return rows.map((r, i) => ({
    user: { id: r.id, email: r.email, username: r.username },
    cookie: `sid=${tokens[i]}`,
    token: tokens[i]!,
    password,
  }));
}

/** app.inject with an optional session cookie. */
export function req(
  app: FastifyInstance,
  method: InjectOptions['method'],
  url: string,
  opts: { cookie?: string; payload?: unknown; headers?: Record<string, string> } = {},
): Promise<LightMyRequestResponse> {
  return app.inject({
    method,
    url,
    headers: { ...(opts.cookie ? { cookie: opts.cookie } : {}), ...opts.headers },
    ...(opts.payload !== undefined ? { payload: opts.payload as InjectOptions['payload'] } : {}),
  });
}

export async function createGuild(app: FastifyInstance, owner: TestUser, name = 'Test Server') {
  const res = await req(app, 'POST', '/api/guilds', { cookie: owner.cookie, payload: { name } });
  if (res.statusCode !== 201) throw new Error(`create guild failed: ${res.body}`);
  const body = res.json();
  return {
    guild: body.guild as { id: string; inviteCode: string; ownerId: string; name: string },
    general: body.channels[0] as { id: string; name: string; guildId: string },
  };
}

export async function joinGuild(app: FastifyInstance, user: TestUser, inviteCode: string) {
  const res = await req(app, 'POST', `/api/invites/${inviteCode}/join`, { cookie: user.cookie });
  if (res.statusCode !== 200) throw new Error(`join failed: ${res.body}`);
}

export async function sendMessage(
  app: FastifyInstance,
  user: TestUser,
  channelId: string,
  content: string,
) {
  return req(app, 'POST', `/api/channels/${channelId}/messages`, {
    cookie: user.cookie,
    payload: { content },
  });
}

// ---------------------------------------------------------------------------------------------
// WebSocket helpers

export async function listen(app: FastifyInstance): Promise<string> {
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address() as AddressInfo;
  return `127.0.0.1:${addr.port}`;
}

export class TestSocket {
  readonly events: WsServerMessage[] = [];
  private waiters: Array<{
    pred: (e: WsServerMessage) => boolean;
    resolve: (e: WsServerMessage) => void;
  }> = [];
  readonly closed: Promise<{ code: number; reason: string }>;
  readonly opened: Promise<void>;

  constructor(readonly ws: WebSocket) {
    this.closed = new Promise((resolve) => {
      ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    });
    this.opened = new Promise((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    ws.on('error', () => {});
    ws.on('message', (raw) => {
      const evt = JSON.parse(raw.toString()) as WsServerMessage;
      this.events.push(evt);
      this.waiters = this.waiters.filter((w) => {
        if (w.pred(evt)) {
          w.resolve(evt);
          return false;
        }
        return true;
      });
    });
  }

  send(msg: unknown): void {
    this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  /** Resolves with the first event (already received or future) matching the predicate. */
  waitFor<T extends WsServerMessage['type']>(
    type: T,
    pred: (e: Extract<WsServerMessage, { type: T }>) => boolean = () => true,
    timeoutMs = 2000,
    { onlyNew = false }: { onlyNew?: boolean } = {},
  ): Promise<Extract<WsServerMessage, { type: T }>> {
    const match = (e: WsServerMessage): boolean =>
      e.type === type && pred(e as Extract<WsServerMessage, { type: T }>);
    if (!onlyNew) {
      const existing = this.events.find(match);
      if (existing) return Promise.resolve(existing as Extract<WsServerMessage, { type: T }>);
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        pred: match,
        resolve: (e: WsServerMessage) => {
          clearTimeout(timer);
          resolve(e as Extract<WsServerMessage, { type: T }>);
        },
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(new Error(`Timed out waiting for ${type}`));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  ofType<T extends WsServerMessage['type']>(type: T): Extract<WsServerMessage, { type: T }>[] {
    return this.events.filter((e) => e.type === type) as Extract<WsServerMessage, { type: T }>[];
  }

  async subscribe(channelId: string): Promise<WsServerMessage> {
    this.send({ type: 'subscribe', data: { channelId } });
    return Promise.race([
      this.waitFor('subscribed', (e) => e.data.channelId === channelId, 2000, { onlyNew: true }),
      this.waitFor('error', (e) => e.data.channelId === channelId, 2000, { onlyNew: true }),
    ]);
  }

  close(): Promise<{ code: number; reason: string }> {
    this.ws.close();
    return this.closed;
  }
}

export function wsConnect(
  host: string,
  opts: { cookie?: string; origin?: string | null } = {},
): TestSocket {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = opts.cookie;
  const origin = opts.origin === undefined ? `http://${host}` : opts.origin;
  if (origin !== null) headers.origin = origin;
  return new TestSocket(new WebSocket(`ws://${host}/ws`, { headers }));
}

/** Connects and waits for the `ready` event. */
export async function wsReady(host: string, cookie: string): Promise<TestSocket> {
  const s = wsConnect(host, { cookie });
  await s.waitFor('ready');
  return s;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
