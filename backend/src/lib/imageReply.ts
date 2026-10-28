import type { FastifyInstance, FastifyReply } from 'fastify';
import { AVATAR_MAX_BYTES } from '@disslxt/shared';

/** Sends a stored picture. URLs carry the file's key, so it can be cached for good. */
export function sendImage(reply: FastifyReply, img: { body: Buffer; mime: string }) {
  return reply
    .header('Content-Type', img.mime)
    .header('Content-Security-Policy', "default-src 'none'; sandbox")
    .header('Cache-Control', 'private, max-age=31536000, immutable')
    .send(img.body);
}

/** Picture uploads arrive as raw bytes (application/octet-stream), at most AVATAR_MAX_BYTES. */
export function acceptImageUploads(app: FastifyInstance): void {
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: AVATAR_MAX_BYTES },
    (_req, body, done) => done(null, body),
  );
}
