import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { and, asc, count, desc, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import {
  PINS_PER_CHANNEL_MAX,
  REACTIONS_PER_MESSAGE_MAX,
  type GifDto,
  type GuildDto,
  type ListMessagesQuery,
  type MessageDto,
  type MessageRefDto,
  type PublicUserDto,
  type ReactionDto,
  type UnreadDto,
} from '@disslxt/shared';
import type { Database } from '../db/client.js';
import {
  channelReads,
  channels,
  guilds,
  messageReactions,
  messages,
  users,
  type Channel,
  type Message,
} from '../db/schema.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import type { Hub } from '../realtime/hub.js';
import type { ChannelService } from './channel.service.js';
import type { StorageService } from './storage.service.js';
import { profileColumns, toMessageDto, toMessageRef, toPublicUser } from './dto.js';
import { mentionedNames, type PushService } from './push.service.js';

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

  /**
   * New message: to everyone reading the channel, as a notice to the rest of the server (for the
   * unread counters) and as push to the others.
   */
  private async published(channel: Channel, message: MessageDto): Promise<MessageDto> {
    await this.channels.publish(channel, { type: 'message.created', data: { message } });
    if (channel.guildId) {
      const mentions = mentionedNames(message.content);
      if (message.replyTo) mentions.add(message.replyTo.author.username.toLowerCase());
      this.hub.publishToGuild(channel.guildId, {
        type: 'channel.activity',
        data: {
          channelId: channel.id,
          guildId: channel.guildId,
          messageId: message.id,
          authorId: message.author.id,
          mentions: [...mentions],
        },
      });
    }
    this.push.messageCreated(message);
    return message;
  }

  /** Reactions per message, oldest emoji first. */
  private async reactionsOf(ids: bigint[]): Promise<Map<string, ReactionDto[]>> {
    const out = new Map<string, ReactionDto[]>();
    if (ids.length === 0) return out;
    const rows = await this.db
      .select({
        messageId: messageReactions.messageId,
        emoji: messageReactions.emoji,
        userId: messageReactions.userId,
      })
      .from(messageReactions)
      .where(inArray(messageReactions.messageId, ids))
      .orderBy(asc(messageReactions.createdAt));
    for (const row of rows) {
      const key = row.messageId.toString();
      const list = out.get(key) ?? [];
      out.set(key, list);
      const entry = list.find((r) => r.emoji === row.emoji);
      if (entry) {
        entry.count += 1;
        entry.userIds.push(row.userId);
      } else list.push({ emoji: row.emoji, count: 1, userIds: [row.userId] });
    }
    return out;
  }

  /** The messages that the given ones answer. */
  private async refsOf(ids: bigint[]): Promise<Map<string, MessageRefDto>> {
    const out = new Map<string, MessageRefDto>();
    if (ids.length === 0) return out;
    const rows = await this.db
      .select({
        id: messages.id,
        kind: messages.kind,
        content: messages.content,
        authorId: users.id,
        username: users.username,
        displayName: users.displayName,
      })
      .from(messages)
      .innerJoin(users, eq(users.id, messages.authorId))
      .where(inArray(messages.id, ids));
    for (const row of rows) {
      out.set(
        row.id.toString(),
        toMessageRef(row, {
          id: row.authorId,
          username: row.username,
          displayName: row.displayName,
        }),
      );
    }
    return out;
  }

  /** Stored messages with their reactions and quoted messages. */
  private async toDtos(rows: { message: Message; author: PublicUserDto }[]): Promise<MessageDto[]> {
    const replyIds = rows.flatMap((r) => (r.message.replyToId ? [r.message.replyToId] : []));
    const [reactions, refs] = await Promise.all([
      this.reactionsOf(rows.map((r) => r.message.id)),
      this.refsOf([...new Set(replyIds)]),
    ]);
    return rows.map(({ message, author }) =>
      toMessageDto(message, author, {
        reactions: reactions.get(message.id.toString()) ?? [],
        replyTo: message.replyToId ? (refs.get(message.replyToId.toString()) ?? null) : null,
      }),
    );
  }

  private async toDto(message: Message, author: PublicUserDto): Promise<MessageDto> {
    const [dto] = await this.toDtos([{ message, author }]);
    if (!dto) throw new Error('message went missing');
    return dto;
  }

  /** Greets someone new in the first text channel of the server (no push: they got one already). */
  async joined(user: PublicUserDto, guild: GuildDto): Promise<void> {
    const [channel] = await this.db
      .select()
      .from(channels)
      .where(and(eq(channels.guildId, guild.id), eq(channels.kind, 'text')))
      .orderBy(asc(channels.createdAt), asc(channels.name))
      .limit(1);
    if (!channel) return;
    const [row] = await this.db
      .insert(messages)
      .values({ channelId: channel.id, authorId: user.id, kind: 'join', content: '' })
      .returning();
    if (!row) throw new Error('insert returned no row');
    const message = toMessageDto(row, user);
    await this.channels.publish(channel, { type: 'message.created', data: { message } });
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

  async create(
    user: PublicUserDto,
    channelId: string,
    content: string,
    replyToId?: string,
  ): Promise<MessageDto> {
    const channel = await this.channels.assertTextChannel(user.id, channelId);
    if (replyToId) {
      const [target] = await this.db
        .select({ channelId: messages.channelId })
        .from(messages)
        .where(eq(messages.id, BigInt(replyToId)))
        .limit(1);
      if (target?.channelId !== channelId) {
        throw new AppError('BAD_REQUEST', 400, 'Diese Nachricht gibt es nicht mehr');
      }
    }
    const bytes = Buffer.byteLength(content);
    await this.storage.assertRoom(bytes);
    this.storage.added(bytes);
    const [row] = await this.db
      .insert(messages)
      .values({
        channelId,
        authorId: user.id,
        content,
        replyToId: replyToId ? BigInt(replyToId) : null,
      })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return this.published(channel, await this.toDto(row, user));
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
      messages: await this.toDtos(
        page.map((r) => ({ message: r.message, author: toPublicUser(r.author) })),
      ),
      hasMore,
    };
  }

  /** Puts an emoji under a message, or takes your own away again. */
  async toggleReaction(userId: string, messageId: string, emoji: string): Promise<ReactionDto[]> {
    const msg = await this.assertReadable(userId, messageId);
    if (msg.kind === 'join') {
      throw new AppError('BAD_REQUEST', 400, 'Darauf kann man nicht reagieren');
    }
    const key = { messageId: msg.id, userId, emoji };
    const removed = await this.db
      .delete(messageReactions)
      .where(
        and(
          eq(messageReactions.messageId, msg.id),
          eq(messageReactions.userId, userId),
          eq(messageReactions.emoji, emoji),
        ),
      )
      .returning({ emoji: messageReactions.emoji });
    if (removed.length === 0) {
      const [existing] = await this.db
        .select({ n: sql<number>`count(distinct ${messageReactions.emoji})::int` })
        .from(messageReactions)
        .where(eq(messageReactions.messageId, msg.id));
      const alreadyThere = await this.db
        .select({ emoji: messageReactions.emoji })
        .from(messageReactions)
        .where(and(eq(messageReactions.messageId, msg.id), eq(messageReactions.emoji, emoji)))
        .limit(1);
      if (alreadyThere.length === 0 && (existing?.n ?? 0) >= REACTIONS_PER_MESSAGE_MAX) {
        throw new AppError('BAD_REQUEST', 400, 'Mehr verschiedene Emoji gehen hier nicht');
      }
      await this.db.insert(messageReactions).values(key).onConflictDoNothing();
    }
    const reactions = (await this.reactionsOf([msg.id])).get(msg.id.toString()) ?? [];
    await this.channels.publish(
      { id: msg.channelId, kind: msg.channelKind },
      {
        type: 'message.reactions',
        data: { id: msg.id.toString(), channelId: msg.channelId, reactions },
      },
    );
    return reactions;
  }

  /** On a server only its owner pins; in a private conversation everyone in it. */
  async setPinned(userId: string, messageId: string, pinned: boolean): Promise<MessageDto> {
    const msg = await this.assertReadable(userId, messageId);
    if (msg.kind === 'join') throw new AppError('BAD_REQUEST', 400, 'Das kann man nicht anpinnen');
    if (msg.guildId) {
      const [guild] = await this.db
        .select({ ownerId: guilds.ownerId })
        .from(guilds)
        .where(eq(guilds.id, msg.guildId))
        .limit(1);
      if (guild?.ownerId !== userId) throw forbidden('Nur der Besitzer kann Nachrichten anpinnen');
    }
    if (pinned) {
      const [row] = await this.db
        .select({ n: count() })
        .from(messages)
        .where(and(eq(messages.channelId, msg.channelId), isNotNull(messages.pinnedAt)));
      if ((row?.n ?? 0) >= PINS_PER_CHANNEL_MAX) {
        throw new AppError(
          'BAD_REQUEST',
          400,
          `Höchstens ${PINS_PER_CHANNEL_MAX} angepinnte Nachrichten pro Kanal`,
        );
      }
    }
    const [row] = await this.db
      .update(messages)
      .set({ pinnedAt: pinned ? new Date() : null })
      .where(eq(messages.id, msg.id))
      .returning();
    if (!row) throw notFound('Nachricht nicht gefunden');
    const [author] = await this.db
      .select(profileColumns)
      .from(users)
      .where(eq(users.id, row.authorId))
      .limit(1);
    if (!author) throw notFound('Nachricht nicht gefunden');
    const message = await this.toDto(row, toPublicUser(author));
    await this.channels.publish(
      { id: msg.channelId, kind: msg.channelKind },
      { type: 'message.updated', data: { message } },
    );
    return message;
  }

  /** Pinned messages of a channel, last pinned first. */
  async pins(userId: string, channelId: string): Promise<MessageDto[]> {
    await this.channels.assertAccess(userId, channelId);
    const rows = await this.db
      .select({ message: messages, author: profileColumns })
      .from(messages)
      .innerJoin(users, eq(users.id, messages.authorId))
      .where(and(eq(messages.channelId, channelId), isNotNull(messages.pinnedAt)))
      .orderBy(desc(messages.pinnedAt))
      .limit(PINS_PER_CHANNEL_MAX);
    return this.toDtos(rows.map((r) => ({ message: r.message, author: toPublicUser(r.author) })));
  }

  /** Unread counters of everything you can read; channels without news are left out. */
  async unread(userId: string, username: string): Promise<UnreadDto[]> {
    // Usernames are [A-Za-z0-9_], so it is safe inside the pattern (and it is a bound parameter).
    const mention = `(^|[^A-Za-z0-9_@])@${username}($|[^A-Za-z0-9_])`;
    const rows = await this.db.execute<{
      channel_id: string;
      guild_id: string | null;
      last_read_id: string;
      count: number;
      mentions: number;
    }>(sql`
      with mine as (
        select c.id as channel_id, c.guild_id, r.last_read_id, gm.joined_at as since
        from guild_members gm
        join channels c on c.guild_id = gm.guild_id and c.kind = 'text'
        left join channel_reads r on r.channel_id = c.id and r.user_id = gm.user_id
        where gm.user_id = ${userId}
        union all
        select dm.channel_id, null, r.last_read_id, null
        from dm_members dm
        left join channel_reads r on r.channel_id = dm.channel_id and r.user_id = dm.user_id
        where dm.user_id = ${userId}
      )
      select mine.channel_id, mine.guild_id,
        coalesce(mine.last_read_id, 0)::text as last_read_id,
        count(*)::int as count,
        (count(*) filter (where m.content ~* ${mention} or quoted.author_id = ${userId}))::int
          as mentions
      from mine
      join messages m on m.channel_id = mine.channel_id
        and m.id > coalesce(mine.last_read_id, 0)
        and m.author_id <> ${userId}
        and m.kind <> 'join'
        and (mine.last_read_id is not null or mine.since is null or m.created_at >= mine.since)
      left join messages quoted on quoted.id = m.reply_to_id
      group by mine.channel_id, mine.guild_id, mine.last_read_id
    `);
    return rows.rows.map((r) => ({
      channelId: r.channel_id,
      guildId: r.guild_id,
      count: r.count,
      mentions: r.mentions,
      lastReadId: r.last_read_id,
    }));
  }

  /** Marks a channel as read up to a message; never moves back. Other devices are told. */
  async markRead(userId: string, channelId: string, messageId: string): Promise<void> {
    await this.channels.assertAccess(userId, channelId);
    const [last] = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.channelId, channelId))
      .orderBy(desc(messages.id))
      .limit(1);
    if (!last) return;
    // A made-up id must not mark future messages as read.
    const wanted = BigInt(messageId);
    const lastReadId = wanted < last.id ? wanted : last.id;
    const [row] = await this.db
      .insert(channelReads)
      .values({ userId, channelId, lastReadId })
      .onConflictDoUpdate({
        target: [channelReads.userId, channelReads.channelId],
        set: {
          lastReadId: sql`greatest(${channelReads.lastReadId}, excluded.last_read_id)`,
          updatedAt: new Date(),
        },
      })
      .returning({ lastReadId: channelReads.lastReadId });
    this.hub.publishToUsers([userId], {
      type: 'channel.read',
      data: { channelId, lastReadId: (row?.lastReadId ?? lastReadId).toString() },
    });
  }

  async edit(user: PublicUserDto, messageId: string, content: string): Promise<MessageDto> {
    const msg = await this.assertAuthor(user.id, messageId);
    if (msg.kind === 'voice') {
      throw new AppError('BAD_REQUEST', 400, 'Sprachnachrichten können nicht bearbeitet werden');
    }
    if (msg.kind !== 'text') {
      throw new AppError('BAD_REQUEST', 400, 'Dateien und GIFs können nicht bearbeitet werden');
    }
    const [row] = await this.db
      .update(messages)
      .set({ content, editedAt: new Date() })
      .where(eq(messages.id, msg.id))
      .returning();
    if (!row) throw notFound('Nachricht nicht gefunden');
    const message = await this.toDto(row, user);
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

  /** 404 if missing, 403 without access to the channel. */
  private async assertReadable(userId: string, messageId: string) {
    const [row] = await this.db
      .select({
        id: messages.id,
        kind: messages.kind,
        channelId: messages.channelId,
        channelKind: channels.kind,
        guildId: channels.guildId,
      })
      .from(messages)
      .innerJoin(channels, eq(channels.id, messages.channelId))
      .where(eq(messages.id, BigInt(messageId)))
      .limit(1);
    if (!row) throw notFound('Nachricht nicht gefunden');
    await this.channels.assertAccess(userId, row.channelId);
    return row;
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
