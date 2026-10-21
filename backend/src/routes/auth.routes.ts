import type { FastifyInstance } from 'fastify';
import {
  loginSchema,
  registerSchema,
  resendVerificationSchema,
  verifyEmailSchema,
} from '@disslxt/shared';
import type { Config } from '../config.js';
import { currentUser, SESSION_COOKIE } from '../plugins/auth.js';
import { WS_CLOSE } from '@disslxt/shared';
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

  // Per IP; mails per address are limited separately in the service (MAIL_MAX_PER_ADDRESS_PER_HOUR).
  const mailLimit = {
    rateLimit: {
      max: opts.config.rateLimit.mailMax,
      timeWindow: opts.config.rateLimit.mailWindowMs,
    },
  };

  // Same answer whether or not the address is taken; no session before the e-mail is confirmed.
  app.post('/auth/register', { config: mailLimit }, async (req, reply) => {
    const input = parse(registerSchema, req.body);
    await auth.register(input);
    return reply.status(202).send({ status: 'verification_sent' });
  });

  // POST, not GET: link scanners in mail clients fetch links but do not submit forms, so they
  // cannot burn the token. A successful confirmation logs the user in.
  app.post('/auth/verify-email', { config: loginLimit }, async (req, reply) => {
    const { token } = parse(verifyEmailSchema, req.body);
    const { user, token: sessionToken, next } = await auth.verifyEmail(token);
    app.setSessionCookie(reply, sessionToken);
    return { user, next };
  });

  app.post('/auth/resend-verification', { config: mailLimit }, async (req, reply) => {
    const { email } = parse(resendVerificationSchema, req.body);
    await auth.resendVerification(email);
    return reply.status(202).send({ status: 'verification_sent' });
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
