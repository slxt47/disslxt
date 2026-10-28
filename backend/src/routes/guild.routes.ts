import type { FastifyInstance } from 'fastify';
import {
  AVATAR_MAX_BYTES,
  createGuildSchema,
  deleteGuildSchema,
  updateGuildSchema,
  uuidSchema,
} from '@disslxt/shared';
import { acceptImageUploads, sendImage } from '../lib/imageReply.js';
import { currentUser } from '../plugins/auth.js';
import type { Services } from '../services/index.js';
import { parse, parseParam } from '../lib/validate.js';
import { notFound } from '../lib/errors.js';

type GuildParams = { Params: { guildId: string } };
const guildId = (p: { guildId: string }) =>
  parseParam(uuidSchema, p.guildId, () => notFound('Server nicht gefunden'));

/** All routes in this plugin require auth (registered inside the protected scope). */
export async function guildRoutes(
  app: FastifyInstance,
  opts: { services: Services },
): Promise<void> {
  const { guilds } = opts.services;
  acceptImageUploads(app);

  app.get('/guilds', async (req) => ({ guilds: await guilds.listForUser(currentUser(req).id) }));

  app.post('/guilds', async (req, reply) => {
    const { name } = parse(createGuildSchema, req.body);
    const result = await guilds.create(currentUser(req), name);
    return reply.status(201).send(result);
  });

  app.get<GuildParams>('/guilds/:guildId', async (req) => ({
    guild: await guilds.get(currentUser(req).id, guildId(req.params)),
  }));

  app.post<GuildParams>('/guilds/:guildId/leave', async (req, reply) => {
    await guilds.leave(currentUser(req).id, guildId(req.params));
    return reply.status(204).send();
  });

  app.delete<GuildParams>('/guilds/:guildId', async (req, reply) => {
    const { name } = parse(deleteGuildSchema, req.body);
    await guilds.delete(currentUser(req).id, guildId(req.params), name);
    return reply.status(204).send();
  });

  // Server settings (owner only, checked in the service).
  app.patch<GuildParams>('/guilds/:guildId', async (req) => {
    const { name } = parse(updateGuildSchema, req.body);
    return { guild: await guilds.rename(currentUser(req).id, guildId(req.params), name) };
  });

  app.put<GuildParams>(
    '/guilds/:guildId/icon',
    { onRequest: app.requireAuth, bodyLimit: AVATAR_MAX_BYTES },
    async (req) => ({
      guild: await guilds.setIcon(currentUser(req).id, guildId(req.params), req.body),
    }),
  );

  app.delete<GuildParams>('/guilds/:guildId/icon', async (req) => ({
    guild: await guilds.removeIcon(currentUser(req).id, guildId(req.params)),
  }));

  app.get<GuildParams>('/guilds/:guildId/icon', async (req, reply) =>
    sendImage(reply, await guilds.icon(currentUser(req).id, guildId(req.params))),
  );

  app.get<GuildParams>('/guilds/:guildId/members', async (req) => ({
    members: await guilds.members(currentUser(req).id, guildId(req.params)),
  }));
}
