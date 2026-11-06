import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PINS_PER_CHANNEL_MAX } from '@disslxt/shared';
import { guilds, messages } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
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
  sleep,
  wsReady,
  type TestSocket,
  type TestUser,
} from './helpers.js';

let app: FastifyInstance;
let alice: TestUser;
let bob: TestUser;
let carol: TestUser;
let channelId: string;
let guildId: string;
let inviteCode: string;
const sockets: TestSocket[] = [];

beforeEach(async () => {
  await resetDb();
  app = await buildTestApp();
  alice = await registerUser(app, { username: 'alice' });
  bob = await registerUser(app, { username: 'bob' });
  carol = await registerUser(app, { username: 'carol' });
  const { guild, general } = await createGuild(app, alice);
  channelId = general.id;
  guildId = guild.id;
  inviteCode = guild.inviteCode;
  await joinGuild(app, bob, inviteCode);
});
afterEach(async () => {
  for (const s of sockets.splice(0)) s.ws.terminate();
  await app.close();
});
afterAll(closeDb);

const say = async (u: TestUser, cid: string, content: string) =>
  (await sendMessage(app, u, cid, content)).json().message as { id: string };
const post = (u: TestUser, path: string, payload?: object) =>
  req(app, 'POST', `/api${path}`, { cookie: u.cookie, payload: payload ?? {} });
const history = async (u: TestUser, cid = channelId) =>
  (await req(app, 'GET', `/api/channels/${cid}/messages`, { cookie: u.cookie })).json()
    .messages as {
    id: string;
    kind: string;
    content: string;
    author: { username: string };
    reactions: { emoji: string; count: number; userIds: string[] }[];
    replyTo: { id: string; excerpt: string; author: { username: string } } | null;
    pinnedAt: string | null;
  }[];
const unread = async (u: TestUser) =>
  (await req(app, 'GET', '/api/unread', { cookie: u.cookie })).json().unread as {
    channelId: string;
    guildId: string | null;
    count: number;
    mentions: number;
    lastReadId: string;
  }[];

describe('reactions', () => {
  it('adds, counts per person, removes with the second click and lists them', async () => {
    const m = await say(alice, channelId, 'hi');
    expect((await post(bob, `/messages/${m.id}/reactions`, { emoji: '👍' })).statusCode).toBe(200);
    await post(alice, `/messages/${m.id}/reactions`, { emoji: '👍' });
    await post(alice, `/messages/${m.id}/reactions`, { emoji: '🎉' });
    let got = (await history(bob)).find((x) => x.id === m.id)!;
    expect(got.reactions.map((r) => [r.emoji, r.count])).toEqual([
      ['👍', 2],
      ['🎉', 1],
    ]);
    expect(got.reactions[0]!.userIds).toEqual([bob.user.id, alice.user.id]);
    await post(bob, `/messages/${m.id}/reactions`, { emoji: '👍' });
    got = (await history(bob)).find((x) => x.id === m.id)!;
    expect(got.reactions[0]).toMatchObject({ emoji: '👍', count: 1 });
  });

  it.each(['abc', '<b>', '', '👍abc', '😀'.repeat(17)])('rejects %s', async (emoji) => {
    const m = await say(alice, channelId, 'hi');
    expect((await post(bob, `/messages/${m.id}/reactions`, { emoji })).statusCode).toBe(400);
  });

  it.each(['❤️', '👍🏽', '🇦🇹', '1️⃣', '👨‍👩‍👧'])('accepts %s', async (emoji) => {
    const m = await say(alice, channelId, 'hi');
    expect((await post(bob, `/messages/${m.id}/reactions`, { emoji })).statusCode).toBe(200);
  });

  it('needs access to the channel', async () => {
    const m = await say(alice, channelId, 'hi');
    expect((await post(carol, `/messages/${m.id}/reactions`, { emoji: '👍' })).statusCode).toBe(
      403,
    );
  });

  it('stops at 20 different emoji, an existing one still works', async () => {
    const m = await say(alice, channelId, 'hi');
    const emoji = [...'😀😁😂🤣😃😄😅😆😉😊😋😎😍😘🥰😗😙😚🙂🤗'];
    for (const e of emoji) await post(bob, `/messages/${m.id}/reactions`, { emoji: e });
    expect((await post(bob, `/messages/${m.id}/reactions`, { emoji: '🤔' })).statusCode).toBe(400);
    expect((await post(alice, `/messages/${m.id}/reactions`, { emoji: '😀' })).statusCode).toBe(
      200,
    );
  });

  it('goes live to readers of the channel', async () => {
    const host = await listen(app);
    const ws = await wsReady(host, bob.cookie);
    sockets.push(ws);
    ws.send({ type: 'subscribe', data: { channelId } });
    await ws.waitFor('subscribed');
    const m = await say(alice, channelId, 'hi');
    await post(alice, `/messages/${m.id}/reactions`, { emoji: '🔥' });
    const ev = await ws.waitFor('message.reactions');
    expect(ev.data).toMatchObject({ id: m.id, reactions: [{ emoji: '🔥', count: 1 }] });
  });
});

describe('answers', () => {
  it('quotes the message and survives its deletion', async () => {
    const m = await say(alice, channelId, 'die Frage');
    const res = await post(bob, `/channels/${channelId}/messages`, {
      content: 'die Antwort',
      replyToId: m.id,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().message.replyTo).toMatchObject({
      id: m.id,
      excerpt: 'die Frage',
      author: { username: 'alice' },
    });
    expect((await history(alice)).at(-1)?.replyTo?.excerpt).toBe('die Frage');
    await req(app, 'DELETE', `/api/messages/${m.id}`, { cookie: alice.cookie });
    const last = (await history(alice)).at(-1)!;
    expect(last.content).toBe('die Antwort');
    expect(last.replyTo).toBeNull();
  });

  it('cannot answer a message of another channel', async () => {
    const other = await createGuild(app, carol, 'Anderer');
    const m = await say(carol, other.general.id, 'geheim');
    const res = await post(bob, `/channels/${channelId}/messages`, {
      content: 'x',
      replyToId: m.id,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('pins', () => {
  it('owner pins and unpins, members see the list, others may not pin', async () => {
    const m = await say(bob, channelId, 'wichtig');
    expect((await post(bob, `/messages/${m.id}/pin`, { pinned: true })).statusCode).toBe(403);
    const res = await post(alice, `/messages/${m.id}/pin`, { pinned: true });
    expect(res.json().message.pinnedAt).not.toBeNull();
    const list = await req(app, 'GET', `/api/channels/${channelId}/pins`, { cookie: bob.cookie });
    expect(list.json().messages.map((x: { id: string }) => x.id)).toEqual([m.id]);
    await post(alice, `/messages/${m.id}/pin`, { pinned: false });
    const after = await req(app, 'GET', `/api/channels/${channelId}/pins`, { cookie: bob.cookie });
    expect(after.json().messages).toEqual([]);
  });

  it('non-members cannot read pins; the limit holds', async () => {
    const list = await req(app, 'GET', `/api/channels/${channelId}/pins`, { cookie: carol.cookie });
    expect(list.statusCode).toBe(403);
    await getDb()
      .db.insert(messages)
      .values(
        Array.from({ length: PINS_PER_CHANNEL_MAX }, (_, i) => ({
          channelId,
          authorId: alice.user.id,
          content: `p${i}`,
          pinnedAt: new Date(),
        })),
      );
    const m = await say(alice, channelId, 'eine zu viel');
    expect((await post(alice, `/messages/${m.id}/pin`, { pinned: true })).statusCode).toBe(400);
  });
});

describe('unread', () => {
  it('counts per channel, finds mentions and answers, resets on read', async () => {
    const q = await say(bob, channelId, 'Frage von bob');
    await say(alice, channelId, 'hallo');
    await say(alice, channelId, 'hey @Bob schau mal');
    await say(alice, channelId, 'nicht @bobby');
    await post(alice, `/channels/${channelId}/messages`, { content: 'antwort', replyToId: q.id });
    const [u] = await unread(bob);
    expect(u).toMatchObject({ channelId, guildId, count: 4, mentions: 2 });
    expect(await unread(alice)).toMatchObject([{ channelId, count: 1, mentions: 0 }]);
    const last = (await history(bob)).at(-1)!;
    expect(
      (await post(bob, `/channels/${channelId}/read`, { messageId: last.id })).statusCode,
    ).toBe(204);
    expect(await unread(bob)).toEqual([]);
  });

  it('never moves back and cannot read ahead', async () => {
    const a = await say(alice, channelId, 'eins');
    const b = await say(alice, channelId, 'zwei');
    await post(bob, `/channels/${channelId}/read`, { messageId: b.id });
    await post(bob, `/channels/${channelId}/read`, { messageId: a.id });
    expect(await unread(bob)).toEqual([]);
    await post(bob, `/channels/${channelId}/read`, { messageId: '999999999' });
    await say(alice, channelId, 'drei');
    expect(await unread(bob)).toMatchObject([{ count: 1 }]);
  });

  it('a new member does not inherit the old history', async () => {
    await say(alice, channelId, 'alt');
    await joinGuild(app, carol, inviteCode);
    expect(await unread(carol)).toEqual([]);
    await say(alice, channelId, 'neu');
    expect(await unread(carol)).toMatchObject([{ count: 1 }]);
  });

  it('greetings do not count, and the other device hears about reading', async () => {
    const host = await listen(app);
    const ws = await wsReady(host, bob.cookie);
    sockets.push(ws);
    await post(bob, `/channels/${channelId}/read`, {
      messageId: (await say(alice, channelId, 'hallo')).id,
    });
    await ws.waitFor('channel.read');
    await post(carol, `/invites/${inviteCode}/join`);
    expect((await history(bob)).at(-1)?.kind).toBe('join');
    expect(await unread(bob)).toEqual([]);
  });

  it('non-members cannot mark a channel as read', async () => {
    expect((await post(carol, `/channels/${channelId}/read`, { messageId: '1' })).statusCode).toBe(
      403,
    );
  });

  it('tells the whole server about activity, with mentions', async () => {
    const host = await listen(app);
    const ws = await wsReady(host, bob.cookie);
    sockets.push(ws);
    await say(alice, channelId, 'hey @bob');
    const ev = await ws.waitFor('channel.activity');
    expect(ev.data).toMatchObject({ channelId, guildId, mentions: ['bob'] });
  });
});

describe('typing', () => {
  it('reaches the others in the channel, not the writer, and is limited', async () => {
    const host = await listen(app);
    const [a, b] = await Promise.all([wsReady(host, alice.cookie), wsReady(host, bob.cookie)]);
    sockets.push(a, b);
    for (const s of [a, b]) {
      s.send({ type: 'subscribe', data: { channelId } });
      await s.waitFor('subscribed');
    }
    a.send({ type: 'typing', data: { channelId } });
    a.send({ type: 'typing', data: { channelId } });
    const ev = await b.waitFor('typing');
    expect(ev.data).toMatchObject({ channelId, userId: alice.user.id, name: 'alice' });
    await sleep(100);
    expect(b.ofType('typing')).toHaveLength(1);
    expect(a.ofType('typing')).toHaveLength(0);
  });

  it('is ignored for a channel the socket does not read', async () => {
    const host = await listen(app);
    const [a, c] = await Promise.all([wsReady(host, carol.cookie), wsReady(host, bob.cookie)]);
    sockets.push(a, c);
    c.send({ type: 'subscribe', data: { channelId } });
    await c.waitFor('subscribed');
    a.send({ type: 'typing', data: { channelId } });
    await sleep(100);
    expect(c.ofType('typing')).toHaveLength(0);
  });
});

describe('greeting', () => {
  it('posts a join message once, which cannot be edited or reacted to', async () => {
    await post(carol, `/invites/${inviteCode}/join`);
    await post(carol, `/invites/${inviteCode}/join`);
    const joins = (await history(alice)).filter((m) => m.kind === 'join');
    expect(joins.map((m) => m.author.username)).toEqual(['carol']);
    const m = joins[0]!;
    expect((await post(alice, `/messages/${m.id}/reactions`, { emoji: '👍' })).statusCode).toBe(
      400,
    );
    const edit = await req(app, 'PATCH', `/api/messages/${m.id}`, {
      cookie: carol.cookie,
      payload: { content: 'x' },
    });
    expect(edit.statusCode).toBe(400);
  });
});

describe('invite links', () => {
  const set = (u: TestUser, body: object) => post(u, `/guilds/${guildId}/invite`, body);

  it('only the owner changes it', async () => {
    const res = await set(bob, { expiresInHours: 1, maxUses: 1 });
    expect(res.statusCode).toBe(403);
  });

  it('stops after max uses', async () => {
    const res = await set(alice, { expiresInHours: null, maxUses: 1 });
    expect(res.json().guild).toMatchObject({ inviteMaxUses: 1, inviteUses: 0 });
    await joinGuild(app, carol, inviteCode);
    const dave = await registerUser(app, { username: 'dave' });
    const preview = await req(app, 'GET', `/api/invites/${inviteCode}`, { cookie: dave.cookie });
    expect(preview.statusCode).toBe(404);
    const join = await post(dave, `/invites/${inviteCode}/join`);
    expect(join.statusCode).toBe(404);
    expect(join.json().error.code).toBe('INVITE_NOT_FOUND');
    expect((await post(carol, `/invites/${inviteCode}/join`)).statusCode).toBe(200);
  });

  it('counts each person once, also when joining again', async () => {
    await set(alice, { expiresInHours: null, maxUses: 2 });
    await joinGuild(app, carol, inviteCode);
    await joinGuild(app, carol, inviteCode);
    const g = await req(app, 'GET', `/api/guilds/${guildId}`, { cookie: alice.cookie });
    expect(g.json().guild.inviteUses).toBe(1);
  });

  it('expires', async () => {
    await set(alice, { expiresInHours: 1, maxUses: null });
    await getDb()
      .db.update(guilds)
      .set({ inviteExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(guilds.id, guildId));
    expect((await post(carol, `/invites/${inviteCode}/join`)).statusCode).toBe(404);
  });

  it('a new link replaces the old one', async () => {
    const res = await set(alice, { expiresInHours: null, maxUses: null, regenerate: true });
    const code = res.json().guild.inviteCode as string;
    expect(code).not.toBe(inviteCode);
    expect((await post(carol, `/invites/${inviteCode}/join`)).statusCode).toBe(404);
    expect((await post(carol, `/invites/${code}/join`)).statusCode).toBe(200);
  });
});

describe('polls', () => {
  const create = (u: TestUser, body: object) => post(u, `/channels/${channelId}/polls`, body);
  const body = { question: 'Pizza?', options: ['Ja', 'Nein', 'Vielleicht'] };

  it('one vote per person; another answer moves it, the same takes it back', async () => {
    const res = await create(alice, body);
    expect(res.statusCode).toBe(201);
    const id = res.json().message.id as string;
    expect(res.json().message).toMatchObject({ kind: 'poll', content: 'Pizza?' });
    await post(bob, `/messages/${id}/vote`, { option: 0 });
    const moved = await post(bob, `/messages/${id}/vote`, { option: 1 });
    expect(moved.json().poll.options.map((o: { userIds: string[] }) => o.userIds.length)).toEqual([
      0, 1, 0,
    ]);
    const back = await post(bob, `/messages/${id}/vote`, { option: 1 });
    expect(back.json().poll.options[1].userIds).toEqual([]);
  });

  it('with several answers allowed, votes add up', async () => {
    const id = (await create(alice, { ...body, multiple: true })).json().message.id as string;
    await post(bob, `/messages/${id}/vote`, { option: 0 });
    const res = await post(bob, `/messages/${id}/vote`, { option: 2 });
    expect(res.json().poll.options[0].userIds).toEqual([bob.user.id]);
    expect(res.json().poll.options[2].userIds).toEqual([bob.user.id]);
  });

  it('shows in the history, goes live, and only readers can vote', async () => {
    const host = await listen(app);
    const ws = await wsReady(host, alice.cookie);
    sockets.push(ws);
    await ws.subscribe(channelId);
    const id = (await create(alice, body)).json().message.id as string;
    await post(bob, `/messages/${id}/vote`, { option: 2 });
    const ev = await ws.waitFor('message.poll');
    expect(ev.data.poll.options[2]?.userIds).toEqual([bob.user.id]);
    expect((await post(carol, `/messages/${id}/vote`, { option: 0 })).statusCode).toBe(403);
    expect((await history(bob)).at(-1)?.kind).toBe('poll');
  });

  it('refuses bad input: an answer that does not exist, too few, not a poll', async () => {
    expect((await create(alice, { question: 'x', options: ['a'] })).statusCode).toBe(400);
    const id = (await create(alice, body)).json().message.id as string;
    expect((await post(bob, `/messages/${id}/vote`, { option: 3 })).statusCode).toBe(404);
    const m = await say(alice, channelId, 'kein Poll');
    expect((await post(bob, `/messages/${m.id}/vote`, { option: 0 })).statusCode).toBe(404);
  });

  it('cannot be edited, deleting takes the votes along', async () => {
    const id = (await create(alice, body)).json().message.id as string;
    await post(bob, `/messages/${id}/vote`, { option: 0 });
    const edit = await req(app, 'PATCH', `/api/messages/${id}`, {
      cookie: alice.cookie,
      payload: { content: 'x' },
    });
    expect(edit.statusCode).toBe(400);
    expect(
      (await req(app, 'DELETE', `/api/messages/${id}`, { cookie: alice.cookie })).statusCode,
    ).toBe(204);
  });
});

describe('for later', () => {
  const inMinutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();
  const plan = (u: TestUser, body: object) => post(u, `/channels/${channelId}/scheduled`, body);

  it('sends when due, not before, and only once', async () => {
    const res = await plan(alice, { kind: 'send', content: 'später', sendAt: inMinutes(5) });
    expect(res.statusCode).toBe(201);
    await app.services.schedule.tick();
    expect((await history(bob)).some((m) => m.content === 'später')).toBe(false);
    const later = new Date(Date.now() + 6 * 60_000);
    await app.services.schedule.tick(later);
    await app.services.schedule.tick(later);
    expect((await history(bob)).filter((m) => m.content === 'später')).toHaveLength(1);
  });

  it('a reminder stays private and arrives live', async () => {
    const host = await listen(app);
    const ws = await wsReady(host, alice.cookie);
    sockets.push(ws);
    await plan(alice, { kind: 'remind', content: 'Tee', sendAt: inMinutes(1) });
    await app.services.schedule.tick(new Date(Date.now() + 2 * 60_000));
    const ev = await ws.waitFor('reminder');
    expect(ev.data.text).toBe('Tee');
    expect((await history(alice)).some((m) => m.content === 'Tee')).toBe(false);
  });

  it('own list, cancel, no access to others', async () => {
    await plan(alice, { kind: 'send', content: 'x', sendAt: inMinutes(5) });
    const list = (await req(app, 'GET', '/api/scheduled', { cookie: alice.cookie })).json()
      .scheduled;
    expect(list).toHaveLength(1);
    expect(
      (await req(app, 'GET', '/api/scheduled', { cookie: bob.cookie })).json().scheduled,
    ).toEqual([]);
    const id = list[0].id as string;
    expect(
      (await req(app, 'DELETE', `/api/scheduled/${id}`, { cookie: bob.cookie })).statusCode,
    ).toBe(404);
    expect(
      (await req(app, 'DELETE', `/api/scheduled/${id}`, { cookie: alice.cookie })).statusCode,
    ).toBe(204);
  });

  it('refuses the past and foreign channels; lost access means nothing is sent', async () => {
    const past = new Date(Date.now() - 3_600_000).toISOString();
    expect((await plan(alice, { kind: 'send', content: 'x', sendAt: past })).statusCode).toBe(400);
    expect(
      (await plan(carol, { kind: 'send', content: 'x', sendAt: inMinutes(5) })).statusCode,
    ).toBe(403);
    await plan(bob, { kind: 'send', content: 'nach Austritt', sendAt: inMinutes(1) });
    await post(bob, `/guilds/${guildId}/leave`);
    await app.services.schedule.tick(new Date(Date.now() + 2 * 60_000));
    expect((await history(alice)).some((m) => m.content === 'nach Austritt')).toBe(false);
  });
});

describe('events', () => {
  const inHours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();
  const create = (u = alice) =>
    post(u, `/channels/${channelId}/events`, { title: 'Spieleabend', startsAt: inHours(1) });

  it('answers count per person, change, and can be taken back', async () => {
    const res = await create();
    expect(res.json().message).toMatchObject({ kind: 'event', content: 'Spieleabend' });
    const id = res.json().message.id as string;
    await post(bob, `/messages/${id}/rsvp`, { answer: 'yes' });
    const moved = await post(bob, `/messages/${id}/rsvp`, { answer: 'maybe' });
    expect(moved.json().event).toMatchObject({ yes: [], maybe: [bob.user.id] });
    const back = await post(bob, `/messages/${id}/rsvp`, { answer: null });
    expect(back.json().event.maybe).toEqual([]);
  });

  it('only readers answer; past dates are refused; not on other messages', async () => {
    const id = (await create()).json().message.id as string;
    expect((await post(carol, `/messages/${id}/rsvp`, { answer: 'yes' })).statusCode).toBe(403);
    const past = await post(alice, `/channels/${channelId}/events`, {
      title: 'x',
      startsAt: inHours(-2),
    });
    expect(past.statusCode).toBe(400);
    const m = await say(alice, channelId, 'hallo');
    expect((await post(bob, `/messages/${m.id}/rsvp`, { answer: 'yes' })).statusCode).toBe(404);
  });

  it('goes live and reminds only once', async () => {
    const host = await listen(app);
    const ws = await wsReady(host, alice.cookie);
    sockets.push(ws);
    await ws.subscribe(channelId);
    const id = (await create()).json().message.id as string;
    await post(bob, `/messages/${id}/rsvp`, { answer: 'yes' });
    expect((await ws.waitFor('message.event')).data.event.yes).toEqual([bob.user.id]);
    const notify = vi.spyOn(app.services.push, 'notify');
    const soon = new Date(Date.now() + 50 * 60_000);
    await app.services.schedule.tick(soon);
    await app.services.schedule.tick(soon);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]?.[0]).toEqual([bob.user.id]);
  });
});
