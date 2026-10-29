import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { messages } from '../db/schema.js';
import { AppError } from '../lib/errors.js';

/** Re-measure at most this often; in between, accepted uploads are added to the last value. */
const REFRESH_MS = 60_000;

/**
 * Overall storage cap for everything people post: files, images, voice messages, profile and
 * server pictures (bytes in UPLOAD_DIR) plus the text of all messages. Once it is reached, new
 * posts are refused with 507 until something is deleted.
 */
export class StorageService {
  private cache: { at: number; bytes: number } | null = null;
  private measuring: Promise<number> | null = null;

  constructor(
    private readonly db: Database,
    private readonly uploadRoot: string,
    readonly limitBytes: number,
  ) {}

  async used(): Promise<number> {
    if (this.cache && Date.now() - this.cache.at < REFRESH_MS) return this.cache.bytes;
    this.measuring ??= this.measure().finally(() => (this.measuring = null));
    return this.measuring;
  }

  /** Throws 507 if `bytes` more would exceed the cap. */
  async assertRoom(bytes: number): Promise<void> {
    if ((await this.used()) + bytes > this.limitBytes) {
      throw new AppError(
        'STORAGE_FULL',
        507,
        `Der Speicher von disslxt ist voll (${Math.round(this.limitBytes / 1e9)} GB). Lösche alte Dateien oder Nachrichten, dann geht es weiter.`,
      );
    }
  }

  /** Accepted something: count it right away (the next measurement corrects any drift). */
  added(bytes: number): void {
    if (this.cache) this.cache.bytes += bytes;
  }

  /** Something was deleted: measure again on the next check. */
  changed(): void {
    this.cache = null;
  }

  async status(): Promise<{ usedBytes: number; limitBytes: number }> {
    return { usedBytes: await this.used(), limitBytes: this.limitBytes };
  }

  private async measure(): Promise<number> {
    const [[row], files] = await Promise.all([
      this.db
        .select({ n: sql<string>`coalesce(sum(octet_length(${messages.content})), 0)` })
        .from(messages),
      dirSize(this.uploadRoot),
    ]);
    const bytes = Number(row?.n ?? 0) + files;
    this.cache = { at: Date.now(), bytes };
    return bytes;
  }
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(p);
    else if (e.isFile())
      total += await stat(p).then(
        (s) => s.size,
        () => 0,
      );
  }
  return total;
}
