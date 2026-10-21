import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  editMessageSchema,
  listMessagesQuery,
  messageIdSchema,
  sendMessageSchema,
  uuidSchema,
} from '@disslxt/shared';
import type { Config } from '../config.js';
import { currentUser } from '../plugins/auth.js';
import type { Services } from '../services/index.js';
import { parse, parseParam } from '../lib/validate.js';
import { notFound } from '../lib/errors.js';

type ChannelParams = { Params: { channelId: string } };
type MessageParams = { Params: { messageId: string } };
const channelId = (p: { channelId: string }) =>
  parseParam(uuidSchema, p.channelId, () => notFound('Kanal nicht gefunden'));
const messageId = (p: { messageId: string }) =>
  parseParam(messageIdSchema, p.messageId, () => notFound('Nachricht nicht gefunden'));

export async function messageRoutes(
  app: FastifyInstance,
  opts: { services: Services; config: Config },
): Promise<void> {
  const { messages } = opts.services;

  app.get<ChannelParams>('/channels/:channelId/messages', async (req) => {
    const id = channelId(req.params);
    const query = parse(listMessagesQuery, req.query);
    return messages.listPage(currentUser(req).id, id, query);
  });

  app.post<ChannelParams>(
    '/channels/:channelId/messages',
    {
      config: {
        rateLimit: {
          max: opts.config.rateLimit.messageMax,
          timeWindow: opts.config.rateLimit.messageWindowMs,
          // Runs after requireAuth (scope-level preHandler), so the key is the user id.
          hook: 'preHandler',
          keyGenerator: (req: FastifyRequest) => req.user?.id ?? req.ip,
        },
      },
    },
    async (req, reply) => {
      const id = channelId(req.params);
      const { content } = parse(sendMessageSchema, req.body);
      const message = await messages.create(currentUser(req), id, content);
      return reply.status(201).send({ message });
    },
  );

  app.patch<MessageParams>('/messages/:messageId', async (req) => {
    const id = messageId(req.params);
    const { content } = parse(editMessageSchema, req.body);
    return { message: await messages.edit(currentUser(req), id, content) };
  });

  app.delete<MessageParams>('/messages/:messageId', async (req, reply) => {
    await messages.delete(currentUser(req).id, messageId(req.params));
    return reply.status(204).send();
  });
}
