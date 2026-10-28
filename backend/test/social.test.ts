import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { users } from '../src/db/schema.js';
import {
  buildTestApp,
  getDb,
  sentMails,
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

describe('group chats', () => {
  async function friendsWithAll() {
    await befriend(alice, bob);
    await befriend(alice, eve);
  }
  const create = (user: TestUser, userIds: string[], name?: string) =>
    req(app, 'POST', '/api/groups', { cookie: user.cookie, payload: { name, userIds } });

  it('only with friends, at least two; everyone gets it and the messages', async () => {
    await befriend(alice, bob);
    expect((await create(alice, [bob.user.id])).statusCode).toBe(400);
    const notFriend = await create(alice, [bob.user.id, eve.user.id]);
    expect(notFriend.statusCode).toBe(403);
    expect(notFriend.json().error.code).toBe('NOT_FRIENDS');

    await befriend(alice, eve);
    const b = await open(bob);
    const e = await open(eve);
    const res = await create(alice, [bob.user.id, eve.user.id], 'Spieleabend');
    expect(res.statusCode).toBe(201);
    const dm = res.json().dm;
    expect(dm.channel).toMatchObject({ kind: 'group', name: 'Spieleabend', guildId: null });
    expect(dm.ownerId).toBe(alice.user.id);
    expect(dm.members.map((m: { username: string }) => m.username).sort()).toEqual(['bob', 'eve']);
    const seen = await b.waitFor('dm.updated', (ev) => ev.data.dm.channel.id === dm.channel.id);
    expect(seen.data.dm.members.map((m: { username: string }) => m.username).sort()).toEqual([
      'alice',
      'eve',
    ]);

    // Bob and Eve are no friends of each other, but both can write in the group.
    await sendMessage(app, bob, dm.channel.id, 'Hallo Gruppe');
    expect((await e.waitFor('message.created')).data.message.content).toBe('Hallo Gruppe');
    expect((await sendMessage(app, eve, dm.channel.id, 'Hi Bob')).statusCode).toBe(201);
  });

  it('rename, add a friend, owner removes, leaving passes on ownership, last one deletes', async () => {
    await friendsWithAll();
    const carol = await registerUser(app, { username: 'carol' });
    await befriend(bob, carol);
    const { dm } = (await create(alice, [bob.user.id, eve.user.id])).json();
    const id = dm.channel.id as string;

    const renamed = await req(app, 'PATCH', `/api/groups/${id}`, {
      cookie: bob.cookie,
      payload: { name: 'Neu' },
    });
    expect(renamed.json().dm.channel.name).toBe('Neu');

    // Bob may only add his own friends.
    const notHis = await req(app, 'POST', `/api/groups/${id}/members`, {
      cookie: alice.cookie,
      payload: { userId: carol.user.id },
    });
    expect(notHis.statusCode).toBe(403);
    const added = await req(app, 'POST', `/api/groups/${id}/members`, {
      cookie: bob.cookie,
      payload: { userId: carol.user.id },
    });
    expect(added.json().dm.members).toHaveLength(3);

    // Only the owner removes others.
    const kick = await req(app, 'DELETE', `/api/groups/${id}/members/${carol.user.id}`, {
      cookie: bob.cookie,
    });
    expect(kick.statusCode).toBe(403);
    const c = await open(carol);
    expect(
      (
        await req(app, 'DELETE', `/api/groups/${id}/members/${carol.user.id}`, {
          cookie: alice.cookie,
        })
      ).statusCode,
    ).toBe(204);
    await c.waitFor('dm.removed', (ev) => ev.data.channelId === id);
    const peek = await req(app, 'GET', `/api/channels/${id}/messages`, { cookie: carol.cookie });
    expect(peek.statusCode).toBe(403);

    // The owner leaves: someone else owns it now.
    await req(app, 'DELETE', `/api/groups/${id}/members/me`, { cookie: alice.cookie });
    const bobs = (await req(app, 'GET', '/api/dms', { cookie: bob.cookie })).json().dms;
    expect(bobs[0].ownerId).not.toBe(alice.user.id);
    expect(bobs[0].members).toHaveLength(1);

    await req(app, 'DELETE', `/api/groups/${id}/members/me`, { cookie: bob.cookie });
    await req(app, 'DELETE', `/api/groups/${id}/members/me`, { cookie: eve.cookie });
    expect(
      (await req(app, 'GET', `/api/channels/${id}/messages`, { cookie: eve.cookie })).statusCode,
    ).toBe(404);
  });

  it('a group call rings everyone; picking up stops only your own ringing', async () => {
    await friendsWithAll();
    const { dm } = (await create(alice, [bob.user.id, eve.user.id], 'Runde')).json();
    const channelId = dm.channel.id as string;
    const a = await open(alice);
    const b = await open(bob);
    const e = await open(eve);
    a.send({ type: 'voice.join', data: { channelId } });
    expect((await b.waitFor('call.ring')).data.group).toBe('Runde');
    await e.waitFor('call.ring');
    b.send({ type: 'voice.join', data: { channelId } });
    await b.waitFor('call.ended', (ev) => ev.data.reason === 'answered');
    await new Promise((r) => setTimeout(r, 150));
    expect(e.ofType('call.ended')).toHaveLength(0);
    e.send({ type: 'call.decline', data: { channelId } });
    await e.waitFor('call.ended', (ev) => ev.data.reason === 'declined');
    await new Promise((r) => setTimeout(r, 150));
    expect(a.ofType('call.ended')).toHaveLength(0);
  });
});

describe('GIFs', () => {
  const calls: string[] = [];
  const fakeGiphy = (async (url: string | URL) => {
    const u = new URL(String(url));
    calls.push(u.pathname + u.search.replace(/api_key=[^&]+/, 'api_key=KEY'));
    const item = (id: string) => ({
      id,
      title: `GIF ${id}`,
      images: { original: { width: '480', height: '270' } },
    });
    if (u.pathname.endsWith('/trending') || u.pathname.endsWith('/search')) {
      return new Response(
        JSON.stringify({ data: [item('abc123'), item('def456'), { id: '../x' }] }),
      );
    }
    const id = u.pathname.split('/').pop()!;
    if (id === 'missing1') return new Response('{}', { status: 404 });
    return new Response(JSON.stringify({ data: item(id) }));
  }) as typeof fetch;

  it('off without a key', async () => {
    const res = await req(app, 'GET', '/api/gifs/status', { cookie: alice.cookie });
    expect(res.json()).toEqual({ enabled: false });
    expect((await req(app, 'GET', '/api/gifs/search', { cookie: alice.cookie })).statusCode).toBe(
      503,
    );
  });

  it('search through the server (key never leaves it), post one, embed from GIPHY', async () => {
    await app.close();
    calls.length = 0;
    app = await buildTestApp({ giphyApiKey: 'secret-key' }, { giphyFetch: fakeGiphy });
    const { general } = await createGuild(app, alice);

    const search = await req(app, 'GET', '/api/gifs/search?q=Katze', { cookie: alice.cookie });
    expect(search.statusCode).toBe(200);
    expect(search.json().gifs.map((g: { id: string }) => g.id)).toEqual(['abc123', 'def456']);
    expect(search.body).not.toContain('secret-key');
    expect(calls[0]).toMatch(/\/v1\/gifs\/search\?.*q=katze/);
    // Cached: the same search does not go to GIPHY again.
    await req(app, 'GET', '/api/gifs/search?q=katze', { cookie: alice.cookie });
    expect(calls).toHaveLength(1);

    const sent = await req(app, 'POST', `/api/channels/${general.id}/gifs`, {
      cookie: alice.cookie,
      payload: { id: 'abc123' },
    });
    expect(sent.statusCode).toBe(201);
    expect(sent.json().message).toMatchObject({
      kind: 'gif',
      content: 'GIF abc123',
      gif: {
        id: 'abc123',
        mp4: 'https://media.giphy.com/media/abc123/giphy.mp4',
        width: 480,
        height: 270,
      },
    });
    const missing = await req(app, 'POST', `/api/channels/${general.id}/gifs`, {
      cookie: alice.cookie,
      payload: { id: 'missing1' },
    });
    expect(missing.statusCode).toBe(404);
    const bad = await req(app, 'POST', `/api/channels/${general.id}/gifs`, {
      cookie: alice.cookie,
      payload: { id: '../../x' },
    });
    expect(bad.statusCode).toBe(400);
    const outsider = await req(app, 'POST', `/api/channels/${general.id}/gifs`, {
      cookie: eve.cookie,
      payload: { id: 'abc123' },
    });
    expect(outsider.statusCode).toBe(403);
  });
});

describe('forgot password', () => {
  const resetToken = (to: string) => {
    const mail = sentMails(app)
      .filter((m) => m.to === to && m.subject.startsWith('Neues Passwort'))
      .at(-1);
    const token = mail?.text.match(/#token=([A-Za-z0-9_-]{43})/)?.[1];
    if (!token) throw new Error('no reset mail');
    return token;
  };

  it('mail only for real accounts; the link sets a new password once and signs out everywhere', async () => {
    const unknown = await req(app, 'POST', '/api/auth/forgot-password', {
      payload: { email: 'nobody@example.com' },
    });
    expect(unknown.statusCode).toBe(202);
    expect(sentMails(app).some((m) => m.to === 'nobody@example.com')).toBe(false);

    const res = await req(app, 'POST', '/api/auth/forgot-password', {
      payload: { email: alice.user.email.toUpperCase() },
    });
    expect(res.statusCode).toBe(202);
    const token = resetToken(alice.user.email);

    const weak = await req(app, 'POST', '/api/auth/reset-password', {
      payload: { token, password: 'alice12345' },
    });
    expect(weak.statusCode).toBe(400);

    // A rejected password does not use up the link; the second try works, a third does not.
    const good = await req(app, 'POST', '/api/auth/reset-password', {
      payload: { token, password: 'Neues-Passwort-42' },
    });
    const again = await req(app, 'POST', '/api/auth/reset-password', {
      payload: { token, password: 'Noch-ein-Passwort-7' },
    });
    expect(again.statusCode).toBe(400);
    expect(again.json().error.code).toBe('RESET_INVALID');
    expect(good.statusCode).toBe(200);
    expect(good.cookies.find((c) => c.name === 'sid')?.value).toBeTruthy();
    // The old session is gone, the new password works, the old one does not.
    expect((await req(app, 'GET', '/api/auth/me', { cookie: alice.cookie })).statusCode).toBe(401);
    const login = await req(app, 'POST', '/api/auth/login', {
      payload: { email: alice.user.email, password: 'Neues-Passwort-42' },
    });
    expect(login.statusCode).toBe(200);
    const old = await req(app, 'POST', '/api/auth/login', {
      payload: { email: alice.user.email, password: alice.password },
    });
    expect(old.statusCode).toBe(401);
  });
});

describe('limits', () => {
  it('at most 5 servers per person', async () => {
    for (let i = 1; i <= 5; i++) await createGuild(app, alice, `S${i}`);
    const sixth = await req(app, 'POST', '/api/guilds', {
      cookie: alice.cookie,
      payload: { name: 'Zu viel' },
    });
    expect(sixth.statusCode).toBe(409);
    expect(sixth.json().error.code).toBe('GUILD_LIMIT');
    // Joining other servers is not limited by this.
    const { guild } = await createGuild(app, bob, 'Bobs');
    await joinGuild(app, alice, guild.inviteCode);
  });

  it('storage cap: posts beyond it are refused with 507; admins see the use', async () => {
    await app.close();
    app = await buildTestApp({
      storage: { root: await mkdtemp(join(tmpdir(), 'disslxt-store-')), limitBytes: 20 },
    });
    const { general } = await createGuild(app, alice);
    expect((await sendMessage(app, alice, general.id, 'x'.repeat(15))).statusCode).toBe(201);
    const full = await sendMessage(app, alice, general.id, 'y'.repeat(10));
    expect(full.statusCode).toBe(507);
    expect(full.json().error.code).toBe('STORAGE_FULL');

    expect((await req(app, 'GET', '/api/admin/storage', { cookie: alice.cookie })).statusCode).toBe(
      403,
    );
    await getDb().db.update(users).set({ badge: 'admin' }).where(eq(users.id, alice.user.id));
    const status = await req(app, 'GET', '/api/admin/storage', { cookie: alice.cookie });
    expect(status.json()).toEqual({ usedBytes: 15, limitBytes: 20 });
  });
});

describe('server tags, status and presence', () => {
  it('owner sets a tag with emoji; members wear it; changes and removal follow', async () => {
    const { guild } = await createGuild(app, alice, 'Gamer');
    await joinGuild(app, bob, guild.inviteCode);
    const bad = await req(app, 'PATCH', `/api/guilds/${guild.id}`, {
      cookie: alice.cookie,
      payload: { tag: 'ABCDE', tagEmoji: 'xx' },
    });
    expect(bad.statusCode).toBe(400);
    const set = await req(app, 'PATCH', `/api/guilds/${guild.id}`, {
      cookie: alice.cookie,
      payload: { tag: 'game', tagEmoji: '🎮' },
    });
    expect(set.json().guild).toMatchObject({ tag: 'GAME', tagEmoji: '🎮' });

    const wear = await req(app, 'PATCH', '/api/users/me', {
      cookie: bob.cookie,
      payload: { tagGuildId: guild.id },
    });
    expect(wear.json().user.tag).toEqual({ guildId: guild.id, text: 'GAME', emoji: '🎮' });
    const notMember = await req(app, 'PATCH', '/api/users/me', {
      cookie: eve.cookie,
      payload: { tagGuildId: guild.id },
    });
    expect(notMember.statusCode).toBe(403);

    const b = await open(bob);
    await req(app, 'PATCH', `/api/guilds/${guild.id}`, {
      cookie: alice.cookie,
      payload: { tagEmoji: '👾' },
    });
    const updated = await b.waitFor('user.updated', (e) => e.data.user.id === bob.user.id);
    expect(updated.data.user.tag?.emoji).toBe('👾');

    await req(app, 'PATCH', `/api/guilds/${guild.id}`, {
      cookie: alice.cookie,
      payload: { tag: '' },
    });
    const me = await req(app, 'GET', '/api/auth/me', { cookie: bob.cookie });
    expect(me.json().user.tag).toBeNull();
  });

  it('custom status (emoji + text) shows up with the author', async () => {
    const { general } = await createGuild(app, alice);
    const res = await req(app, 'PATCH', '/api/users/me', {
      cookie: alice.cookie,
      payload: { statusEmoji: '🎧', statusText: ' Höre Musik ' },
    });
    expect(res.json().user.status).toEqual({ emoji: '🎧', text: 'Höre Musik' });
    expect(
      (
        await req(app, 'PATCH', '/api/users/me', {
          cookie: alice.cookie,
          payload: { statusEmoji: 'hi' },
        })
      ).statusCode,
    ).toBe(400);
    await sendMessage(app, alice, general.id, 'hey');
    const list = await req(app, 'GET', `/api/channels/${general.id}/messages`, {
      cookie: alice.cookie,
    });
    expect(list.json().messages[0].author.status).toEqual({ emoji: '🎧', text: 'Höre Musik' });
    const cleared = await req(app, 'PATCH', '/api/users/me', {
      cookie: alice.cookie,
      payload: { statusEmoji: null, statusText: '' },
    });
    expect(cleared.json().user.status).toBeNull();
  });

  it('presence: online, red while in a call, offline', async () => {
    await befriend(alice, bob);
    const channelId = await openDm(alice, bob);
    const a = await open(alice);
    const b = await open(bob);
    await a.waitFor(
      'friend.presence',
      (e) => e.data.userId === bob.user.id && e.data.presence === 'online',
    );
    b.send({ type: 'voice.join', data: { channelId } });
    await a.waitFor(
      'friend.presence',
      (e) => e.data.userId === bob.user.id && e.data.presence === 'call',
    );
    const friends = await req(app, 'GET', '/api/friends', { cookie: alice.cookie });
    expect(friends.json().friends[0].presence).toBe('call');
    b.send({ type: 'voice.leave' });
    await a.waitFor(
      'friend.presence',
      (e) => e.data.userId === bob.user.id && e.data.presence === 'online',
      2000,
      { onlyNew: true },
    );
  });
});
