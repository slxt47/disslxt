import { randomBytes } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import type { WebhookDto } from '@disslxt/shared';
import type { Database } from '../db/client.js';
import { channels, channelWebhooks } from '../db/schema.js';
import { AppError, notFound } from '../lib/errors.js';
import { sha256 } from '../lib/tokens.js';
import type { ChannelService } from './channel.service.js';
import type { MessageService } from './message.service.js';

const toDto = (w: typeof channelWebhooks.$inferSelect): WebhookDto => ({
  id: w.id,
  channelId: w.channelId,
  name: w.name,
  createdAt: w.createdAt.toISOString(),
});

/** Lets programs post into a channel: each hook has its own name and secret. */
export class WebhookService {
  constructor(
    private readonly db: Database,
    private readonly channels: ChannelService,
    private readonly messages: MessageService,
  ) {}

  async list(userId: string, channelId: string): Promise<WebhookDto[]> {
    await this.channels.assertManageable(userId, channelId);
    const rows = await this.db
      .select()
      .from(channelWebhooks)
      .where(eq(channelWebhooks.channelId, channelId))
      .orderBy(asc(channelWebhooks.createdAt));
    return rows.map(toDto);
  }

  /** The token is shown once and only its hash is kept. */
  async create(
    userId: string,
    channelId: string,
    name: string,
  ): Promise<{ webhook: WebhookDto; token: string }> {
    const channel = await this.channels.assertManageable(userId, channelId);
    if (channel.kind !== 'text') throw new AppError('BAD_REQUEST', 400, 'Nur in Textkanälen');
    const token = randomBytes(32).toString('base64url');
    const [row] = await this.db
      .insert(channelWebhooks)
      .values({ channelId, name, tokenHash: sha256(token), createdBy: userId })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return { webhook: toDto(row), token };
  }

  async remove(userId: string, channelId: string, id: string): Promise<void> {
    await this.channels.assertManageable(userId, channelId);
    const gone = await this.db
      .delete(channelWebhooks)
      .where(and(eq(channelWebhooks.id, id), eq(channelWebhooks.channelId, channelId)))
      .returning({ id: channelWebhooks.id });
    if (gone.length === 0) throw notFound('Webhook nicht gefunden');
  }

  /** Public entry: wrong id and wrong token look the same. */
  async deliver(id: string, token: string, content: string): Promise<void> {
    const [row] = await this.db
      .select({ hook: channelWebhooks, channel: channels })
      .from(channelWebhooks)
      .innerJoin(channels, eq(channels.id, channelWebhooks.channelId))
      .where(and(eq(channelWebhooks.id, id), eq(channelWebhooks.tokenHash, sha256(token))))
      .limit(1);
    if (!row) throw notFound('Webhook nicht gefunden');
    await this.messages.createBot(row.channel, row.hook.createdBy, row.hook.name, content);
  }
}
