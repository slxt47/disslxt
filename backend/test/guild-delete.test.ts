import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PassthroughTranscoder } from '../src/lib/voice.js';
import {
  buildTestApp,
  closeDb,
  createGuild,
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

const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(500, 7)]);
let app: FastifyInstance;
let dir: string;
let owner: TestUser;
let member: TestUser;
let guild: { id: string; name: string; inviteCode: string };
let generalId: string;
const sockets: TestSocket[] = [];

beforeEach(async () => {
  await resetDb();
  dir = await mkdtemp(join(tmpdir(), 'disslxt-del-'));
  app = await buildTestApp(
    { voice: { dir, transcode: 'off', ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe' } },
    { transcoder: new PassthroughTranscoder() },
  );
  owner = await registerUser(app, { username: 'owner' });
  member = await registerUser(app, { username: 'member' });
  const g = await createGuild(app, owner, 'Weg damit');
  guild = g.guild;
  generalId = g.general.id;
  await joinGuild(app, member, guild.inviteCode);
});
afterEach(async () => {
  for (const s of sockets.splice(0)) s.ws.terminate();
  await app?.close();
  await rm(dir, { recursive: true, force: true });
});
afterAll(closeDb);

const del = (user: TestUser, name: string) =>
  req(app, 'DELETE', `/api/guilds/${guild.id}`, { cookie: user.cookie, payload: { name } });

describe('deleting a guild', () => {
  it('owner only, with the exact name; members can leave instead', async () => {
    expect((await del(member, 'Weg damit')).statusCode).toBe(403);
    expect((await del(owner, 'weg damit')).statusCode).toBe(400);
    const leave = await req(app, 'POST', `/api/guilds/${guild.id}/leave`, { cookie: owner.cookie });
    expect(leave.json().error.code).toBe('OWNER_CANNOT_LEAVE');
  });

  it('removes channels, messages and voice files; members learn it live', async () => {
    await sendMessage(app, member, generalId, 'bis bald');
    await app.inject({
      method: 'POST',
      url: `/api/channels/${generalId}/voice-messages`,
      headers: { cookie: member.cookie, 'content-type': 'audio/webm' },
      payload: WEBM,
    });
    expect(await readdir(dir)).toHaveLength(1);
    const host = await listen(app);
    const tab = await wsReady(host, member.cookie);
    sockets.push(tab);
    await tab.subscribe(generalId);

    expect((await del(owner, ' Weg damit ')).statusCode).toBe(204);
    expect((await tab.waitFor('guild.deleted')).data.guildId).toBe(guild.id);
    expect(await readdir(dir)).toEqual([]);
    const list = await req(app, 'GET', '/api/guilds', { cookie: member.cookie });
    expect(list.json().guilds).toEqual([]);
    const msgs = await req(app, 'GET', `/api/channels/${generalId}/messages`, {
      cookie: member.cookie,
    });
    expect(msgs.statusCode).toBe(404);
    // The old invite is dead too.
    const invite = await req(app, 'GET', `/api/invites/${guild.inviteCode}`, {
      cookie: member.cookie,
    });
    expect(invite.statusCode).toBe(404);
  });
});
