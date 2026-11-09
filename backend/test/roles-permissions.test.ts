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
  type TestSocket,
  type TestUser,
} from './helpers.js';

let app: FastifyInstance;
let owner: TestUser;
let mod: TestUser;
let member: TestUser;
let outsider: TestUser;
let guildId: string;
let general: string;
let inviteCode: string;
const sockets: TestSocket[] = [];

const api = (
  u: TestUser,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  payload?: object,
) => req(app, method, `/api${path}`, { cookie: u.cookie, ...(payload ? { payload } : {}) });
const newRole = async (name: string, permissions: string[] = [], u = owner) => {
  const res = await api(u, 'POST', `/guilds/${guildId}/roles`, { name, color: null, permissions });
  expect(res.statusCode).toBe(201);
  return res.json().role as { id: string; position: number };
};
const give = (u: TestUser, ...roleIds: string[]) =>
  api(owner, 'PUT', `/guilds/${guildId}/members/${u.user.id}/roles`, { roleIds });
const newChannel = async (u: TestUser, name: string, kind = 'text') =>
  (await api(u, 'POST', `/guilds/${guildId}/channels`, { name, kind })).json().channel as {
    id: string;
  };
const lock = (channelId: string, roleIds: string[], u = owner) =>
  api(u, 'PUT', `/channels/${channelId}/access`, { restricted: true, roleIds });
const channelNames = async (u: TestUser) =>
  (await api(u, 'GET', `/guilds/${guildId}/channels`))
    .json()
    .channels.map((c: { name: string }) => c.name);
const say = async (u: TestUser, cid: string, content: string) =>
  (await sendMessage(app, u, cid, content)).json().message as { id: string };

beforeEach(async () => {
  await resetDb();
  app = await buildTestApp();
  owner = await registerUser(app, { username: 'owner' });
  mod = await registerUser(app, { username: 'moder' });
  member = await registerUser(app, { username: 'member' });
  outsider = await registerUser(app, { username: 'outsider' });
  const { guild, general: g } = await createGuild(app, owner);
  guildId = guild.id;
  general = g.id;
  inviteCode = guild.inviteCode;
  await joinGuild(app, mod, inviteCode);
  await joinGuild(app, member, inviteCode);
});
afterEach(async () => {
  for (const s of sockets.splice(0)) s.ws.terminate();
  await app.close();
});
afterAll(closeDb);

describe('managing roles', () => {
  it('only the owner creates, changes, deletes and hands out roles', async () => {
    const role = await newRole('Mod', ['kick_members']);
    const denied: [string, 'POST' | 'PATCH' | 'DELETE' | 'PUT', object?][] = [
      [`/guilds/${guildId}/roles`, 'POST', { name: 'X', color: null, permissions: [] }],
      [`/guilds/${guildId}/roles/${role.id}`, 'PATCH', { name: 'Y' }],
      [`/guilds/${guildId}/roles/${role.id}`, 'DELETE'],
      [`/guilds/${guildId}/members/${mod.user.id}/roles`, 'PUT', { roleIds: [role.id] }],
      [`/guilds/${guildId}/roles/order`, 'PUT', { roleIds: [role.id] }],
    ];
    await give(mod, role.id);
    for (const [path, method, body] of denied) {
      expect((await api(mod, method, path, body)).statusCode, path).toBe(403);
    }
  });

  it('even a role with every permission cannot hand out roles', async () => {
    const all = await newRole('Alles', [
      'manage_channels',
      'manage_messages',
      'manage_invites',
      'kick_members',
      'ban_members',
    ]);
    await give(mod, all.id);
    expect((await give(mod, all.id)).statusCode).toBe(204); // the owner's call
    const res = await api(mod, 'PUT', `/guilds/${guildId}/members/${member.user.id}/roles`, {
      roleIds: [all.id],
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects unknown permissions, doubles, and roles of another server', async () => {
    const bad = await api(owner, 'POST', `/guilds/${guildId}/roles`, {
      name: 'X',
      color: null,
      permissions: ['manage_roles'],
    });
    expect(bad.statusCode).toBe(400);
    await newRole('Doppelt');
    const dup = await api(owner, 'POST', `/guilds/${guildId}/roles`, {
      name: 'Doppelt',
      color: null,
      permissions: [],
    });
    expect(dup.statusCode).toBe(409);
    const other = await createGuild(app, outsider, 'Anderer');
    const foreign = (
      await api(outsider, 'POST', `/guilds/${other.guild.id}/roles`, {
        name: 'Fremd',
        color: null,
        permissions: ['ban_members'],
      })
    ).json().role.id as string;
    expect((await give(mod, foreign)).statusCode).toBe(404);
  });

  it('reports my permissions; members list carries roles', async () => {
    const role = await newRole('Mod', ['kick_members']);
    await give(mod, role.id);
    const mine = await api(mod, 'GET', `/guilds/${guildId}/roles`);
    expect(mine.json().myPermissions).toEqual(['kick_members']);
    expect((await api(member, 'GET', `/guilds/${guildId}/roles`)).json().myPermissions).toEqual([]);
    expect((await api(owner, 'GET', `/guilds/${guildId}/roles`)).json().myPermissions).toHaveLength(
      5,
    );
    const list = (await api(owner, 'GET', `/guilds/${guildId}/members`)).json().members as {
      username: string;
      roleIds: string[];
    }[];
    expect(list.find((m) => m.username === 'moder')?.roleIds).toEqual([role.id]);
  });

  it('non-members see nothing', async () => {
    expect((await api(outsider, 'GET', `/guilds/${guildId}/roles`)).statusCode).toBe(403);
    expect((await api(outsider, 'GET', `/guilds/${guildId}/bans`)).statusCode).toBe(403);
  });
});

describe('what a role allows', () => {
  it('manage_channels creates channels, others cannot', async () => {
    const body = { name: 'neu', kind: 'text' };
    expect((await api(mod, 'POST', `/guilds/${guildId}/channels`, body)).statusCode).toBe(403);
    await give(mod, (await newRole('Kanäle', ['manage_channels'])).id);
    expect((await api(mod, 'POST', `/guilds/${guildId}/channels`, body)).statusCode).toBe(201);
  });

  it('manage_invites changes the link', async () => {
    const body = { expiresInHours: null, maxUses: 5 };
    expect((await api(mod, 'POST', `/guilds/${guildId}/invite`, body)).statusCode).toBe(403);
    await give(mod, (await newRole('Einladen', ['manage_invites'])).id);
    expect((await api(mod, 'POST', `/guilds/${guildId}/invite`, body)).statusCode).toBe(200);
  });

  it('manage_messages pins and deletes messages of people below, not of the owner', async () => {
    const theirs = await say(member, general, 'weg damit');
    const bosses = await say(owner, general, 'vom Chef');
    expect((await api(mod, 'DELETE', `/messages/${theirs.id}`)).statusCode).toBe(403);
    expect(
      (await api(mod, 'POST', `/messages/${theirs.id}/pin`, { pinned: true })).statusCode,
    ).toBe(403);
    await give(mod, (await newRole('Mod', ['manage_messages'])).id);
    expect(
      (await api(mod, 'POST', `/messages/${theirs.id}/pin`, { pinned: true })).statusCode,
    ).toBe(200);
    expect((await api(mod, 'DELETE', `/messages/${bosses.id}`)).statusCode).toBe(403);
    expect((await api(mod, 'DELETE', `/messages/${theirs.id}`)).statusCode).toBe(204);
  });

  it('without the permission only your own messages can be deleted', async () => {
    const m = await say(mod, general, 'x');
    expect((await api(member, 'DELETE', `/messages/${m.id}`)).json().error.code).toBe('NOT_AUTHOR');
  });
});

describe('rank', () => {
  it('nobody moderates the owner, equals or anyone above', async () => {
    const high = await newRole('Hoch', ['kick_members', 'ban_members']);
    const low = await newRole('Tief', ['kick_members', 'ban_members']);
    await give(mod, low.id);
    await give(member, high.id);
    const kick = (a: TestUser, b: TestUser) =>
      api(a, 'DELETE', `/guilds/${guildId}/members/${b.user.id}`);
    expect((await kick(mod, owner)).statusCode).toBe(403);
    expect((await kick(mod, member)).statusCode).toBe(403);
    await give(member, low.id);
    expect((await kick(mod, member)).statusCode).toBe(403);
    await api(owner, 'PUT', `/guilds/${guildId}/roles/order`, { roleIds: [low.id, high.id] });
    await give(member, high.id);
    expect((await kick(mod, member)).statusCode).toBe(204);
  });

  it('the order must name all roles', async () => {
    const a = await newRole('A');
    await newRole('B');
    const res = await api(owner, 'PUT', `/guilds/${guildId}/roles/order`, { roleIds: [a.id] });
    expect(res.statusCode).toBe(400);
  });
});

describe('kick and ban', () => {
  it('a kicked member is out, live, and can come back', async () => {
    await give(mod, (await newRole('Mod', ['kick_members'])).id);
    const host = await listen(app);
    const ws = await wsReady(host, member.cookie);
    sockets.push(ws);
    await ws.subscribe(general);
    expect(
      (await api(mod, 'DELETE', `/guilds/${guildId}/members/${member.user.id}`)).statusCode,
    ).toBe(204);
    const ev = await ws.waitFor('member.left');
    expect(ev.data).toMatchObject({ userId: member.user.id, reason: 'kicked' });
    expect((await api(member, 'GET', `/channels/${general}/messages`)).statusCode).toBe(403);
    await say(owner, general, 'danach');
    await sleep(100);
    expect(ws.ofType('message.created')).toHaveLength(0);
    expect((await api(member, 'POST', `/invites/${inviteCode}/join`, {})).statusCode).toBe(200);
  });

  it('a banned member cannot return until unbanned; roles are gone', async () => {
    const role = await newRole('Rolle');
    await give(member, role.id);
    const banned = await api(owner, 'POST', `/guilds/${guildId}/bans`, { userId: member.user.id });
    expect(banned.statusCode).toBe(204);
    const list = (await api(owner, 'GET', `/guilds/${guildId}/bans`)).json().bans;
    expect(list[0].user.username).toBe('member');
    const preview = await api(member, 'GET', `/invites/${inviteCode}`);
    expect(preview.json().error.code).toBe('BANNED');
    const join = await api(member, 'POST', `/invites/${inviteCode}/join`, {});
    expect(join.statusCode).toBe(403);
    expect(join.json().error.code).toBe('BANNED');
    await api(owner, 'DELETE', `/guilds/${guildId}/bans/${member.user.id}`);
    expect((await api(member, 'POST', `/invites/${inviteCode}/join`, {})).statusCode).toBe(200);
    const after = (await api(owner, 'GET', `/guilds/${guildId}/members`)).json().members;
    expect(after.find((m: { username: string }) => m.username === 'member').roleIds).toEqual([]);
  });

  it('needs the permission; the owner cannot be banned; you cannot remove yourself', async () => {
    expect(
      (await api(mod, 'POST', `/guilds/${guildId}/bans`, { userId: member.user.id })).statusCode,
    ).toBe(403);
    await give(mod, (await newRole('Mod', ['ban_members'])).id);
    expect(
      (await api(mod, 'POST', `/guilds/${guildId}/bans`, { userId: owner.user.id })).statusCode,
    ).toBe(403);
    expect(
      (await api(mod, 'POST', `/guilds/${guildId}/bans`, { userId: mod.user.id })).statusCode,
    ).toBe(403);
  });
});

describe('restricted channels', () => {
  it('are invisible, unreadable and unwritable without a role', async () => {
    const secret = await newChannel(owner, 'geheim');
    const role = await newRole('Team');
    await give(mod, role.id);
    await lock(secret.id, [role.id]);
    const m = await say(owner, secret.id, 'streng geheim');

    expect(await channelNames(member)).toEqual(['general']);
    expect(await channelNames(mod)).toEqual(['general', 'geheim']);
    expect(await channelNames(owner)).toEqual(['general', 'geheim']);

    for (const [method, path, body] of [
      ['GET', `/channels/${secret.id}/messages`],
      ['GET', `/channels/${secret.id}/pins`],
      ['POST', `/channels/${secret.id}/messages`, { content: 'x' }],
      ['POST', `/channels/${secret.id}/read`, { messageId: m.id }],
      ['POST', `/messages/${m.id}/reactions`, { emoji: '👍' }],
      ['GET', `/channels/${secret.id}/access`],
    ] as const) {
      expect((await api(member, method, path, body)).statusCode, path).toBe(404);
    }
    expect((await api(mod, 'GET', `/channels/${secret.id}/messages`)).statusCode).toBe(200);
  });

  it('a permission does not open a channel', async () => {
    const secret = await newChannel(owner, 'geheim');
    await lock(secret.id, []);
    const m = await say(owner, secret.id, 'x');
    await give(mod, (await newRole('Mod', ['manage_messages', 'manage_channels'])).id);
    expect((await api(mod, 'GET', `/channels/${secret.id}/messages`)).statusCode).toBe(404);
    expect((await api(mod, 'DELETE', `/messages/${m.id}`)).statusCode).toBe(404);
    expect((await api(mod, 'POST', `/messages/${m.id}/pin`, { pinned: true })).statusCode).toBe(
      404,
    );
    expect((await lock(secret.id, [], mod)).statusCode).toBe(404);
  });

  it('do not show up in unread counts or activity', async () => {
    const secret = await newChannel(owner, 'geheim');
    await lock(secret.id, []);
    const host = await listen(app);
    const ws = await wsReady(host, member.cookie);
    sockets.push(ws);
    await say(owner, secret.id, 'psst @member');
    await sleep(100);
    expect(ws.ofType('channel.activity')).toHaveLength(0);
    expect((await api(member, 'GET', '/unread')).json().unread).toEqual([]);
    expect((await api(owner, 'GET', '/unread')).json().unread).toEqual([]);
  });

  it('the socket cannot subscribe, and is thrown out when the role goes', async () => {
    const secret = await newChannel(owner, 'geheim');
    const role = await newRole('Team');
    await give(member, role.id);
    await lock(secret.id, [role.id]);
    const host = await listen(app);
    const [m, o] = await Promise.all([wsReady(host, member.cookie), wsReady(host, mod.cookie)]);
    sockets.push(m, o);
    expect((await o.subscribe(secret.id)).type).toBe('error');
    expect((await m.subscribe(secret.id)).type).toBe('subscribed');
    await give(member);
    await m.waitFor('unsubscribed', (e) => e.data.channelId === secret.id);
    await m.waitFor('guild.roles-changed');
    await say(owner, secret.id, 'nach dem Rauswurf');
    await sleep(100);
    expect(m.ofType('message.created')).toHaveLength(0);
  });

  it('new members are not greeted in a restricted channel', async () => {
    const first = general;
    await lock(first, []);
    const second = await newChannel(owner, 'offen');
    await api(outsider, 'POST', `/invites/${inviteCode}/join`, {});
    const open = (await api(owner, 'GET', `/channels/${second.id}/messages`)).json().messages;
    expect(open.map((x: { kind: string }) => x.kind)).toEqual(['join']);
    const hidden = (await api(owner, 'GET', `/channels/${first}/messages`)).json().messages;
    expect(hidden).toEqual([]);
  });

  it('voice: hidden from others, and who is in it stays hidden', async () => {
    const voice = await newChannel(owner, 'stimme', 'voice');
    const role = await newRole('Team');
    await give(mod, role.id);
    await lock(voice.id, [role.id]);
    const host = await listen(app);
    const [a, b] = await Promise.all([wsReady(host, mod.cookie), wsReady(host, member.cookie)]);
    sockets.push(a, b);
    b.send({ type: 'voice.join', data: { channelId: voice.id } });
    await b.waitFor('error', (e) => e.data.code === 'NOT_FOUND');
    a.send({ type: 'voice.join', data: { channelId: voice.id } });
    await a.waitFor('voice.joined');
    await sleep(100);
    expect(b.ofType('voice.state')).toHaveLength(0);
    const seen = (await api(member, 'GET', `/guilds/${guildId}/voice`)).json().channels;
    expect(seen).toEqual({});
    const own = (await api(mod, 'GET', `/guilds/${guildId}/voice`)).json().channels;
    expect(Object.keys(own)).toEqual([voice.id]);
    // Role gone: out of the call.
    await give(mod);
    await a.waitFor('voice.left');
  });

  it('opening it up again shows it to everyone', async () => {
    const c = await newChannel(owner, 'wieder');
    await lock(c.id, []);
    expect(await channelNames(member)).toEqual(['general']);
    await api(owner, 'PUT', `/channels/${c.id}/access`, { restricted: false, roleIds: [] });
    expect(await channelNames(member)).toEqual(['general', 'wieder']);
  });

  it('deleting a role takes its access with it', async () => {
    const c = await newChannel(owner, 'team');
    const role = await newRole('Team');
    await give(mod, role.id);
    await lock(c.id, [role.id]);
    await api(owner, 'DELETE', `/guilds/${guildId}/roles/${role.id}`);
    expect(await channelNames(mod)).toEqual(['general']);
  });

  it('leaving and rejoining does not keep old roles', async () => {
    const c = await newChannel(owner, 'team');
    const role = await newRole('Team');
    await give(mod, role.id);
    await lock(c.id, [role.id]);
    await api(mod, 'POST', `/guilds/${guildId}/leave`);
    await api(mod, 'POST', `/invites/${inviteCode}/join`, {});
    expect(await channelNames(mod)).toEqual(['general']);
  });
});
