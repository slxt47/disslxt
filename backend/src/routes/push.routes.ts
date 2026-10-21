import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  guildNotificationsSchema,
  pushSubscriptionSchema,
  pushUnsubscribeSchema,
  uuidSchema,
} from '@disslxt/shared';
import type { Config } from '../config.js';
import { notFound } from '../lib/errors.js';
import { parse, parseParam } from '../lib/validate.js';
import { currentUser } from '../plugins/auth.js';
import type { Services } from '../services/index.js';

type GuildParams = { Params: { guildId: string } };

export async function pushRoutes(
  app: FastifyInstance,
  opts: { services: Services; config: Config },
): Promise<void> {
  const { push, guilds } = opts.services;
  const perUser = {
    rateLimit: {
      max: 10,
      timeWindow: 60_000,
      hook: 'preHandler' as const,
      keyGenerator: (req: FastifyRequest) => req.user?.id ?? req.ip,
    },
  };

  app.get('/push/config', async (req) => push.clientConfig(currentUser(req).id));

  app.post('/push/subscriptions', { config: perUser }, async (req, reply) => {
    const sub = parse(pushSubscriptionSchema, req.body);
    await push.subscribe(currentUser(req).id, sub, req.headers['user-agent']);
    return reply.status(201).send({ status: 'subscribed' });
  });

  app.delete('/push/subscriptions', async (req, reply) => {
    const { endpoint } = parse(pushUnsubscribeSchema, req.body);
    await push.unsubscribe(currentUser(req).id, endpoint);
    return reply.status(204).send();
  });

  app.post('/push/test', { config: perUser }, async (req) => ({
    delivered: await push.sendTest(currentUser(req).id),
  }));

  app.put<GuildParams>('/guilds/:guildId/notifications', async (req) => {
    const guildId = parseParam(uuidSchema, req.params.guildId, () =>
      notFound('Server nicht gefunden'),
    );
    const { muted } = parse(guildNotificationsSchema, req.body);
    const userId = currentUser(req).id;
    await guilds.assertMember(userId, guildId);
    await push.setGuildMuted(userId, guildId, muted);
    return { muted };
  });
}
