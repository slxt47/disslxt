import type { FastifyInstance } from 'fastify';
import { channelAccessSchema, createChannelSchema, uuidSchema } from '@disslxt/shared';
import { currentUser } from '../plugins/auth.js';
import type { Services } from '../services/index.js';
import { parse, parseParam } from '../lib/validate.js';
import { notFound } from '../lib/errors.js';

type GuildParams = { Params: { guildId: string } };
type ChannelParams = { Params: { channelId: string } };
const channelId = (p: { channelId: string }) =>
  parseParam(uuidSchema, p.channelId, () => notFound('Kanal nicht gefunden'));
const guildId = (p: { guildId: string }) =>
  parseParam(uuidSchema, p.guildId, () => notFound('Server nicht gefunden'));

export async function channelRoutes(
  app: FastifyInstance,
  opts: { services: Services },
): Promise<void> {
  const { channels, roles } = opts.services;

  app.get<ChannelParams>('/channels/:channelId/access', async (req) =>
    roles.channelAccess(currentUser(req).id, channelId(req.params)),
  );

  app.put<ChannelParams>('/channels/:channelId/access', async (req, reply) => {
    const { restricted, roleIds } = parse(channelAccessSchema, req.body);
    await roles.setChannelAccess(currentUser(req).id, channelId(req.params), restricted, roleIds);
    return reply.status(204).send();
  });

  app.get<GuildParams>('/guilds/:guildId/channels', async (req) => ({
    channels: await channels.list(currentUser(req).id, guildId(req.params)),
  }));

  app.get<GuildParams>('/guilds/:guildId/voice', async (req) => ({
    channels: await channels.voiceState(currentUser(req).id, guildId(req.params)),
  }));

  app.post<GuildParams>('/guilds/:guildId/channels', async (req, reply) => {
    const id = guildId(req.params);
    const { name, kind } = parse(createChannelSchema, req.body);
    const channel = await channels.create(currentUser(req).id, id, name, kind);
    return reply.status(201).send({ channel });
  });
}
