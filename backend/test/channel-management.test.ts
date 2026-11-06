import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CATEGORIES_PER_GUILD_MAX } from '@disslxt/shared';
import { messages } from '../src/db/schema.js';
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
let owner: TestUser;
let member: TestUser;
let outsider: TestUser;
let guildId: string;
let general: string;
const sockets: TestSocket[] = [];

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
const api = (u: TestUser, method: Method, path: string, payload?: object) =>
  req(app, method, `/api${path}`, { cookie: u.cookie, ...(payload ? { payload } : {}) });
const newChannel = async (name: string, kind = 'text', u = owner) =>
  (await api(u, 'POST', `/guilds/${guildId}/channels`, { name, kind })).json().channel as {
    id: string;
  };
const channelList = async (u = owner) =>
  (await api(u, 'GET', `/guilds/${guildId}/channels`)).json().channels as {
    id: string;
    name: string;
    description: string | null;
    categoryId: string | null;
  }[];
const newCategory = async (name: string) =>
  (await api(owner, 'POST', `/guilds/${guildId}/categories`, { name })).json().category as {
    id: string;
  };
const giveManage = async (u: TestUser) => {
  const role = (
    await api(owner, 'POST', `/guilds/${guildId}/roles`, {
      name: 'Kanäle',
      color: null,
      permissions: ['manage_channels'],
    })
  ).json().role as { id: string };
  await api(owner, 'PUT', `/guilds/${guildId}/members/${u.user.id}/roles`, { roleIds: [role.id] });
  return role;
};

beforeEach(async () => {
  await resetDb();
  app = await buildTestApp();
  owner = await registerUser(app, { username: 'owner' });
  member = await registerUser(app, { username: 'member' });
  outsider = await registerUser(app, { username: 'outsider' });
  const created = await createGuild(app, owner);
  guildId = created.guild.id;
  general = created.general.id;
  await joinGuild(app, member, created.guild.inviteCode);
});
afterEach(async () => {
  for (const s of sockets.splice(0)) s.ws.terminate();
  await app.close();
});
afterAll(closeDb);

describe('editing a channel', () => {
  it('renames and describes; empty description clears it', async () => {
    const res = await api(owner, 'PATCH', `/channels/${general}`, {
      name: 'Off Topic',
      description: 'Alles andere',
    });
    expect(res.json().channel).toMatchObject({ name: 'off-topic', description: 'Alles andere' });
    const clear = await api(owner, 'PATCH', `/channels/${general}`, { description: '' });
    expect(clear.json().channel.description).toBeNull();
  });

  it('refuses a taken name and a bad one', async () => {
    await newChannel('zwei');
    const taken = await api(owner, 'PATCH', `/channels/${general}`, { name: 'zwei' });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error.code).toBe('CHANNEL_EXISTS');
    expect((await api(owner, 'PATCH', `/channels/${general}`, { name: 'äöü' })).statusCode).toBe(
      400,
    );
  });

  it('needs manage_channels', async () => {
    const body = { name: 'neu' };
    expect((await api(member, 'PATCH', `/channels/${general}`, body)).statusCode).toBe(403);
    await giveManage(member);
    expect((await api(member, 'PATCH', `/channels/${general}`, body)).statusCode).toBe(200);
  });

  it('non-members and hidden channels get nothing', async () => {
    expect((await api(outsider, 'PATCH', `/channels/${general}`, { name: 'x' })).statusCode).toBe(
      403,
    );
    const hidden = await newChannel('geheim');
    await api(owner, 'PUT', `/channels/${hidden.id}/access`, { restricted: true, roleIds: [] });
    await giveManage(member);
    expect((await api(member, 'PATCH', `/channels/${hidden.id}`, { name: 'x' })).statusCode).toBe(
      404,
    );
    expect(
      (await api(member, 'DELETE', `/channels/${hidden.id}`, { name: 'geheim' })).statusCode,
    ).toBe(404);
  });

  it('a private conversation is not a server channel', async () => {
    const res = await api(owner, 'PATCH', `/channels/00000000-0000-4000-8000-000000000000`, {
      name: 'x',
    });
    expect(res.statusCode).toBe(404);
  });

  it('tells the server, without names', async () => {
    const host = await listen(app);
    const ws = await wsReady(host, member.cookie);
    sockets.push(ws);
    await api(owner, 'PATCH', `/channels/${general}`, { name: 'neu' });
    const ev = await ws.waitFor('guild.channels-changed');
    expect(ev.data).toEqual({ guildId });
  });
});

describe('deleting a channel', () => {
  it('needs the exact name; takes messages and files', async () => {
    const c = await newChannel('weg');
    await sendMessage(app, owner, c.id, 'x');
    await getDb().db.insert(messages).values({
      channelId: c.id,
      authorId: owner.user.id,
      kind: 'file',
      content: '',
      fileKey: 'test-datei',
      fileName: 'a.txt',
      fileSize: 1,
      fileMime: 'text/plain',
    });
    expect((await api(owner, 'DELETE', `/channels/${c.id}`, { name: 'falsch' })).statusCode).toBe(
      400,
    );
    expect((await api(owner, 'DELETE', `/channels/${c.id}`, { name: 'weg' })).statusCode).toBe(204);
    expect((await channelList()).map((x) => x.name)).toEqual(['general']);
    expect((await api(owner, 'GET', `/channels/${c.id}/messages`)).statusCode).toBe(404);
    const left = await getDb().db.select().from(messages);
    expect(left.filter((m) => m.channelId === c.id)).toEqual([]);
  });

  it('the last open text channel stays; a voice channel never blocks', async () => {
    const voice = await newChannel('stimme', 'voice');
    const last = await api(owner, 'DELETE', `/channels/${general}`, { name: 'general' });
    expect(last.statusCode).toBe(400);
    expect(
      (await api(owner, 'DELETE', `/channels/${voice.id}`, { name: 'stimme' })).statusCode,
    ).toBe(204);
    const hidden = await newChannel('nur-team');
    await api(owner, 'PUT', `/channels/${hidden.id}/access`, { restricted: true, roleIds: [] });
    expect(
      (await api(owner, 'DELETE', `/channels/${general}`, { name: 'general' })).statusCode,
    ).toBe(400);
  });

  it('readers and people in the call are out at once', async () => {
    const text = await newChannel('text');
    const voice = await newChannel('stimme', 'voice');
    const host = await listen(app);
    const [a, b] = await Promise.all([wsReady(host, member.cookie), wsReady(host, owner.cookie)]);
    sockets.push(a, b);
    await a.subscribe(text.id);
    b.send({ type: 'voice.join', data: { channelId: voice.id } });
    await b.waitFor('voice.joined');
    await api(owner, 'DELETE', `/channels/${text.id}`, { name: 'text' });
    await a.waitFor('unsubscribed', (e) => e.data.channelId === text.id);
    await api(owner, 'DELETE', `/channels/${voice.id}`, { name: 'stimme' });
    await b.waitFor('voice.left');
    await a.waitFor('guild.channels-changed');
  });

  it('needs manage_channels', async () => {
    const c = await newChannel('weg');
    expect((await api(member, 'DELETE', `/channels/${c.id}`, { name: 'weg' })).statusCode).toBe(
      403,
    );
  });
});

describe('order and categories', () => {
  it('sorts by order; the first channel can change, greetings follow', async () => {
    const a = await newChannel('a');
    const b = await newChannel('b');
    const res = await api(owner, 'PUT', `/guilds/${guildId}/channels/order`, {
      channels: [
        { id: b.id, categoryId: null },
        { id: general, categoryId: null },
        { id: a.id, categoryId: null },
      ],
    });
    expect(res.statusCode).toBe(204);
    expect((await channelList(member)).map((c) => c.name)).toEqual(['b', 'general', 'a']);
    await api(outsider, 'GET', `/guilds/${guildId}/channels`);
    const code = (await api(owner, 'GET', `/guilds/${guildId}`)).json().guild.inviteCode;
    await api(outsider, 'POST', `/invites/${code}/join`, {});
    const greeted = (await api(owner, 'GET', `/channels/${b.id}/messages`)).json().messages;
    expect(greeted.map((m: { kind: string }) => m.kind)).toEqual(['join']);
  });

  it('new channels go to the end', async () => {
    await newChannel('b');
    await newChannel('a');
    expect((await channelList()).map((c) => c.name)).toEqual(['general', 'b', 'a']);
  });

  it('puts channels into categories; deleting one keeps its channels', async () => {
    const cat = await newCategory('Spiele');
    await api(owner, 'PATCH', `/channels/${general}`, { categoryId: cat.id });
    expect((await channelList())[0]?.categoryId).toBe(cat.id);
    await api(owner, 'DELETE', `/guilds/${guildId}/categories/${cat.id}`);
    expect((await channelList())[0]?.categoryId).toBeNull();
  });

  it('renames, sorts, refuses doubles and the limit holds', async () => {
    const a = await newCategory('A');
    const b = await newCategory('B');
    const dup = await api(owner, 'POST', `/guilds/${guildId}/categories`, { name: 'A' });
    expect(dup.statusCode).toBe(409);
    await api(owner, 'PATCH', `/guilds/${guildId}/categories/${a.id}`, { name: 'Erste' });
    await api(owner, 'PUT', `/guilds/${guildId}/categories/order`, { categoryIds: [b.id, a.id] });
    const list = (await api(member, 'GET', `/guilds/${guildId}/categories`)).json().categories;
    expect(list.map((c: { name: string }) => c.name)).toEqual(['B', 'Erste']);
    const part = await api(owner, 'PUT', `/guilds/${guildId}/categories/order`, {
      categoryIds: [a.id],
    });
    expect(part.statusCode).toBe(400);
    for (let i = 2; i < CATEGORIES_PER_GUILD_MAX; i += 1) await newCategory(`c${i}`);
    const over = await api(owner, 'POST', `/guilds/${guildId}/categories`, { name: 'zu viel' });
    expect(over.statusCode).toBe(400);
  });

  it('a category of another server is refused', async () => {
    const other = await createGuild(app, outsider, 'Fremd');
    const foreign = (
      await api(outsider, 'POST', `/guilds/${other.guild.id}/categories`, { name: 'F' })
    ).json().category.id as string;
    expect(
      (await api(owner, 'PATCH', `/channels/${general}`, { categoryId: foreign })).statusCode,
    ).toBe(404);
    const order = await api(owner, 'PUT', `/guilds/${guildId}/channels/order`, {
      channels: [{ id: general, categoryId: foreign }],
    });
    expect(order.statusCode).toBe(404);
    expect(
      (await api(owner, 'DELETE', `/guilds/${guildId}/categories/${foreign}`)).statusCode,
    ).toBe(404);
  });

  it('managing needs the right, reading does not', async () => {
    const cat = await newCategory('A');
    expect((await api(member, 'GET', `/guilds/${guildId}/categories`)).statusCode).toBe(200);
    expect((await api(outsider, 'GET', `/guilds/${guildId}/categories`)).statusCode).toBe(403);
    for (const [m, p, b] of [
      ['POST', `/guilds/${guildId}/categories`, { name: 'B' }],
      ['PATCH', `/guilds/${guildId}/categories/${cat.id}`, { name: 'B' }],
      ['DELETE', `/guilds/${guildId}/categories/${cat.id}`],
      ['PUT', `/guilds/${guildId}/categories/order`, { categoryIds: [cat.id] }],
      ['PUT', `/guilds/${guildId}/channels/order`, { channels: [] }],
    ] as const) {
      expect((await api(member, m, p, b)).statusCode, p).toBe(403);
    }
  });

  it('sorting with a hidden channel: it cannot be named, and it stays', async () => {
    const hidden = await newChannel('geheim');
    await api(owner, 'PUT', `/channels/${hidden.id}/access`, { restricted: true, roleIds: [] });
    await giveManage(member);
    const named = await api(member, 'PUT', `/guilds/${guildId}/channels/order`, {
      channels: [{ id: hidden.id, categoryId: null }],
    });
    expect(named.statusCode).toBe(404);
    const fine = await api(member, 'PUT', `/guilds/${guildId}/channels/order`, {
      channels: [{ id: general, categoryId: null }],
    });
    expect(fine.statusCode).toBe(204);
    expect((await channelList()).map((c) => c.name)).toContain('geheim');
  });
});
