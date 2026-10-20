import type { FastifyError, FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../lib/errors.js';

const CODE_BY_STATUS: Record<number, string> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED',
};

/**
 * Maps every error to the uniform shape `{ error: { code, message, details? } }`.
 * 5xx errors are logged with stack; the response never contains internals.
 */
async function errorHandlerPlugin(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((err: FastifyError | AppError, req, reply) => {
    if (err instanceof AppError) {
      if (err.statusCode >= 500) req.log.error({ err }, 'request failed');
      const body: { code: string; message: string; details?: unknown } = {
        code: err.code,
        message: err.message,
      };
      if (err.details !== undefined) body.details = err.details;
      return reply.status(err.statusCode).send({ error: body });
    }

    const status =
      typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600
        ? err.statusCode
        : 500;

    if (status >= 500) {
      req.log.error({ err }, 'unhandled error');
      return reply
        .status(500)
        .send({ error: { code: 'INTERNAL', message: 'Interner Serverfehler' } });
    }

    // Fastify-generated client errors (malformed JSON, unsupported media type, body too large …)
    req.log.info({ code: err.code, msg: err.message }, 'client error');
    const code = CODE_BY_STATUS[status] ?? 'BAD_REQUEST';
    const message =
      err.code === 'FST_ERR_CTP_INVALID_JSON_BODY' || err instanceof SyntaxError
        ? 'Ungültiges JSON'
        : err.message;
    return reply.status(status).send({ error: { code, message } });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        message: `Route ${req.method} ${req.url.split('?')[0]} nicht gefunden`,
      },
    });
  });
}

export default fp(errorHandlerPlugin, { name: 'error-handler' });
