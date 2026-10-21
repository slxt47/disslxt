import { randomUUID } from 'node:crypto';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Config } from './config.js';
import type { Database } from './db/client.js';
import { AppError } from './lib/errors.js';
import { createMailer, MemoryMailer, type Mailer } from './lib/mailer.js';
import { MemoryPushSender, WebPushSender, type PushSender } from './lib/push.js';
import { createTranscoder, type Transcoder } from './lib/voice.js';
import authPlugin from './plugins/auth.js';
import errorHandler from './plugins/errorHandler.js';
import security from './plugins/security.js';
import { Hub } from './realtime/hub.js';
import { MAX_FRAME_BYTES, wsRoutes } from './realtime/ws.route.js';
import { authRoutes } from './routes/auth.routes.js';
import { channelRoutes } from './routes/channel.routes.js';
import { guildRoutes } from './routes/guild.routes.js';
import { healthRoutes } from './routes/health.js';
import { inviteRoutes } from './routes/invite.routes.js';
import { messageRoutes } from './routes/message.routes.js';
import { pushRoutes } from './routes/push.routes.js';
import { voiceRoutes } from './routes/voice.routes.js';
import { createServices, type Services } from './services/index.js';

declare module 'fastify' {
  interface FastifyInstance {
    hub: Hub;
    services: Services;
    mailer: Mailer;
  }
}

export interface BuildAppOptions {
  config: Config;
  db: Database;
  /** Override the logger (e.g. `false` in tests). Defaults to pino configured from config. */
  logger?: FastifyServerOptions['logger'];
  /** Override the mail transport (tests pass a MemoryMailer to read the sent mails). */
  mailer?: Mailer;
  /** Override the push transport (tests pass a MemoryPushSender). Default: Web Push if VAPID
   *  keys are configured, otherwise none. */
  pushSender?: PushSender | null;
  /** Override voice-message conversion (tests). Default from VOICE_TRANSCODE. */
  transcoder?: Transcoder;
  /** Hook to register extra routes before the app is ready (used by tests). */
  extraRoutes?: (app: FastifyInstance) => void | Promise<void>;
}

export function loggerOptions(config: Config): FastifyServerOptions['logger'] {
  return {
    level: config.logLevel,
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'res.headers["set-cookie"]',
        'password',
        '*.password',
        'body.password',
        'body.token',
      ],
      censor: '[REDACTED]',
    },
    ...(config.nodeEnv === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
  };
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const { config, db } = opts;
  const app = Fastify({
    logger: opts.logger ?? loggerOptions(config),
    trustProxy: config.trustProxy,
    bodyLimit: 64 * 1024,
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && /^[\w-]{1,64}$/.test(incoming)
        ? incoming
        : randomUUID();
    },
  });

  const hub = new Hub();
  const mailer = opts.mailer ?? createMailer(config.mail, app.log);
  const pushSender =
    opts.pushSender !== undefined
      ? opts.pushSender
      : config.push
        ? config.push.transport === 'memory'
          ? new MemoryPushSender()
          : new WebPushSender(config.push)
        : null;
  const services = createServices(db, hub, config, mailer, app.log, pushSender);
  app.decorate('hub', hub);
  app.decorate('services', services);
  app.decorate('mailer', mailer);
  app.addHook('onClose', async () => {
    mailer.close();
    await services.push.idle();
  });

  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  // JSON only: drop the text/plain parser (so form-like "simple" requests get 415) and accept an
  // empty body on JSON requests (e.g. POST /logout sent with a JSON content type).
  app.removeContentTypeParser('text/plain');
  const defaultJson = app.getDefaultJsonParser('error', 'error');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    if (body === '' || body === undefined) return done(null, undefined);
    return defaultJson(req, body as string, done);
  });

  await app.register(errorHandler);
  await app.register(security, { config });
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_req, ctx) =>
      new AppError(
        'RATE_LIMITED',
        429,
        `Zu viele Anfragen, bitte in ${ctx.after} erneut versuchen`,
        {
          retryAfterMs: ctx.ttl,
        },
      ),
  });
  await app.register(authPlugin, { config, auth: services.auth });
  await app.register(websocket, { options: { maxPayload: MAX_FRAME_BYTES } });

  await app.register(
    async (api) => {
      await api.register(healthRoutes, { db });
      await api.register(authRoutes, { services, config, hub });
      // Local development / E2E only: read captured mails instead of a real inbox. Never
      // registered in production, where the in-memory transport is rejected anyway.
      if (config.nodeEnv !== 'production' && mailer instanceof MemoryMailer) {
        api.get('/dev/mails', async () => ({ mails: mailer.sent }));
      }
      if (config.nodeEnv !== 'production' && pushSender instanceof MemoryPushSender) {
        api.get('/dev/pushes', async () => {
          await services.push.idle();
          return { pushes: pushSender.sent };
        });
      }
      // Everything below requires a valid session.
      await api.register(async (protectedApi) => {
        protectedApi.addHook('preHandler', protectedApi.requireAuth);
        await protectedApi.register(guildRoutes, { services });
        await protectedApi.register(inviteRoutes, { services });
        await protectedApi.register(channelRoutes, { services });
        await protectedApi.register(messageRoutes, { services, config });
        await protectedApi.register(pushRoutes, { services, config });
        await protectedApi.register(voiceRoutes, {
          services,
          config,
          transcoder: opts.transcoder ?? createTranscoder(config.voice, app.log),
        });
      });
    },
    { prefix: '/api' },
  );

  await app.register(wsRoutes, { services, hub, config });

  if (opts.extraRoutes) await opts.extraRoutes(app);

  return app;
}
