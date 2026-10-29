import type { FastifyInstance, FastifyRequest } from 'fastify';
import { gifSearchQuery, sendGifSchema, uuidSchema } from '@disslxt/shared';
import type { Config } from '../config.js';
import { notFound } from '../lib/errors.js';
import { parse, parseParam } from '../lib/validate.js';
import { currentUser } from '../plugins/auth.js';
import type { Services } from '../services/index.js';

/** GIF picker (GIPHY search through the server, so the API key stays secret) and GIF messages. */
export async function gifRoutes(
  app: FastifyInstance,
  opts: { services: Services; config: Config },
): Promise<void> {
  const { gifs, channels, messages } = opts.services;
  const perUser = (max: number) => ({
    rateLimit: {
      max,
      timeWindow: 60_000,
      hook: 'preHandler' as const,
      keyGenerator: (req: FastifyRequest) => req.user?.id ?? req.ip,
    },
  });

  app.get('/gifs/status', async () => ({ enabled: gifs.enabled }));

  app.get('/gifs/search', { config: perUser(60) }, async (req) => {
    const { q, offset } = parse(gifSearchQuery, req.query);
    return { gifs: await gifs.search(q, offset) };
  });

  app.post<{ Params: { channelId: string } }>(
    '/channels/:channelId/gifs',
    {
      config: perUser(Math.min(30, opts.config.rateLimit.messageMax)),
    },
    async (req, reply) => {
      const channelId = parseParam(uuidSchema, req.params.channelId, () =>
        notFound('Kanal nicht gefunden'),
      );
      const { id } = parse(sendGifSchema, req.body);
      const user = currentUser(req);
      const channel = await channels.assertTextChannel(user.id, channelId);
      const message = await messages.createGif(user, channel, await gifs.get(id));
      return reply.status(201).send({ message });
    },
  );
}
