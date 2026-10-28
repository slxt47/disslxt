import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VOICE_CHANNEL_MAX_PARTICIPANTS, type PushPayload } from '@disslxt/shared';
import { loadConfig } from '../src/config.js';
import { MemoryPushSender } from '../src/lib/push.js';
import { IceService } from '../src/services/ice.service.js';
import {
  buildTestApp,
  bulkCreateUsers,
  closeDb,
  createGuild,
  joinGuild,
  listen,
  registerUser,
  req,
  resetDb,
  TEST_DATABASE_URL,
  wsReady,
  type TestSocket,
  type TestUser,
} from './helpers.js';

let app: FastifyInstance;
let host: string;
let sender: MemoryPushSender;
let alice: TestUser;
let bob: TestUser;
let guildId: string;
let inviteCode: string;
let textId: string;
let voiceId: string;
const sockets: TestSocket[] = [];

async function open(user: TestUser): Promise<TestSocket> {
  const s = await wsReady(host, user.cookie);
  sockets.push(s);
  return s;
}

async function join(s: TestSocket, channelId = voiceId) {
  s.send({ type: 'voice.join', data: { channelId } });
  return s.waitFor('voice.joined', (e) => e.data.channelId === channelId, 2000, { onlyNew: true });
}

const offer = { type: 'offer' as const, sdp: 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n' };

beforeEach(async () => {
  await resetDb();
  sender = new MemoryPushSender();
  app = await buildTestApp(
    {
      push: {
        publicKey: 'k',
        privateKey: 'p',
        subject: 'mailto:x@example.com',
        transport: 'webpush',
      },
    },
    { pushSender: sender },
  );
  host = await listen(app);
  alice = await registerUser(app, { username: 'alice' });
  bob = await registerUser(app, { username: 'bob' });
  const g = await createGuild(app, alice, 'Talk');
  guildId = g.guild.id;
  inviteCode = g.guild.inviteCode;
  textId = g.general.id;
  await joinGuild(app, bob, inviteCode);
  const res = await req(app, 'POST', `/api/guilds/${guildId}/channels`, {
    cookie: alice.cookie,
    payload: { name: 'Lounge', kind: 'voice' },
  });
  expect(res.statusCode).toBe(201);
  expect(res.json().channel).toMatchObject({ name: 'lounge', kind: 'voice' });
  voiceId = res.json().channel.id;
});
afterEach(async () => {
  for (const s of sockets.splice(0)) s.ws.terminate();
  await app?.close();
});
afterAll(closeDb);

describe('voice channels', () => {
  it('channels list the kind; text is the default', async () => {
    const res = await req(app, 'GET', `/api/guilds/${guildId}/channels`, { cookie: bob.cookie });
    expect(
      res.json().channels.map((c: { name: string; kind: string }) => [c.name, c.kind]),
    ).toEqual([
      ['general', 'text'],
      ['lounge', 'voice'],
    ]);
  });

  it('have no text chat and accept no voice-message uploads', async () => {
    const res = await req(app, 'POST', `/api/channels/${voiceId}/messages`, {
      cookie: alice.cookie,
      payload: { content: 'hallo?' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('joining and signalling', () => {
  it('the joiner gets the present peers; they get peer-joined; SDP and ICE are relayed', async () => {
    const a = await open(alice);
    const b = await open(bob);
    const aJoined = await join(a);
    expect(aJoined.data.peers).toEqual([]);
    const bJoined = await join(b);
    expect(bJoined.data.peers).toEqual([
      {
        peerId: aJoined.data.peerId,
        userId: alice.user.id,
        username: 'alice',
        displayName: null,
        avatarUrl: null,
        muted: false,
        video: false,
      },
    ]);
    const pj = await a.waitFor('voice.peer-joined');
    expect(pj.data.peer).toMatchObject({ peerId: bJoined.data.peerId, username: 'bob' });

    // Bob (the joiner) offers to Alice; Alice answers; a candidate goes along.
    b.send({ type: 'voice.signal', data: { to: aJoined.data.peerId, signal: offer } });
    const got = await a.waitFor('voice.signal');
    expect(got.data).toEqual({ from: bJoined.data.peerId, signal: offer });
    const candidate = {
      type: 'candidate' as const,
      candidate: {
        candidate: 'candidate:1 1 udp 1 127.0.0.1 5000 typ host',
        sdpMid: '0',
        sdpMLineIndex: 0,
      },
    };
    a.send({ type: 'voice.signal', data: { to: bJoined.data.peerId, signal: candidate } });
    expect((await b.waitFor('voice.signal')).data.signal).toEqual(candidate);
  });

  it('signals only reach peers of the same channel; outsiders cannot inject', async () => {
    const a = await open(alice);
    const b = await open(bob);
    const aJoined = await join(a);
    // Bob is not in the channel: his signal to Alice is dropped.
    b.send({ type: 'voice.signal', data: { to: aJoined.data.peerId, signal: offer } });
    await b.subscribe(textId); // round-trip
    expect(a.ofType('voice.signal')).toEqual([]);
  });

  it('the whole guild sees who is in the channel (WS and REST)', async () => {
    const watcher = await open(bob);
    const a = await open(alice);
    await join(a);
    const state = await watcher.waitFor('voice.state', (e) => e.data.peers.length === 1);
    expect(state.data).toMatchObject({ guildId, channelId: voiceId });
    const rest = await req(app, 'GET', `/api/guilds/${guildId}/voice`, { cookie: bob.cookie });
    expect(rest.json().channels[voiceId]).toEqual([
      expect.objectContaining({ username: 'alice', muted: false }),
    ]);
  });

  it('mute is shown to the others', async () => {
    const a = await open(alice);
    const b = await open(bob);
    await join(a);
    await join(b);
    a.send({ type: 'voice.mute', data: { muted: true } });
    const m = await b.waitFor('voice.peer-muted');
    expect(m.data.muted).toBe(true);
  });

  it('leaving and closing the socket both tell the others', async () => {
    const a = await open(alice);
    const b = await open(bob);
    const aj = await join(a);
    const bj = await join(b);
    b.send({ type: 'voice.leave' });
    expect((await a.waitFor('voice.peer-left')).data.peerId).toBe(bj.data.peerId);
    expect((await b.waitFor('voice.left')).data.reason).toBe('left');

    await join(b);
    a.ws.terminate();
    const left = await b.waitFor('voice.peer-left', (e) => e.data.peerId === aj.data.peerId);
    expect(left.data.channelId).toBe(voiceId);
    const rest = await req(app, 'GET', `/api/guilds/${guildId}/voice`, { cookie: bob.cookie });
    expect(rest.json().channels[voiceId]).toHaveLength(1);
  });

  it('joining on a second device moves the person there', async () => {
    const phone = await open(alice);
    const laptop = await open(alice);
    await join(phone);
    await join(laptop);
    expect((await phone.waitFor('voice.left')).data.reason).toBe('other-device');
    const rest = await req(app, 'GET', `/api/guilds/${guildId}/voice`, { cookie: alice.cookie });
    expect(rest.json().channels[voiceId]).toHaveLength(1);
  });

  it(`at most ${VOICE_CHANNEL_MAX_PARTICIPANTS} people per channel`, async () => {
    const users = await bulkCreateUsers(VOICE_CHANNEL_MAX_PARTICIPANTS);
    for (const u of users) await joinGuild(app, u, inviteCode);
    for (const u of users) await join(await open(u));
    const late = await open(bob);
    late.send({ type: 'voice.join', data: { channelId: voiceId } });
    expect((await late.waitFor('error')).data.code).toBe('VOICE_FULL');
  });

  it('text channels, foreign guilds and unknown channels cannot be joined', async () => {
    const outsider = await registerUser(app, { username: 'eve' });
    const e = await open(outsider);
    e.send({ type: 'voice.join', data: { channelId: voiceId } });
    expect((await e.waitFor('error')).data.code).toBe('FORBIDDEN');
    const a = await open(alice);
    a.send({ type: 'voice.join', data: { channelId: textId } });
    expect((await a.waitFor('error')).data.code).toBe('BAD_REQUEST');
    a.send({ type: 'voice.join', data: { channelId: '00000000-0000-4000-8000-000000000000' } });
    expect((await a.waitFor('error', (x) => x.data.code === 'NOT_FOUND')).data.code).toBe(
      'NOT_FOUND',
    );
  });

  it('leaving the guild also leaves its voice channel', async () => {
    const a = await open(alice);
    const b = await open(bob);
    await join(a);
    const bj = await join(b);
    await req(app, 'POST', `/api/guilds/${guildId}/leave`, { cookie: bob.cookie });
    expect((await a.waitFor('voice.peer-left')).data.peerId).toBe(bj.data.peerId);
  });

  it('a burst of ICE candidates never costs a control frame like voice.leave', async () => {
    const a = await open(alice);
    const b = await open(bob);
    const aj = await join(a);
    const bj = await join(b);
    const candidate = {
      type: 'candidate' as const,
      candidate: {
        candidate: 'candidate:1 1 udp 1 172.17.0.1 5000 typ host',
        sdpMid: '0',
        sdpMLineIndex: 0,
      },
    };
    for (let i = 0; i < 150; i++) {
      b.send({ type: 'voice.signal', data: { to: aj.data.peerId, signal: candidate } });
    }
    b.send({ type: 'voice.leave' });
    expect((await a.waitFor('voice.peer-left')).data.peerId).toBe(bj.data.peerId);
    expect(b.ofType('error')).toEqual([]);
  });

  it('malformed signals are rejected', async () => {
    const a = await open(alice);
    await join(a);
    a.send({ type: 'voice.signal', data: { to: 'x', signal: offer } });
    a.send({
      type: 'voice.signal',
      data: { to: 'abcdefghij', signal: { type: 'offer', sdp: 'x'.repeat(13_000) } },
    });
    await a.waitFor('error', (e) => e.data.code === 'BAD_REQUEST');
    expect(a.ofType('error').length).toBeGreaterThanOrEqual(1);
  });
});

describe('push', () => {
  it('the first person in a voice channel invites the others; later joins do not', async () => {
    await req(app, 'POST', '/api/push/subscriptions', {
      cookie: bob.cookie,
      payload: {
        endpoint: 'https://fcm.googleapis.com/fcm/send/bob',
        keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) },
      },
    });
    await app.services.push.idle();
    sender.sent.length = 0;
    const a = await open(alice);
    await join(a);
    await app.services.push.idle();
    expect(sender.sent.map((s) => s.payload as PushPayload)).toEqual([
      {
        title: '🔊 lounge · Talk',
        body: 'alice ist im Sprachkanal. Komm dazu!',
        url: `/guilds/${guildId}/channels/${voiceId}`,
        tag: `voice-${voiceId}`,
      },
    ]);
    const b = await open(bob);
    await join(b);
    await app.services.push.idle();
    expect(sender.sent).toHaveLength(1);
  });
});

describe('ICE servers', () => {
  const base = { DATABASE_URL: TEST_DATABASE_URL };
  const log = { error: vi.fn() } as never;

  it('STUN by default; a static TURN server from the environment', async () => {
    const ice = new IceService(
      loadConfig({
        ...base,
        TURN_URLS: 'turn:turn.example:3478,turns:turn.example:5349',
        TURN_USERNAME: 'u',
        TURN_CREDENTIAL: 'c',
      }),
      log,
    );
    expect(await ice.servers()).toEqual([
      { urls: ['stun:stun.cloudflare.com:3478'] },
      {
        urls: ['turn:turn.example:3478', 'turns:turn.example:5349'],
        username: 'u',
        credential: 'c',
      },
    ]);
  });

  it('Cloudflare TURN: generates credentials, drops port 53, caches them', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        iceServers: [
          { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
          {
            urls: [
              'turn:turn.cloudflare.com:3478?transport=udp',
              'turn:turn.cloudflare.com:53?transport=udp',
              'turns:turn.cloudflare.com:443?transport=tcp',
            ],
            username: 'gen-user',
            credential: 'gen-pass',
          },
        ],
      }),
    );
    const ice = new IceService(
      loadConfig({ ...base, CLOUDFLARE_TURN_KEY_ID: 'key1', CLOUDFLARE_TURN_API_TOKEN: 'tok' }),
      log,
      fetchImpl as unknown as typeof fetch,
    );
    const servers = await ice.servers();
    expect(servers[1]).toEqual({
      urls: [
        'turn:turn.cloudflare.com:3478?transport=udp',
        'turns:turn.cloudflare.com:443?transport=tcp',
      ],
      username: 'gen-user',
      credential: 'gen-pass',
    });
    await ice.servers();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://rtc.live.cloudflare.com/v1/turn/keys/key1/credentials/generate-ice-servers',
    );
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });

  it('a failing Cloudflare API falls back to the rest instead of breaking voice', async () => {
    const ice = new IceService(
      loadConfig({ ...base, CLOUDFLARE_TURN_KEY_ID: 'k', CLOUDFLARE_TURN_API_TOKEN: 't' }),
      log,
      (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch,
    );
    expect(await ice.servers()).toEqual([{ urls: ['stun:stun.cloudflare.com:3478'] }]);
  });

  it('GET /voice/ice-servers needs a session and is not cached', async () => {
    expect((await req(app, 'GET', '/api/voice/ice-servers')).statusCode).toBe(401);
    const res = await req(app, 'GET', '/api/voice/ice-servers', { cookie: alice.cookie });
    expect(res.json().iceServers[0].urls).toEqual(['stun:stun.cloudflare.com:3478']);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
