import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildTestApp,
  closeDb,
  createGuild,
  joinGuild,
  listen,
  registerUser,
  req,
  resetDb,
  sendMessage,
  sleep,
  wsReady,
  type TestUser,
} from './helpers.js';

let app: FastifyInstance;
let owner: TestUser;
let member: TestUser;
let outsider: TestUser;
let guildId: string;
let inviteCode: string;
let channelId: string;
let messageId: string;

beforeEach(async () => {
  await resetDb();
  app = await buildTestApp();
  owner = await registerUser(app, { username: 'owner' });
  member = await registerUser(app, { username: 'member' });
  outsider = await registerUser(app, { username: 'outsider' });
  const g = await createGuild(app, owner);
  guildId = g.guild.id;
  inviteCode = g.guild.inviteCode;
  channelId = g.general.id;
  await joinGuild(app, member, inviteCode);
  messageId = (await sendMessage(app, member, channelId, 'hello')).json().message.id;
});
afterEach(async () => {
  await app.close();
});
afterAll(closeDb);

type Call = [method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: () => string, payload?: unknown];

describe('non-members get 403 on every guild, channel and message endpoint', () => {
  const calls: Array<[string, Call]> = [
    ['G3 get guild', ['GET', () => `/api/guilds/${guildId}`]],
    ['G4 leave', ['POST', () => `/api/guilds/${guildId}/leave`]],
    ['G5 members', ['GET', () => `/api/guilds/${guildId}/members`]],
    ['C1 list channels', ['GET', () => `/api/guilds/${guildId}/channels`]],
    ['C2 create channel', ['POST', () => `/api/guilds/${guildId}/channels`, { name: 'x' }]],
    ['M1 list messages', ['GET', () => `/api/channels/${channelId}/messages`]],
    ['M2 send message', ['POST', () => `/api/channels/${channelId}/messages`, { content: 'x' }]],
    ['M3 edit message', ['PATCH', () => `/api/messages/${messageId}`, { content: 'x' }]],
    ['M4 delete message', ['DELETE', () => `/api/messages/${messageId}`]],
  ];

  it.each(calls)('%s → 403', async (_name, [method, url, payload]) => {
    const res = await req(app, method, url(), { cookie: outsider.cookie, payload });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it('a former member loses access after leaving', async () => {
    await req(app, 'POST', `/api/guilds/${guildId}/leave`, { cookie: member.cookie });
    for (const [method, url, payload] of calls.map(([, c]) => c)) {
      const res = await req(app, method, url(), { cookie: member.cookie, payload });
      expect(res.statusCode, `${method} ${url()}`).toBe(403);
    }
  });
});

describe('message author checks', () => {
  it('M3/M4 by a non-author member (even the guild owner) → 403 NOT_AUTHOR', async () => {
    for (const [method, payload] of [
      ['PATCH', { content: 'x' }],
      ['DELETE', undefined],
    ] as const) {
      const res = await req(app, method, `/api/messages/${messageId}`, {
        cookie: owner.cookie,
        payload,
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('NOT_AUTHOR');
    }
  });
});

describe('unauthenticated requests get 401 on every protected route', () => {
  const routes: Call[] = [
    ['POST', () => '/api/auth/logout'],
    ['GET', () => '/api/auth/me'],
    ['GET', () => '/api/guilds'],
    ['POST', () => '/api/guilds', { name: 'x' }],
    ['GET', () => `/api/guilds/${guildId}`],
    ['POST', () => `/api/guilds/${guildId}/leave`],
    ['GET', () => `/api/guilds/${guildId}/members`],
    ['GET', () => `/api/invites/${inviteCode}`],
    ['POST', () => `/api/invites/${inviteCode}/join`],
    ['GET', () => `/api/guilds/${guildId}/channels`],
    ['POST', () => `/api/guilds/${guildId}/channels`, { name: 'x' }],
    ['GET', () => `/api/channels/${channelId}/messages`],
    ['POST', () => `/api/channels/${channelId}/messages`, { content: 'x' }],
    ['PATCH', () => `/api/messages/${messageId}`, { content: 'x' }],
    ['DELETE', () => `/api/messages/${messageId}`],
  ];

  it.each(routes.map((r) => [`${r[0]} ${r[1].toString()}`, r] as const))(
    '%s',
    async (_n, [method, url, payload]) => {
      for (const cookie of [undefined, 'sid=invalid-token']) {
        const res = await req(app, method, url(), { cookie, payload });
        expect(res.statusCode).toBe(401);
        expect(res.json().error.code).toBe('UNAUTHORIZED');
      }
    },
  );

  it('auth is checked before validation and existence', async () => {
    const res = await req(app, 'GET', '/api/guilds/not-a-uuid');
    expect(res.statusCode).toBe(401);
  });
});

describe('WS subscribe of a non-member', () => {
  it('gets error FORBIDDEN and receives no events', async () => {
    const host = await listen(app);
    const ws = await wsReady(host, outsider.cookie);
    const reply = await ws.subscribe(channelId);
    expect(reply).toEqual({ type: 'error', data: { code: 'FORBIDDEN', channelId } });

    await sendMessage(app, member, channelId, 'secret');
    await sleep(150);
    expect(ws.ofType('message.created')).toHaveLength(0);
    await ws.close();
  });

  it('gets NOT_FOUND for unknown channels', async () => {
    const host = await listen(app);
    const ws = await wsReady(host, outsider.cookie);
    const unknown = crypto.randomUUID();
    expect(await ws.subscribe(unknown)).toEqual({
      type: 'error',
      data: { code: 'NOT_FOUND', channelId: unknown },
    });
    await ws.close();
  });
});
