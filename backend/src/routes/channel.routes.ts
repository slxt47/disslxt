import type { FastifyInstance } from 'fastify';
import {
  categoryOrderSchema,
  categorySchema,
  channelAccessSchema,
  channelOrderSchema,
  createChannelSchema,
  createWebhookSchema,
  deleteChannelSchema,
  updateChannelSchema,
  uuidSchema,
} from '@disslxt/shared';
import { currentUser } from '../plugins/auth.js';
import type { Services } from '../services/index.js';
import { parse, parseParam } from '../lib/validate.js';
import { notFound } from '../lib/errors.js';

type GuildParams = { Params: { guildId: string } };
type ChannelParams = { Params: { channelId: string } };
type CategoryParams = { Params: { guildId: string; categoryId: string } };
const categoryId = (p: { categoryId: string }) =>
  parseParam(uuidSchema, p.categoryId, () => notFound('Kategorie nicht gefunden'));
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

  const { webhooks } = opts.services;

  app.get<ChannelParams>('/channels/:channelId/webhooks', async (req) => ({
    webhooks: await webhooks.list(currentUser(req).id, channelId(req.params)),
  }));

  app.post<ChannelParams>('/channels/:channelId/webhooks', async (req, reply) => {
    const { name } = parse(createWebhookSchema, req.body);
    return reply
      .status(201)
      .send(await webhooks.create(currentUser(req).id, channelId(req.params), name));
  });

  app.delete<{ Params: { channelId: string; id: string } }>(
    '/channels/:channelId/webhooks/:id',
    async (req, reply) => {
      const id = parseParam(uuidSchema, req.params.id, () => notFound('Webhook nicht gefunden'));
      await webhooks.remove(currentUser(req).id, channelId(req.params), id);
      return reply.status(204).send();
    },
  );

  // Managing channels needs manage_channels (checked in the service).
  app.patch<ChannelParams>('/channels/:channelId', async (req) => {
    const patch = parse(updateChannelSchema, req.body);
    return { channel: await channels.update(currentUser(req).id, channelId(req.params), patch) };
  });

  app.delete<ChannelParams>('/channels/:channelId', async (req, reply) => {
    const { name } = parse(deleteChannelSchema, req.body);
    await channels.remove(currentUser(req).id, channelId(req.params), name);
    return reply.status(204).send();
  });

  app.put<GuildParams>('/guilds/:guildId/channels/order', async (req, reply) => {
    const { channels: order } = parse(channelOrderSchema, req.body);
    await channels.reorder(currentUser(req).id, guildId(req.params), order);
    return reply.status(204).send();
  });

  app.get<GuildParams>('/guilds/:guildId/categories', async (req) => ({
    categories: await channels.categories(currentUser(req).id, guildId(req.params)),
  }));

  app.post<GuildParams>('/guilds/:guildId/categories', async (req, reply) => {
    const { name } = parse(categorySchema, req.body);
    const category = await channels.createCategory(currentUser(req).id, guildId(req.params), name);
    return reply.status(201).send({ category });
  });

  app.put<GuildParams>('/guilds/:guildId/categories/order', async (req, reply) => {
    const { categoryIds } = parse(categoryOrderSchema, req.body);
    await channels.reorderCategories(currentUser(req).id, guildId(req.params), categoryIds);
    return reply.status(204).send();
  });

  app.patch<CategoryParams>('/guilds/:guildId/categories/:categoryId', async (req) => {
    const { name } = parse(categorySchema, req.body);
    const id = categoryId(req.params);
    return {
      category: await channels.renameCategory(currentUser(req).id, guildId(req.params), id, name),
    };
  });

  app.delete<CategoryParams>('/guilds/:guildId/categories/:categoryId', async (req, reply) => {
    await channels.deleteCategory(currentUser(req).id, guildId(req.params), categoryId(req.params));
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
