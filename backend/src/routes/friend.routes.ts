import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  addGroupMemberSchema,
  createGroupSchema,
  friendRequestSchema,
  openDmSchema,
  renameGroupSchema,
  uuidSchema,
} from '@disslxt/shared';
import type { Config } from '../config.js';
import { notFound } from '../lib/errors.js';
import { parse, parseParam } from '../lib/validate.js';
import { currentUser } from '../plugins/auth.js';
import type { Services } from '../services/index.js';

type UserParams = { Params: { userId: string } };
const userId = (p: { userId: string }) =>
  parseParam(uuidSchema, p.userId, () => notFound('Benutzer nicht gefunden'));

/** Friends and private conversations (all routes require auth). */
export async function friendRoutes(
  app: FastifyInstance,
  opts: { services: Services; config: Config },
): Promise<void> {
  const { friends, dms, channels } = opts.services;

  app.get('/friends', async (req) => ({ friends: await friends.list(currentUser(req).id) }));

  // Requests reveal whether a username exists, so they share the (per-user) message limit.
  app.post(
    '/friends/requests',
    {
      config: {
        rateLimit: {
          max: Math.min(30, opts.config.rateLimit.messageMax),
          timeWindow: opts.config.rateLimit.messageWindowMs,
          hook: 'preHandler',
          keyGenerator: (req: FastifyRequest) => req.user?.id ?? req.ip,
        },
      },
    },
    async (req, reply) => {
      const { username } = parse(friendRequestSchema, req.body);
      return reply
        .status(201)
        .send({ friend: await friends.request(currentUser(req).id, username) });
    },
  );

  app.post<UserParams>('/friends/:userId/accept', async (req) => ({
    friend: await friends.accept(currentUser(req).id, userId(req.params)),
  }));

  app.delete<UserParams>('/friends/:userId', async (req, reply) => {
    await friends.remove(currentUser(req).id, userId(req.params));
    return reply.status(204).send();
  });

  app.get('/dms', async (req) => ({ dms: await dms.list(currentUser(req).id) }));

  app.post('/dms', async (req) => {
    const { userId: peerId } = parse(openDmSchema, req.body);
    return { dm: await dms.open(currentUser(req).id, peerId) };
  });

  // Group chats: start one with friends, rename, add people, remove / leave.
  type GroupParams = { Params: { channelId: string; userId?: string } };
  const groupId = (p: { channelId: string }) =>
    parseParam(uuidSchema, p.channelId, () => notFound('Gruppe nicht gefunden'));

  app.post('/groups', async (req, reply) => {
    const { name, userIds } = parse(createGroupSchema, req.body);
    return reply
      .status(201)
      .send({ dm: await dms.createGroup(currentUser(req).id, name, userIds) });
  });

  app.patch<GroupParams>('/groups/:channelId', async (req) => {
    const { name } = parse(renameGroupSchema, req.body);
    return { dm: await dms.renameGroup(currentUser(req).id, groupId(req.params), name) };
  });

  app.post<GroupParams>('/groups/:channelId/members', async (req) => {
    const { userId: newId } = parse(addGroupMemberSchema, req.body);
    return { dm: await dms.addMember(currentUser(req).id, groupId(req.params), newId) };
  });

  /** `me` leaves; anyone else is removed (owner only). */
  app.delete<{ Params: { channelId: string; userId: string } }>(
    '/groups/:channelId/members/:userId',
    async (req, reply) => {
      const me = currentUser(req).id;
      const target = req.params.userId === 'me' ? me : userId(req.params);
      await dms.removeMember(me, groupId(req.params), target);
      return reply.status(204).send();
    },
  );

  /** Who is in the call of a private conversation right now. */
  app.get<{ Params: { channelId: string } }>('/dms/:channelId/call', async (req) => {
    const id = parseParam(uuidSchema, req.params.channelId, () => notFound('Kanal nicht gefunden'));
    await channels.assertAccess(currentUser(req).id, id);
    return { peers: channels.callPeers(id) };
  });
}
