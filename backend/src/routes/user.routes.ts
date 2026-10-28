import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AVATAR_MAX_BYTES, updateProfileSchema, uuidSchema } from '@disslxt/shared';
import type { Config } from '../config.js';
import { forbidden, notFound } from '../lib/errors.js';
import { acceptImageUploads, sendImage } from '../lib/imageReply.js';
import { parse, parseParam } from '../lib/validate.js';
import { currentUser } from '../plugins/auth.js';
import type { Services } from '../services/index.js';

/** Profile settings and profile pictures (all routes require auth). */
export async function userRoutes(
  app: FastifyInstance,
  opts: { services: Services; config: Config },
): Promise<void> {
  const { users } = opts.services;
  acceptImageUploads(app);
  const uploadLimit = {
    rateLimit: {
      max: opts.config.rateLimit.messageMax,
      timeWindow: opts.config.rateLimit.messageWindowMs,
      hook: 'preHandler' as const,
      keyGenerator: (req: FastifyRequest) => req.user?.id ?? req.ip,
    },
  };

  app.patch('/users/me', async (req) => {
    return {
      user: await users.updateProfile(currentUser(req).id, parse(updateProfileSchema, req.body)),
    };
  });

  app.put(
    '/users/me/avatar',
    // Auth before the body is read, like the file upload.
    { onRequest: app.requireAuth, bodyLimit: AVATAR_MAX_BYTES, config: uploadLimit },
    async (req) => ({ user: await users.setAvatar(currentUser(req).id, req.body) }),
  );

  app.delete('/users/me/avatar', async (req) => ({
    user: await users.removeAvatar(currentUser(req).id),
  }));

  /** Storage use against the cap: only for accounts with the 'admin' badge. */
  app.get('/admin/storage', async (req) => {
    if (currentUser(req).badge !== 'admin') throw forbidden('Nur für Admins');
    return opts.services.storage.status();
  });

  app.get<{ Params: { userId: string } }>('/users/:userId/avatar', async (req, reply) => {
    const id = parseParam(uuidSchema, req.params.userId, () => notFound('Kein Bild'));
    return sendImage(reply, await users.avatar(id));
  });
}
