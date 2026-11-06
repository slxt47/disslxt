import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { channels } from '../src/db/schema.js';
import { cleanTranscript } from '../src/lib/whisper.js';
import { firstUrl, parseMeta } from '../src/lib/linkMeta.js';
import { allowedUrl, isPublicAddress, safeGet } from '../src/lib/safeFetch.js';
import type { FetchedPage } from '../src/lib/safeFetch.js';
import {
  buildTestApp,
  closeDb,
  createGuild,
  getDb,
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

let app: FastifyInstance;
let alice: TestUser;
let bob: TestUser;
let carol: TestUser;
let guildId: string;
let general: string;
const sockets: TestSocket[] = [];
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
let pages: Record<string, FetchedPage | null>;
const fetched: string[] = [];
const fetcher = vi.fn(async (url: string) => {
  fetched.push(url);
  return pages[url] ?? null;
});
const html = (url: string, head: string): FetchedPage => ({
  url,
  contentType: 'text/html; charset=utf-8',
  body: Buffer.from(`<html><head>${head}</head><body>x</body></html>`),
});
let uploadDir: string;

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
const api = (u: TestUser, method: Method, path: string, payload?: object) =>
  req(app, method, `/api${path}`, { cookie: u.cookie, ...(payload ? { payload } : {}) });
const say = async (u: TestUser, cid: string, content: string) =>
  (await sendMessage(app, u, cid, content)).json().message as { id: string };
const find = async (u: TestUser, query: string) => {
  const res = await api(u, 'GET', `/search?${query}`);
  expect(res.statusCode).toBe(200);
  return res.json().results as {
    message: { id: string; content: string; linkPreview: unknown };
    channelName: string;
    guildName: string | null;
  }[];
};

beforeEach(async () => {
  await resetDb();
  pages = {};
  fetched.length = 0;
  fetcher.mockClear();
  uploadDir = await mkdtemp(join(tmpdir(), 'disslxt-previews-'));
  app = await buildTestApp(
    { linkPreviews: { enabled: true, dir: uploadDir } },
    { linkFetcher: fetcher },
  );
  alice = await registerUser(app, { username: 'alice' });
  bob = await registerUser(app, { username: 'bob' });
  carol = await registerUser(app, { username: 'carol' });
  const g = await createGuild(app, alice);
  guildId = g.guild.id;
  general = g.general.id;
  await joinGuild(app, bob, g.guild.inviteCode);
});
afterEach(async () => {
  for (const s of sockets.splice(0)) s.ws.terminate();
  await app.close();
  await rm(uploadDir, { recursive: true, force: true });
});
afterAll(closeDb);

describe('search', () => {
  it('finds words, also the start of a word, in any case, newest first', async () => {
    await say(alice, general, 'Die Katze schläft');
    await say(bob, general, 'katzenfutter kaufen');
    await say(bob, general, 'nichts davon');
    const hits = await find(alice, 'q=katz');
    expect(hits.map((h) => h.message.content)).toEqual([
      'katzenfutter kaufen',
      'Die Katze schläft',
    ]);
    expect(hits[0]).toMatchObject({ channelName: 'general', guildName: 'Test Server' });
    expect(await find(alice, 'q=kaufen+katz')).toHaveLength(1);
    expect(await find(alice, 'q=schl%C3%A4ft')).toHaveLength(1);
  });

  it('shows only what you may read', async () => {
    await say(alice, general, 'geheimwort im server');
    expect(await find(carol, 'q=geheimwort')).toEqual([]);
    expect(await find(bob, 'q=geheimwort')).toHaveLength(1);
    const hidden = (
      await api(alice, 'POST', `/guilds/${guildId}/channels`, { name: 'team', kind: 'text' })
    ).json().channel.id as string;
    await api(alice, 'PUT', `/channels/${hidden}/access`, { restricted: true, roleIds: [] });
    await say(alice, hidden, 'verstecktwort');
    expect(await find(bob, 'q=verstecktwort')).toEqual([]);
    expect(await find(alice, 'q=verstecktwort')).toHaveLength(1);
    expect(await find(bob, `q=verstecktwort&channelId=${hidden}`)).toEqual([]);
    expect(await find(bob, `q=geheimwort&guildId=${guildId}`)).toHaveLength(1);
  });

  it('after leaving a server its messages are gone from the search', async () => {
    await say(alice, general, 'abschiedswort');
    await api(bob, 'POST', `/guilds/${guildId}/leave`);
    expect(await find(bob, 'q=abschiedswort')).toEqual([]);
  });

  it('filters by person, place and date, and pages on', async () => {
    await say(alice, general, 'wort eins');
    const b = await say(bob, general, 'wort zwei');
    expect((await find(alice, `q=wort&authorId=${bob.user.id}`)).map((h) => h.message.id)).toEqual([
      b.id,
    ]);
    expect(await find(alice, 'q=wort&after=2999-01-01')).toEqual([]);
    expect(await find(alice, 'q=wort&until=2000-01-01')).toEqual([]);
    expect(await find(alice, 'q=wort&privateOnly=true')).toEqual([]);
    expect(await find(alice, `q=wort&beforeId=${b.id}`)).toHaveLength(1);
  });

  it.each(["'; drop table messages; --", 'a & b | !c', ':*:* (', '<->'])(
    'survives query syntax: %s',
    async (q) => {
      await say(alice, general, 'hallo');
      const res = await api(alice, 'GET', `/search?q=${encodeURIComponent(q)}`);
      expect(res.statusCode).toBe(200);
    },
  );

  it('needs a login and two characters', async () => {
    expect((await req(app, 'GET', '/api/search?q=hallo')).statusCode).toBe(401);
    expect((await api(alice, 'GET', '/search?q=a')).statusCode).toBe(400);
  });
});

describe('which addresses may be fetched', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.17.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '::127.0.0.1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'ff02::1',
    '64:ff9b::7f00:1',
    '2002:7f00:1::',
    '2001:db8::1',
    'nonsense',
  ])('refuses %s', (ip) => expect(isPublicAddress(ip)).toBe(false));

  it.each(['1.1.1.1', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111', '::ffff:1.1.1.1'])(
    'allows %s',
    (ip) => expect(isPublicAddress(ip)).toBe(true),
  );

  it.each([
    'http://127.0.0.1/',
    'http://[::1]/',
    'http://2130706433/',
    'http://0x7f.0.0.1/',
    'http://localhost/',
    'http://foo.localhost/',
    'http://db:5432/',
    'https://example.com:8443/',
    'ftp://example.com/',
    'file:///etc/passwd',
    'http://user:pw@example.com/',
    'http://169.254.169.254/latest/meta-data/',
  ])('refuses the URL %s', (url) => expect(allowedUrl(url)).toBeNull());

  it('a real request to this machine fails, also by name', async () => {
    const host = await listen(app);
    const port = new URL(`http://${host}`).port;
    expect(await safeGet(`http://127.0.0.1:${port}/api/health`, 1000)).toBeNull();
    expect(await safeGet('http://localhost/', 1000)).toBeNull();
  });
});

describe('reading a page', () => {
  it('takes Open Graph first, falls back to title and description', () => {
    const page = 'https://a.de/x';
    expect(
      parseMeta(
        `<head><title>Titel</title><meta property="og:title" content="OG &amp; Mehr">
        <meta name="description" content='Text'><meta property="og:image" content="/bild.png">
        <meta property="og:site_name" content="Seite"></head>`,
        page,
      ),
    ).toEqual({
      title: 'OG & Mehr',
      description: 'Text',
      siteName: 'Seite',
      imageUrl: 'https://a.de/bild.png',
    });
    expect(parseMeta('<title>Nur Titel</title>', page).title).toBe('Nur Titel');
  });

  it('no script survives as anything but text; bad image links are dropped', () => {
    const meta = parseMeta(
      `<head><title><script>alert(1)</script></title>
       <meta property="og:image" content="javascript:alert(1)"></head>`,
      'https://a.de',
    );
    expect(meta.imageUrl).toBeNull();
    expect(meta.title).toBe('<script>alert(1)</script>');
  });

  it('finds the first link, not in code, not in angle brackets', () => {
    expect(firstUrl('siehe https://a.de/x. und https://b.de')).toBe('https://a.de/x');
    expect(firstUrl('`https://a.de` und ```\nhttps://b.de\n```')).toBeNull();
    expect(firstUrl('<https://a.de> kein Bild')).toBeNull();
    expect(firstUrl('keine Links')).toBeNull();
  });
});

describe('link previews', () => {
  const URL_A = 'https://example.com/seite';

  it('arrives live after the message, with a copied picture', async () => {
    pages[URL_A] = html(
      URL_A,
      '<title>Beispiel</title><meta property="og:image" content="https://example.com/b.png">',
    );
    pages['https://example.com/b.png'] = { url: 'x', contentType: 'image/png', body: PNG };
    const host = await listen(app);
    const ws = await wsReady(host, bob.cookie);
    sockets.push(ws);
    await ws.subscribe(general);
    const m = await say(alice, general, `schau: ${URL_A}`);
    const ev = await ws.waitFor('message.updated');
    expect(ev.data.message).toMatchObject({
      id: m.id,
      linkPreview: { title: 'Beispiel', url: URL_A },
    });
    const imageUrl = ev.data.message.linkPreview?.imageUrl ?? '';
    expect(imageUrl).toMatch(/^\/api\/link-images\//);
    const image = await req(app, 'GET', imageUrl, { cookie: bob.cookie });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toBe('image/png');
    expect((await req(app, 'GET', imageUrl)).statusCode).toBe(401);
    expect(await readdir(uploadDir)).toHaveLength(1);
  });

  it('a picture that is none is not kept', async () => {
    pages[URL_A] = html(
      URL_A,
      '<title>T</title><meta property="og:image" content="https://example.com/b.svg">',
    );
    pages['https://example.com/b.svg'] = {
      url: 'x',
      contentType: 'image/svg+xml',
      body: Buffer.from('<svg onload="alert(1)"/>'),
    };
    await say(alice, general, URL_A);
    await app.services.linkPreviews.settled();
    expect(await readdir(uploadDir)).toEqual([]);
    const [m] = (await api(alice, 'GET', `/channels/${general}/messages`))
      .json()
      .messages.slice(-1);
    expect(m.linkPreview).toMatchObject({ title: 'T', imageUrl: null });
  });

  it('is fetched once for the same link', async () => {
    pages[URL_A] = html(URL_A, '<title>T</title>');
    await say(alice, general, URL_A);
    await app.services.linkPreviews.settled();
    await say(bob, general, URL_A);
    await app.services.linkPreviews.settled();
    expect(fetched.filter((u) => u === URL_A)).toHaveLength(1);
  });

  it('pages without anything to show, and failures, stay without preview', async () => {
    await say(alice, general, 'https://example.com/404');
    await app.services.linkPreviews.settled();
    const list = (await api(alice, 'GET', `/channels/${general}/messages`)).json().messages;
    expect(list.at(-1).linkPreview).toBeNull();
  });

  it('the author can take it away for good; others cannot', async () => {
    pages[URL_A] = html(URL_A, '<title>T</title>');
    const m = await say(alice, general, URL_A);
    await app.services.linkPreviews.settled();
    expect((await api(bob, 'POST', `/messages/${m.id}/hide-preview`, {})).statusCode).toBe(403);
    const res = await api(alice, 'POST', `/messages/${m.id}/hide-preview`, {});
    expect(res.json().message.linkPreview).toBeNull();
    await api(alice, 'PATCH', `/messages/${m.id}`, { content: `${URL_A} geändert` });
    await app.services.linkPreviews.settled();
    const list = (await api(alice, 'GET', `/channels/${general}/messages`)).json().messages;
    expect(list.at(-1).linkPreview).toBeNull();
  });

  it('editing the link replaces the preview', async () => {
    pages[URL_A] = html(URL_A, '<title>Alt</title>');
    pages['https://example.com/neu'] = html('https://example.com/neu', '<title>Neu</title>');
    const m = await say(alice, general, URL_A);
    await app.services.linkPreviews.settled();
    await api(alice, 'PATCH', `/messages/${m.id}`, { content: 'https://example.com/neu' });
    await app.services.linkPreviews.settled();
    const list = (await api(alice, 'GET', `/channels/${general}/messages`)).json().messages;
    expect(list.at(-1).linkPreview.title).toBe('Neu');
  });

  it('switched off, nothing is fetched', async () => {
    const off = await buildTestApp({}, { linkFetcher: fetcher });
    const u = await registerUser(off, { username: 'dave' });
    const { general: g } = await createGuild(off, u);
    await sendMessage(off, u, g.id, URL_A);
    expect(fetcher).not.toHaveBeenCalled();
    await off.close();
  });
});

describe('voice messages written down', () => {
  const audio = { key: 'k.m4a', mime: 'audio/mp4', durationMs: 1000 };
  const channelOf = async () => {
    const [channel] = await getDb().db.select().from(channels).where(eq(channels.id, general));
    return channel!;
  };

  it('cleans what Whisper invents for silence', () => {
    expect(cleanTranscript(' Hallo [Musik] zusammen (lacht) ')).toBe('Hallo zusammen');
    expect(cleanTranscript('[MUSIK]')).toBe('');
    expect(cleanTranscript('Untertitel der Amara.org-Community')).toBe('org-Community');
  });

  it('the text arrives live, can be found, and goes with the message', async () => {
    const seen: string[] = [];
    const voiceApp = await buildTestApp(
      {},
      {
        transcriber: async (path) => {
          seen.push(path);
          return ' Treffen wir uns um acht ';
        },
      },
    );
    const a = await registerUser(voiceApp, { username: 'dora' });
    const made = await createGuild(voiceApp, a);
    const host = await listen(voiceApp);
    const ws = await wsReady(host, a.cookie);
    sockets.push(ws);
    await ws.subscribe(made.general.id);
    const [channel] = await getDb()
      .db.select()
      .from(channels)
      .where(eq(channels.id, made.general.id));
    const created = await voiceApp.services.messages.createVoice(a.user, channel!, audio);
    expect(created.content).toBe('');
    const ev = await ws.waitFor('message.updated');
    expect(ev.data.message).toMatchObject({ id: created.id, content: 'Treffen wir uns um acht' });
    expect(seen[0]).toContain('k.m4a');
    const res = await req(voiceApp, 'GET', '/api/search?q=treffen', { cookie: a.cookie });
    expect(res.json().results[0].message.kind).toBe('voice');
    await voiceApp.close();
  });

  it('a failure leaves the message as it is, and the next one still works', async () => {
    let calls = 0;
    const voiceApp = await buildTestApp(
      {},
      {
        transcriber: async () => {
          calls += 1;
          if (calls === 1) throw new Error('kaputt');
          return 'geht wieder';
        },
      },
    );
    const a = await registerUser(voiceApp, { username: 'erik' });
    const made = await createGuild(voiceApp, a);
    const [channel] = await getDb()
      .db.select()
      .from(channels)
      .where(eq(channels.id, made.general.id));
    const one = await voiceApp.services.messages.createVoice(a.user, channel!, audio);
    const two = await voiceApp.services.messages.createVoice(a.user, channel!, audio);
    await voiceApp.services.transcripts.settled();
    const list = (
      await req(voiceApp, 'GET', `/api/channels/${made.general.id}/messages`, { cookie: a.cookie })
    ).json().messages as { id: string; content: string }[];
    expect(list.find((m) => m.id === one.id)?.content).toBe('');
    expect(list.find((m) => m.id === two.id)?.content).toBe('geht wieder');
    await voiceApp.close();
  });

  it('without a transcriber nothing happens', async () => {
    await app.services.messages.createVoice(alice.user, await channelOf(), audio);
    await app.services.transcripts.settled();
    const list = (await api(alice, 'GET', `/channels/${general}/messages`)).json().messages;
    expect(list.at(-1).content).toBe('');
  });
});
