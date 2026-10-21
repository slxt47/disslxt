import { and, desc, eq, lt } from 'drizzle-orm';
import type { ListMessagesQuery, MessageDto, UserDto } from '@disslxt/shared';
import type { Database } from '../db/client.js';
import { channels, messages, users } from '../db/schema.js';
import { forbidden, notFound } from '../lib/errors.js';
import type { Hub } from '../realtime/hub.js';
import type { ChannelService } from './channel.service.js';
import { toMessageDto } from './dto.js';
import type { GuildService } from './guild.service.js';

export class MessageService {
  constructor(
    private readonly db: Database,
    private readonly hub: Hub,
    private readonly guilds: GuildService,
    private readonly channels: ChannelService,
  ) {}

  async create(
    user: Pick<UserDto, 'id' | 'username'>,
    channelId: string,
    content: string,
  ): Promise<MessageDto> {
    await this.channels.assertAccess(user.id, channelId);
    const [row] = await this.db
      .insert(messages)
      .values({ channelId, authorId: user.id, content })
      .returning();
    if (!row) throw new Error('insert returned no row');
    const message = toMessageDto(row, user);
    this.hub.publishToChannel(channelId, { type: 'message.created', data: { message } });
    return message;
  }

  /** Newest `limit` messages with id < before, returned in ascending order. */
  async listPage(
    userId: string,
    channelId: string,
    query: ListMessagesQuery,
  ): Promise<{ messages: MessageDto[]; hasMore: boolean }> {
    await this.channels.assertAccess(userId, channelId);
    const where = query.before
      ? and(eq(messages.channelId, channelId), lt(messages.id, BigInt(query.before)))
      : eq(messages.channelId, channelId);
    const rows = await this.db
      .select({ message: messages, author: { id: users.id, username: users.username } })
      .from(messages)
      .innerJoin(users, eq(users.id, messages.authorId))
      .where(where)
      .orderBy(desc(messages.id))
      .limit(query.limit + 1);
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit).reverse();
    return { messages: page.map((r) => toMessageDto(r.message, r.author)), hasMore };
  }

  async edit(
    user: Pick<UserDto, 'id' | 'username'>,
    messageId: string,
    content: string,
  ): Promise<MessageDto> {
    const msg = await this.assertAuthor(user.id, messageId);
    const [row] = await this.db
      .update(messages)
      .set({ content, editedAt: new Date() })
      .where(eq(messages.id, msg.id))
      .returning();
    if (!row) throw notFound('Nachricht nicht gefunden');
    const message = toMessageDto(row, user);
    this.hub.publishToChannel(row.channelId, { type: 'message.updated', data: { message } });
    return message;
  }

  async delete(userId: string, messageId: string): Promise<void> {
    const msg = await this.assertAuthor(userId, messageId);
    const deleted = await this.db
      .delete(messages)
      .where(eq(messages.id, msg.id))
      .returning({ id: messages.id });
    if (deleted.length === 0) throw notFound('Nachricht nicht gefunden');
    this.hub.publishToChannel(msg.channelId, {
      type: 'message.deleted',
      data: { id: msg.id.toString(), channelId: msg.channelId },
    });
  }

  /** 404 if missing, 403 FORBIDDEN if not a guild member, 403 NOT_AUTHOR if not the author. */
  private async assertAuthor(userId: string, messageId: string) {
    const [row] = await this.db
      .select({
        id: messages.id,
        authorId: messages.authorId,
        channelId: messages.channelId,
        guildId: channels.guildId,
      })
      .from(messages)
      .innerJoin(channels, eq(channels.id, messages.channelId))
      .where(eq(messages.id, BigInt(messageId)))
      .limit(1);
    if (!row) throw notFound('Nachricht nicht gefunden');
    await this.guilds.assertMember(userId, row.guildId);
    if (row.authorId !== userId) {
      throw forbidden('Nur der Autor darf diese Nachricht ändern', 'NOT_AUTHOR');
    }
    return row;
  }
}
