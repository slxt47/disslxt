import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { guildMembers } from '../src/db/schema.js';
import {
  buildTestApp,
  closeDb,
  createGuild,
  getDb,
  joinGuild,
  registerUser,
  req,
  resetDb,
  type TestUser,
} from './helpers.js';

let app: FastifyInstance;
let alice: TestUser;
let bob: TestUser;

beforeEach(async () => {
  await resetDb();
  app = await buildTestApp();
  alice = await registerUser(app, { username: 'alice' });
  bob = await registerUser(app, { username: 'bob' });
});
afterEach(async () => {
  await app.close();
});
afterAll(closeDb);

describe('POST /api/guilds', () => {
  it('create → owner is a member, #general exists', async () => {
    const res = await req(app, 'POST', '/api/guilds', {
      cookie: alice.cookie,
      payload: { name: '  My Server  ' },
    });
    expect(res.statusCode).toBe(201);
    const { guild, channels } = res.json();
    expect(guild).toMatchObject({ name: 'My Server', ownerId: alice.user.id });
    expect(guild.inviteCode).toMatch(/^[A-Za-z0-9]{10}$/);
    expect(new Date(guild.createdAt).toString()).not.toBe('Invalid Date');
    expect(channels).toHaveLength(1);
    expect(channels[0]).toMatchObject({ name: 'general', guildId: guild.id });

    const members = await getDb()
      .db.select()
      .from(guildMembers)
      .where(and(eq(guildMembers.guildId, guild.id), eq(guildMembers.userId, alice.user.id)));
    expect(members).toHaveLength(1);

    const list = await req(app, 'GET', `/api/guilds/${guild.id}/channels`, {
      cookie: alice.cookie,
    });
    expect(list.json().channels.map((c: { name: string }) => c.name)).toEqual(['general']);
  });

  it.each([
    ['NUL', 'a\u0000b'],
    ['newline', 'a\nb'],
    ['DEL', 'a\u007fb'],
  ])('D3: guild name with %s → 400 VALIDATION_ERROR', async (_label, name) => {
    const res = await req(app, 'POST', '/api/guilds', { cookie: alice.cookie, payload: { name } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('generates distinct invite codes', async () => {
    const a = await createGuild(app, alice, 'A');
    const b = await createGuild(app, alice, 'B');
    expect(a.guild.inviteCode).not.toBe(b.guild.inviteCode);
  });

  it.each([{ name: '' }, { name: '   ' }, { name: 'x'.repeat(101) }, {}, { name: 5 }])(
    'rejects invalid payload %j with 400',
    async (payload) => {
      const res = await req(app, 'POST', '/api/guilds', { cookie: alice.cookie, payload });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    },
  );
});

describe('GET /api/guilds', () => {
  it('lists only the user’s own guilds', async () => {
    const a = await createGuild(app, alice, 'Alice Server');
    const b = await createGuild(app, bob, 'Bob Server');
    const aliceList = await req(app, 'GET', '/api/guilds', { cookie: alice.cookie });
    expect(aliceList.statusCode).toBe(200);
    expect(aliceList.json().guilds.map((g: { id: string }) => g.id)).toEqual([a.guild.id]);

    await joinGuild(app, alice, b.guild.inviteCode);
    const after = await req(app, 'GET', '/api/guilds', { cookie: alice.cookie });
    expect(after.json().guilds.map((g: { id: string }) => g.id)).toEqual([a.guild.id, b.guild.id]);
  });

  it('returns an empty list for a new user', async () => {
    const res = await req(app, 'GET', '/api/guilds', { cookie: bob.cookie });
    expect(res.json()).toEqual({ guilds: [] });
  });
});

describe('GET /api/guilds/:guildId', () => {
  it('returns the guild for members', async () => {
    const { guild } = await createGuild(app, alice);
    const res = await req(app, 'GET', `/api/guilds/${guild.id}`, { cookie: alice.cookie });
    expect(res.statusCode).toBe(200);
    expect(res.json().guild).toMatchObject({ id: guild.id, name: guild.name });
  });

  it('403 for non-members, 404 for unknown and non-uuid ids', async () => {
    const { guild } = await createGuild(app, alice);
    expect(
      (await req(app, 'GET', `/api/guilds/${guild.id}`, { cookie: bob.cookie })).statusCode,
    ).toBe(403);
    const unknown = await req(app, 'GET', `/api/guilds/${crypto.randomUUID()}`, {
      cookie: alice.cookie,
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe('NOT_FOUND');
    expect(
      (await req(app, 'GET', '/api/guilds/not-a-uuid', { cookie: alice.cookie })).statusCode,
    ).toBe(404);
  });
});

describe('invites', () => {
  it('I1 preview shows name, member count and membership', async () => {
    const { guild } = await createGuild(app, alice, 'Preview Server');
    const res = await req(app, 'GET', `/api/invites/${guild.inviteCode}`, { cookie: bob.cookie });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      guild: { id: guild.id, name: 'Preview Server', memberCount: 1 },
      alreadyMember: false,
    });
    const own = await req(app, 'GET', `/api/invites/${guild.inviteCode}`, {
      cookie: alice.cookie,
    });
    expect(own.json().alreadyMember).toBe(true);
  });

  it('I2 join makes the user a member; joining again is idempotent', async () => {
    const { guild } = await createGuild(app, alice);
    const first = await req(app, 'POST', `/api/invites/${guild.inviteCode}/join`, {
      cookie: bob.cookie,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().guild).toMatchObject({ id: guild.id, name: guild.name });

    const second = await req(app, 'POST', `/api/invites/${guild.inviteCode}/join`, {
      cookie: bob.cookie,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().guild.id).toBe(guild.id);

    const preview = await req(app, 'GET', `/api/invites/${guild.inviteCode}`, {
      cookie: bob.cookie,
    });
    expect(preview.json()).toMatchObject({ guild: { memberCount: 2 }, alreadyMember: true });
    expect(
      (await req(app, 'GET', `/api/guilds/${guild.id}`, { cookie: bob.cookie })).statusCode,
    ).toBe(200);
  });

  it('bad code → 404 INVITE_NOT_FOUND', async () => {
    for (const code of ['DoesNotExist', 'bad%20code']) {
      const preview = await req(app, 'GET', `/api/invites/${code}`, { cookie: bob.cookie });
      expect(preview.statusCode).toBe(404);
      expect(preview.json().error.code).toBe('INVITE_NOT_FOUND');
      const join = await req(app, 'POST', `/api/invites/${code}/join`, { cookie: bob.cookie });
      expect(join.statusCode).toBe(404);
      expect(join.json().error.code).toBe('INVITE_NOT_FOUND');
    }
  });

  it('requires auth', async () => {
    const { guild } = await createGuild(app, alice);
    expect((await req(app, 'GET', `/api/invites/${guild.inviteCode}`)).statusCode).toBe(401);
    expect((await req(app, 'POST', `/api/invites/${guild.inviteCode}/join`)).statusCode).toBe(401);
  });
});

describe('POST /api/guilds/:guildId/leave', () => {
  it('leave → 204, afterwards 403 on channels', async () => {
    const { guild } = await createGuild(app, alice);
    await joinGuild(app, bob, guild.inviteCode);
    const res = await req(app, 'POST', `/api/guilds/${guild.id}/leave`, { cookie: bob.cookie });
    expect(res.statusCode).toBe(204);
    const channels = await req(app, 'GET', `/api/guilds/${guild.id}/channels`, {
      cookie: bob.cookie,
    });
    expect(channels.statusCode).toBe(403);
    const list = await req(app, 'GET', '/api/guilds', { cookie: bob.cookie });
    expect(list.json().guilds).toEqual([]);
  });

  it('owner gets 409 OWNER_CANNOT_LEAVE', async () => {
    const { guild } = await createGuild(app, alice);
    const res = await req(app, 'POST', `/api/guilds/${guild.id}/leave`, { cookie: alice.cookie });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('OWNER_CANNOT_LEAVE');
  });

  it('non-member gets 403, unknown guild 404', async () => {
    const { guild } = await createGuild(app, alice);
    expect(
      (await req(app, 'POST', `/api/guilds/${guild.id}/leave`, { cookie: bob.cookie })).statusCode,
    ).toBe(403);
    expect(
      (
        await req(app, 'POST', `/api/guilds/${crypto.randomUUID()}/leave`, {
          cookie: bob.cookie,
        })
      ).statusCode,
    ).toBe(404);
  });

  it('a user can re-join after leaving', async () => {
    const { guild } = await createGuild(app, alice);
    await joinGuild(app, bob, guild.inviteCode);
    await req(app, 'POST', `/api/guilds/${guild.id}/leave`, { cookie: bob.cookie });
    await joinGuild(app, bob, guild.inviteCode);
    expect(
      (await req(app, 'GET', `/api/guilds/${guild.id}`, { cookie: bob.cookie })).statusCode,
    ).toBe(200);
  });
});

describe('GET /api/guilds/:guildId/members', () => {
  it('lists members sorted by username with an online flag', async () => {
    const { guild } = await createGuild(app, alice);
    await joinGuild(app, bob, guild.inviteCode);
    const res = await req(app, 'GET', `/api/guilds/${guild.id}/members`, { cookie: bob.cookie });
    expect(res.statusCode).toBe(200);
    expect(res.json().members).toEqual([
      { userId: alice.user.id, username: 'alice', online: false },
      { userId: bob.user.id, username: 'bob', online: false },
    ]);
  });
});
