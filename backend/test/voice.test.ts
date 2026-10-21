import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VOICE_MAX_BYTES } from '@disslxt/shared';
import { MemoryPushSender } from '../src/lib/push.js';
import { PassthroughTranscoder, sniffAudio, type Transcoder } from '../src/lib/voice.js';
import { parseRange } from '../src/routes/voice.routes.js';
import {
  buildTestApp,
  closeDb,
  createGuild,
  joinGuild,
  listen,
  registerUser,
  req,
  resetDb,
  wsReady,
  type TestSocket,
  type TestUser,
} from './helpers.js';

/** Minimal byte prefixes of the formats browsers record in. */
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(2000, 7)]);
const MP4 = Buffer.concat([
  Buffer.from([0, 0, 0, 0x20]),
  Buffer.from('ftypM4A '),
  Buffer.alloc(3000, 3),
]);

let app: FastifyInstance;
let dir: string;
let alice: TestUser;
let bob: TestUser;
let outsider: TestUser;
let channelId: string;
const sockets: TestSocket[] = [];

async function build(transcoder: Transcoder = new PassthroughTranscoder()) {
  app = await buildTestApp(
    { voice: { dir, transcode: 'off', ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe' } },
    { transcoder },
  );
}

function upload(
  user: TestUser,
  body: Buffer,
  type = 'audio/webm;codecs=opus',
  query = '?durationMs=4200',
  target = channelId,
) {
  return app.inject({
    method: 'POST',
    url: `/api/channels/${target}/voice-messages${query}`,
    headers: { cookie: user.cookie, 'content-type': type },
    payload: body,
  });
}

beforeEach(async () => {
  await resetDb();
  dir = await mkdtemp(join(tmpdir(), 'disslxt-voice-'));
  await build();
  alice = await registerUser(app, { username: 'alice' });
  bob = await registerUser(app, { username: 'bob' });
  outsider = await registerUser(app, { username: 'eve' });
  const g = await createGuild(app, alice, 'Voice');
  channelId = g.general.id;
  await joinGuild(app, bob, g.guild.inviteCode);
});
afterEach(async () => {
  for (const s of sockets.splice(0)) s.ws.terminate();
  await app?.close();
  await rm(dir, { recursive: true, force: true });
});
afterAll(closeDb);

describe('upload', () => {
  it('stores the recording and creates a voice message (also live over WebSocket)', async () => {
    const host = await listen(app);
    const bobTab = await wsReady(host, bob.cookie);
    sockets.push(bobTab);
    await bobTab.subscribe(channelId);

    const res = await upload(alice, WEBM);
    expect(res.statusCode).toBe(201);
    const { message } = res.json();
    expect(message).toMatchObject({
      channelId,
      kind: 'voice',
      content: '',
      author: { username: 'alice' },
      audio: { url: `/api/voice-messages/${message.id}`, durationMs: 4200, mime: 'audio/webm' },
    });
    expect(await readdir(dir)).toHaveLength(1);
    const evt = await bobTab.waitFor('message.created');
    expect(evt.data.message).toEqual(message);

    // Shows up in the history like any other message.
    const page = await req(app, 'GET', `/api/channels/${channelId}/messages`, {
      cookie: bob.cookie,
    });
    expect(page.json().messages).toEqual([message]);
  });

  it('Safari recordings (MP4/AAC) are accepted too', async () => {
    const res = await upload(alice, MP4, 'audio/mp4');
    expect(res.statusCode).toBe(201);
    expect(res.json().message.audio.mime).toBe('audio/mp4');
  });

  it('the length is capped at 2 minutes whatever the client says', async () => {
    const res = await upload(alice, WEBM, 'audio/webm', '?durationMs=99999999');
    expect(res.json().message.audio.durationMs).toBe(120_000);
  });

  it('rejects non-audio content even with an audio Content-Type (magic bytes decide)', async () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>'.padEnd(200, ' '));
    const res = await upload(alice, html, 'audio/webm');
    expect(res.statusCode).toBe(415);
    expect(res.json().error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(await readdir(dir)).toEqual([]);
  });

  it('rejects other content types, empty and oversized bodies', async () => {
    expect((await upload(alice, WEBM, 'video/webm')).statusCode).toBe(415);
    expect((await upload(alice, WEBM, 'audio/x-flac')).statusCode).toBe(415);
    expect((await upload(alice, Buffer.alloc(0))).statusCode).toBe(400);
    const big = Buffer.concat([WEBM, Buffer.alloc(VOICE_MAX_BYTES)]);
    expect((await upload(alice, big)).statusCode).toBe(413);
    expect(await readdir(dir)).toEqual([]);
  });

  it('needs a session and guild membership', async () => {
    const anon = await app.inject({
      method: 'POST',
      url: `/api/channels/${channelId}/voice-messages`,
      headers: { 'content-type': 'audio/webm' },
      payload: WEBM,
    });
    expect(anon.statusCode).toBe(401);
    expect((await upload(outsider, WEBM)).statusCode).toBe(403);
    expect(await readdir(dir)).toEqual([]);
  });

  it('cross-site uploads are blocked by the origin check', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/channels/${channelId}/voice-messages`,
      headers: {
        cookie: alice.cookie,
        'content-type': 'audio/webm',
        origin: 'https://evil.example',
      },
      payload: WEBM,
    });
    expect(res.statusCode).toBe(403);
  });

  it('a recording ffmpeg cannot decode is a 415, and nothing is left behind', async () => {
    await app.close();
    await build({
      store: () => Promise.reject(Object.assign(new Error('x'), { stderr: 'Invalid data found' })),
    });
    alice = await registerUser(app, { username: 'alice2' });
    const g = await createGuild(app, alice, 'V2');
    const res = await upload(alice, WEBM, 'audio/webm', '', g.general.id);
    expect(res.statusCode).toBe(415);
  });

  it('pushes announce a voice message instead of an empty preview', async () => {
    await app.close();
    const sender = new MemoryPushSender();
    app = await buildTestApp(
      {
        voice: { dir, transcode: 'off', ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe' },
        push: {
          publicKey: 'k',
          privateKey: 'p',
          subject: 'mailto:x@example.com',
          transport: 'webpush',
        },
      },
      { transcoder: new PassthroughTranscoder(), pushSender: sender },
    );
    const a = await registerUser(app, { username: 'alice3' });
    const b = await registerUser(app, { username: 'bob3' });
    const g = await createGuild(app, a, 'V3');
    await joinGuild(app, b, g.guild.inviteCode);
    await req(app, 'POST', '/api/push/subscriptions', {
      cookie: b.cookie,
      payload: {
        endpoint: 'https://fcm.googleapis.com/fcm/send/b3',
        keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) },
      },
    });
    await upload(a, WEBM, 'audio/webm', '', g.general.id);
    await app.services.push.idle();
    expect(sender.sent.map((s) => (s.payload as { body: string }).body)).toContain(
      'alice3: 🎤 Sprachnachricht',
    );
  });
});

describe('playback', () => {
  let url: string;
  beforeEach(async () => {
    url = (await upload(alice, WEBM)).json().message.audio.url;
  });

  it('members get the file with type, length and range support', async () => {
    const res = await req(app, 'GET', url, { cookie: bob.cookie });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('audio/webm');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-length']).toBe(String(WEBM.length));
    expect(res.headers['cache-control']).toBe('private, max-age=86400');
    expect(res.rawPayload.equals(WEBM)).toBe(true);
  });

  it('serves byte ranges (Safari plays audio only with them)', async () => {
    const res = await req(app, 'GET', url, { cookie: bob.cookie, headers: { range: 'bytes=0-1' } });
    expect(res.statusCode).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 0-1/${WEBM.length}`);
    expect([...res.rawPayload]).toEqual([0x1a, 0x45]);
    const tail = await req(app, 'GET', url, { cookie: bob.cookie, headers: { range: 'bytes=-3' } });
    expect(tail.rawPayload.length).toBe(3);
    const bad = await req(app, 'GET', url, {
      cookie: bob.cookie,
      headers: { range: `bytes=${WEBM.length}-` },
    });
    expect(bad.statusCode).toBe(416);
    expect(bad.headers['content-range']).toBe(`bytes */${WEBM.length}`);
  });

  it('non-members and guests cannot listen', async () => {
    expect((await req(app, 'GET', url, { cookie: outsider.cookie })).statusCode).toBe(403);
    expect((await req(app, 'GET', url)).statusCode).toBe(401);
  });

  it('text messages and unknown ids are 404', async () => {
    const text = await req(app, 'POST', `/api/channels/${channelId}/messages`, {
      cookie: alice.cookie,
      payload: { content: 'nur Text' },
    });
    const id = text.json().message.id;
    expect(
      (await req(app, 'GET', `/api/voice-messages/${id}`, { cookie: bob.cookie })).statusCode,
    ).toBe(404);
    expect(
      (await req(app, 'GET', '/api/voice-messages/999999', { cookie: bob.cookie })).statusCode,
    ).toBe(404);
    expect(
      (await req(app, 'GET', '/api/voice-messages/abc', { cookie: bob.cookie })).statusCode,
    ).toBe(404);
  });

  it('voice messages cannot be edited; deleting removes the file', async () => {
    const id = url.split('/').at(-1)!;
    const edit = await req(app, 'PATCH', `/api/messages/${id}`, {
      cookie: alice.cookie,
      payload: { content: 'Text statt Audio' },
    });
    expect(edit.statusCode).toBe(400);
    const [file] = await readdir(dir);
    expect(existsSync(join(dir, file!))).toBe(true);
    const del = await req(app, 'DELETE', `/api/messages/${id}`, { cookie: alice.cookie });
    expect(del.statusCode).toBe(204);
    expect(await readdir(dir)).toEqual([]);
    expect((await req(app, 'GET', url, { cookie: bob.cookie })).statusCode).toBe(404);
  });
});

describe('helpers', () => {
  it('sniffAudio recognises the recorder formats and nothing else', () => {
    expect(sniffAudio(WEBM)).toBe('webm');
    expect(sniffAudio(MP4)).toBe('mp4');
    expect(sniffAudio(Buffer.concat([Buffer.from('OggS'), Buffer.alloc(20)]))).toBe('ogg');
    expect(
      sniffAudio(
        Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(8)]),
      ),
    ).toBe('wav');
    expect(sniffAudio(Buffer.from('GIF89a......................'))).toBeNull();
    expect(sniffAudio(Buffer.alloc(4))).toBeNull();
  });

  it('parseRange handles open, suffix and invalid ranges', () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange('bytes=10-', 100)).toEqual({ start: 10, end: 99 });
    expect(parseRange('bytes=10-500', 100)).toEqual({ start: 10, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=50-40', 100)).toBe('unsatisfiable');
    expect(parseRange('bytes=0-1,5-6', 100)).toBeNull();
  });
});
