import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  AVATAR_MAX_BYTES,
  confirmTwoFactorSchema,
  deleteAccountSchema,
  enableTwoFactorSchema,
  passwordConfirmSchema,
  setBadgesSchema,
  setRoleSchema,
  updateProfileSchema,
  uuidSchema,
} from '@disslxt/shared';
import type { Config } from '../config.js';
import { notFound } from '../lib/errors.js';
import { acceptImageUploads, sendImage } from '../lib/imageReply.js';
import { parse, parseParam } from '../lib/validate.js';
import { currentUser, SESSION_COOKIE } from '../plugins/auth.js';
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

  // Deletes the account with everything in it (see AccountService); the password confirms it.
  // Rate-limited like the login, since a wrong password here is a password guess as well.
  app.delete(
    '/users/me',
    {
      config: {
        rateLimit: {
          max: opts.config.rateLimit.loginMax,
          timeWindow: opts.config.rateLimit.loginWindowMs,
        },
      },
    },
    async (req, reply) => {
      const { password } = parse(deleteAccountSchema, req.body);
      await opts.services.accounts.delete(currentUser(req).id, password);
      app.clearSessionCookie(reply);
      return reply.status(204).send();
    },
  );

  // --- Second factor, devices, data export ------------------------------------------------------
  const { security } = opts.services;
  // Password and code checks are guesses as well, so they are limited like the login.
  const guessLimit = {
    config: {
      rateLimit: {
        max: opts.config.rateLimit.loginMax,
        timeWindow: opts.config.rateLimit.loginWindowMs,
      },
    },
  };

  app.get('/account/two-factor', async (req) => security.status(currentUser(req).id));

  app.post('/account/two-factor/setup', guessLimit, async (req) => {
    const { password } = parse(passwordConfirmSchema, req.body);
    return security.startSetup(currentUser(req).id, password);
  });

  app.post('/account/two-factor/enable', guessLimit, async (req) => {
    const { code } = parse(enableTwoFactorSchema, req.body);
    return { recoveryCodes: await security.enable(currentUser(req).id, code) };
  });

  app.post('/account/two-factor/disable', guessLimit, async (req, reply) => {
    const { password, code } = parse(confirmTwoFactorSchema, req.body);
    await security.disable(currentUser(req).id, password, code);
    return reply.status(204).send();
  });

  app.post('/account/two-factor/recovery-codes', guessLimit, async (req) => {
    const { password, code } = parse(confirmTwoFactorSchema, req.body);
    return { recoveryCodes: await security.newRecoveryCodes(currentUser(req).id, password, code) };
  });

  const sessionToken = (req: FastifyRequest): string => req.cookies[SESSION_COOKIE] ?? '';

  app.get('/account/sessions', async (req) => ({
    sessions: await security.sessions(currentUser(req).id, sessionToken(req)),
  }));

  app.delete<{ Params: { sessionId: string } }>(
    '/account/sessions/:sessionId',
    async (req, reply) => {
      const id = parseParam(uuidSchema, req.params.sessionId, () =>
        notFound('Sitzung nicht gefunden'),
      );
      await security.endSession(currentUser(req).id, id);
      return reply.status(204).send();
    },
  );

  app.post('/account/sessions/end-others', async (req) => ({
    ended: await security.endOtherSessions(currentUser(req).id, sessionToken(req)),
  }));

  // One file with everything; limited per person, because it reads all of their messages.
  app.get(
    '/account/export',
    {
      config: {
        rateLimit: {
          max: 3,
          timeWindow: 60 * 60 * 1000,
          hook: 'preHandler',
          keyGenerator: (req: FastifyRequest) => req.user?.id ?? req.ip,
        },
      },
    },
    async (req, reply) => {
      const data = await security.exportData(currentUser(req).id);
      return reply
        .header('Content-Disposition', 'attachment; filename="disslxt-export.json"')
        .header('Cache-Control', 'no-store')
        .send(data);
    },
  );

  app.put(
    '/users/me/avatar',
    // Auth before the body is read, like the file upload.
    { onRequest: app.requireAuth, bodyLimit: AVATAR_MAX_BYTES, config: uploadLimit },
    async (req) => ({ user: await users.setAvatar(currentUser(req).id, req.body) }),
  );

  app.delete('/users/me/avatar', async (req) => ({
    user: await users.removeAvatar(currentUser(req).id),
  }));

  app.get('/badges', async () => ({ badges: await opts.services.badges.catalogue() }));

  app.get('/users/me/badges', async (req) => opts.services.badges.mine(currentUser(req).id));

  app.put('/users/me/badges', async (req) => {
    const { badgeIds } = parse(setBadgesSchema, req.body);
    return { user: await users.setBadges(currentUser(req).id, badgeIds) };
  });

  app.get<{ Params: { userId: string } }>('/users/:userId/profile', async (req) => {
    const id = parseParam(uuidSchema, req.params.userId, () => notFound('Benutzer nicht gefunden'));
    return { profile: await users.profile(id) };
  });

  // --- Admin area: admins and the owner (checked per request against the stored role) ---------

  /** Storage use against the cap. */
  app.get('/admin/storage', async (req) => {
    opts.services.admin.assertModerator(currentUser(req).role ?? 'user');
    return opts.services.storage.status();
  });

  app.get('/admin/users', async (req) => ({
    users: await opts.services.admin.listUsers(currentUser(req).role ?? 'user'),
  }));

  app.post<{ Params: { userId: string } }>('/admin/users/:userId/kick', async (req, reply) => {
    const id = parseParam(uuidSchema, req.params.userId, () => notFound('Benutzer nicht gefunden'));
    await opts.services.admin.kick(currentUser(req).id, id);
    return reply.status(204).send();
  });

  app.put<{ Params: { userId: string } }>('/admin/users/:userId/role', async (req, reply) => {
    const id = parseParam(uuidSchema, req.params.userId, () => notFound('Benutzer nicht gefunden'));
    const { role } = parse(setRoleSchema, req.body);
    await opts.services.admin.setRole(currentUser(req).id, id, role);
    return reply.status(204).send();
  });

  app.get<{ Params: { userId: string } }>('/users/:userId/avatar', async (req, reply) => {
    const id = parseParam(uuidSchema, req.params.userId, () => notFound('Kein Bild'));
    return sendImage(reply, await users.avatar(id));
  });
}
