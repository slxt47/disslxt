import { and, eq, lt, notExists, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { AVATAR_MAX_BYTES } from '@disslxt/shared';
import type { Database } from '../db/client.js';
import { linkPreviews, messages } from '../db/schema.js';
import type { ImageStore } from '../lib/images.js';
import { parseMeta } from '../lib/linkMeta.js';
import { safeGet, type FetchedPage } from '../lib/safeFetch.js';
import { sha256 } from '../lib/tokens.js';

const PAGE_MAX_BYTES = 512 * 1024;
const FRESH_MS = 7 * 24 * 60 * 60 * 1000;
/** Fetches at the same time; more links in that moment simply stay without a preview. */
const MAX_RUNNING = 4;

export type Fetcher = (url: string, maxBytes: number) => Promise<FetchedPage | null>;

/**
 * Previews of links, fetched by the server in the background: the browsers of the others never
 * contact the linked site, and the picture is a checked copy served from here.
 */
export class LinkPreviewService {
  private running = 0;
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly db: Database,
    private readonly images: ImageStore,
    private readonly log: FastifyBaseLogger,
    private readonly enabled: boolean,
    private readonly fetcher: Fetcher = safeGet,
  ) {}

  /** Finds the preview for a link and hands its id over; nothing happens if there is none. */
  enqueue(url: string, done: (previewId: string) => Promise<void>): void {
    if (!this.enabled || this.running >= MAX_RUNNING) return;
    this.running += 1;
    const task = this.resolve(url)
      .then((id) => (id ? done(id) : undefined))
      .catch((err: unknown) => this.log.warn({ err }, 'link preview failed'))
      .finally(() => {
        this.running -= 1;
        this.pending.delete(task);
      });
    this.pending.add(task);
  }

  /** Waits for what is running (tests, shutdown). */
  async settled(): Promise<void> {
    await Promise.all(this.pending);
  }

  private async resolve(url: string): Promise<string | null> {
    const urlHash = sha256(url);
    const [known] = await this.db
      .select()
      .from(linkPreviews)
      .where(eq(linkPreviews.urlHash, urlHash))
      .limit(1);
    if (known && Date.now() - known.fetchedAt.getTime() < FRESH_MS) {
      return known.title ? known.id : null;
    }
    const page = await this.fetcher(url, PAGE_MAX_BYTES);
    const html = page?.contentType.includes('text/html') ? page.body.toString('utf8') : '';
    const meta = page ? parseMeta(html, page.url) : null;
    const imageKey = meta?.imageUrl ? await this.copyImage(meta.imageUrl) : null;
    const values = {
      urlHash,
      url: url.slice(0, 2048),
      title: meta?.title ?? null,
      description: meta?.description ?? null,
      siteName: meta?.siteName ?? null,
      imageKey,
      fetchedAt: new Date(),
    };
    const [row] = await this.db
      .insert(linkPreviews)
      .values(values)
      .onConflictDoUpdate({ target: linkPreviews.urlHash, set: values })
      .returning({ id: linkPreviews.id, title: linkPreviews.title });
    if (known?.imageKey && known.imageKey !== imageKey) await this.images.remove(known.imageKey);
    await this.sweep();
    return row?.title ? row.id : null;
  }

  /** A copy, so nobody's browser asks the foreign site; ImageStore checks that it is an image. */
  private async copyImage(url: string): Promise<string | null> {
    const image = await this.fetcher(url, AVATAR_MAX_BYTES + 1);
    if (!image || image.body.length > AVATAR_MAX_BYTES) return null;
    try {
      return await this.images.save(image.body);
    } catch {
      return null;
    }
  }

  /** Previews no message uses any more go away, with their pictures. */
  private async sweep(): Promise<void> {
    const old = await this.db
      .delete(linkPreviews)
      .where(
        and(
          lt(linkPreviews.fetchedAt, sql`now() - interval '1 day'`),
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(messages)
              .where(eq(messages.linkPreviewId, linkPreviews.id)),
          ),
        ),
      )
      .returning({ imageKey: linkPreviews.imageKey });
    await Promise.all(old.map((p) => this.images.remove(p.imageKey)));
  }

  image(key: string) {
    return this.images.read(key);
  }
}
