import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, loggerOptions } from '../src/app.js';
import { createDb } from '../src/db/client.js';
import {
  ALLOWED_TEST_ORIGIN,
  buildTestApp,
  closeDb,
  createGuild,
  getDb,
  registerUser,
  req,
  resetDb,
  sendMessage,
  testConfig,
  type TestUser,
} from './helpers.js';

let app: FastifyInstance;
let alice: TestUser;
let channelId: string;

beforeEach(async () => {
  await resetDb();
  app = await buildTestApp(
    {},
    {
      extraRoutes: (a) => {
        a.get('/api/__test/boom', async () => {
          throw new Error('kaboom: secret internals');
        });
      },
    },
  );
  alice = await registerUser(app, { username: 'alice' });
  channelId = (await createGuild(app, alice)).general.id;
});
afterEach(async () => {
  await app.close();
});
afterAll(closeDb);

describe('XSS', () => {
  it('stores HTML payloads verbatim and returns them as JSON', async () => {
    const payload = '<img src=x onerror=alert(1)>';
    const sent = await sendMessage(app, alice, channelId, payload);
    expect(sent.statusCode).toBe(201);
    expect(sent.headers['content-type']).toMatch(/^application\/json/);
    expect(sent.json().message.content).toBe(payload);

    const list = await req(app, 'GET', `/api/channels/${channelId}/messages`, {
      cookie: alice.cookie,
    });
    expect(list.headers['content-type']).toMatch(/^application\/json/);
    expect(list.json().messages[0].content).toBe(payload);
  });

  it('stores HTML in guild names verbatim', async () => {
    const { guild } = await createGuild(app, alice, '<script>alert(1)</script>');
    expect(guild.name).toBe('<script>alert(1)</script>');
  });
});

describe('security headers (helmet)', () => {
  it('API responses carry nosniff, a strict CSP and frame protection', async () => {
    const res = await req(app, 'GET', '/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('error responses carry the headers too', async () => {
    const res = await req(app, 'GET', '/api/auth/me');
    expect(res.statusCode).toBe(401);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('Origin check (CSRF)', () => {
  it('rejects mutating requests from a foreign Origin with 403 BAD_ORIGIN', async () => {
    const res = await req(app, 'POST', `/api/channels/${channelId}/messages`, {
      cookie: alice.cookie,
      payload: { content: 'csrf' },
      headers: { origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('BAD_ORIGIN');
    const list = await req(app, 'GET', `/api/channels/${channelId}/messages`, {
      cookie: alice.cookie,
    });
    expect(list.json().messages).toEqual([]);
  });

  it('rejects a foreign Origin on login/register/logout too', async () => {
    for (const url of ['/api/auth/login', '/api/auth/register', '/api/auth/logout']) {
      const res = await req(app, 'POST', url, {
        cookie: alice.cookie,
        payload: {},
        headers: { origin: 'http://localhost.evil.example' },
      });
      expect(res.statusCode, url).toBe(403);
      expect(res.json().error.code).toBe('BAD_ORIGIN');
    }
  });

  it('allows same-origin and ALLOWED_ORIGINS', async () => {
    const same = await req(app, 'POST', `/api/channels/${channelId}/messages`, {
      cookie: alice.cookie,
      payload: { content: 'same origin' },
      headers: { origin: 'http://chat.example:8443', host: 'chat.example:8443' },
    });
    expect(same.statusCode).toBe(201);
    const allowed = await req(app, 'POST', `/api/channels/${channelId}/messages`, {
      cookie: alice.cookie,
      payload: { content: 'allowed origin' },
      headers: { origin: ALLOWED_TEST_ORIGIN },
    });
    expect(allowed.statusCode).toBe(201);
  });

  it('does not block safe methods', async () => {
    const res = await req(app, 'GET', '/api/auth/me', {
      cookie: alice.cookie,
      headers: { origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects malformed Origin values', async () => {
    const res = await req(app, 'POST', '/api/guilds', {
      cookie: alice.cookie,
      payload: { name: 'x' },
      headers: { origin: 'null' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('input validation', () => {
  it('oversize content → 400 with field details', async () => {
    const res = await sendMessage(app, alice, channelId, 'x'.repeat(2001));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ path: 'content', message: expect.any(String) }],
    });
  });

  it('bodies above the size limit → 413', async () => {
    const res = await req(app, 'POST', `/api/channels/${channelId}/messages`, {
      cookie: alice.cookie,
      payload: { content: 'x'.repeat(70 * 1024) },
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('malformed JSON → 400 VALIDATION_ERROR', async () => {
    const res = await req(app, 'POST', '/api/auth/login', {
      payload: '{"email": ',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('non-JSON bodies are rejected with 415', async () => {
    for (const ct of ['text/plain', 'application/x-www-form-urlencoded']) {
      const res = await req(app, 'POST', '/api/guilds', {
        cookie: alice.cookie,
        payload: 'name=x',
        headers: { 'content-type': ct },
      });
      expect(res.statusCode, ct).toBe(415);
      expect(res.json().error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    }
  });

  it('prototype-pollution keys in JSON are rejected', async () => {
    const res = await req(app, 'POST', '/api/guilds', {
      cookie: alice.cookie,
      payload: '{"name":"x","__proto__":{"admin":true}}',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('every POST/PATCH validates its body and reports details', async () => {
    const guildId = (await createGuild(app, alice)).guild.id;
    const msgId = (await sendMessage(app, alice, channelId, 'x')).json().message.id;
    const cases: Array<['POST' | 'PATCH', string]> = [
      ['POST', '/api/auth/register'],
      ['POST', '/api/auth/login'],
      ['POST', '/api/guilds'],
      ['POST', `/api/guilds/${guildId}/channels`],
      ['POST', `/api/channels/${channelId}/messages`],
      ['PATCH', `/api/messages/${msgId}`],
    ];
    for (const [method, url] of cases) {
      const res = await req(app, method, url, { cookie: alice.cookie, payload: { bogus: 1 } });
      expect(res.statusCode, url).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
      expect(Array.isArray(res.json().error.details)).toBe(true);
      expect(res.json().error.details.length).toBeGreaterThan(0);
    }
  });
});

describe('error handling', () => {
  it('unknown route → 404 JSON in the error shape', async () => {
    const res = await req(app, 'GET', '/api/does-not-exist');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
  });

  it('a thrown error → 500 INTERNAL without stack or internals', async () => {
    const res = await req(app, 'GET', '/api/__test/boom');
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: 'INTERNAL', message: 'Interner Serverfehler' } });
    expect(res.body).not.toContain('kaboom');
    expect(res.body).not.toContain('at ');
  });

  it('every response carries a request id; a sane incoming x-request-id is reused', async () => {
    const res = await req(app, 'GET', '/api/health');
    expect(res.headers['x-request-id']).toEqual(expect.any(String));
    const custom = await req(app, 'GET', '/api/health', { headers: { 'x-request-id': 'abc-123' } });
    expect(custom.headers['x-request-id']).toBe('abc-123');
    const bad = await req(app, 'GET', '/api/health', {
      headers: { 'x-request-id': 'bad id <script>' },
    });
    expect(bad.headers['x-request-id']).not.toBe('bad id <script>');
  });

  it('health → 503 when the database is unreachable', async () => {
    const broken = createDb('postgres://chat:chat@127.0.0.1:1/nope');
    const brokenApp = await buildApp({ config: testConfig(), db: broken.db, logger: false });
    try {
      const res = await req(brokenApp, 'GET', '/api/health');
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe('SERVICE_UNAVAILABLE');
    } finally {
      await brokenApp.close();
      await broken.close();
    }
  });
});

describe('logging', () => {
  it('logs requests as JSON with reqId and never logs passwords or cookies', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const config = testConfig({ logLevel: 'info', nodeEnv: 'test' });
    const opts = loggerOptions(config);
    const logApp = await buildApp({
      config,
      db: getDb().db,
      logger: { ...(typeof opts === 'object' ? opts : {}), stream },
    });
    try {
      const password = 'super secret pw 42';
      const reg = await req(logApp, 'POST', '/api/auth/register', {
        payload: { email: 'log@example.com', username: 'logger', password },
      });
      const sid = reg.cookies.find((c) => c.name === 'sid')!.value;
      await req(logApp, 'GET', '/api/auth/me', { cookie: `sid=${sid}` });
      logApp.log.info(
        { password, body: { password }, user: { password }, req: { headers: { cookie: sid } } },
        'redaction probe',
      );

      const output = lines.join('');
      expect(output).not.toContain(password);
      expect(output).not.toContain(sid);
      expect(output).toContain('[REDACTED]');
      const parsed = lines.map((l) => JSON.parse(l));
      const completed = parsed.find((l) => l.msg === 'request completed');
      expect(completed).toMatchObject({ reqId: expect.any(String), res: { statusCode: 201 } });
    } finally {
      await logApp.close();
    }
  });
});
