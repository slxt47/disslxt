import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { pendingRegistrations, sessions, users } from '../src/db/schema.js';
import type { Mailer } from '../src/lib/mailer.js';
import {
  buildTestApp,
  closeDb,
  getDb,
  registerUser,
  req,
  resetDb,
  sentMails,
  sidFromSetCookie,
  TEST_DATABASE_URL,
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
const register = (a: FastifyInstance, payload: Record<string, unknown> = creds) =>
  req(a, 'POST', '/api/auth/register', { payload });
const verify = (a: FastifyInstance, token: string) =>
  req(a, 'POST', '/api/auth/verify-email', { payload: { token } });
const login = (a: FastifyInstance, password = creds.password) =>
  req(a, 'POST', '/api/auth/login', { payload: { email: creds.email, password } });

describe('registration needs a confirmed e-mail', () => {
  it('register → 202, no cookie, no account yet, one confirmation mail', async () => {
    const res = await register(app);
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ status: 'verification_sent' });
    expect(sidFromSetCookie(res)).toBeUndefined();
    expect(await getDb().db.select().from(users)).toHaveLength(0);
    expect(await getDb().db.select().from(sessions)).toHaveLength(0);

    const [pending] = await getDb().db.select().from(pendingRegistrations);
    expect(pending?.email).toBe('alice@example.com');
    expect(pending?.passwordHash.startsWith('$argon2id$')).toBe(true);

    const mails = sentMails(app);
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ to: 'alice@example.com' });
    // Link points at PUBLIC_URL with the token in the fragment (never sent to a server).
    expect(mails[0]!.text).toMatch(/https:\/\/disslxt\.test\/verify-email#token=[\w-]{43}/);
    expect(mails[0]!.html).toContain('https://disslxt.test/verify-email#token=');
    // Only the hash is stored.
    expect(pending?.tokenHash).not.toBe(verificationToken(app, creds.email));
  });

  it('no login before confirmation: right password → 403 EMAIL_NOT_VERIFIED', async () => {
    await register(app);
    const res = await login(app);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('EMAIL_NOT_VERIFIED');
    expect(sidFromSetCookie(res)).toBeUndefined();
  });

  it('unconfirmed + wrong password looks exactly like an unknown address', async () => {
    await register(app);
    const wrong = await login(app, 'wrong password');
    const unknown = await req(app, 'POST', '/api/auth/login', {
      payload: { email: 'nobody@example.com', password: 'wrong password' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
  });

  it('confirming creates the account, logs in, and then login works', async () => {
    await register(app);
    const res = await verify(app, verificationToken(app, creds.email));
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ email: 'alice@example.com', username: 'alice' });
    expect(res.json().next).toBeNull();
    const sid = sidFromSetCookie(res);
    expect((await req(app, 'GET', '/api/auth/me', { cookie: `sid=${sid}` })).statusCode).toBe(200);

    const [row] = await getDb().db.select().from(users);
    expect(row?.emailVerifiedAt).toBeInstanceOf(Date);
    expect(await getDb().db.select().from(pendingRegistrations)).toHaveLength(0);
    expect((await login(app)).statusCode).toBe(200);
  });

  it('a link works only once', async () => {
    await register(app);
    const token = verificationToken(app, creds.email);
    expect((await verify(app, token)).statusCode).toBe(200);
    const again = await verify(app, token);
    expect(again.statusCode).toBe(400);
    expect(again.json().error.code).toBe('VERIFICATION_INVALID');
  });

  it('an expired link is rejected and creates no account', async () => {
    await register(app);
    await getDb()
      .db.update(pendingRegistrations)
      .set({ expiresAt: new Date(Date.now() - 1000) });
    const res = await verify(app, verificationToken(app, creds.email));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VERIFICATION_INVALID');
    expect(await getDb().db.select().from(users)).toHaveLength(0);
  });

  it('the link expires after EMAIL_VERIFICATION_TTL_HOURS', async () => {
    await register(app);
    const [pending] = await getDb().db.select().from(pendingRegistrations);
    const hours = (pending!.expiresAt.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThanOrEqual(24);
  });

  it.each([['short'], ['x'.repeat(44)], ['has spaces in it and is 43 characters long!']])(
    'a malformed token → 400 VALIDATION_ERROR (%s)',
    async (token) => {
      const res = await verify(app, token);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    },
  );

  it('an unknown well-formed token → 400 VERIFICATION_INVALID', async () => {
    const res = await verify(app, 'A'.repeat(43));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VERIFICATION_INVALID');
  });
});

describe('abuse protection', () => {
  it('registering a taken address answers identically and only notifies the owner', async () => {
    await registerUser(app, creds);
    const mailsBefore = sentMails(app).length;

    const res = await register(app, {
      ...creds,
      email: 'ALICE@example.com',
      password: 'Evil-Pw-123x',
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ status: 'verification_sent' });
    expect(sidFromSetCookie(res)).toBeUndefined();

    const notice = sentMails(app).slice(mailsBefore);
    expect(notice).toHaveLength(1);
    expect(notice[0]!.subject).toBe('Registrierungsversuch bei disslxt');
    expect(notice[0]!.text).not.toMatch(/#token=/);
    expect(await getDb().db.select().from(pendingRegistrations)).toHaveLength(0);
    // The existing password still works, the attacker's does not.
    expect((await login(app)).statusCode).toBe(200);
    expect((await login(app, 'evil pw 123')).statusCode).toBe(401);
  });

  it('a squatted sign-up cannot hijack the account: each link carries its own password', async () => {
    // Attacker registers the victim's address first, with the attacker's password.
    await register(app, { ...creds, username: 'attacker', password: 'Fremdes-Pw-91' });
    const attackerToken = verificationToken(app, creds.email);
    // Victim registers for real and confirms their own (newer) link.
    await register(app);
    const victimToken = verificationToken(app, creds.email);
    expect(victimToken).not.toBe(attackerToken);

    const res = await verify(app, victimToken);
    expect(res.statusCode).toBe(200);
    expect(res.json().user.username).toBe('alice');
    expect((await login(app)).statusCode).toBe(200);
    expect((await login(app, 'attacker pw 1')).statusCode).toBe(401);
    // The attacker's link died with the confirmation.
    expect((await verify(app, attackerToken)).json().error.code).toBe('VERIFICATION_INVALID');
  });

  it('per-address limit: no more mails than MAIL_MAX_PER_ADDRESS_PER_HOUR, same answer', async () => {
    const limited = await buildTestApp({
      mail: { ...loadConfig({ DATABASE_URL: TEST_DATABASE_URL }).mail, maxPerAddressPerHour: 2 },
    });
    try {
      for (let i = 0; i < 4; i++) {
        const res = await register(limited);
        expect(res.statusCode).toBe(202);
        expect(res.json()).toEqual({ status: 'verification_sent' });
      }
      const resend = await req(limited, 'POST', '/api/auth/resend-verification', {
        payload: { email: creds.email },
      });
      expect(resend.statusCode).toBe(202);
      expect(sentMails(limited)).toHaveLength(2);
      // Other addresses are unaffected.
      await register(limited, { ...creds, email: 'bob@example.com', username: 'bob' });
      expect(sentMails(limited)).toHaveLength(3);
    } finally {
      await limited.close();
    }
  });

  it('per-IP limit on resend → 429 RATE_LIMITED', async () => {
    const limited = await buildTestApp({ rateLimit: { mailMax: 2 } });
    try {
      const resend = () =>
        req(limited, 'POST', '/api/auth/resend-verification', {
          payload: { email: 'x@example.com' },
        });
      expect((await resend()).statusCode).toBe(202);
      expect((await resend()).statusCode).toBe(202);
      const res = await resend();
      expect(res.statusCode).toBe(429);
      expect(res.json().error.code).toBe('RATE_LIMITED');
    } finally {
      await limited.close();
    }
  });

  it('a failing mail server does not break the sign-up answer', async () => {
    const failing: Mailer = { send: () => Promise.reject(new Error('smtp down')), close() {} };
    const broken = await buildTestApp({}, { mailer: failing });
    try {
      const res = await register(broken);
      expect(res.statusCode).toBe(202);
    } finally {
      await broken.close();
    }
  });
});

describe('resend', () => {
  it('sends a fresh link and invalidates the previous one', async () => {
    await register(app);
    const first = verificationToken(app, creds.email);
    const res = await req(app, 'POST', '/api/auth/resend-verification', {
      payload: { email: 'ALICE@example.com' },
    });
    expect(res.statusCode).toBe(202);
    const second = verificationToken(app, creds.email);
    expect(second).not.toBe(first);
    expect((await verify(app, first)).json().error.code).toBe('VERIFICATION_INVALID');
    expect((await verify(app, second)).statusCode).toBe(200);
  });

  it('unknown or already confirmed addresses → same 202, no mail', async () => {
    await registerUser(app, { email: 'done@example.com' });
    const before = sentMails(app).length;
    for (const email of ['nobody@example.com', 'done@example.com']) {
      const res = await req(app, 'POST', '/api/auth/resend-verification', { payload: { email } });
      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual({ status: 'verification_sent' });
    }
    expect(sentMails(app)).toHaveLength(before);
  });
});

describe('continue where the user came from', () => {
  it('a same-origin path (e.g. an invite) is returned after confirming', async () => {
    await register(app, { ...creds, next: '/invite/AbC123' });
    const res = await verify(app, verificationToken(app, creds.email));
    expect(res.json().next).toBe('/invite/AbC123');
  });

  it.each([['//evil.example/x'], ['https://evil.example'], ['/\\evil.example'], ['javascript:x']])(
    'an off-site target is rejected (%s)',
    async (next) => {
      const res = await register(app, { ...creds, next });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    },
  );
});

describe('existing accounts', () => {
  it('a legacy row without email_verified_at cannot log in', async () => {
    const u = await registerUser(app, creds);
    await getDb().db.update(users).set({ emailVerifiedAt: null }).where(eq(users.id, u.user.id));
    const res = await login(app);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('EMAIL_NOT_VERIFIED');
  });
});

describe('configuration', () => {
  const prod = {
    NODE_ENV: 'production',
    DATABASE_URL: TEST_DATABASE_URL,
    PUBLIC_URL: 'https://disslxt.slxt.org',
    MAIL_TRANSPORT: 'smtp',
    SMTP_HOST: 'smtp.mail.me.com',
    SMTP_USER: 'someone@icloud.com',
    SMTP_PASS: 'app-specific-password',
    MAIL_FROM: 'disslxt <noreply@slxt.org>',
  };

  it('production accepts a complete SMTP setup', () => {
    const c = loadConfig(prod);
    expect(c.mail.transport).toBe('smtp');
    expect(c.mail.smtp).toMatchObject({ host: 'smtp.mail.me.com', port: 587, secure: false });
  });

  it.each([['MAIL_TRANSPORT'], ['SMTP_HOST'], ['SMTP_PASS'], ['MAIL_FROM'], ['PUBLIC_URL']])(
    'production refuses to start without %s',
    (key) => {
      const env: Record<string, string> = { ...prod };
      delete env[key];
      expect(() => loadConfig(env)).toThrow(/production requires/);
    },
  );

  it('rejects a PUBLIC_URL with a trailing slash', () => {
    expect(() => loadConfig({ ...prod, PUBLIC_URL: 'https://disslxt.slxt.org/' })).toThrow();
  });

  it('the dev mailbox endpoint does not exist with a real mail transport', async () => {
    const res = await req(app, 'GET', '/api/dev/mails');
    expect(res.statusCode).toBe(200);
    const smtpApp = await buildTestApp(
      {},
      { mailer: { send: () => Promise.resolve(), close() {} } },
    );
    try {
      expect((await req(smtpApp, 'GET', '/api/dev/mails')).statusCode).toBe(404);
    } finally {
      await smtpApp.close();
    }
  });
});
