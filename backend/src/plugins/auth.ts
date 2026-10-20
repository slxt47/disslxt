import cookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { UserDto } from '@chat-mvp/shared';
import type { Config } from '../config.js';
import { unauthorized } from '../lib/errors.js';
import type { AuthService } from '../services/auth.service.js';

export const SESSION_COOKIE = 'sid';

declare module 'fastify' {
  interface FastifyRequest {
    user: UserDto | null;
  }
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest) => Promise<void>;
    setSessionCookie: (reply: FastifyReply, token: string) => void;
    clearSessionCookie: (reply: FastifyReply) => void;
  }
}

/**
 * Cookie-based session auth. `requireAuth` (used as preHandler) resolves `request.user` from the
 * opaque `sid` cookie; only the sha256 of the token is stored in the database.
 */
async function authPlugin(
  app: FastifyInstance,
  opts: { config: Config; auth: AuthService },
): Promise<void> {
  await app.register(cookie);
  app.decorateRequest('user', null);

  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: opts.config.cookieSecure,
    path: '/',
  };

  app.decorate('setSessionCookie', (reply: FastifyReply, token: string) => {
    reply.setCookie(SESSION_COOKIE, token, {
      ...cookieOptions,
      maxAge: Math.floor(opts.config.sessionTtlDays * 24 * 60 * 60),
    });
  });

  app.decorate('clearSessionCookie', (reply: FastifyReply) => {
    reply.clearCookie(SESSION_COOKIE, cookieOptions);
  });

  app.decorate('requireAuth', async (req: FastifyRequest) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) throw unauthorized();
    const user = await opts.auth.getUserBySession(token);
    if (!user) throw unauthorized('Sitzung ungültig oder abgelaufen');
    req.user = user;
  });
}

export default fp(authPlugin, { name: 'auth' });

/** Returns the authenticated user; only valid behind requireAuth. */
export function currentUser(req: FastifyRequest): UserDto {
  if (!req.user) throw unauthorized();
  return req.user;
}
