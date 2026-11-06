import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TWO_FACTOR_MAX_FAILURES } from '@disslxt/shared';
import { recoveryCodes, sessions, users } from '../src/db/schema.js';
import { describeDevice } from '../src/lib/device.js';
import { open, seal } from '../src/lib/secretBox.js';
import {
  base32Decode,
  base32Encode,
  currentStep,
  hotp,
  matchTotp,
  newTotpSecret,
} from '../src/lib/totp.js';
import {
  buildTestApp,
  closeDb,
  createGuild,
  getDb,
  listen,
  registerUser,
  req,
  resetDb,
  sendMessage,
  sentMails,
  sidFromSetCookie,
  wsReady,
  type TestSocket,
  type TestUser,
} from './helpers.js';

const KEY = Buffer.alloc(32, 7);
const PASSWORD = 'Tr0cken-Blume-7';
let app: FastifyInstance;
let alice: TestUser;
const sockets: TestSocket[] = [];

const api = (u: TestUser, method: 'GET' | 'POST' | 'DELETE', path: string, payload?: object) =>
  req(app, method, `/api${path}`, { cookie: u.cookie, ...(payload ? { payload } : {}) });
const codeFor = (secret: string, stepOffset = 0n) =>
  hotp(base32Decode(secret), currentStep() + stepOffset);
const login = (password = PASSWORD, email = alice.user.email) =>
  req(app, 'POST', '/api/auth/login', { payload: { email, password } });
const second = (ticket: string, code: string) =>
  req(app, 'POST', '/api/auth/login/two-factor', { payload: { ticket, code } });

/** Switches 2FA on; uses the code of the previous step, so "now" stays free for the test. */
async function enable(): Promise<{ secret: string; codes: string[] }> {
  const setup = await api(alice, 'POST', '/account/two-factor/setup', { password: PASSWORD });
  expect(setup.statusCode).toBe(200);
  const { secret } = setup.json() as { secret: string };
  const on = await api(alice, 'POST', '/account/two-factor/enable', {
    code: codeFor(secret, -1n),
  });
  expect(on.statusCode).toBe(200);
  return { secret, codes: on.json().recoveryCodes };
}

beforeEach(async () => {
  await resetDb();
  await getDb().db.delete(recoveryCodes);
  app = await buildTestApp({ twoFactorKey: KEY });
  alice = await registerUser(app, { username: 'alice', password: PASSWORD });
});
afterEach(async () => {
  for (const s of sockets.splice(0)) s.ws.terminate();
  vi.useRealTimers();
  await app.close();
});
afterAll(closeDb);

describe('totp', () => {
  // RFC 6238 appendix B, SHA-1 with the 20-byte ASCII key, last six digits.
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('matches the RFC vector for t=%i', (t, code) => {
    const key = Buffer.from('12345678901234567890');
    expect(hotp(key, currentStep(t * 1000))).toBe(code);
  });

  it('base32 round trip', () => {
    const s = newTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(s))).toBe(s);
  });

  it('allows one step of drift, refuses more and refuses used steps', () => {
    const s = newTotpSecret();
    const now = 1_800_000_000_000;
    const key = base32Decode(s);
    const at = (d: bigint) => hotp(key, currentStep(now) + d);
    expect(matchTotp(s, at(1n), 0n, now)).toBe(currentStep(now) + 1n);
    expect(matchTotp(s, at(-1n), 0n, now)).toBe(currentStep(now) - 1n);
    expect(matchTotp(s, at(2n), 0n, now)).toBeNull();
    expect(matchTotp(s, at(0n), currentStep(now), now)).toBeNull();
  });
});

describe('secret box', () => {
  it('round trip; another key or a changed byte fails', () => {
    const box = seal('geheim', KEY);
    expect(box).not.toContain('geheim');
    expect(open(box, KEY)).toBe('geheim');
    expect(() => open(box, Buffer.alloc(32, 8))).toThrow();
    const parts = box.split('.');
    parts[3] = Buffer.from('anders').toString('base64url');
    expect(() => open(parts.join('.'), KEY)).toThrow();
  });
});

describe('setting up two factors', () => {
  it('needs the password; the secret is stored encrypted', async () => {
    expect(
      (await api(alice, 'POST', '/account/two-factor/setup', { password: 'falsch' })).statusCode,
    ).toBe(401);
    const { secret } = await enable();
    const [row] = await getDb().db.select().from(users).where(eq(users.id, alice.user.id));
    expect(row?.totpSecret).toBeTruthy();
    expect(row?.totpSecret).not.toContain(secret);
  });

  it('only counts after the first right code', async () => {
    const setup = await api(alice, 'POST', '/account/two-factor/setup', { password: PASSWORD });
    expect(setup.json().uri).toMatch(/^otpauth:\/\/totp\/disslxt/);
    expect(
      (await api(alice, 'POST', '/account/two-factor/enable', { code: '000000' })).statusCode,
    ).toBe(401);
    expect((await login()).json().user).toBeTruthy();
    const status = await api(alice, 'GET', '/account/two-factor');
    expect(status.json()).toMatchObject({ enabled: false, available: true });
  });

  it('gives ten recovery codes, stored only as hashes', async () => {
    const { codes } = await enable();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    const rows = await getDb().db.select().from(recoveryCodes);
    expect(rows).toHaveLength(10);
    expect(rows.map((r) => r.codeHash)).not.toContain(codes[0]);
  });

  it('without a key on the server it says so', async () => {
    const plain = await buildTestApp({ twoFactorKey: null });
    const res = await req(plain, 'POST', '/api/account/two-factor/setup', {
      cookie: alice.cookie,
      payload: { password: PASSWORD },
    });
    expect(res.statusCode).toBe(503);
    await plain.close();
  });
});

describe('signing in with two factors', () => {
  it('the password alone gives no session', async () => {
    const { secret } = await enable();
    const first = await login();
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ twoFactor: true });
    expect(first.json().user).toBeUndefined();
    expect(sidFromSetCookie(first)).toBeUndefined();
    const done = await second(first.json().ticket, codeFor(secret));
    expect(done.statusCode).toBe(200);
    expect(done.json().user.username).toBe('alice');
    expect(sidFromSetCookie(done)).toBeTruthy();
  });

  it('a wrong password does not reveal that 2FA is on', async () => {
    await enable();
    const res = await login('falsch-falsch');
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('a code cannot be used twice; the ticket works once', async () => {
    const { secret } = await enable();
    const ticket = (await login()).json().ticket as string;
    const code = codeFor(secret);
    expect((await second(ticket, code)).statusCode).toBe(200);
    expect((await second(ticket, code)).statusCode).toBe(401);
    const again = (await login()).json().ticket as string;
    expect((await second(again, code)).statusCode).toBe(401);
  });

  it('a recovery code works once, with or without its dash', async () => {
    const { codes } = await enable();
    const ticket = (await login()).json().ticket as string;
    expect((await second(ticket, codes[0]!)).statusCode).toBe(200);
    const t2 = (await login()).json().ticket as string;
    expect((await second(t2, codes[0]!)).statusCode).toBe(401);
    expect((await second(t2, codes[1]!.replace('-', '').toLowerCase())).statusCode).toBe(200);
    expect((await api(alice, 'GET', '/account/two-factor')).json().recoveryCodesLeft).toBe(8);
  });

  it('locks the account after too many wrong codes, even the right one then', async () => {
    const { secret } = await enable();
    const ticket = (await login()).json().ticket as string;
    for (let i = 0; i < TWO_FACTOR_MAX_FAILURES; i += 1) {
      expect((await second(ticket, '000000')).statusCode).toBe(401);
    }
    const locked = await second(ticket, codeFor(secret));
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe('TWO_FACTOR_LOCKED');
    // New tickets do not get around it.
    const fresh = (await login()).json().ticket as string;
    expect((await second(fresh, codeFor(secret))).statusCode).toBe(429);
  });

  it('an expired or made-up ticket is refused', async () => {
    await enable();
    expect((await second('erfunden', '123456')).statusCode).toBe(401);
  });

  it('resetting the password does not get around the second factor', async () => {
    const { secret } = await enable();
    const oldTicket = (await login()).json().ticket as string;
    await req(app, 'POST', '/api/auth/forgot-password', { payload: { email: alice.user.email } });
    await vi.waitFor(() => expect(sentMails(app).at(-1)?.text).toContain('reset-password'));
    const token = /#token=([\w-]+)/.exec(sentMails(app).at(-1)?.text ?? '')?.[1];
    const res = await req(app, 'POST', '/api/auth/reset-password', {
      payload: { token, password: 'Gelbe!Tulpe88-neu' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ signIn: true });
    expect((await second(oldTicket, codeFor(secret))).statusCode).toBe(401);
    expect(sidFromSetCookie(res)).toBeUndefined();
    const first = await login('Gelbe!Tulpe88-neu');
    expect(first.json()).toMatchObject({ twoFactor: true });
    expect((await second(first.json().ticket, codeFor(secret))).statusCode).toBe(200);
  });
});

describe('switching off and new codes', () => {
  it('needs password and code', async () => {
    const { secret } = await enable();
    const code = codeFor(secret);
    const off = (body: object) => api(alice, 'POST', '/account/two-factor/disable', body);
    expect((await off({ password: 'falsch', code })).statusCode).toBe(401);
    expect((await off({ password: PASSWORD, code: '000000' })).statusCode).toBe(401);
    expect((await off({ password: PASSWORD, code })).statusCode).toBe(204);
    expect((await login()).json().user).toBeTruthy();
    expect(await getDb().db.select().from(recoveryCodes)).toHaveLength(0);
  });

  it('new recovery codes end the old ones', async () => {
    const { secret, codes } = await enable();
    const res = await api(alice, 'POST', '/account/two-factor/recovery-codes', {
      password: PASSWORD,
      code: codeFor(secret),
    });
    const fresh = res.json().recoveryCodes as string[];
    const t = (await login()).json().ticket as string;
    expect((await second(t, codes[0]!)).statusCode).toBe(401);
    expect((await second(t, fresh[0]!)).statusCode).toBe(200);
  });

  it('deleting the account takes everything with it', async () => {
    await enable();
    await req(app, 'DELETE', '/api/users/me', {
      cookie: alice.cookie,
      payload: { password: PASSWORD },
    });
    expect(await getDb().db.select().from(recoveryCodes)).toHaveLength(0);
  });
});

describe('devices', () => {
  const firefox = 'Mozilla/5.0 (Windows NT 10.0; rv:130.0) Gecko/20100101 Firefox/130.0';

  it('names browser and system, and keeps nothing else', () => {
    expect(describeDevice(firefox)).toBe('Firefox auf Windows');
    expect(
      describeDevice(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605 Version/18 Mobile Safari/604',
      ),
    ).toBe('Safari auf iPhone');
    expect(describeDevice('Mozilla/5.0 (X11; Linux) Chrome/130.0 Safari/537')).toBe(
      'Chrome auf Linux',
    );
    expect(describeDevice(undefined)).toBeNull();
  });

  async function secondDevice(): Promise<string> {
    const res = await req(app, 'POST', '/api/auth/login', {
      payload: { email: alice.user.email, password: PASSWORD },
      headers: { 'user-agent': firefox },
    });
    return `sid=${sidFromSetCookie(res)}`;
  }

  it('lists devices, marks this one, ends another live', async () => {
    const other = await secondDevice();
    const list = (await api(alice, 'GET', '/account/sessions')).json().sessions as {
      id: string;
      device: string | null;
      current: boolean;
    }[];
    expect(list).toHaveLength(2);
    expect(list.filter((s) => s.current)).toHaveLength(1);
    const foreign = list.find((s) => !s.current)!;
    expect(foreign.device).toBe('Firefox auf Windows');
    const host = await listen(app);
    const ws = await wsReady(host, other);
    sockets.push(ws);
    expect((await api(alice, 'DELETE', `/account/sessions/${foreign.id}`)).statusCode).toBe(204);
    expect((await ws.closed).code).toBe(4401);
    const after = await req(app, 'GET', '/api/auth/me', { cookie: other });
    expect(after.statusCode).toBe(401);
  });

  it('ends all others, not this one', async () => {
    const a = await secondDevice();
    const b = await secondDevice();
    const res = await api(alice, 'POST', '/account/sessions/end-others');
    expect(res.json().ended).toBe(2);
    expect((await req(app, 'GET', '/api/auth/me', { cookie: a })).statusCode).toBe(401);
    expect((await req(app, 'GET', '/api/auth/me', { cookie: b })).statusCode).toBe(401);
    expect((await api(alice, 'GET', '/auth/me')).statusCode).toBe(200);
  });

  it("nobody ends someone else's session", async () => {
    const bob = await registerUser(app, { username: 'bob' });
    const [own] = await getDb()
      .db.select()
      .from(sessions)
      .where(eq(sessions.userId, alice.user.id));
    expect((await api(bob, 'DELETE', `/account/sessions/${own!.id}`)).statusCode).toBe(404);
    expect((await api(alice, 'GET', '/auth/me')).statusCode).toBe(200);
  });
});

describe('data export', () => {
  it('contains your data and no secrets', async () => {
    const { general } = await createGuild(app, alice, 'Mein Server');
    await sendMessage(app, alice, general.id, 'meine Nachricht');
    await enable();
    const res = await api(alice, 'GET', '/account/export');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('disslxt-export.json');
    const data = res.json();
    expect(data.account.email).toBe(alice.user.email);
    expect(data.servers[0].name).toBe('Mein Server');
    expect(data.messages[0].content).toBe('meine Nachricht');
    expect(res.body).not.toMatch(/passwordHash|password_hash|totpSecret|argon2/);
  });

  it('holds only your own messages', async () => {
    const bob = await registerUser(app, { username: 'bob' });
    const { general } = await createGuild(app, bob, 'Bobs');
    await sendMessage(app, bob, general.id, 'von bob');
    const data = (await api(alice, 'GET', '/account/export')).json();
    expect(data.messages).toEqual([]);
  });

  it('needs a login', async () => {
    expect((await req(app, 'GET', '/api/account/export')).statusCode).toBe(401);
  });

  it('stops after three a hour', async () => {
    const limited = await buildTestApp({ twoFactorKey: KEY });
    const u = await registerUser(limited, { username: 'carol' });
    const get = () => req(limited, 'GET', '/api/account/export', { cookie: u.cookie });
    for (let i = 0; i < 3; i += 1) expect((await get()).statusCode).toBe(200);
    expect((await get()).statusCode).toBe(429);
    await limited.close();
  });
});
