import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  currentMonth,
  MAX_REPORT_BYTES,
  TurnUsageService,
} from '../src/services/turnUsage.service.js';
import {
  buildTestApp,
  closeDb,
  getDb,
  registerUser,
  req,
  resetDb,
  type TestUser,
} from './helpers.js';
import { sql } from 'drizzle-orm';

const TURN = { urls: ['turn:turn.example:3478'], username: 'u', credential: 'c' };
let app: FastifyInstance;
let alice: TestUser;

async function build(limitBytes: number) {
  app = await buildTestApp({
    ice: {
      stunUrls: ['stun:stun.example:3478'],
      cloudflare: null,
      static: TURN,
      monthlyLimitBytes: limitBytes,
    },
  });
  alice = await registerUser(app, { username: 'alice' });
}

const iceUrls = async () =>
  (await req(app, 'GET', '/api/voice/ice-servers', { cookie: alice.cookie }))
    .json()
    .iceServers.map((s: { urls: string[] }) => s.urls[0]);
const report = (bytes: unknown, user = alice) =>
  req(app, 'POST', '/api/voice/turn-usage', { cookie: user.cookie, payload: { bytes } });

beforeEach(async () => {
  await resetDb();
  await getDb().db.execute(sql`TRUNCATE turn_usage`);
});
afterEach(async () => {
  await app?.close();
});
afterAll(closeDb);

describe('TURN quota', () => {
  it('counts reported relay traffic per month and shows it', async () => {
    await build(10_000_000);
    expect((await report(1_500_000)).statusCode).toBe(204);
    expect((await report(500_000)).statusCode).toBe(204);
    const res = await req(app, 'GET', '/api/voice/turn-usage', { cookie: alice.cookie });
    expect(res.json()).toEqual({
      month: currentMonth(),
      usedBytes: 2_000_000,
      limitBytes: 10_000_000,
      exhausted: false,
      configured: true,
    });
  });

  it('hands out TURN below the limit and only STUN once it is reached', async () => {
    await build(1_000_000);
    expect(await iceUrls()).toEqual(['stun:stun.example:3478', 'turn:turn.example:3478']);
    await report(1_000_000);
    expect(await iceUrls()).toEqual(['stun:stun.example:3478']);
    expect(
      (await req(app, 'GET', '/api/voice/turn-usage', { cookie: alice.cookie })).json().exhausted,
    ).toBe(true);
  });

  it('a single report cannot be absurdly large; bad input and guests are refused', async () => {
    await build(1e12);
    await report(5e9);
    const res = await req(app, 'GET', '/api/voice/turn-usage', { cookie: alice.cookie });
    expect(res.json().usedBytes).toBe(MAX_REPORT_BYTES);
    expect((await report(-5)).statusCode).toBe(400);
    expect((await report('viel')).statusCode).toBe(400);
    expect(
      (await app.inject({ method: 'POST', url: '/api/voice/turn-usage', payload: { bytes: 1 } }))
        .statusCode,
    ).toBe(401);
  });

  it('a new month starts from zero', async () => {
    let now = new Date('2026-10-31T23:59:00Z');
    const svc = new TurnUsageService(getDb().db, 100, () => now);
    await svc.add(150);
    expect(await svc.status()).toMatchObject({ month: '2026-10', usedBytes: 150, exhausted: true });
    now = new Date('2026-11-01T00:01:00Z');
    expect(await svc.status()).toMatchObject({ month: '2026-11', usedBytes: 0, exhausted: false });
  });

  it('without a TURN server the quota is irrelevant (configured: false)', async () => {
    app = await buildTestApp();
    alice = await registerUser(app, { username: 'bob' });
    const res = await req(app, 'GET', '/api/voice/turn-usage', { cookie: alice.cookie });
    expect(res.json().configured).toBe(false);
  });
});
