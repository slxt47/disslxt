import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { messages } from '../src/db/schema.js';
import {
  buildTestApp,
  closeDb,
  createGuild,
  getDb,
  joinGuild,
  registerUser,
  req,
  resetDb,
  sendMessage,
  type TestUser,
} from './helpers.js';

let app: FastifyInstance;
let alice: TestUser;
let bob: TestUser;
let channelId: string;

beforeEach(async () => {
  await resetDb();
  app = await buildTestApp();
  alice = await registerUser(app, { username: 'alice' });
  bob = await registerUser(app, { username: 'bob' });
  const { guild, general } = await createGuild(app, alice);
  channelId = general.id;
  await joinGuild(app, bob, guild.inviteCode);
});
afterEach(async () => {
  await app.close();
});
afterAll(closeDb);

const list = (u: TestUser, query = '') =>
  req(app, 'GET', `/api/channels/${channelId}/messages${query}`, { cookie: u.cookie });

/** Inserts n messages directly (fast) in order, returns their ids. */
async function seed(n: number, author = alice): Promise<string[]> {
  const rows = await getDb()
    .db.insert(messages)
    .values(
      Array.from({ length: n }, (_, i) => ({
        channelId,
        authorId: author.user.id,
        content: `msg ${i + 1}`,
      })),
    )
    .returning({ id: messages.id });
  return rows.map((r) => r.id.toString());
}

describe('POST /api/channels/:channelId/messages', () => {
  it('member sends → 201 with the message DTO (trimmed)', async () => {
    const res = await sendMessage(app, bob, channelId, '  Hallo Welt  ');
    expect(res.statusCode).toBe(201);
    const { message } = res.json();
    expect(message).toEqual({
      id: expect.stringMatching(/^\d+$/),
      channelId,
      author: { id: bob.user.id, username: 'bob' },
      kind: 'text',
      content: 'Hallo Welt',
      audio: null,
      createdAt: expect.any(String),
      editedAt: null,
    });
  });

  it('keeps inner newlines', async () => {
    const res = await sendMessage(app, alice, channelId, 'line 1\nline 2');
    expect(res.json().message.content).toBe('line 1\nline 2');
  });

  it('message ids are increasing strings', async () => {
    const a = (await sendMessage(app, alice, channelId, 'a')).json().message.id;
    const b = (await sendMessage(app, alice, channelId, 'b')).json().message.id;
    expect(BigInt(b)).toBeGreaterThan(BigInt(a));
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   \n\t '],
    ['2001 chars', 'x'.repeat(2001)],
    ['2001 emoji', '😀'.repeat(2001)],
    ['non-string', 123],
    ['NUL byte (D3)', 'a\u0000b'],
    ['escape control char (D3)', 'a\u001bb'],
  ])('%s → 400', async (_label, content) => {
    const res = await req(app, 'POST', `/api/channels/${channelId}/messages`, {
      cookie: alice.cookie,
      payload: { content },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(res.json().error.details[0].path).toBe('content');
  });

  it('missing content → 400', async () => {
    const res = await req(app, 'POST', `/api/channels/${channelId}/messages`, {
      cookie: alice.cookie,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('2000 chars is OK', async () => {
    const res = await sendMessage(app, alice, channelId, 'x'.repeat(2000));
    expect(res.statusCode).toBe(201);
    expect(res.json().message.content).toHaveLength(2000);
  });

  it('D5: 2000 emoji (4000 UTF-16 units) is OK and stored as 2000 characters', async () => {
    const res = await sendMessage(app, alice, channelId, '😀'.repeat(2000));
    expect(res.statusCode).toBe(201);
    expect([...res.json().message.content]).toHaveLength(2000);
  });

  it('unknown channel → 404, non-uuid → 404', async () => {
    const res = await req(app, 'POST', `/api/channels/${crypto.randomUUID()}/messages`, {
      cookie: alice.cookie,
      payload: { content: 'x' },
    });
    expect(res.statusCode).toBe(404);
    const bad = await req(app, 'POST', '/api/channels/abc/messages', {
      cookie: alice.cookie,
      payload: { content: 'x' },
    });
    expect(bad.statusCode).toBe(404);
  });
});

describe('GET /api/channels/:channelId/messages', () => {
  it('returns messages ascending with author info', async () => {
    await sendMessage(app, alice, channelId, 'first');
    await sendMessage(app, bob, channelId, 'second');
    const res = await list(bob);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.hasMore).toBe(false);
    expect(body.messages.map((m: { content: string }) => m.content)).toEqual(['first', 'second']);
    expect(body.messages[1].author).toEqual({ id: bob.user.id, username: 'bob' });
  });

  it('empty channel → empty page', async () => {
    expect((await list(alice)).json()).toEqual({ messages: [], hasMore: false });
  });

  it('60 messages: page 1 = 50 newest with hasMore, page 2 = 10 without, no overlap', async () => {
    const ids = await seed(60);
    const p1 = (await list(alice)).json();
    expect(p1.messages).toHaveLength(50);
    expect(p1.hasMore).toBe(true);
    expect(p1.messages.map((m: { id: string }) => m.id)).toEqual(ids.slice(10));
    expect(p1.messages[0].content).toBe('msg 11');
    expect(p1.messages[49].content).toBe('msg 60');

    const oldest = p1.messages[0].id;
    const p2 = (await list(alice, `?before=${oldest}`)).json();
    expect(p2.messages).toHaveLength(10);
    expect(p2.hasMore).toBe(false);
    expect(p2.messages.map((m: { id: string }) => m.id)).toEqual(ids.slice(0, 10));

    const all = [...p2.messages, ...p1.messages].map((m: { id: string }) => m.id);
    expect(new Set(all).size).toBe(60);
  });

  it('respects limit and exact boundary for hasMore', async () => {
    await seed(10);
    const p = (await list(alice, '?limit=10')).json();
    expect(p.messages).toHaveLength(10);
    expect(p.hasMore).toBe(false);
    const q = (await list(alice, '?limit=3')).json();
    expect(q.messages.map((m: { content: string }) => m.content)).toEqual([
      'msg 8',
      'msg 9',
      'msg 10',
    ]);
    expect(q.hasMore).toBe(true);
  });

  it('only returns messages of the requested channel', async () => {
    const other = await req(
      app,
      'POST',
      `/api/guilds/${(await createGuild(app, alice)).guild.id}/channels`,
      {
        cookie: alice.cookie,
        payload: { name: 'other' },
      },
    );
    await sendMessage(app, alice, other.json().channel.id, 'elsewhere');
    await sendMessage(app, alice, channelId, 'here');
    const res = (await list(alice)).json();
    expect(res.messages.map((m: { content: string }) => m.content)).toEqual(['here']);
  });

  it.each(['?limit=101', '?limit=0', '?limit=abc', '?before=abc', '?before=-5', '?before=0'])(
    'invalid query %s → 400',
    async (q) => {
      const res = await list(alice, q);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    },
  );

  it('limit=100 is allowed', async () => {
    expect((await list(alice, '?limit=100')).statusCode).toBe(200);
  });
});

describe('PATCH /api/messages/:messageId', () => {
  it('author edits → 200 with editedAt set', async () => {
    const id = (await sendMessage(app, alice, channelId, 'orig')).json().message.id;
    const res = await req(app, 'PATCH', `/api/messages/${id}`, {
      cookie: alice.cookie,
      payload: { content: ' edited ' },
    });
    expect(res.statusCode).toBe(200);
    const { message } = res.json();
    expect(message).toMatchObject({ id, content: 'edited', author: { id: alice.user.id } });
    expect(message.editedAt).not.toBeNull();

    const listed = (await list(bob)).json().messages[0];
    expect(listed.content).toBe('edited');
    expect(listed.editedAt).toBe(message.editedAt);
  });

  it('other member → 403 NOT_AUTHOR', async () => {
    const id = (await sendMessage(app, alice, channelId, 'orig')).json().message.id;
    const res = await req(app, 'PATCH', `/api/messages/${id}`, {
      cookie: bob.cookie,
      payload: { content: 'hacked' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('NOT_AUTHOR');
    expect((await list(alice)).json().messages[0].content).toBe('orig');
  });

  it('D3: NUL byte in an edit → 400 VALIDATION_ERROR', async () => {
    const id = (await sendMessage(app, alice, channelId, 'orig')).json().message.id;
    const res = await req(app, 'PATCH', `/api/messages/${id}`, {
      cookie: alice.cookie,
      payload: { content: 'x\u0000y' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('validates content', async () => {
    const id = (await sendMessage(app, alice, channelId, 'orig')).json().message.id;
    for (const content of ['', '  ', 'x'.repeat(2001)]) {
      const res = await req(app, 'PATCH', `/api/messages/${id}`, {
        cookie: alice.cookie,
        payload: { content },
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it('unknown / malformed id → 404', async () => {
    for (const id of ['999999', 'abc', '0']) {
      const res = await req(app, 'PATCH', `/api/messages/${id}`, {
        cookie: alice.cookie,
        payload: { content: 'x' },
      });
      expect(res.statusCode).toBe(404);
    }
  });
});

describe('DELETE /api/messages/:messageId', () => {
  it('author deletes → 204 and the message is gone', async () => {
    const id = (await sendMessage(app, alice, channelId, 'bye')).json().message.id;
    const res = await req(app, 'DELETE', `/api/messages/${id}`, { cookie: alice.cookie });
    expect(res.statusCode).toBe(204);
    expect((await list(alice)).json().messages).toEqual([]);
    const again = await req(app, 'DELETE', `/api/messages/${id}`, { cookie: alice.cookie });
    expect(again.statusCode).toBe(404);
    const edit = await req(app, 'PATCH', `/api/messages/${id}`, {
      cookie: alice.cookie,
      payload: { content: 'x' },
    });
    expect(edit.statusCode).toBe(404);
  });

  it('other member → 403 NOT_AUTHOR', async () => {
    const id = (await sendMessage(app, alice, channelId, 'keep')).json().message.id;
    const res = await req(app, 'DELETE', `/api/messages/${id}`, { cookie: bob.cookie });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('NOT_AUTHOR');
    expect((await list(alice)).json().messages).toHaveLength(1);
  });
});
