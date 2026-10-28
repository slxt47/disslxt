import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AVATAR_MAX_BYTES } from '@disslxt/shared';
import { AppError, notFound } from './errors.js';
import { sniffImage, type InlineImage } from './files.js';

const EXT: Record<InlineImage, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};
const MIME = Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m])) as Record<
  string,
  InlineImage
>;

/**
 * Profile and server pictures. Only real PNG/JPEG/GIF/WebP files (checked by their bytes) are
 * stored, under a random name whose extension records the type.
 */
export class ImageStore {
  constructor(private readonly dir: string) {}

  async save(body: unknown): Promise<string> {
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new AppError('BAD_REQUEST', 400, 'Das Bild ist leer');
    }
    if (body.length > AVATAR_MAX_BYTES) {
      throw new AppError('PAYLOAD_TOO_LARGE', 413, 'Das Bild ist zu groß (höchstens 2 MB)');
    }
    const mime = sniffImage(body);
    if (!mime) {
      throw new AppError(
        'UNSUPPORTED_MEDIA_TYPE',
        415,
        'Bitte ein Bild als PNG, JPEG, GIF oder WebP wählen',
      );
    }
    const key = `${randomBytes(16).toString('hex')}.${EXT[mime]}`;
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, key), body);
    return key;
  }

  async read(key: string | null): Promise<{ body: Buffer; mime: InlineImage }> {
    const mime = key ? MIME[key.split('.').pop() ?? ''] : undefined;
    // Keys are generated here; anything else (e.g. a path) is never looked up.
    if (!key || !mime || !/^[0-9a-f]{32}\.[a-z]{3,4}$/.test(key)) throw notFound('Kein Bild');
    try {
      return { body: await readFile(join(this.dir, key)), mime };
    } catch {
      throw notFound('Kein Bild');
    }
  }

  async remove(key: string | null): Promise<void> {
    if (key && /^[0-9a-f]{32}\.[a-z]{3,4}$/.test(key)) {
      await rm(join(this.dir, key), { force: true });
    }
  }
}
