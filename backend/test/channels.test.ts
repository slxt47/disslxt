import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildTestApp,
  closeDb,
  createGuild,
  joinGuild,
  registerUser,
  req,
  resetDb,
  type TestUser,
} from './helpers.js';

let app: FastifyInstance;
let owner: TestUser;
let member: TestUser;
let outsider: TestUser;
let guildId: string;

beforeEach(async () => {
  await resetDb();
  app = await buildTestApp();
  owner = await registerUser(app, { username: 'owner' });
  member = await registerUser(app, { username: 'member' });
  outsider = await registerUser(app, { username: 'outsider' });
  const { guild } = await createGuild(app, owner);
  guildId = guild.id;
  await joinGuild(app, member, guild.inviteCode);
});
afterEach(async () => {
  await app.close();
});
afterAll(closeDb);

const create = (u: TestUser, name: unknown, gid = guildId) =>
  req(app, 'POST', `/api/guilds/${gid}/channels`, { cookie: u.cookie, payload: { name } });

describe('POST /api/guilds/:guildId/channels', () => {
  it('owner → 201 with a normalised name', async () => {
    const res = await create(owner, '  Off Topic  ');
    expect(res.statusCode).toBe(201);
    expect(res.json().channel).toMatchObject({ name: 'off-topic', guildId });
    expect(res.json().channel.id).toEqual(expect.any(String));
  });

  it('D3: NUL / control char in the channel name → 400 VALIDATION_ERROR', async () => {
    for (const name of ['de\u0000v', 'de\u001bv']) {
      const res = await create(owner, name);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('non-owner member → 403', async () => {
    const res = await create(member, 'random');
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it('non-member → 403', async () => {
    expect((await create(outsider, 'random')).statusCode).toBe(403);
  });

  it('duplicate → 409 CHANNEL_EXISTS (also after normalisation)', async () => {
    expect((await create(owner, 'dev')).statusCode).toBe(201);
    const dup = await create(owner, 'DEV');
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('CHANNEL_EXISTS');
    expect((await create(owner, 'general')).statusCode).toBe(409);
  });

  it('same name in a different guild is fine', async () => {
    const other = await createGuild(app, owner, 'Other');
    expect((await create(owner, 'dev')).statusCode).toBe(201);
    expect((await create(owner, 'dev', other.guild.id)).statusCode).toBe(201);
  });

  it.each(['', '   ', 'ümlaut', 'under_score', 'x'.repeat(33), 42])(
    'invalid name %j → 400',
    async (name) => {
      const res = await create(owner, name);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
      expect(res.json().error.details[0].path).toBe('name');
    },
  );

  it('unknown guild → 404', async () => {
    expect((await create(owner, 'x', crypto.randomUUID())).statusCode).toBe(404);
    expect((await create(owner, 'x', 'nope')).statusCode).toBe(404);
  });
});

describe('GET /api/guilds/:guildId/channels', () => {
  it('lists channels sorted by creation time', async () => {
    await create(owner, 'zeta');
    await create(owner, 'alpha');
    const res = await req(app, 'GET', `/api/guilds/${guildId}/channels`, { cookie: member.cookie });
    expect(res.statusCode).toBe(200);
    expect(res.json().channels.map((c: { name: string }) => c.name)).toEqual([
      'general',
      'zeta',
      'alpha',
    ]);
  });

  it('non-member → 403, unknown guild → 404', async () => {
    expect(
      (await req(app, 'GET', `/api/guilds/${guildId}/channels`, { cookie: outsider.cookie }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await req(app, 'GET', `/api/guilds/${crypto.randomUUID()}/channels`, {
          cookie: owner.cookie,
        })
      ).statusCode,
    ).toBe(404);
  });
});
