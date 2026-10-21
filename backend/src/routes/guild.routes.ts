import type { FastifyInstance } from 'fastify';
import { createGuildSchema, uuidSchema } from '@disslxt/shared';
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

  app.get<GuildParams>('/guilds/:guildId/members', async (req) => ({
    members: await guilds.members(currentUser(req).id, guildId(req.params)),
  }));
}
