import { performance } from 'node:perf_hooks';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WS_CLOSE } from '@disslxt/shared';
import { guildMembers } from '../src/db/schema.js';
import {
  ALLOWED_TEST_ORIGIN,
  buildTestApp,
  bulkCreateUsers,
  closeDb,
  createGuild,
  getDb,
  joinGuild,
  listen,
  registerUser,
  req,
  resetDb,
  sendMessage,
  sleep,
  wsConnect,
  wsReady,
  type TestSocket,
  type TestUser,
} from './helpers.js';

let app: FastifyInstance;
let host: string;
let alice: TestUser;
let bob: TestUser;
let guildId: string;
let inviteCode: string;
let generalId: string;
const sockets: TestSocket[] = [];

async function open(user: TestUser): Promise<TestSocket> {
  const s = await wsReady(host, user.cookie);
  sockets.push(s);
  return s;
}

async function setup(overrides: Parameters<typeof buildTestApp>[0] = {}) {
  app = await buildTestApp(overrides);
  host = await listen(app);
  alice = await registerUser(app, { username: 'alice' });
  bob = await registerUser(app, { username: 'bob' });
  const g = await createGuild(app, alice, 'RT');
  guildId = g.guild.id;
  inviteCode = g.guild.inviteCode;
  generalId = g.general.id;
  await joinGuild(app, bob, inviteCode);
}

beforeEach(async () => {
  await resetDb();
});
afterEach(async () => {
  for (const s of sockets.splice(0)) s.ws.terminate();
  await app?.close();
});
afterAll(closeDb);

describe('connection auth', () => {
  beforeEach(() => setup());

  it('valid cookie → ready with userId', async () => {
    const s = await open(alice);
    expect(s.events[0]).toEqual({ type: 'ready', data: { userId: alice.user.id } });
  });

  it('no cookie → closes with 4401', async () => {
    const s = wsConnect(host);
    expect((await s.closed).code).toBe(WS_CLOSE.UNAUTHORIZED);
  });

  it('bad cookie → closes with 4401', async () => {
    const s = wsConnect(host, { cookie: 'sid=not-a-valid-token' });
    expect((await s.closed).code).toBe(4401);
  });

  it('expired/logged-out session → 4401', async () => {
    await req(app, 'POST', '/api/auth/logout', { cookie: bob.cookie });
    const s = wsConnect(host, { cookie: bob.cookie });
    expect((await s.closed).code).toBe(4401);
  });

  it('wrong Origin → closes with 4403', async () => {
    const s = wsConnect(host, { cookie: alice.cookie, origin: 'http://evil.example' });
    expect((await s.closed).code).toBe(WS_CLOSE.BAD_ORIGIN);
    expect(s.ofType('ready')).toHaveLength(0);
  });

  it('missing Origin → closes with 4403', async () => {
    const s = wsConnect(host, { cookie: alice.cookie, origin: null });
    expect((await s.closed).code).toBe(4403);
  });

  it('origin from ALLOWED_ORIGINS is accepted', async () => {
    const s = wsConnect(host, { cookie: alice.cookie, origin: ALLOWED_TEST_ORIGIN });
    sockets.push(s);
    await s.waitFor('ready');
  });

  it('logout closes the session’s sockets with 4401', async () => {
    const s = await open(bob);
    await req(app, 'POST', '/api/auth/logout', { cookie: bob.cookie });
    expect((await s.closed).code).toBe(4401);
  });
});

describe('protocol', () => {
  beforeEach(() => setup());

  it('ping → pong', async () => {
    const s = await open(alice);
    s.send({ type: 'ping' });
    await s.waitFor('pong');
  });

  it('invalid JSON or schema → error BAD_REQUEST without closing', async () => {
    const s = await open(alice);
    s.send('{not json');
    await s.waitFor('error', (e) => e.data.code === 'BAD_REQUEST');
    s.send({ type: 'subscribe', data: { channelId: 'nope' } });
    s.send({ type: 'unknown' });
    await sleep(100);
    expect(s.ofType('error').filter((e) => e.data.code === 'BAD_REQUEST')).toHaveLength(3);
    s.send({ type: 'ping' });
    await s.waitFor('pong');
    expect(s.ws.readyState).toBe(s.ws.OPEN);
  });

  it('frames sent right after connecting are processed after auth', async () => {
    const s = wsConnect(host, { cookie: alice.cookie });
    sockets.push(s);
    await s.opened;
    s.send({ type: 'subscribe', data: { channelId: generalId } });
    await s.waitFor('subscribed');
    expect(s.events.map((e) => e.type).filter((t) => t !== 'presence.update')).toEqual([
      'ready',
      'subscribed',
    ]);
  });

  it('subscribe / unsubscribe acknowledgements', async () => {
    const s = await open(alice);
    expect(await s.subscribe(generalId)).toEqual({
      type: 'subscribed',
      data: { channelId: generalId },
    });
    s.send({ type: 'unsubscribe', data: { channelId: generalId } });
    expect(await s.waitFor('unsubscribed')).toEqual({
      type: 'unsubscribed',
      data: { channelId: generalId },
    });
  });
});

describe('channel rooms and message events', () => {
  let otherChannelId: string;

  beforeEach(async () => {
    await setup();
    const res = await req(app, 'POST', `/api/guilds/${guildId}/channels`, {
      cookie: alice.cookie,
      payload: { name: 'other' },
    });
    otherChannelId = res.json().channel.id;
  });

  it('message.created arrives with the full message DTO', async () => {
    const b = await open(bob);
    await b.subscribe(generalId);
    const sent = (await sendMessage(app, alice, generalId, 'hi bob')).json().message;
    const evt = await b.waitFor('message.created');
    expect(evt.data.message).toEqual(sent);
    expect(evt.data.message).toMatchObject({
      channelId: generalId,
      author: { id: alice.user.id, username: 'alice' },
      content: 'hi bob',
      editedAt: null,
    });
  });

  it('the sender’s own subscribed socket also receives the echo', async () => {
    const a = await open(alice);
    await a.subscribe(generalId);
    const sent = (await sendMessage(app, alice, generalId, 'echo')).json().message;
    expect((await a.waitFor('message.created')).data.message.id).toBe(sent.id);
  });

  it('message.updated and message.deleted have the right payloads', async () => {
    const b = await open(bob);
    await b.subscribe(generalId);
    const id = (await sendMessage(app, alice, generalId, 'v1')).json().message.id;
    const patched = await req(app, 'PATCH', `/api/messages/${id}`, {
      cookie: alice.cookie,
      payload: { content: 'v2' },
    });
    const upd = await b.waitFor('message.updated');
    expect(upd.data.message).toEqual(patched.json().message);
    expect(upd.data.message.editedAt).not.toBeNull();

    await req(app, 'DELETE', `/api/messages/${id}`, { cookie: alice.cookie });
    const del = await b.waitFor('message.deleted');
    expect(del).toEqual({ type: 'message.deleted', data: { id, channelId: generalId } });
  });

  it('a subscriber to channel X does not receive messages from channel Y', async () => {
    const b = await open(bob);
    await b.subscribe(generalId);
    await sendMessage(app, alice, otherChannelId, 'in other');
    await sendMessage(app, alice, generalId, 'in general');
    await b.waitFor('message.created', (e) => e.data.message.content === 'in general');
    await sleep(50);
    expect(b.ofType('message.created').map((e) => e.data.message.content)).toEqual(['in general']);
  });

  it('after unsubscribe nothing arrives', async () => {
    const b = await open(bob);
    await b.subscribe(generalId);
    b.send({ type: 'unsubscribe', data: { channelId: generalId } });
    await b.waitFor('unsubscribed');
    await sendMessage(app, alice, generalId, 'nobody listening');
    await sleep(150);
    expect(b.ofType('message.created')).toHaveLength(0);
  });

  it('subscribing to another channel drops the previous subscription', async () => {
    const b = await open(bob);
    await b.subscribe(generalId);
    await b.subscribe(otherChannelId);
    await sendMessage(app, alice, generalId, 'old room');
    await sendMessage(app, alice, otherChannelId, 'new room');
    await b.waitFor('message.created', (e) => e.data.message.content === 'new room');
    await sleep(50);
    expect(b.ofType('message.created').map((e) => e.data.message.content)).toEqual(['new room']);
  });

  it('each tab has its own subscription', async () => {
    const b1 = await open(bob);
    const b2 = await open(bob);
    await b1.subscribe(generalId);
    await b2.subscribe(otherChannelId);
    await sendMessage(app, alice, generalId, 'g');
    await b1.waitFor('message.created');
    await sleep(50);
    expect(b2.ofType('message.created')).toHaveLength(0);
  });
});

describe('guild events', () => {
  beforeEach(() => setup());

  it('channel.created goes to all connected guild members', async () => {
    const b = await open(bob);
    const res = await req(app, 'POST', `/api/guilds/${guildId}/channels`, {
      cookie: alice.cookie,
      payload: { name: 'News' },
    });
    const evt = await b.waitFor('channel.created');
    expect(evt.data.channel).toEqual(res.json().channel);
    expect(evt.data.channel.name).toBe('news');
  });

  it('member.joined (with live online flag) and presence go to the guild', async () => {
    const carol = await registerUser(app, { username: 'carol' });
    const a = await open(alice);
    const c = await open(carol);
    await joinGuild(app, carol, inviteCode);
    const joined = await a.waitFor('member.joined');
    expect(joined.data).toEqual({
      guildId,
      member: { userId: carol.user.id, username: 'carol', online: true },
    });
    await a.waitFor('presence.update', (e) => e.data.userId === carol.user.id);
    // carol's existing socket now belongs to the guild room
    await req(app, 'POST', `/api/guilds/${guildId}/channels`, {
      cookie: alice.cookie,
      payload: { name: 'after-join' },
    });
    await c.waitFor('channel.created');
    // and she may subscribe to its channels
    expect((await c.subscribe(generalId)).type).toBe('subscribed');
  });

  it('idempotent re-join emits no second member.joined', async () => {
    const a = await open(alice);
    await joinGuild(app, bob, inviteCode);
    await sleep(100);
    expect(a.ofType('member.joined')).toHaveLength(0);
  });

  it('member.left is sent and the leaver’s sockets drop the guild rooms', async () => {
    const a = await open(alice);
    const b = await open(bob);
    await b.subscribe(generalId);
    await req(app, 'POST', `/api/guilds/${guildId}/leave`, { cookie: bob.cookie });
    expect((await a.waitFor('member.left')).data).toEqual({ guildId, userId: bob.user.id });
    // the leaver's own socket is told too (other tabs can update their UI)
    await b.waitFor('member.left');

    await sendMessage(app, alice, generalId, 'after leave');
    await req(app, 'POST', `/api/guilds/${guildId}/channels`, {
      cookie: alice.cookie,
      payload: { name: 'secret' },
    });
    await sleep(150);
    expect(b.ofType('message.created')).toHaveLength(0);
    expect(b.ofType('channel.created')).toHaveLength(0);
    // membership is re-checked on subscribe
    expect(await b.subscribe(generalId)).toMatchObject({
      type: 'error',
      data: { code: 'FORBIDDEN' },
    });
  });

  it('a newly created guild’s events reach the creator’s open socket', async () => {
    const a = await open(alice);
    const { guild } = await createGuild(app, alice, 'Second');
    await req(app, 'POST', `/api/guilds/${guild.id}/channels`, {
      cookie: alice.cookie,
      payload: { name: 'fresh' },
    });
    const evt = await a.waitFor('channel.created', (e) => e.data.channel.guildId === guild.id);
    expect(evt.data.channel.name).toBe('fresh');
  });
});

describe('presence', () => {
  beforeEach(() => setup());

  const members = async (u: TestUser) =>
    (await req(app, 'GET', `/api/guilds/${guildId}/members`, { cookie: u.cookie })).json()
      .members as Array<{ userId: string; online: boolean }>;
  const onlineOf = async (u: TestUser, userId: string) =>
    (await members(u)).find((m) => m.userId === userId)?.online;

  it('B connects → A gets online; B closes → offline; G5 reflects it', async () => {
    const a = await open(alice);
    expect(await onlineOf(alice, bob.user.id)).toBe(false);

    const b = await open(bob);
    const on = await a.waitFor('presence.update', (e) => e.data.userId === bob.user.id);
    expect(on.data).toEqual({ guildId, userId: bob.user.id, status: 'online' });
    expect(await onlineOf(alice, bob.user.id)).toBe(true);

    await b.close();
    const off = await a.waitFor(
      'presence.update',
      (e) => e.data.userId === bob.user.id && e.data.status === 'offline',
    );
    expect(off.data.guildId).toBe(guildId);
    expect(await onlineOf(alice, bob.user.id)).toBe(false);
  });

  it('two tabs only go offline after both close', async () => {
    const a = await open(alice);
    const b1 = await open(bob);
    const b2 = await open(bob);
    await a.waitFor('presence.update', (e) => e.data.userId === bob.user.id);
    await b1.close();
    await sleep(150);
    const bobEvents = () =>
      a.ofType('presence.update').filter((e) => e.data.userId === bob.user.id);
    expect(bobEvents().map((e) => e.data.status)).toEqual(['online']);
    expect(await onlineOf(alice, bob.user.id)).toBe(true);

    await b2.close();
    await a.waitFor(
      'presence.update',
      (e) => e.data.userId === bob.user.id && e.data.status === 'offline',
    );
    expect(bobEvents().map((e) => e.data.status)).toEqual(['online', 'offline']);
  });

  it('a user in another guild does not receive the presence event', async () => {
    const dave = await registerUser(app, { username: 'dave' });
    await createGuild(app, dave, 'Dave only');
    const d = await open(dave);
    await open(bob);
    await sleep(150);
    expect(d.ofType('presence.update').filter((e) => e.data.userId === bob.user.id)).toEqual([]);
  });

  it('D2: a socket closed while its early subscribe is drained does not stay online', async () => {
    // Hold the queued subscribe inside assertAccess until the client has terminated.
    const channels = app.services.channels;
    const original = channels.assertAccess.bind(channels);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const inAssert = new Promise<void>((r) => (entered = r));
    channels.assertAccess = async (...args: Parameters<typeof original>) => {
      entered();
      await gate;
      return original(...args);
    };
    try {
      const b = wsConnect(host, { cookie: bob.cookie });
      await b.opened;
      b.send({ type: 'subscribe', data: { channelId: generalId } });
      await inAssert;
      expect(app.hub.isOnline(bob.user.id)).toBe(true);
      b.ws.terminate();
      await b.closed;
      await sleep(50); // let the server see the close while the subscribe is still pending
      release();
      await sleep(50);
    } finally {
      channels.assertAccess = original;
    }
    expect(app.hub.isOnline(bob.user.id)).toBe(false);
    expect(app.hub.clientCount).toBe(0);
    expect(await onlineOf(alice, bob.user.id)).toBe(false);
  });

  it('D2: 30× connect, subscribe before ready, terminate → no ghost presence', async () => {
    for (let i = 0; i < 30; i++) {
      const b = wsConnect(host, { cookie: bob.cookie });
      await b.opened;
      b.send({ type: 'subscribe', data: { channelId: generalId } });
      await sleep(i % 5);
      b.ws.terminate();
      await b.closed;
    }
    await sleep(300);
    expect(app.hub.clientCount).toBe(0);
    expect(await onlineOf(alice, bob.user.id)).toBe(false);
  });

  it('presence is broadcast to each of the user’s guilds', async () => {
    const other = await createGuild(app, alice, 'Other');
    await joinGuild(app, bob, other.guild.inviteCode);
    const a = await open(alice);
    await open(bob);
    await a.waitFor('presence.update', (e) => e.data.guildId === guildId);
    await a.waitFor('presence.update', (e) => e.data.guildId === other.guild.id);
  });
});

describe('heartbeat', () => {
  it('terminates sockets that stop answering pings, keeps healthy ones', async () => {
    await setup({ wsHeartbeatMs: 100 });
    const a = await open(alice);
    const b = await open(bob);
    await a.waitFor('presence.update', (e) => e.data.userId === bob.user.id);
    // Stop reading on B's socket: it can no longer answer pings with pongs.
    b.ws.pause();
    await a.waitFor(
      'presence.update',
      (e) => e.data.userId === bob.user.id && e.data.status === 'offline',
      3000,
    );
    // A answered every ping and is still connected.
    await sleep(300);
    a.send({ type: 'ping' });
    await a.waitFor('pong');
    expect(app.hub.isOnline(alice.user.id)).toBe(true);
    expect(app.hub.isOnline(bob.user.id)).toBe(false);
  });
});

describe('non-functional', () => {
  it('delivery latency: p95 < 300 ms from POST until the subscriber receives it (20 msgs)', async () => {
    await setup();
    const b = await open(bob);
    await b.subscribe(generalId);
    const base = `http://${host}`;
    const durations: number[] = [];
    for (let i = 0; i < 20; i++) {
      const content = `latency ${i}`;
      const received = b.waitFor('message.created', (e) => e.data.message.content === content);
      const t0 = performance.now();
      const res = await fetch(`${base}/api/channels/${generalId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: alice.cookie },
        body: JSON.stringify({ content }),
      });
      expect(res.status).toBe(201);
      await received;
      durations.push(performance.now() - t0);
    }
    durations.sort((x, y) => x - y);
    const p95 = durations[Math.ceil(0.95 * durations.length) - 1]!;
    console.info(
      `[latency] p50=${durations[9]!.toFixed(1)}ms p95=${p95.toFixed(1)}ms max=${durations[19]!.toFixed(1)}ms`,
    );
    expect(p95).toBeLessThan(300);
  });

  it('100 users in one guild/channel all receive a message within 1 s', async () => {
    await setup();
    const users = await bulkCreateUsers(100);
    await getDb()
      .db.insert(guildMembers)
      .values(users.map((u) => ({ guildId, userId: u.user.id })));

    const conns = await Promise.all(users.map((u) => open(u)));
    expect(app.hub.clientCount).toBe(100);
    const subs = await Promise.all(conns.map((c) => c.subscribe(generalId)));
    expect(subs.every((s) => s.type === 'subscribed')).toBe(true);

    const t0 = performance.now();
    const all = Promise.all(
      conns.map((c) =>
        c.waitFor('message.created', (e) => e.data.message.content === 'to all', 1000),
      ),
    );
    const res = await sendMessage(app, alice, generalId, 'to all');
    expect(res.statusCode).toBe(201);
    await all;
    const elapsed = performance.now() - t0;
    console.info(`[100 users] all received in ${elapsed.toFixed(1)}ms`);
    expect(elapsed).toBeLessThan(1000);
    expect(conns.every((c) => c.ofType('error').length === 0)).toBe(true);
    expect(conns.every((c) => c.ws.readyState === c.ws.OPEN)).toBe(true);
  });
});
