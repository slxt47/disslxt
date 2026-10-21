import { createReadStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  messageIdSchema,
  uuidSchema,
  VOICE_MAX_BYTES,
  VOICE_MAX_SECONDS,
  VOICE_UPLOAD_TYPES,
} from '@disslxt/shared';
import type { Config } from '../config.js';
import { AppError, notFound } from '../lib/errors.js';
import { parseParam } from '../lib/validate.js';
import { isBadInput, sniffAudio, type Transcoder } from '../lib/voice.js';
import { currentUser } from '../plugins/auth.js';
import type { Services } from '../services/index.js';

const unsupported = (message = 'Keine gültige Audiodatei') =>
  new AppError('UNSUPPORTED_MEDIA_TYPE', 415, message);

/**
 * Voice messages: raw audio upload (the recording's own MIME type as Content-Type) and a
 * member-only download with HTTP range support (Safari needs ranges to play audio).
 */
export async function voiceRoutes(
  app: FastifyInstance,
  opts: { services: Services; config: Config; transcoder: Transcoder },
): Promise<void> {
  const { channels, messages } = opts.services;
  const dir = opts.config.voice.dir;

  // Only in this scope: everything else stays JSON-only.
  app.addContentTypeParser(
    /^audio\//,
    { parseAs: 'buffer', bodyLimit: VOICE_MAX_BYTES },
    (_req, body, done) => done(null, body),
  );

  app.post<{ Params: { channelId: string }; Querystring: { durationMs?: string } }>(
    '/channels/:channelId/voice-messages',
    {
      bodyLimit: VOICE_MAX_BYTES,
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
      await channels.assertAccess(user.id, channelId);

      const type = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
      if (!(VOICE_UPLOAD_TYPES as readonly string[]).includes(type)) {
        throw unsupported('Dieses Audioformat wird nicht unterstützt');
      }
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        throw new AppError('BAD_REQUEST', 400, 'Die Aufnahme ist leer');
      }
      const container = sniffAudio(body);
      if (!container) throw unsupported();

      const hint = Number(req.query.durationMs);
      const clientDurationMs = Number.isFinite(hint) ? hint : VOICE_MAX_SECONDS * 1000;
      await mkdir(dir, { recursive: true });
      let audio;
      try {
        audio = await opts.transcoder.store(body, container, dir, clientDurationMs);
      } catch (err) {
        if (isBadInput(err)) throw unsupported('Die Aufnahme konnte nicht gelesen werden');
        throw err;
      }
      try {
        const message = await messages.createVoice(user, channelId, audio);
        return reply.status(201).send({ message });
      } catch (err) {
        await rm(join(dir, audio.key), { force: true });
        throw err;
      }
    },
  );

  app.get<{ Params: { messageId: string } }>('/voice-messages/:messageId', async (req, reply) => {
    const messageId = parseParam(messageIdSchema, req.params.messageId, () =>
      notFound('Sprachnachricht nicht gefunden'),
    );
    const file = await messages.voiceFile(currentUser(req).id, messageId);
    const size = await stat(file.path).then(
      (s) => s.size,
      () => {
        throw notFound('Sprachnachricht nicht gefunden');
      },
    );
    reply
      .header('Content-Type', file.mime)
      .header('Accept-Ranges', 'bytes')
      .header('Content-Disposition', 'inline')
      // The file never changes; members may keep it, shared caches may not.
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

/** Single `bytes=` range (what media elements send); multi-ranges fall back to the full file. */
export function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | 'unsatisfiable' | null {
  const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start: number;
  let end: number;
  if (m[1] === '') {
    // Suffix range: the last N bytes.
    const n = Number(m[2]);
    if (n === 0) return 'unsatisfiable';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}
