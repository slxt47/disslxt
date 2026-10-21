import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PushPayload } from '@disslxt/shared';
import { loadConfig } from '../src/config.js';
import { MemoryPushSender } from '../src/lib/push.js';
import { mentionedNames } from '../src/services/push.service.js';
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
  TEST_DATABASE_URL,
  wsReady,
  type TestSocket,
  type TestUser,
} from './helpers.js';

const VAPID = {
  publicKey: 'BPub',
  privateKey: 'priv',
  subject: 'mailto:test@example.com',
  transport: 'webpush' as const,
};
const endpoint = (n: string) => `https://fcm.googleapis.com/fcm/send/${n}`;
const keys = { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) };

let app: FastifyInstance;
let sender: MemoryPushSender;
let alice: TestUser;
let bob: TestUser;
let carol: TestUser;
let guildId: string;
let generalId: string;
const sockets: TestSocket[] = [];

async function subscribe(user: TestUser, id: string) {
  const res = await req(app, 'POST', '/api/push/subscriptions', {
    cookie: user.cookie,
    payload: { endpoint: endpoint(id), keys },
  });
  expect(res.statusCode).toBe(201);
}

/** Pushes delivered so far, keyed by endpoint id. */
async function delivered(): Promise<{ to: string; payload: PushPayload }[]> {
  await app.services.push.idle();
  return sender.sent.map((s) => ({
    to: s.endpoint.split('/').at(-1)!,
    payload: s.payload as PushPayload,
  }));
}

beforeEach(async () => {
  await resetDb();
  sender = new MemoryPushSender();
  app = await buildTestApp({ push: VAPID }, { pushSender: sender });
  alice = await registerUser(app, { username: 'alice' });
  bob = await registerUser(app, { username: 'bob' });
  carol = await registerUser(app, { username: 'carol' });
  const g = await createGuild(app, alice, 'Push Club');
  guildId = g.guild.id;
  generalId = g.general.id;
  await joinGuild(app, bob, g.guild.inviteCode);
  await joinGuild(app, carol, g.guild.inviteCode);
  await subscribe(alice, 'alice');
  await subscribe(bob, 'bob');
  await subscribe(carol, 'carol');
  await app.services.push.idle();
  sender.sent.length = 0; // drop the "member joined" pushes of the setup
});
afterEach(async () => {
  for (const s of sockets.splice(0)) s.ws.terminate();
  await app?.close();
});
afterAll(closeDb);

describe('configuration', () => {
  it('GET /push/config exposes the public key and the muted guilds', async () => {
    const res = await req(app, 'GET', '/api/push/config', { cookie: bob.cookie });
    expect(res.json()).toEqual({ enabled: true, publicKey: 'BPub', mutedGuildIds: [] });
  });

  it('push is disabled without VAPID keys, and nothing is sent', async () => {
    await app.close();
    app = await buildTestApp({ push: null }, { pushSender: sender });
    const res = await req(app, 'GET', '/api/push/config', { cookie: bob.cookie });
    expect(res.json()).toMatchObject({ enabled: false, publicKey: null });
    await sendMessage(app, alice, generalId, 'Hallo');
    expect(await delivered()).toEqual([]);
  });

  it('the memory transport is refused in production', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: TEST_DATABASE_URL,
        PUSH_TRANSPORT: 'memory',
        MAIL_TRANSPORT: 'smtp',
        SMTP_HOST: 'h',
        SMTP_USER: 'u',
        SMTP_PASS: 'p',
        MAIL_FROM: 'f@example.com',
        PUBLIC_URL: 'https://x.example',
      }),
    ).toThrow(/PUSH_TRANSPORT=webpush/);
  });

  it('only one of the two VAPID keys is a configuration error', () => {
    expect(() => loadConfig({ DATABASE_URL: TEST_DATABASE_URL, VAPID_PUBLIC_KEY: 'x' })).toThrow(
      /VAPID/,
    );
  });

  it('requires a session', async () => {
    expect((await req(app, 'GET', '/api/push/config')).statusCode).toBe(401);
  });
});

describe('subscriptions', () => {
  it('rejects endpoints that are not a browser push service (no requests to arbitrary hosts)', async () => {
    for (const bad of [
      'https://evil.example/push',
      'http://fcm.googleapis.com/fcm/send/x',
      'https://fcm.googleapis.com:8443/x',
      'https://user@fcm.googleapis.com/x',
      'https://fcm.googleapis.com.evil.example/x',
      'https://127.0.0.1/x',
    ]) {
      const res = await req(app, 'POST', '/api/push/subscriptions', {
        cookie: bob.cookie,
        payload: { endpoint: bad, keys },
      });
      expect(res.statusCode, bad).toBe(400);
    }
    for (const good of [
      'https://web.push.apple.com/QGx',
      'https://updates.push.services.mozilla.com/wpush/v2/x',
      'https://wns2-par02p.notify.windows.com/w/?token=x',
    ]) {
      const res = await req(app, 'POST', '/api/push/subscriptions', {
        cookie: bob.cookie,
        payload: { endpoint: good, keys },
      });
      expect(res.statusCode, good).toBe(201);
    }
  });

  it('the same browser re-subscribing under another account moves the subscription', async () => {
    await req(app, 'POST', '/api/push/subscriptions', {
      cookie: carol.cookie,
      payload: { endpoint: endpoint('bob'), keys },
    });
    await sendMessage(app, alice, generalId, 'für wen?');
    const to = (await delivered()).map((d) => d.to).sort();
    expect(to).toEqual(['bob', 'carol']); // both endpoints now belong to carol
    const bobGets = await req(app, 'POST', '/api/push/test', { cookie: bob.cookie });
    expect(bobGets.json()).toEqual({ delivered: 0 });
  });

  it('unsubscribe removes only the own subscription', async () => {
    await req(app, 'DELETE', '/api/push/subscriptions', {
      cookie: carol.cookie,
      payload: { endpoint: endpoint('bob') },
    });
    await req(app, 'DELETE', '/api/push/subscriptions', {
      cookie: bob.cookie,
      payload: { endpoint: endpoint('carol') },
    });
    await sendMessage(app, alice, generalId, 'x');
    expect((await delivered()).map((d) => d.to).sort()).toEqual(['bob', 'carol']);

    const res = await req(app, 'DELETE', '/api/push/subscriptions', {
      cookie: bob.cookie,
      payload: { endpoint: endpoint('bob') },
    });
    expect(res.statusCode).toBe(204);
    sender.sent.length = 0;
    await sendMessage(app, alice, generalId, 'y');
    expect((await delivered()).map((d) => d.to)).toEqual(['carol']);
  });

  it('subscriptions the push service reports as gone (404/410) are deleted', async () => {
    sender.failWith.set(endpoint('bob'), 410);
    sender.failWith.set(endpoint('carol'), 404);
    await sendMessage(app, alice, generalId, 'weg?');
    await delivered();
    sender.failWith.clear();
    await sendMessage(app, alice, generalId, 'noch da?');
    expect(await delivered()).toEqual([]);
  });

  it('a temporary push-service error keeps the subscription', async () => {
    sender.failWith.set(endpoint('bob'), 503);
    await sendMessage(app, alice, generalId, 'eins');
    await delivered();
    sender.failWith.clear();
    sender.sent.length = 0;
    await sendMessage(app, alice, generalId, 'zwei');
    expect((await delivered()).map((d) => d.to).sort()).toEqual(['bob', 'carol']);
  });

  it('POST /push/test reaches all own devices', async () => {
    await req(app, 'POST', '/api/push/subscriptions', {
      cookie: bob.cookie,
      payload: { endpoint: endpoint('bob-phone'), keys },
    });
    const res = await req(app, 'POST', '/api/push/test', { cookie: bob.cookie });
    expect(res.json()).toEqual({ delivered: 2 });
  });
});

describe('new messages', () => {
  it('notify every other member, not the author, with channel, guild, preview and link', async () => {
    await sendMessage(app, alice, generalId, 'Treffen um 18 Uhr?');
    const got = await delivered();
    expect(got.map((d) => d.to).sort()).toEqual(['bob', 'carol']);
    expect(got[0]!.payload).toEqual({
      title: '#general · Push Club',
      body: 'alice: Treffen um 18 Uhr?',
      url: `/guilds/${guildId}/channels/${generalId}`,
      tag: `channel-${generalId}`,
    });
  });

  it('long messages are shortened in the preview', async () => {
    await sendMessage(app, alice, generalId, 'x'.repeat(500));
    const body = (await delivered())[0]!.payload.body;
    expect([...body].length).toBeLessThanOrEqual(140);
    expect(body.endsWith('…')).toBe(true);
  });

  it('members looking at the channel in a visible tab get no push; a hidden tab does', async () => {
    const host = await listen(app);
    const bobTab = await wsReady(host, bob.cookie);
    const carolTab = await wsReady(host, carol.cookie);
    sockets.push(bobTab, carolTab);
    await bobTab.subscribe(generalId);
    await carolTab.subscribe(generalId);
    carolTab.send({ type: 'visibility', data: { visible: false } });
    await carolTab.subscribe(generalId); // round-trip so the visibility frame is processed

    await sendMessage(app, alice, generalId, 'live');
    expect((await delivered()).map((d) => d.to)).toEqual(['carol']);
  });

  it('a muted guild sends no message pushes, but @mentions still come through', async () => {
    const mute = await req(app, 'PUT', `/api/guilds/${guildId}/notifications`, {
      cookie: bob.cookie,
      payload: { muted: true },
    });
    expect(mute.json()).toEqual({ muted: true });
    const cfg = await req(app, 'GET', '/api/push/config', { cookie: bob.cookie });
    expect(cfg.json().mutedGuildIds).toEqual([guildId]);

    await sendMessage(app, alice, generalId, 'an alle');
    expect((await delivered()).map((d) => d.to)).toEqual(['carol']);

    sender.sent.length = 0;
    await sendMessage(app, alice, generalId, 'Hey @Bob, schau mal');
    const got = await delivered();
    const toBob = got.find((d) => d.to === 'bob')!;
    expect(toBob.payload.title).toBe('alice hat dich erwähnt');
    expect(toBob.payload.body).toBe('#general: Hey @Bob, schau mal');
    expect(got.find((d) => d.to === 'carol')!.payload.title).toBe('#general · Push Club');

    await req(app, 'PUT', `/api/guilds/${guildId}/notifications`, {
      cookie: bob.cookie,
      payload: { muted: false },
    });
    sender.sent.length = 0;
    await sendMessage(app, alice, generalId, 'wieder laut');
    expect((await delivered()).map((d) => d.to).sort()).toEqual(['bob', 'carol']);
  });

  it('muting needs membership', async () => {
    const outsider = await registerUser(app, { username: 'dave' });
    const res = await req(app, 'PUT', `/api/guilds/${guildId}/notifications`, {
      cookie: outsider.cookie,
      payload: { muted: true },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('important events', () => {
  it('the owner is told when someone joins via invite', async () => {
    const g = await createGuild(app, bob, 'Bobs Ecke');
    await joinGuild(app, carol, g.guild.inviteCode);
    const got = await delivered();
    expect(got).toEqual([
      {
        to: 'bob',
        payload: {
          title: 'Bobs Ecke',
          body: 'carol ist dem Server beigetreten.',
          url: `/guilds/${g.guild.id}`,
          tag: `members-${g.guild.id}`,
        },
      },
    ]);
  });
});

describe('mentionedNames', () => {
  it('finds @names, ignores e-mail addresses and partial names', () => {
    expect([...mentionedNames('@alice hi @Bob_2, mail me at x@carol.de or @@dave')]).toEqual([
      'alice',
      'bob_2',
    ]);
  });
});
