import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { and, desc, eq, lt } from 'drizzle-orm';
import type { GifDto, ListMessagesQuery, MessageDto, PublicUserDto } from '@disslxt/shared';
import type { Database } from '../db/client.js';
import { channels, messages, users, type Channel } from '../db/schema.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import type { Hub } from '../realtime/hub.js';
import type { ChannelService } from './channel.service.js';
import type { StorageService } from './storage.service.js';
import { profileColumns, toMessageDto, toPublicUser } from './dto.js';
import type { PushService } from './push.service.js';

export class MessageService {
  constructor(
    private readonly db: Database,
    private readonly hub: Hub,
    private readonly storage: StorageService,
    private readonly channels: ChannelService,
    private readonly push: PushService,
    /** Directory of voice message files (deleted together with their message). */
    private readonly voiceDir: string,
    /** Directory of shared files (deleted together with their message). */
    private readonly fileDir: string,
  ) {}

  /** Stores a file message whose file is already in the file directory. */
  async createFile(
    user: PublicUserDto,
    channel: Channel,
    file: { key: string; name: string; size: number; mime: string },
  ): Promise<MessageDto> {
    const [row] = await this.db
      .insert(messages)
      .values({
        channelId: channel.id,
        authorId: user.id,
        kind: 'file',
        content: '',
        fileKey: file.key,
        fileName: file.name,
        fileSize: file.size,
        fileMime: file.mime,
      })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return this.published(channel, toMessageDto(row, user));
  }

  /** New message: to everyone reading the channel, and as push to the others. */
  private async published(channel: Channel, message: MessageDto): Promise<MessageDto> {
    await this.channels.publish(channel, { type: 'message.created', data: { message } });
    this.push.messageCreated(message);
    return message;
  }

  /** A GIF from GIPHY (already checked to exist); its title is the message text. */
  async createGif(user: PublicUserDto, channel: Channel, gif: GifDto): Promise<MessageDto> {
    const [row] = await this.db
      .insert(messages)
      .values({
        channelId: channel.id,
        authorId: user.id,
        kind: 'gif',
        content: gif.title.slice(0, 2000),
        gifId: gif.id,
        gifWidth: gif.width,
        gifHeight: gif.height,
      })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return this.published(channel, toMessageDto(row, user));
  }

  /** Stored file of a message, for readers of its channel only (404 / 403 otherwise). */
  async sharedFile(
    userId: string,
    messageId: string,
  ): Promise<{ path: string; mime: string; name: string }> {
    const [row] = await this.db
      .select({
        fileKey: messages.fileKey,
        fileMime: messages.fileMime,
        fileName: messages.fileName,
        channelId: messages.channelId,
      })
      .from(messages)
      .where(and(eq(messages.id, BigInt(messageId)), eq(messages.kind, 'file')))
      .limit(1);
    if (!row?.fileKey) throw notFound('Datei nicht gefunden');
    await this.channels.assertAccess(userId, row.channelId);
    return {
      path: join(this.fileDir, row.fileKey),
      mime: row.fileMime ?? 'application/octet-stream',
      name: row.fileName ?? 'datei',
    };
  }

  /** Stores a voice message whose file is already in the voice directory. */
  async createVoice(
    user: PublicUserDto,
    channel: Channel,
    audio: { key: string; mime: string; durationMs: number },
  ): Promise<MessageDto> {
    const [row] = await this.db
      .insert(messages)
      .values({
        channelId: channel.id,
        authorId: user.id,
        kind: 'voice',
        content: '',
        audioKey: audio.key,
        audioMime: audio.mime,
        audioDurationMs: audio.durationMs,
      })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return this.published(channel, toMessageDto(row, user));
  }

  /** Voice file of a message, for readers of its channel only (404 / 403 otherwise). */
  async voiceFile(userId: string, messageId: string): Promise<{ path: string; mime: string }> {
    const [row] = await this.db
      .select({
        audioKey: messages.audioKey,
        audioMime: messages.audioMime,
        channelId: messages.channelId,
      })
      .from(messages)
      .where(and(eq(messages.id, BigInt(messageId)), eq(messages.kind, 'voice')))
      .limit(1);
    if (!row?.audioKey) throw notFound('Sprachnachricht nicht gefunden');
    await this.channels.assertAccess(userId, row.channelId);
    return { path: join(this.voiceDir, row.audioKey), mime: row.audioMime ?? 'audio/mp4' };
  }

  async create(user: PublicUserDto, channelId: string, content: string): Promise<MessageDto> {
    const channel = await this.channels.assertTextChannel(user.id, channelId);
    const bytes = Buffer.byteLength(content);
    await this.storage.assertRoom(bytes);
    this.storage.added(bytes);
    const [row] = await this.db
      .insert(messages)
      .values({ channelId, authorId: user.id, content })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return this.published(channel, toMessageDto(row, user));
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
      .select({
        message: messages,
        author: profileColumns,
      })
      .from(messages)
      .innerJoin(users, eq(users.id, messages.authorId))
      .where(where)
      .orderBy(desc(messages.id))
      .limit(query.limit + 1);
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit).reverse();
    return {
      messages: page.map((r) => toMessageDto(r.message, toPublicUser(r.author))),
      hasMore,
    };
  }

  async edit(user: PublicUserDto, messageId: string, content: string): Promise<MessageDto> {
    const msg = await this.assertAuthor(user.id, messageId);
    if (msg.kind === 'voice') {
      throw new AppError('BAD_REQUEST', 400, 'Sprachnachrichten können nicht bearbeitet werden');
    }
    if (msg.kind === 'file' || msg.kind === 'gif') {
      throw new AppError('BAD_REQUEST', 400, 'Dateien und GIFs können nicht bearbeitet werden');
    }
    const [row] = await this.db
      .update(messages)
      .set({ content, editedAt: new Date() })
      .where(eq(messages.id, msg.id))
      .returning();
    if (!row) throw notFound('Nachricht nicht gefunden');
    const message = toMessageDto(row, user);
    await this.channels.publish(
      { id: row.channelId, kind: msg.channelKind },
      { type: 'message.updated', data: { message } },
    );
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
    if (msg.fileKey) await rm(join(this.fileDir, msg.fileKey), { force: true });
    this.storage.changed();
    await this.channels.publish(
      { id: msg.channelId, kind: msg.channelKind },
      { type: 'message.deleted', data: { id: msg.id.toString(), channelId: msg.channelId } },
    );
  }

  /** 404 if missing, 403 FORBIDDEN without access to the channel, 403 NOT_AUTHOR if not the author. */
  private async assertAuthor(userId: string, messageId: string) {
    const [row] = await this.db
      .select({
        id: messages.id,
        authorId: messages.authorId,
        channelId: messages.channelId,
        kind: messages.kind,
        audioKey: messages.audioKey,
        fileKey: messages.fileKey,
        channelKind: channels.kind,
      })
      .from(messages)
      .innerJoin(channels, eq(channels.id, messages.channelId))
      .where(eq(messages.id, BigInt(messageId)))
      .limit(1);
    if (!row) throw notFound('Nachricht nicht gefunden');
    await this.channels.assertAccess(userId, row.channelId);
    if (row.authorId !== userId) {
      throw forbidden('Nur der Autor darf diese Nachricht ändern', 'NOT_AUTHOR');
    }
    return row;
  }
}
