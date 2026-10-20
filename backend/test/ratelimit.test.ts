import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildTestApp,
  closeDb,
  createGuild,
  joinGuild,
  registerUser,
  req,
  resetDb,
  sendMessage,
  sleep,
  type TestUser,
} from './helpers.js';

const apps: FastifyInstance[] = [];
async function make(...args: Parameters<typeof buildTestApp>) {
  const app = await buildTestApp(...args);
  apps.push(app);
  return app;
}

beforeEach(async () => {
  await resetDb();
});
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});
afterAll(closeDb);

describe('login / register rate limit (per IP)', () => {
  it('11th login within the window → 429 RATE_LIMITED with retry-after', async () => {
    const app = await make({ rateLimit: { loginMax: 10, loginWindowMs: 60_000 } });
    const u = await registerUser(app);
    for (let i = 0; i < 10; i++) {
      const res = await req(app, 'POST', '/api/auth/login', {
        payload: { email: u.user.email, password: i % 2 ? u.password : 'wrong password' },
      });
      expect([200, 401]).toContain(res.statusCode);
    }
    const res = await req(app, 'POST', '/api/auth/login', {
      payload: { email: u.user.email, password: u.password },
    });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('RATE_LIMITED');
    expect(res.json().error.message).toEqual(expect.any(String));
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(res.headers['retry-after'])).toBeLessThanOrEqual(60);
  });

  it('register is limited too', async () => {
    const app = await make({ rateLimit: { loginMax: 3 } });
    for (let i = 0; i < 3; i++) {
      const res = await req(app, 'POST', '/api/auth/register', {
        payload: { email: `r${i}@example.com`, username: `r_user_${i}`, password: 'password123' },
      });
      expect(res.statusCode).toBe(201);
    }
    const res = await req(app, 'POST', '/api/auth/register', {
      payload: { email: 'r9@example.com', username: 'r_user_9', password: 'password123' },
    });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('RATE_LIMITED');
  });

  it('is keyed by IP: another client IP is unaffected', async () => {
    const app = await make({ rateLimit: { loginMax: 2 } });
    const payload = { email: 'nobody@example.com', password: 'whatever1' };
    const from = (ip: string) =>
      app.inject({ method: 'POST', url: '/api/auth/login', payload, remoteAddress: ip });
    expect((await from('10.0.0.1')).statusCode).toBe(401);
    expect((await from('10.0.0.1')).statusCode).toBe(401);
    expect((await from('10.0.0.1')).statusCode).toBe(429);
    expect((await from('10.0.0.2')).statusCode).toBe(401);
  });

  it('uses X-Forwarded-For only when trustProxy is enabled', async () => {
    const app = await make({ trustProxy: true, rateLimit: { loginMax: 1 } });
    const payload = { email: 'nobody@example.com', password: 'whatever1' };
    const from = (xff: string) =>
      app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload,
        headers: { 'x-forwarded-for': xff },
      });
    expect((await from('203.0.113.1')).statusCode).toBe(401);
    expect((await from('203.0.113.1')).statusCode).toBe(429);
    expect((await from('203.0.113.2')).statusCode).toBe(401);
  });

  it('the window resets', async () => {
    const app = await make({ rateLimit: { loginMax: 1, loginWindowMs: 300 } });
    const payload = { email: 'nobody@example.com', password: 'whatever1' };
    expect((await req(app, 'POST', '/api/auth/login', { payload })).statusCode).toBe(401);
    expect((await req(app, 'POST', '/api/auth/login', { payload })).statusCode).toBe(429);
    await sleep(400);
    expect((await req(app, 'POST', '/api/auth/login', { payload })).statusCode).toBe(401);
  });
});

describe('message send rate limit (per user)', () => {
  let app: FastifyInstance;
  let alice: TestUser;
  let bob: TestUser;
  let channelId: string;

  beforeEach(async () => {
    app = await make({ rateLimit: { messageMax: 20, messageWindowMs: 10_000 } });
    alice = await registerUser(app, { username: 'alice' });
    bob = await registerUser(app, { username: 'bob' });
    const g = await createGuild(app, alice);
    channelId = g.general.id;
    await joinGuild(app, bob, g.guild.inviteCode);
  });

  it('21st message within 10 s → 429; a different user is unaffected', async () => {
    for (let i = 0; i < 20; i++) {
      expect((await sendMessage(app, alice, channelId, `m${i}`)).statusCode).toBe(201);
    }
    const limited = await sendMessage(app, alice, channelId, 'one too many');
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);

    // bob sends from the same IP but is keyed by his user id
    expect((await sendMessage(app, bob, channelId, 'hi')).statusCode).toBe(201);

    // reading is not limited
    const list = await req(app, 'GET', `/api/channels/${channelId}/messages`, {
      cookie: alice.cookie,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().messages).toHaveLength(21);
  });

  it('unauthenticated sends get 401 (auth runs before the limiter)', async () => {
    const res = await req(app, 'POST', `/api/channels/${channelId}/messages`, {
      payload: { content: 'x' },
    });
    expect(res.statusCode).toBe(401);
  });
});
