import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { and, desc, eq, lt } from 'drizzle-orm';
import type { ListMessagesQuery, MessageDto, UserDto } from '@disslxt/shared';
import type { Database } from '../db/client.js';
import { channels, messages, users } from '../db/schema.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import type { Hub } from '../realtime/hub.js';
import type { ChannelService } from './channel.service.js';
import { toMessageDto } from './dto.js';
import type { GuildService } from './guild.service.js';
import type { PushService } from './push.service.js';

export class MessageService {
  constructor(
    private readonly db: Database,
    private readonly hub: Hub,
    private readonly guilds: GuildService,
    private readonly channels: ChannelService,
    private readonly push: PushService,
    /** Directory of voice message files (deleted together with their message). */
    private readonly voiceDir: string,
  ) {}

  /** Stores a voice message whose file is already in the voice directory. */
  async createVoice(
    user: Pick<UserDto, 'id' | 'username'>,
    channelId: string,
    audio: { key: string; mime: string; durationMs: number },
  ): Promise<MessageDto> {
    const [row] = await this.db
      .insert(messages)
      .values({
        channelId,
        authorId: user.id,
        kind: 'voice',
        content: '',
        audioKey: audio.key,
        audioMime: audio.mime,
        audioDurationMs: audio.durationMs,
      })
      .returning();
    if (!row) throw new Error('insert returned no row');
    const message = toMessageDto(row, user);
    this.hub.publishToChannel(channelId, { type: 'message.created', data: { message } });
    this.push.messageCreated(message);
    return message;
  }

  /** Voice file of a message, for members of its guild only (404 / 403 otherwise). */
  async voiceFile(userId: string, messageId: string): Promise<{ path: string; mime: string }> {
    const [row] = await this.db
      .select({
        audioKey: messages.audioKey,
        audioMime: messages.audioMime,
        guildId: channels.guildId,
      })
      .from(messages)
      .innerJoin(channels, eq(channels.id, messages.channelId))
      .where(and(eq(messages.id, BigInt(messageId)), eq(messages.kind, 'voice')))
      .limit(1);
    if (!row?.audioKey) throw notFound('Sprachnachricht nicht gefunden');
    await this.guilds.assertMember(userId, row.guildId);
    return { path: join(this.voiceDir, row.audioKey), mime: row.audioMime ?? 'audio/mp4' };
  }

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
    this.push.messageCreated(message);
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
    if (msg.kind === 'voice') {
      throw new AppError('BAD_REQUEST', 400, 'Sprachnachrichten können nicht bearbeitet werden');
    }
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
    if (msg.audioKey) await rm(join(this.voiceDir, msg.audioKey), { force: true });
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
        kind: messages.kind,
        audioKey: messages.audioKey,
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
