import helmet from '@fastify/helmet';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Config } from '../config.js';
import { forbidden } from '../lib/errors.js';
import { isAllowedOrigin, requestHost, requestOrigin } from '../lib/origin.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Security headers (helmet, strict API CSP) and CSRF origin check:
 * mutating requests carrying an Origin that is neither same-origin nor in ALLOWED_ORIGINS are
 * rejected with 403 BAD_ORIGIN. (Non-browser clients without Origin are allowed; browsers always
 * send Origin on cross-site POST/PATCH/DELETE.)
 */
async function securityPlugin(app: FastifyInstance, opts: { config: Config }): Promise<void> {
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    hsts: opts.config.cookieSecure,
  });

  app.addHook('onRequest', async (req) => {
    if (SAFE_METHODS.has(req.method)) return;
    const origin = requestOrigin(req);
    if (origin === undefined) return;
    if (!isAllowedOrigin(origin, requestHost(req), opts.config)) {
      throw forbidden('Ungültige Herkunft (Origin)', 'BAD_ORIGIN');
    }
  });
}

export default fp(securityPlugin, { name: 'security' });
