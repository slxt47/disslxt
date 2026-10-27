import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sessions, users } from '../src/db/schema.js';
import { sha256 } from '../src/lib/tokens.js';
import {
  buildTestApp,
  closeDb,
  getDb,
  registerUser,
  req,
  resetDb,
  sidFromSetCookie,
  verificationToken,
} from './helpers.js';

let app: FastifyInstance;

beforeEach(async () => {
  await resetDb();
  app = await buildTestApp();
});
afterEach(async () => {
  await app.close();
});
afterAll(closeDb);

const creds = { email: 'Alice@Example.com', username: 'alice', password: 'Correct-Horse-7' };

describe('POST /api/auth/register', () => {
  it('stores only an argon2id hash; the account exists only after confirmation', async () => {
    const u = await registerUser(app, creds);
    expect(u.user).toEqual({
      id: expect.any(String),
      email: 'alice@example.com',
      username: 'alice',
    });
    expect(u.user).not.toHaveProperty('passwordHash');

    const [row] = await getDb().db.select().from(users).where(eq(users.id, u.user.id));
    expect(row?.passwordHash).not.toBe(creds.password);
    expect(row?.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(row?.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it('confirming sets an httpOnly, SameSite=Lax session cookie and stores only the token hash', async () => {
    const u = await registerUser(app, creds);
    const rows = await getDb().db.select().from(sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).toBe(sha256(u.token));
    expect(rows[0]?.tokenHash).not.toBe(u.token);
    expect(rows[0]!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
  });

  it('sets the Secure flag when COOKIE_SECURE is enabled', async () => {
    const secureApp = await buildTestApp({ cookieSecure: true });
    try {
      await req(secureApp, 'POST', '/api/auth/register', { payload: creds });
      const res = await req(secureApp, 'POST', '/api/auth/verify-email', {
        payload: { token: verificationToken(secureApp, creds.email) },
      });
      const cookie = res.cookies.find((c) => c.name === 'sid');
      expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/', secure: true });
      expect(cookie?.maxAge).toBe(30 * 24 * 60 * 60);
    } finally {
      await secureApp.close();
    }
  });

  it('auto-logs in after confirming: the cookie works for /me', async () => {
    const u = await registerUser(app);
    const me = await req(app, 'GET', '/api/auth/me', { cookie: u.cookie });
    expect(me.statusCode).toBe(200);
    expect(me.json().user).toEqual(u.user);
  });

  it('weak passwords are refused with the rules that failed', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'weak@example.com', username: 'weakling', password: 'Passwort123!' },
    });
    expect(res.statusCode).toBe(400);
    const details = res.json().error.details as { path: string; message: string }[];
    expect(details).toEqual([{ path: 'password', message: 'Kein häufig benutztes Passwort' }]);
    const personal = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'weak@example.com', username: 'weakling', password: 'Weakling!2026' },
    });
    expect(personal.json().error.details[0].message).toMatch(/Benutzernamen/);
  });

  it('returns 400 VALIDATION_ERROR with field details', async () => {
    const res = await req(app, 'POST', '/api/auth/register', {
      payload: { email: 'nope', username: 'x', password: 'short' },
    });
    expect(res.statusCode).toBe(400);
    const { error } = res.json();
    expect(error.code).toBe('VALIDATION_ERROR');
    const paths = error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['email', 'username', 'password']));
  });

  it.each([
    ['username', { ...creds, username: 'ali\u0000ce' }],
    ['email', { ...creds, email: 'alice\u0000@example.com' }],
  ])('D3: NUL byte in %s → 400 VALIDATION_ERROR', async (_label, payload) => {
    const res = await req(app, 'POST', '/api/auth/register', { payload });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('D3: NUL byte in the login email → 400, not 500', async () => {
    const res = await req(app, 'POST', '/api/auth/login', {
      payload: { email: 'a\u0000@example.com', password: 'whatever1' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for a missing body', async () => {
    const res = await req(app, 'POST', '/api/auth/register');
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await registerUser(app, creds);
  });

  it('login ok → 200 + new session cookie', async () => {
    const res = await req(app, 'POST', '/api/auth/login', {
      payload: { email: 'alice@example.com', password: creds.password },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.username).toBe('alice');
    const sid = sidFromSetCookie(res);
    expect(sid).toBeTruthy();
    const me = await req(app, 'GET', '/api/auth/me', { cookie: `sid=${sid}` });
    expect(me.statusCode).toBe(200);
    expect(await getDb().db.select().from(sessions)).toHaveLength(2);
  });

  it('login is case-insensitive for the e-mail', async () => {
    const res = await req(app, 'POST', '/api/auth/login', {
      payload: { email: 'ALICE@EXAMPLE.COM', password: creds.password },
    });
    expect(res.statusCode).toBe(200);
  });

  it('wrong pw 401 / unknown email 401 with the same message', async () => {
    const wrong = await req(app, 'POST', '/api/auth/login', {
      payload: { email: creds.email, password: 'wrong password' },
    });
    const unknown = await req(app, 'POST', '/api/auth/login', {
      payload: { email: 'nobody@example.com', password: 'whatever1' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().error.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.json()).toEqual(wrong.json());
    expect(sidFromSetCookie(wrong)).toBeUndefined();
  });

  it('returns 400 for invalid input', async () => {
    const res = await req(app, 'POST', '/api/auth/login', { payload: { email: 'x' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('session handling', () => {
  it('/me without cookie → 401 UNAUTHORIZED', async () => {
    const res = await req(app, 'GET', '/api/auth/me');
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });

  it('/me with an unknown token → 401', async () => {
    const res = await req(app, 'GET', '/api/auth/me', { cookie: 'sid=garbage' });
    expect(res.statusCode).toBe(401);
  });

  it('logout → 204, the old cookie then gets 401 on /me', async () => {
    const u = await registerUser(app);
    const res = await req(app, 'POST', '/api/auth/logout', { cookie: u.cookie });
    expect(res.statusCode).toBe(204);
    const cleared = res.cookies.find((c) => c.name === 'sid');
    expect(cleared?.value).toBe('');
    expect(await getDb().db.select().from(sessions)).toHaveLength(0);

    const me = await req(app, 'GET', '/api/auth/me', { cookie: u.cookie });
    expect(me.statusCode).toBe(401);
  });

  it('logout only ends the current session', async () => {
    const u = await registerUser(app);
    const login = await req(app, 'POST', '/api/auth/login', {
      payload: { email: u.user.email, password: u.password },
    });
    const second = `sid=${sidFromSetCookie(login)}`;
    await req(app, 'POST', '/api/auth/logout', { cookie: u.cookie });
    expect((await req(app, 'GET', '/api/auth/me', { cookie: second })).statusCode).toBe(200);
  });

  it('logout without a session → 401', async () => {
    const res = await req(app, 'POST', '/api/auth/logout');
    expect(res.statusCode).toBe(401);
  });

  it('logout accepts an empty JSON body', async () => {
    const u = await registerUser(app);
    const res = await req(app, 'POST', '/api/auth/logout', {
      cookie: u.cookie,
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(204);
  });

  it('expired session → 401', async () => {
    const u = await registerUser(app);
    await getDb()
      .db.update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.userId, u.user.id));
    const res = await req(app, 'GET', '/api/auth/me', { cookie: u.cookie });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/health', () => {
  it('returns ok without auth', async () => {
    const res = await req(app, 'GET', '/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});
