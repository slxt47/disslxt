import type { FastifyInstance } from 'fastify';
import { loginSchema, registerSchema } from '@chat-mvp/shared';
import type { Config } from '../config.js';
import { currentUser, SESSION_COOKIE } from '../plugins/auth.js';
import { WS_CLOSE } from '@chat-mvp/shared';
import type { Hub } from '../realtime/hub.js';
import type { Services } from '../services/index.js';
import { parse } from '../lib/validate.js';
import { sha256 } from '../lib/tokens.js';

export async function authRoutes(
  app: FastifyInstance,
  opts: { services: Services; config: Config; hub: Hub },
): Promise<void> {
  const { auth } = opts.services;
  const loginLimit = {
    rateLimit: {
      max: opts.config.rateLimit.loginMax,
      timeWindow: opts.config.rateLimit.loginWindowMs,
    },
  };

  app.post('/auth/register', { config: loginLimit }, async (req, reply) => {
    const input = parse(registerSchema, req.body);
    const { user, token } = await auth.register(input);
    app.setSessionCookie(reply, token);
    return reply.status(201).send({ user });
  });

  app.post('/auth/login', { config: loginLimit }, async (req, reply) => {
    const input = parse(loginSchema, req.body);
    const { user, token } = await auth.login(input);
    app.setSessionCookie(reply, token);
    return { user };
  });

  app.post('/auth/logout', { preHandler: app.requireAuth }, async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) {
      await auth.logout(token);
      opts.hub.closeSession(sha256(token), WS_CLOSE.UNAUTHORIZED, 'logged out');
    }
    app.clearSessionCookie(reply);
    return reply.status(204).send();
  });

  app.get('/auth/me', { preHandler: app.requireAuth }, async (req) => ({ user: currentUser(req) }));
}
