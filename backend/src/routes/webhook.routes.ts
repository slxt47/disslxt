import type { FastifyInstance } from 'fastify';
import { messageContentSchema, uuidSchema } from '@disslxt/shared';
import { z } from 'zod';
import type { Config } from '../config.js';
import { notFound, unauthorized } from '../lib/errors.js';
import { parse, parseParam } from '../lib/validate.js';
import type { Services } from '../services/index.js';

/**
 * Public: programs post here. The secret travels in a header, so it never lands in access logs.
 */
export async function webhookRoutes(
  app: FastifyInstance,
  opts: { services: Services; config: Config },
): Promise<void> {
  const body = z.object({ content: messageContentSchema });

  app.post<{ Params: { id: string } }>(
    '/hooks/:id',
    {
      bodyLimit: 16 * 1024,
      config: {
        rateLimit: {
          max: opts.config.rateLimit.loginMax * 6,
          timeWindow: opts.config.rateLimit.loginWindowMs,
        },
      },
    },
    async (req, reply) => {
      const id = parseParam(uuidSchema, req.params.id, () => notFound('Webhook nicht gefunden'));
      const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
      if (!token) throw unauthorized();
      const { content } = parse(body, req.body);
      await opts.services.webhooks.deliver(id, token, content);
      return reply.status(204).send();
    },
  );
}
