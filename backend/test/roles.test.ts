import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { users } from '../src/db/schema.js';
import {
  buildTestApp,
  closeDb,
  getDb,
  listen,
  registerUser,
  req,
  resetDb,
  userBadgesInsert,
  wsConnect,
  type TestUser,
} from './helpers.js';

let app: FastifyInstance;
let owner: TestUser;
let admin: TestUser;
let admin2: TestUser;
let alice: TestUser;
let bob: TestUser;

const setRole = (u: TestUser, role: 'owner' | 'admin') =>
  getDb().db.update(users).set({ role }).where(eq(users.id, u.user.id));
const kick = (by: TestUser, target: TestUser) =>
  req(app, 'POST', `/api/admin/users/${target.user.id}/kick`, { cookie: by.cookie });
const promote = (by: TestUser, target: TestUser, role: 'admin' | 'user') =>
  req(app, 'PUT', `/api/admin/users/${target.user.id}/role`, {
    cookie: by.cookie,
    payload: { role },
  });
const stillSignedIn = async (u: TestUser) =>
  (await req(app, 'GET', '/api/auth/me', { cookie: u.cookie })).statusCode === 200;
const roleOf = async (u: TestUser) =>
  (await getDb().db.select().from(users).where(eq(users.id, u.user.id)))[0]?.role;

beforeEach(async () => {
  await resetDb();
  app = await buildTestApp();
  owner = await registerUser(app, { username: 'theowner' });
  admin = await registerUser(app, { username: 'theadmin' });
  admin2 = await registerUser(app, { username: 'otheradmin' });
  alice = await registerUser(app, { username: 'alice' });
  bob = await registerUser(app, { username: 'bob' });
  await setRole(owner, 'owner');
  await setRole(admin, 'admin');
  await setRole(admin2, 'admin');
});
afterEach(async () => {
  await app.close();
});
afterAll(closeDb);

describe('kicking', () => {
  it('owner kicks an admin and a user; their sessions die at once', async () => {
    expect((await kick(owner, admin)).statusCode).toBe(204);
    expect((await kick(owner, alice)).statusCode).toBe(204);
    expect(await stillSignedIn(admin)).toBe(false);
    expect(await stillSignedIn(alice)).toBe(false);
    expect(await stillSignedIn(bob)).toBe(true);
  });

  it('admin kicks normal users only', async () => {
    expect((await kick(admin, alice)).statusCode).toBe(204);
    expect(await stillSignedIn(alice)).toBe(false);
    expect((await kick(admin, admin2)).statusCode).toBe(403);
    expect(await stillSignedIn(admin2)).toBe(true);
  });

  it('nobody can kick the owner, not even themselves or an admin', async () => {
    for (const actor of [admin, alice, owner]) {
      const res = await kick(actor, owner);
      expect(res.statusCode).toBe(actor === alice ? 403 : actor === owner ? 400 : 403);
    }
    expect((await kick(admin, owner)).json().error.code).toBe('OWNER_PROTECTED');
    expect(await stillSignedIn(owner)).toBe(true);
  });

  it('normal users cannot kick anyone; unknown ids are 404; no login is 401', async () => {
    expect((await kick(alice, bob)).statusCode).toBe(403);
    expect(await stillSignedIn(bob)).toBe(true);
    const unknown = await req(
      app,
      'POST',
      '/api/admin/users/00000000-0000-4000-8000-000000000000/kick',
      { cookie: owner.cookie },
    );
    expect(unknown.statusCode).toBe(404);
    const anon = await req(app, 'POST', `/api/admin/users/${bob.user.id}/kick`);
    expect(anon.statusCode).toBe(401);
  });

  it('closes the open socket of a kicked user', async () => {
    const host = await listen(app);
    const socket = wsConnect(host, { cookie: alice.cookie });
    await socket.waitFor('ready');
    expect((await kick(admin, alice)).statusCode).toBe(204);
    expect((await socket.closed).code).toBe(4401);
  });
});

describe('roles', () => {
  it('owner promotes and demotes; the role is seen by the user at once', async () => {
    expect((await promote(owner, alice, 'admin')).statusCode).toBe(204);
    expect(await roleOf(alice)).toBe('admin');
    const me = await req(app, 'GET', '/api/auth/me', { cookie: alice.cookie });
    expect(me.json().user.role).toBe('admin');
    expect((await kick(alice, bob)).statusCode).toBe(204);
    expect((await promote(owner, alice, 'user')).statusCode).toBe(204);
    expect(await roleOf(alice)).toBe('user');
  });

  it('admins and users cannot change roles', async () => {
    expect((await promote(admin, alice, 'admin')).statusCode).toBe(403);
    expect((await promote(admin, admin2, 'user')).statusCode).toBe(403);
    expect((await promote(alice, alice, 'admin')).statusCode).toBe(403);
    expect(await roleOf(alice)).toBe('user');
    expect(await roleOf(admin2)).toBe('admin');
  });

  it('the owner cannot be demoted, and no API call can create a second owner', async () => {
    const res = await promote(owner, owner, 'user');
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('OWNER_PROTECTED');
    expect(await roleOf(owner)).toBe('owner');
    expect((await promote(owner, alice, 'owner' as never)).statusCode).toBe(400);
    await expect(setRole(alice, 'owner')).rejects.toThrow(); // one owner, enforced by the database
  });

  it('demoting takes admin-only badges away', async () => {
    await promote(owner, alice, 'admin');
    expect(
      (
        await req(app, 'PUT', '/api/users/me/badges', {
          cookie: alice.cookie,
          payload: { badgeIds: ['admin'] },
        })
      ).statusCode,
    ).toBe(200);
    await promote(owner, alice, 'user');
    const mine = await req(app, 'GET', '/api/users/me/badges', { cookie: alice.cookie });
    expect(mine.json().shown).toEqual([]);
  });
});

describe('admin area endpoints', () => {
  it('user list: moderators only', async () => {
    const list = await req(app, 'GET', '/api/admin/users', { cookie: admin.cookie });
    expect(list.statusCode).toBe(200);
    const roles = Object.fromEntries(
      list.json().users.map((u: { username: string; role: string }) => [u.username, u.role]),
    );
    expect(roles).toMatchObject({ theowner: 'owner', theadmin: 'admin', alice: 'user' });
    expect(JSON.stringify(list.json())).not.toContain('@example.com'); // no e-mail addresses
    expect((await req(app, 'GET', '/api/admin/users', { cookie: alice.cookie })).statusCode).toBe(
      403,
    );
    expect((await req(app, 'GET', '/api/admin/storage', { cookie: alice.cookie })).statusCode).toBe(
      403,
    );
    expect((await req(app, 'GET', '/api/admin/storage', { cookie: admin.cookie })).statusCode).toBe(
      200,
    );
  });
});

describe('profiles and badges', () => {
  it('profile of another user: role, shown badges, sign-up date', async () => {
    const res = await req(app, 'GET', `/api/users/${owner.user.id}/profile`, {
      cookie: alice.cookie,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().profile).toMatchObject({ username: 'theowner', role: 'owner', badges: [] });
    expect(res.json().profile.email).toBeUndefined();
    expect((await req(app, 'GET', `/api/users/${owner.user.id}/profile`)).statusCode).toBe(401);
  });

  it('users choose only from the badges they may wear (max 3, no duplicates)', async () => {
    const put = (badgeIds: string[]) =>
      req(app, 'PUT', '/api/users/me/badges', { cookie: alice.cookie, payload: { badgeIds } });
    const mine = await req(app, 'GET', '/api/users/me/badges', { cookie: alice.cookie });
    expect(mine.json().available.map((b: { id: string }) => b.id)).toEqual(['member']);
    expect((await put(['member'])).json().user.badges).toEqual(['member']);
    expect((await put(['owner'])).statusCode).toBe(403);
    expect((await put(['admin'])).statusCode).toBe(403);
    expect((await put(['early-adopter'])).statusCode).toBe(403);
    expect((await put(['nope'])).statusCode).toBe(403);
    expect((await put(['member', 'member'])).statusCode).toBe(400);
    expect((await put(['a', 'b', 'c', 'd'])).statusCode).toBe(400);
    await userBadgesInsert(alice, 'early-adopter');
    expect((await put(['early-adopter', 'member'])).json().user.badges).toEqual([
      'early-adopter',
      'member',
    ]);
    // Others see them on the profile.
    const seen = await req(app, 'GET', `/api/users/${alice.user.id}/profile`, {
      cookie: bob.cookie,
    });
    expect(seen.json().profile.badges).toEqual(['early-adopter', 'member']);
    expect((await put([])).json().user.badges).toEqual([]);
  });

  it('the display name shows up in profile and member data', async () => {
    const r = await req(app, 'PATCH', '/api/users/me', {
      cookie: alice.cookie,
      payload: { displayName: 'Ali C.' },
    });
    expect(r.statusCode).toBe(200);
    const seen = await req(app, 'GET', `/api/users/${alice.user.id}/profile`, {
      cookie: bob.cookie,
    });
    expect(seen.json().profile).toMatchObject({ displayName: 'Ali C.', username: 'alice' });
  });
});
