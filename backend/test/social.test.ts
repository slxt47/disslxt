import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  wsReady,
  type TestSocket,
  type TestUser,
} from './helpers.js';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(200, 1),
]);

let app: FastifyInstance;
let host: string;
let alice: TestUser;
let bob: TestUser;
let eve: TestUser;
const sockets: TestSocket[] = [];

async function open(user: TestUser): Promise<TestSocket> {
  const s = await wsReady(host, user.cookie);
  sockets.push(s);
  return s;
}

const upload = (user: TestUser, url: string, body: Buffer) =>
  app.inject({
    method: 'PUT',
    url,
    headers: { cookie: user.cookie, 'content-type': 'application/octet-stream' },
    payload: body,
  });

async function befriend(a: TestUser, b: TestUser): Promise<void> {
  const r1 = await req(app, 'POST', '/api/friends/requests', {
    cookie: a.cookie,
    payload: { username: b.user.username },
  });
  expect(r1.statusCode).toBe(201);
  const r2 = await req(app, 'POST', `/api/friends/${a.user.id}/accept`, { cookie: b.cookie });
  expect(r2.statusCode).toBe(200);
}

async function openDm(a: TestUser, b: TestUser): Promise<string> {
  const res = await req(app, 'POST', '/api/dms', {
    cookie: a.cookie,
    payload: { userId: b.user.id },
  });
  expect(res.statusCode).toBe(200);
  return res.json().dm.channel.id as string;
}

beforeEach(async () => {
  await resetDb();
  const avatars = await mkdtemp(join(tmpdir(), 'disslxt-avatars-'));
  const files = await mkdtemp(join(tmpdir(), 'disslxt-files-'));
  app = await buildTestApp({ avatars: { dir: avatars }, files: { dir: files } });
  host = await listen(app);
  alice = await registerUser(app, { username: 'alice' });
  bob = await registerUser(app, { username: 'bob' });
  eve = await registerUser(app, { username: 'eve' });
});

afterEach(async () => {
  for (const s of sockets.splice(0)) s.ws.terminate();
  await app?.close();
});
afterAll(closeDb);

describe('usernames', () => {
  it('are unique regardless of case', async () => {
    const res = await req(app, 'POST', '/api/auth/register', {
      payload: { email: 'other@example.com', username: 'ALICE', password: 'correct horse battery' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('USERNAME_TAKEN');
  });
});

describe('profile', () => {
  it('display name: set, shown to guild members, removed with an empty string', async () => {
    const { guild, general } = await createGuild(app, alice);
    await joinGuild(app, bob, guild.inviteCode);
    const b = await open(bob);
    const res = await req(app, 'PATCH', '/api/users/me', {
      cookie: alice.cookie,
      payload: { displayName: '  Ali 🌸 ' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ username: 'alice', displayName: 'Ali 🌸' });
    const ev = await b.waitFor('user.updated');
    expect(ev.data.user).toMatchObject({ id: alice.user.id, displayName: 'Ali 🌸' });

    await sendMessage(app, alice, general.id, 'hi');
    const list = await req(app, 'GET', `/api/channels/${general.id}/messages`, {
      cookie: bob.cookie,
    });
    expect(list.json().messages[0].author.displayName).toBe('Ali 🌸');
    const members = await req(app, 'GET', `/api/guilds/${guild.id}/members`, {
      cookie: bob.cookie,
    });
    expect(
      members.json().members.find((m: { userId: string }) => m.userId === alice.user.id),
    ).toMatchObject({ displayName: 'Ali 🌸' });

    const cleared = await req(app, 'PATCH', '/api/users/me', {
      cookie: alice.cookie,
      payload: { displayName: '' },
    });
    expect(cleared.json().user.displayName).toBeNull();
    const tooLong = await req(app, 'PATCH', '/api/users/me', {
      cookie: alice.cookie,
      payload: { displayName: 'x'.repeat(33) },
    });
    expect(tooLong.statusCode).toBe(400);
  });

  it('picture: only real images, readable when signed in, replaced and removed', async () => {
    expect((await upload(alice, '/api/users/me/avatar', Buffer.from('<svg/>'))).statusCode).toBe(
      415,
    );
    const res = await upload(alice, '/api/users/me/avatar', PNG);
    expect(res.statusCode).toBe(200);
    const url = res.json().user.avatarUrl as string;
    expect(url).toMatch(new RegExp(`^/api/users/${alice.user.id}/avatar\\?v=`));

    const get = await req(app, 'GET', url, { cookie: eve.cookie });
    expect(get.statusCode).toBe(200);
    expect(get.headers['content-type']).toBe('image/png');
    expect(get.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    expect((await req(app, 'GET', url)).statusCode).toBe(401);

    const again = await upload(alice, '/api/users/me/avatar', PNG);
    expect(again.json().user.avatarUrl).not.toBe(url);
    const removed = await req(app, 'DELETE', '/api/users/me/avatar', { cookie: alice.cookie });
    expect(removed.json().user.avatarUrl).toBeNull();
    expect((await req(app, 'GET', url, { cookie: eve.cookie })).statusCode).toBe(404);
  });
});

describe('server settings', () => {
  it('owner renames and sets a picture; members see it; others may not', async () => {
    const { guild } = await createGuild(app, alice, 'Alt');
    await joinGuild(app, bob, guild.inviteCode);
    const b = await open(bob);

    const forbidden = await req(app, 'PATCH', `/api/guilds/${guild.id}`, {
      cookie: bob.cookie,
      payload: { name: 'Bobs' },
    });
    expect(forbidden.statusCode).toBe(403);

    const res = await req(app, 'PATCH', `/api/guilds/${guild.id}`, {
      cookie: alice.cookie,
      payload: { name: ' Neu ' },
    });
    expect(res.json().guild.name).toBe('Neu');
    expect((await b.waitFor('guild.updated')).data.guild.name).toBe('Neu');

    expect((await upload(bob, `/api/guilds/${guild.id}/icon`, PNG)).statusCode).toBe(403);
    const icon = await upload(alice, `/api/guilds/${guild.id}/icon`, PNG);
    const url = icon.json().guild.iconUrl as string;
    expect(url).toMatch(/^\/api\/guilds\/.+\/icon\?v=/);
    expect((await req(app, 'GET', url, { cookie: bob.cookie })).statusCode).toBe(200);
    expect((await req(app, 'GET', url, { cookie: eve.cookie })).statusCode).toBe(403);
    const removed = await req(app, 'DELETE', `/api/guilds/${guild.id}/icon`, {
      cookie: alice.cookie,
    });
    expect(removed.json().guild.iconUrl).toBeNull();
  });
});

describe('friends', () => {
  it('request by username → incoming/outgoing → accept → friends on both sides', async () => {
    const b = await open(bob);
    const sent = await req(app, 'POST', '/api/friends/requests', {
      cookie: alice.cookie,
      payload: { username: 'BOB' },
    });
    expect(sent.json().friend).toMatchObject({ status: 'outgoing', user: { username: 'bob' } });
    expect((await b.waitFor('friend.updated')).data.friend).toMatchObject({
      status: 'incoming',
      user: { id: alice.user.id },
    });

    const bobs = await req(app, 'GET', '/api/friends', { cookie: bob.cookie });
    expect(bobs.json().friends).toHaveLength(1);
    expect(bobs.json().friends[0].status).toBe('incoming');

    const accepted = await req(app, 'POST', `/api/friends/${alice.user.id}/accept`, {
      cookie: bob.cookie,
    });
    expect(accepted.json().friend).toMatchObject({ status: 'friend', online: false });
    const alices = await req(app, 'GET', '/api/friends', { cookie: alice.cookie });
    expect(alices.json().friends[0]).toMatchObject({ status: 'friend', online: true });
  });

  it('errors: unknown name, yourself, twice; a crossing request is accepted', async () => {
    const unknown = await req(app, 'POST', '/api/friends/requests', {
      cookie: alice.cookie,
      payload: { username: 'nobody' },
    });
    expect(unknown.statusCode).toBe(404);
    const self = await req(app, 'POST', '/api/friends/requests', {
      cookie: alice.cookie,
      payload: { username: 'alice' },
    });
    expect(self.statusCode).toBe(400);
    await req(app, 'POST', '/api/friends/requests', {
      cookie: alice.cookie,
      payload: { username: 'bob' },
    });
    const crossing = await req(app, 'POST', '/api/friends/requests', {
      cookie: bob.cookie,
      payload: { username: 'alice' },
    });
    expect(crossing.json().friend.status).toBe('friend');
    const twice = await req(app, 'POST', '/api/friends/requests', {
      cookie: alice.cookie,
      payload: { username: 'bob' },
    });
    expect(twice.statusCode).toBe(409);
  });

  it('presence goes to friends; removing ends it and is announced', async () => {
    await befriend(alice, bob);
    const a = await open(alice);
    const b = await open(bob);
    await a.waitFor('friend.presence', (e) => e.data.userId === bob.user.id && e.data.online);
    await b.close();
    await a.waitFor('friend.presence', (e) => e.data.userId === bob.user.id && !e.data.online);

    const del = await req(app, 'DELETE', `/api/friends/${bob.user.id}`, { cookie: alice.cookie });
    expect(del.statusCode).toBe(204);
    await a.waitFor('friend.removed', (e) => e.data.userId === bob.user.id);
    const list = await req(app, 'GET', '/api/friends', { cookie: bob.cookie });
    expect(list.json().friends).toEqual([]);
  });
});

describe('private conversations', () => {
  it('only friends; messages and files reach the other without subscribing', async () => {
    const before = await req(app, 'POST', '/api/dms', {
      cookie: alice.cookie,
      payload: { userId: bob.user.id },
    });
    expect(before.statusCode).toBe(403);
    expect(before.json().error.code).toBe('NOT_FRIENDS');

    await befriend(alice, bob);
    const b = await open(bob);
    const channelId = await openDm(alice, bob);
    expect(await openDm(bob, alice)).toBe(channelId);
    const dmEv = await b.waitFor('dm.updated');
    expect(dmEv.data.dm.peer.id).toBe(alice.user.id);

    expect((await sendMessage(app, alice, channelId, 'psst')).statusCode).toBe(201);
    const got = await b.waitFor('message.created');
    expect(got.data.message).toMatchObject({ channelId, content: 'psst' });

    const file = await app.inject({
      method: 'POST',
      url: `/api/channels/${channelId}/files?name=bild.png`,
      headers: { cookie: bob.cookie, 'content-type': 'application/octet-stream' },
      payload: PNG,
    });
    expect(file.statusCode).toBe(201);
    const fileUrl = file.json().message.file.url as string;
    expect((await req(app, 'GET', fileUrl, { cookie: alice.cookie })).statusCode).toBe(200);
    expect((await req(app, 'GET', fileUrl, { cookie: eve.cookie })).statusCode).toBe(403);

    const list = await req(app, 'GET', '/api/dms', { cookie: bob.cookie });
    expect(list.json().dms).toHaveLength(1);
    expect(list.json().dms[0].lastMessageAt).not.toBeNull();
  });

  it('outsiders cannot read or subscribe; after unfriending it is read-only', async () => {
    await befriend(alice, bob);
    const channelId = await openDm(alice, bob);
    await sendMessage(app, alice, channelId, 'hallo');
    const peek = await req(app, 'GET', `/api/channels/${channelId}/messages`, {
      cookie: eve.cookie,
    });
    expect(peek.statusCode).toBe(403);
    const e = await open(eve);
    expect((await e.subscribe(channelId)).type).toBe('error');

    await req(app, 'DELETE', `/api/friends/${alice.user.id}`, { cookie: bob.cookie });
    const write = await sendMessage(app, bob, channelId, 'noch da?');
    expect(write.statusCode).toBe(403);
    expect(write.json().error.code).toBe('NOT_FRIENDS');
    const read = await req(app, 'GET', `/api/channels/${channelId}/messages`, {
      cookie: bob.cookie,
    });
    expect(read.json().messages).toHaveLength(1);
  });
});

describe('calls', () => {
  it('calling rings the friend; picking up stops the ringing; hanging up ends it', async () => {
    await befriend(alice, bob);
    const channelId = await openDm(alice, bob);
    const a = await open(alice);
    const b = await open(bob);

    a.send({ type: 'voice.join', data: { channelId, video: true } });
    await a.waitFor('voice.joined');
    const ring = await b.waitFor('call.ring');
    expect(ring.data).toMatchObject({ channelId, video: true, from: { id: alice.user.id } });
    const state = await b.waitFor('voice.state', (e) => e.data.channelId === channelId);
    expect(state.data.peers[0]).toMatchObject({ userId: alice.user.id, video: true });

    b.send({ type: 'voice.join', data: { channelId } });
    const joined = await b.waitFor('voice.joined');
    expect(joined.data.peers).toHaveLength(1);
    await b.waitFor('call.ended', (e) => e.data.reason === 'answered');

    b.send({ type: 'voice.video', data: { video: true } });
    expect((await a.waitFor('voice.peer-video')).data.video).toBe(true);

    a.send({ type: 'voice.leave' });
    b.send({ type: 'voice.leave' });
    await a.waitFor('call.ended', (e) => e.data.reason === 'cancelled');
  });

  it('declining tells the caller; strangers cannot call', async () => {
    await befriend(alice, bob);
    const channelId = await openDm(alice, bob);
    const a = await open(alice);
    const b = await open(bob);
    a.send({ type: 'voice.join', data: { channelId } });
    await b.waitFor('call.ring');
    b.send({ type: 'call.decline', data: { channelId } });
    await a.waitFor('call.ended', (e) => e.data.reason === 'declined');

    const e = await open(eve);
    e.send({ type: 'voice.join', data: { channelId } });
    expect((await e.waitFor('error')).data.code).toBe('FORBIDDEN');
  });
});
