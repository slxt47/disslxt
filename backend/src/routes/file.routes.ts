import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { FILE_MAX_BYTES, messageIdSchema, uuidSchema } from '@disslxt/shared';
import type { Config } from '../config.js';
import { AppError, notFound } from '../lib/errors.js';
import { contentDisposition, sanitizeFileName, sniffImage } from '../lib/files.js';
import { parseParam } from '../lib/validate.js';
import { currentUser } from '../plugins/auth.js';
import type { Services } from '../services/index.js';
import { parseRange } from './voice.routes.js';

/**
 * Shared files. Upload: raw bytes as application/octet-stream, the name in `?name=`. Download:
 * members only; real images inline, everything else strictly as an attachment with a sandboxing
 * CSP, so an uploaded HTML or SVG file can never run on this origin.
 */
export async function fileRoutes(
  app: FastifyInstance,
  opts: { services: Services; config: Config },
): Promise<void> {
  const { channels, messages } = opts.services;
  const dir = opts.config.files.dir;

  // Only octet-stream: a file that happens to be JSON must not be parsed as a request body.
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: FILE_MAX_BYTES },
    (_req, body, done) => done(null, body),
  );

  app.post<{ Params: { channelId: string }; Querystring: { name?: string } }>(
    '/channels/:channelId/files',
    {
      onRequest: app.requireAuth,
      bodyLimit: FILE_MAX_BYTES,
      config: {
        rateLimit: {
          max: opts.config.rateLimit.messageMax,
          timeWindow: opts.config.rateLimit.messageWindowMs,
          hook: 'preHandler',
          keyGenerator: (req: FastifyRequest) => req.user?.id ?? req.ip,
        },
      },
    },
    async (req, reply) => {
      const channelId = parseParam(uuidSchema, req.params.channelId, () =>
        notFound('Kanal nicht gefunden'),
      );
      const user = currentUser(req);
      const channel = await channels.assertTextChannel(user.id, channelId);
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        throw new AppError('BAD_REQUEST', 400, 'Die Datei ist leer');
      }
      const name = sanitizeFileName(typeof req.query.name === 'string' ? req.query.name : '');
      const mime = sniffImage(body) ?? 'application/octet-stream';
      const key = randomBytes(16).toString('hex');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, key), body);
      try {
        const message = await messages.createFile(user, channel, {
          key,
          name,
          size: body.length,
          mime,
        });
        return reply.status(201).send({ message });
      } catch (err) {
        await rm(join(dir, key), { force: true });
        throw err;
      }
    },
  );

  app.get<{ Params: { messageId: string } }>('/files/:messageId', async (req, reply) => {
    const messageId = parseParam(messageIdSchema, req.params.messageId, () =>
      notFound('Datei nicht gefunden'),
    );
    const file = await messages.sharedFile(currentUser(req).id, messageId);
    const size = await stat(file.path).then(
      (s) => s.size,
      () => {
        throw notFound('Datei nicht gefunden');
      },
    );
    const inline = file.mime.startsWith('image/');
    reply
      .header('Content-Type', inline ? file.mime : 'application/octet-stream')
      .header('Content-Disposition', contentDisposition(file.name, inline))
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('Accept-Ranges', 'bytes')
      .header('Cache-Control', 'private, max-age=86400');
    const range = parseRange(req.headers.range, size);
    if (range === 'unsatisfiable') {
      return reply.status(416).header('Content-Range', `bytes */${size}`).send();
    }
    if (range) {
      reply
        .status(206)
        .header('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
        .header('Content-Length', range.end - range.start + 1);
      return reply.send(createReadStream(file.path, range));
    }
    reply.header('Content-Length', size);
    return reply.send(createReadStream(file.path));
  });
}
