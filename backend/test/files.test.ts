import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FILE_MAX_BYTES } from '@disslxt/shared';
import { contentDisposition, sanitizeFileName, sniffImage } from '../src/lib/files.js';
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

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(200, 1),
]);
const PDF = Buffer.from('%PDF-1.7\n' + 'x'.repeat(300));

let app: FastifyInstance;
let dir: string;
let alice: TestUser;
let bob: TestUser;
let eve: TestUser;
let channelId: string;
let guildId: string;
const sockets: TestSocket[] = [];

const upload = (user: TestUser, body: Buffer, name = 'bild.png', target = channelId) =>
  app.inject({
    method: 'POST',
    url: `/api/channels/${target}/files?name=${encodeURIComponent(name)}`,
    headers: { cookie: user.cookie, 'content-type': 'application/octet-stream' },
    payload: body,
  });

beforeEach(async () => {
  await resetDb();
  dir = await mkdtemp(join(tmpdir(), 'disslxt-files-'));
  app = await buildTestApp({ files: { dir } });
  alice = await registerUser(app, { username: 'alice' });
  bob = await registerUser(app, { username: 'bob' });
  eve = await registerUser(app, { username: 'eve' });
  const g = await createGuild(app, alice, 'Dateien');
  channelId = g.general.id;
  guildId = g.guild.id;
  await joinGuild(app, bob, g.guild.inviteCode);
});
afterEach(async () => {
  for (const s of sockets.splice(0)) s.ws.terminate();
  await app?.close();
  await rm(dir, { recursive: true, force: true });
});
afterAll(closeDb);

describe('sharing files', () => {
  it('an image becomes a file message, live for the others, shown inline', async () => {
    const host = await listen(app);
    const tab = await wsReady(host, bob.cookie);
    sockets.push(tab);
    await tab.subscribe(channelId);

    const res = await upload(alice, PNG, 'Urlaub Strand.png');
    expect(res.statusCode).toBe(201);
    const { message } = res.json();
    expect(message).toMatchObject({
      kind: 'file',
      content: '',
      audio: null,
      file: {
        url: `/api/files/${message.id}`,
        name: 'Urlaub Strand.png',
        size: PNG.length,
        isImage: true,
      },
    });
    expect((await tab.waitFor('message.created')).data.message).toEqual(message);

    const get = await req(app, 'GET', message.file.url, { cookie: bob.cookie });
    expect(get.statusCode).toBe(200);
    expect(get.headers['content-type']).toBe('image/png');
    expect(get.headers['content-disposition']).toMatch(/^inline; filename="Urlaub Strand.png"/);
    expect(get.rawPayload.equals(PNG)).toBe(true);
  });

  it('anything that is not a real image is only ever a download (no HTML/SVG on our origin)', async () => {
    const cases: [string, Buffer][] = [
      ['seite.html', Buffer.from('<html><script>alert(document.cookie)</script></html>')],
      ['bild.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')],
      ['fake.png', Buffer.from('<script>alert(1)</script>'.padEnd(100, ' '))],
      ['bericht.pdf', PDF],
    ];
    for (const [name, body] of cases) {
      const { message } = (await upload(alice, body, name)).json();
      expect(message.file.isImage, name).toBe(false);
      const get = await req(app, 'GET', message.file.url, { cookie: bob.cookie });
      expect(get.headers['content-type'], name).toBe('application/octet-stream');
      expect(get.headers['content-disposition'], name).toMatch(/^attachment;/);
      expect(get.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
      expect(get.headers['x-content-type-options']).toBe('nosniff');
    }
  });

  it('file names are cleaned: no paths, no hidden direction tricks', async () => {
    const tricky = await upload(alice, PDF, '../../etc/rechnung\u202Efdp.exe');
    expect(tricky.json().message.file.name).toBe('rechnungfdp.exe');
    const unnamed = await upload(alice, PDF, '');
    expect(unnamed.json().message.file.name).toBe('datei');
  });

  it('only members can download; guests need a session', async () => {
    const url = (await upload(alice, PNG)).json().message.file.url;
    expect((await req(app, 'GET', url, { cookie: eve.cookie })).statusCode).toBe(403);
    expect((await req(app, 'GET', url)).statusCode).toBe(401);
    expect((await upload(eve, PNG)).statusCode).toBe(403);
  });

  it('limits: 25 MB, not empty, octet-stream only, guests turned away before reading', async () => {
    const big = Buffer.alloc(FILE_MAX_BYTES + 1);
    expect((await upload(alice, big)).statusCode).toBe(413);
    expect((await upload(alice, Buffer.alloc(0))).statusCode).toBe(400);
    const json = await app.inject({
      method: 'POST',
      url: `/api/channels/${channelId}/files?name=a.json`,
      headers: { cookie: alice.cookie, 'content-type': 'application/json' },
      payload: '{"a":1}',
    });
    expect(json.statusCode).toBe(400);
    const guest = await app.inject({
      method: 'POST',
      url: `/api/channels/${channelId}/files`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: big,
    });
    expect(guest.statusCode).toBe(401);
    expect(await readdir(dir)).toEqual([]);
  });

  it('range requests work (resumable downloads)', async () => {
    const url = (await upload(alice, PDF, 'a.pdf')).json().message.file.url;
    const part = await req(app, 'GET', url, {
      cookie: bob.cookie,
      headers: { range: 'bytes=0-3' },
    });
    expect(part.statusCode).toBe(206);
    expect(part.rawPayload.toString()).toBe('%PDF');
  });

  it('cannot be edited; deleting the message or the server removes the file', async () => {
    const m1 = (await upload(alice, PNG)).json().message;
    const m2 = (await upload(bob, PDF, 'b.pdf')).json().message;
    expect(await readdir(dir)).toHaveLength(2);
    const edit = await req(app, 'PATCH', `/api/messages/${m1.id}`, {
      cookie: alice.cookie,
      payload: { content: 'Text' },
    });
    expect(edit.statusCode).toBe(400);
    await req(app, 'DELETE', `/api/messages/${m1.id}`, { cookie: alice.cookie });
    expect(await readdir(dir)).toHaveLength(1);
    expect(m2.file.isImage).toBe(false);
    await req(app, 'DELETE', `/api/guilds/${guildId}`, {
      cookie: alice.cookie,
      payload: { name: 'Dateien' },
    });
    expect(await readdir(dir)).toEqual([]);
  });
});

describe('helpers', () => {
  it('sniffImage knows PNG, JPEG, GIF, WebP and nothing else', () => {
    expect(sniffImage(PNG)).toBe('image/png');
    expect(
      sniffImage(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)])),
    ).toBe('image/jpeg');
    expect(sniffImage(Buffer.from('GIF89a......'))).toBe('image/gif');
    expect(
      sniffImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])),
    ).toBe('image/webp');
    expect(sniffImage(Buffer.from('<svg xmlns="..."></svg>'))).toBeNull();
  });

  it('sanitizeFileName keeps the extension when shortening', () => {
    const long = sanitizeFileName(`${'a'.repeat(300)}.tar.gz`);
    expect([...long].length).toBe(200);
    expect(long.endsWith('.gz')).toBe(true);
    expect(sanitizeFileName('..hidden')).toBe('hidden');
    expect(sanitizeFileName('C:\\Users\\x\\Bild.jpg')).toBe('Bild.jpg');
  });

  it('contentDisposition has an ASCII fallback and the UTF-8 name', () => {
    expect(contentDisposition('Grüße "x".pdf', false)).toBe(
      `attachment; filename="Gr__e _x_.pdf"; filename*=UTF-8''Gr%C3%BC%C3%9Fe%20%22x%22.pdf`,
    );
  });
});
