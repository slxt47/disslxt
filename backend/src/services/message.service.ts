import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  PINS_PER_CHANNEL_MAX,
  REACTIONS_PER_MESSAGE_MAX,
  SEARCH_PAGE_SIZE,
  type GifDto,
  type GuildDto,
  type CreatePollInput,
  type EventDto,
  type LinkPreviewDto,
  type ListMessagesQuery,
  type MessageDto,
  type MessageRefDto,
  type PollDto,
  type PublicUserDto,
  type ReactionDto,
  type RsvpAnswer,
  type SearchQuery,
  type SearchResultDto,
  type UnreadDto,
  type WsServerMessage,
} from '@disslxt/shared';
import type { Database } from '../db/client.js';
import {
  channelReads,
  channels,
  eventRsvps,
  guilds,
  linkPreviews,
  messageEvents,
  messageReactions,
  messages,
  pollVotes,
  polls,
  users,
  type Channel,
  type Message,
} from '../db/schema.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import type { Hub } from '../realtime/hub.js';
import type { ChannelService } from './channel.service.js';
import type { StorageService } from './storage.service.js';
import { firstUrl } from '../lib/linkMeta.js';
import { profileColumns, toChannelKind, toMessageDto, toMessageRef, toPublicUser } from './dto.js';
import type { LinkPreviewService } from './linkPreview.service.js';
import { channelVisibleSql, type PermissionService } from './permission.service.js';
import { mentionedNames, type PushService } from './push.service.js';
import type { TranscriptionService } from './transcription.service.js';

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
    private readonly perms: PermissionService,
    private readonly previews: LinkPreviewService,
    private readonly transcripts: TranscriptionService,
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
    // Thread replies stay out of the channel's unread count; those involved get a push.
    if (channel.guildId && !message.threadRootId) {
      const mentions = mentionedNames(message.content);
      if (message.replyTo) mentions.add(message.replyTo.author.username.toLowerCase());
      const activity: WsServerMessage = {
        type: 'channel.activity',
        data: {
          channelId: channel.id,
          guildId: channel.guildId,
          messageId: message.id,
          authorId: message.author.id,
          mentions: [...mentions],
        },
      };
      const audience = await this.channels.audience(channel);
      if (audience) this.hub.publishToUsers(audience, activity);
      else this.hub.publishToGuild(channel.guildId, activity);
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

  private async pollsOf(ids: bigint[]): Promise<Map<string, PollDto>> {
    const out = new Map<string, PollDto>();
    if (ids.length === 0) return out;
    const [rows, votes] = await Promise.all([
      this.db.select().from(polls).where(inArray(polls.messageId, ids)),
      this.db.select().from(pollVotes).where(inArray(pollVotes.messageId, ids)),
    ]);
    for (const row of rows) {
      const own = votes.filter((v) => v.messageId === row.messageId);
      out.set(row.messageId.toString(), {
        multiple: row.multiple,
        options: row.options.map((text, i) => ({
          text,
          userIds: own.filter((v) => v.option === i).map((v) => v.userId),
        })),
      });
    }
    return out;
  }

  private async threadCountsOf(ids: bigint[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ root: messages.threadRootId, n: count() })
      .from(messages)
      .where(inArray(messages.threadRootId, ids))
      .groupBy(messages.threadRootId);
    return new Map(rows.map((r) => [String(r.root), r.n]));
  }

  /** Replies of a thread, oldest first. */
  async thread(userId: string, rootId: string): Promise<MessageDto[]> {
    const root = await this.assertReadable(userId, rootId);
    const rows = await this.db
      .select({ message: messages, author: profileColumns })
      .from(messages)
      .innerJoin(users, eq(users.id, messages.authorId))
      .where(eq(messages.threadRootId, root.id))
      .orderBy(asc(messages.id));
    return this.toDtos(rows.map((r) => ({ message: r.message, author: toPublicUser(r.author) })));
  }

  /** The count under the first message changed. */
  private async refreshRoot(rootId: bigint, channel: Pick<Channel, 'id' | 'kind'>): Promise<void> {
    const [root] = await this.db.select().from(messages).where(eq(messages.id, rootId)).limit(1);
    if (root) await this.republish(root, channel);
  }

  private async eventsOf(ids: bigint[]): Promise<Map<string, EventDto>> {
    const out = new Map<string, EventDto>();
    if (ids.length === 0) return out;
    const [rows, answers] = await Promise.all([
      this.db.select().from(messageEvents).where(inArray(messageEvents.messageId, ids)),
      this.db.select().from(eventRsvps).where(inArray(eventRsvps.messageId, ids)),
    ]);
    for (const row of rows) {
      const own = answers.filter((a) => a.messageId === row.messageId);
      const who = (answer: string) => own.filter((a) => a.answer === answer).map((a) => a.userId);
      out.set(row.messageId.toString(), {
        startsAt: row.startsAt.toISOString(),
        yes: who('yes'),
        maybe: who('maybe'),
        no: who('no'),
      });
    }
    return out;
  }

  /** An event is a message whose text is the title; everyone in the channel can answer. */
  async createEvent(
    user: PublicUserDto,
    channelId: string,
    title: string,
    startsAt: Date,
  ): Promise<MessageDto> {
    const channel = await this.channels.assertTextChannel(user.id, channelId);
    const row = await this.db.transaction(async (tx) => {
      const [message] = await tx
        .insert(messages)
        .values({ channelId, authorId: user.id, kind: 'event', content: title })
        .returning();
      if (!message) throw new Error('insert returned no row');
      await tx.insert(messageEvents).values({ messageId: message.id, startsAt });
      return message;
    });
    return this.published(channel, await this.toDto(row, user));
  }

  /** Answers an event; null takes the answer back. */
  async rsvp(userId: string, messageId: string, answer: RsvpAnswer | null): Promise<EventDto> {
    const msg = await this.assertReadable(userId, messageId);
    if (msg.kind !== 'event') throw notFound('Termin nicht gefunden');
    if (answer) {
      await this.db
        .insert(eventRsvps)
        .values({ messageId: msg.id, userId, answer })
        .onConflictDoUpdate({
          target: [eventRsvps.messageId, eventRsvps.userId],
          set: { answer },
        });
    } else {
      await this.db
        .delete(eventRsvps)
        .where(and(eq(eventRsvps.messageId, msg.id), eq(eventRsvps.userId, userId)));
    }
    const event = (await this.eventsOf([msg.id])).get(msg.id.toString());
    if (!event) throw notFound('Termin nicht gefunden');
    await this.channels.publish(
      { id: msg.channelId, kind: msg.channelKind },
      { type: 'message.event', data: { id: msg.id.toString(), channelId: msg.channelId, event } },
    );
    return event;
  }

  /** A poll is a message whose text is the question. */
  async createPoll(
    user: PublicUserDto,
    channelId: string,
    input: CreatePollInput,
  ): Promise<MessageDto> {
    const channel = await this.channels.assertTextChannel(user.id, channelId);
    await this.storage.assertRoom(Buffer.byteLength(input.question));
    const row = await this.db.transaction(async (tx) => {
      const [message] = await tx
        .insert(messages)
        .values({ channelId, authorId: user.id, kind: 'poll', content: input.question })
        .returning();
      if (!message) throw new Error('insert returned no row');
      await tx
        .insert(polls)
        .values({ messageId: message.id, options: input.options, multiple: input.multiple });
      return message;
    });
    return this.published(channel, await this.toDto(row, user));
  }

  /** Votes for an answer, or takes the vote back with a second tap. */
  async vote(userId: string, messageId: string, option: number): Promise<PollDto> {
    const msg = await this.assertReadable(userId, messageId);
    const [poll] = await this.db.select().from(polls).where(eq(polls.messageId, msg.id)).limit(1);
    if (!poll || option >= poll.options.length) throw notFound('Umfrage nicht gefunden');
    await this.db.transaction(async (tx) => {
      const mine = and(eq(pollVotes.messageId, msg.id), eq(pollVotes.userId, userId));
      const had = await tx
        .delete(pollVotes)
        .where(and(mine, eq(pollVotes.option, option)))
        .returning({ option: pollVotes.option });
      if (had.length > 0) return;
      if (!poll.multiple) await tx.delete(pollVotes).where(mine);
      await tx.insert(pollVotes).values({ messageId: msg.id, option, userId });
    });
    const result = (await this.pollsOf([msg.id])).get(msg.id.toString());
    if (!result) throw notFound('Umfrage nicht gefunden');
    await this.channels.publish(
      { id: msg.channelId, kind: msg.channelKind },
      {
        type: 'message.poll',
        data: { id: msg.id.toString(), channelId: msg.channelId, poll: result },
      },
    );
    return result;
  }

  private async previewsOf(ids: string[]): Promise<Map<string, LinkPreviewDto>> {
    const out = new Map<string, LinkPreviewDto>();
    if (ids.length === 0) return out;
    const rows = await this.db.select().from(linkPreviews).where(inArray(linkPreviews.id, ids));
    for (const row of rows) {
      if (!row.title) continue;
      out.set(row.id, {
        url: row.url,
        title: row.title,
        description: row.description,
        siteName: row.siteName,
        imageUrl: row.imageKey ? `/api/link-images/${row.imageKey}` : null,
      });
    }
    return out;
  }

  /** Looks for a preview of the message's first link, in the background. */
  private previewLater(row: Message, channel: Pick<Channel, 'id' | 'kind'>): void {
    if (row.kind !== 'text' || row.previewHidden) return;
    const url = firstUrl(row.content);
    if (!url) return;
    this.previews.enqueue(url, async (linkPreviewId) => {
      // Edited or deleted in the meantime: only a message still holding this link gets it.
      const [updated] = await this.db
        .update(messages)
        .set({ linkPreviewId })
        .where(and(eq(messages.id, row.id), eq(messages.previewHidden, false)))
        .returning();
      if (!updated || firstUrl(updated.content) !== url) return;
      await this.republish(updated, channel);
    });
  }

  private async republish(row: Message, channel: Pick<Channel, 'id' | 'kind'>): Promise<void> {
    const [author] = await this.db
      .select(profileColumns)
      .from(users)
      .where(eq(users.id, row.authorId))
      .limit(1);
    if (!author) return;
    const message = await this.toDto(row, toPublicUser(author));
    await this.channels.publish(channel, { type: 'message.updated', data: { message } });
  }

  /** The author takes the preview off their message. */
  async hidePreview(user: PublicUserDto, messageId: string): Promise<MessageDto> {
    const msg = await this.assertAuthor(user.id, messageId);
    const [row] = await this.db
      .update(messages)
      .set({ linkPreviewId: null, previewHidden: true })
      .where(eq(messages.id, msg.id))
      .returning();
    if (!row) throw notFound('Nachricht nicht gefunden');
    await this.republish(row, { id: row.channelId, kind: msg.channelKind });
    return this.toDto(row, user);
  }

  /** Messages you can read that contain the words; newest first. */
  async search(user: PublicUserDto, query: SearchQuery): Promise<SearchResultDto[]> {
    const words = query.q.match(/[\p{L}\p{N}]+/gu) ?? [];
    if (words.length === 0) return [];
    // Only letters and digits reach the query syntax; each word also matches longer ones.
    const tsquery = words
      .slice(0, 10)
      .map((w) => `${w}:*`)
      .join(' & ');
    const me = sql`${user.id}::uuid`;
    const conditions: (SQL | undefined)[] = [
      sql`to_tsvector('simple', ${messages.content}) @@ to_tsquery('simple', ${tsquery})`,
      // Voice messages hold their transcript as text.
      inArray(messages.kind, ['text', 'voice', 'poll', 'event']),
      or(
        and(
          isNotNull(channels.guildId),
          sql`exists (select 1 from guild_members gm where gm.guild_id = ${channels.guildId} and gm.user_id = ${me})`,
          channelVisibleSql(sql`${channels.id}`, me),
        ),
        sql`exists (select 1 from dm_members dm where dm.channel_id = ${channels.id} and dm.user_id = ${me})`,
      ),
      query.guildId ? eq(channels.guildId, query.guildId) : undefined,
      query.channelId ? eq(messages.channelId, query.channelId) : undefined,
      query.privateOnly ? isNull(channels.guildId) : undefined,
      query.authorId ? eq(messages.authorId, query.authorId) : undefined,
      query.after ? gte(messages.createdAt, new Date(query.after)) : undefined,
      query.until
        ? lt(messages.createdAt, new Date(new Date(query.until).getTime() + 86_400_000))
        : undefined,
      query.beforeId ? lt(messages.id, BigInt(query.beforeId)) : undefined,
    ];
    const rows = await this.db
      .select({
        message: messages,
        author: profileColumns,
        channelName: channels.name,
        channelKind: channels.kind,
        guildId: channels.guildId,
        guildName: guilds.name,
      })
      .from(messages)
      .innerJoin(channels, eq(channels.id, messages.channelId))
      .innerJoin(users, eq(users.id, messages.authorId))
      .leftJoin(guilds, eq(guilds.id, channels.guildId))
      .where(and(...conditions))
      .orderBy(desc(messages.id))
      .limit(SEARCH_PAGE_SIZE);
    const dtos = await this.toDtos(
      rows.map((r) => ({ message: r.message, author: toPublicUser(r.author) })),
    );
    return rows.map((r, i) => ({
      message: dtos[i]!,
      channelName: r.channelName,
      channelKind: toChannelKind(r.channelKind),
      guildId: r.guildId,
      guildName: r.guildName,
    }));
  }

  /** Stored messages with their reactions and quoted messages. */
  private async toDtos(rows: { message: Message; author: PublicUserDto }[]): Promise<MessageDto[]> {
    const replyIds = rows.flatMap((r) => (r.message.replyToId ? [r.message.replyToId] : []));
    const previewIds = rows.flatMap((r) =>
      r.message.linkPreviewId ? [r.message.linkPreviewId] : [],
    );
    const pollIds = rows.flatMap((r) => (r.message.kind === 'poll' ? [r.message.id] : []));
    const eventIds = rows.flatMap((r) => (r.message.kind === 'event' ? [r.message.id] : []));
    const [reactions, refs, previews, pollsById, eventsById, threadCounts] = await Promise.all([
      this.reactionsOf(rows.map((r) => r.message.id)),
      this.refsOf([...new Set(replyIds)]),
      this.previewsOf([...new Set(previewIds)]),
      this.pollsOf(pollIds),
      this.eventsOf(eventIds),
      this.threadCountsOf(rows.map((r) => r.message.id)),
    ]);
    return rows.map(({ message, author }) =>
      toMessageDto(message, author, {
        reactions: reactions.get(message.id.toString()) ?? [],
        replyTo: message.replyToId ? (refs.get(message.replyToId.toString()) ?? null) : null,
        linkPreview: message.linkPreviewId ? (previews.get(message.linkPreviewId) ?? null) : null,
        poll: pollsById.get(message.id.toString()) ?? null,
        event: eventsById.get(message.id.toString()) ?? null,
        threadCount: threadCounts.get(message.id.toString()) ?? 0,
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
      .where(
        and(
          eq(channels.guildId, guild.id),
          eq(channels.kind, 'text'),
          eq(channels.restricted, false),
        ),
      )
      .orderBy(asc(channels.position), asc(channels.createdAt), asc(channels.name))
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
    const message = await this.published(channel, toMessageDto(row, user));
    this.transcripts.enqueue(join(this.voiceDir, audio.key), async (text) => {
      const [updated] = await this.db
        .update(messages)
        .set({ content: text })
        .where(eq(messages.id, row.id))
        .returning();
      if (updated) await this.republish(updated, channel);
    });
    return message;
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
    threadRootId?: string,
  ): Promise<MessageDto> {
    const channel = await this.channels.assertTextChannel(user.id, channelId);
    if (threadRootId) {
      const [root] = await this.db
        .select({ channelId: messages.channelId, nested: messages.threadRootId })
        .from(messages)
        .where(eq(messages.id, BigInt(threadRootId)))
        .limit(1);
      if (root?.channelId !== channelId || root.nested) {
        throw new AppError('BAD_REQUEST', 400, 'Diesen Thread gibt es nicht');
      }
    }
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
        // A reply in a thread also tells the person who started it.
        replyToId: replyToId || threadRootId ? BigInt(replyToId ?? threadRootId ?? '0') : null,
        threadRootId: threadRootId ? BigInt(threadRootId) : null,
      })
      .returning();
    if (!row) throw new Error('insert returned no row');
    const message = await this.published(channel, await this.toDto(row, user));
    this.previewLater(row, channel);
    if (row.threadRootId) await this.refreshRoot(row.threadRootId, channel);
    return message;
  }

  /** Newest `limit` messages with id < before, returned in ascending order. */
  async listPage(
    userId: string,
    channelId: string,
    query: ListMessagesQuery,
  ): Promise<{ messages: MessageDto[]; hasMore: boolean }> {
    await this.channels.assertAccess(userId, channelId);
    const inChannel = and(eq(messages.channelId, channelId), isNull(messages.threadRootId));
    const where = query.before ? and(inChannel, lt(messages.id, BigInt(query.before))) : inChannel;
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
      await this.perms.assert(
        userId,
        await this.guildOf(msg.guildId),
        'manage_messages',
        'Dafür fehlt dir das Recht',
      );
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

  private async guildOf(guildId: string): Promise<{ id: string; ownerId: string }> {
    const [guild] = await this.db
      .select({ id: guilds.id, ownerId: guilds.ownerId })
      .from(guilds)
      .where(eq(guilds.id, guildId))
      .limit(1);
    if (!guild) throw notFound('Server nicht gefunden');
    return guild;
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
          and ${channelVisibleSql(sql`c.id`, sql`gm.user_id`)}
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
        and m.thread_root_id is null
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
    const found = await this.assertAuthor(user.id, messageId);
    const msg = { ...found, previewUrl: firstUrl(found.content) };
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
    const channel = { id: row.channelId, kind: msg.channelKind };
    // Another link (or none): the old preview no longer fits.
    let current = row;
    if (firstUrl(content) !== msg.previewUrl) {
      const [cleared] = await this.db
        .update(messages)
        .set({ linkPreviewId: null })
        .where(eq(messages.id, msg.id))
        .returning();
      if (cleared) current = cleared;
    }
    const message = await this.toDto(current, user);
    await this.channels.publish(channel, { type: 'message.updated', data: { message } });
    if (!current.linkPreviewId) this.previewLater(current, channel);
    return message;
  }

  /** Your own, or with manage_messages those of people below your rank. */
  async delete(userId: string, messageId: string): Promise<void> {
    const msg = await this.assertMayDelete(userId, messageId);
    const deleted = await this.db
      .delete(messages)
      .where(eq(messages.id, msg.id))
      .returning({ id: messages.id });
    if (deleted.length === 0) throw notFound('Nachricht nicht gefunden');
    if (msg.threadRootId) {
      await this.refreshRoot(msg.threadRootId, { id: msg.channelId, kind: msg.channelKind });
    }
    if (msg.audioKey) await rm(join(this.voiceDir, msg.audioKey), { force: true });
    if (msg.fileKey) await rm(join(this.fileDir, msg.fileKey), { force: true });
    this.storage.changed();
    await this.channels.publish(
      { id: msg.channelId, kind: msg.channelKind },
      { type: 'message.deleted', data: { id: msg.id.toString(), channelId: msg.channelId } },
    );
  }

  private async assertMayDelete(userId: string, messageId: string) {
    const [row] = await this.db
      .select({ authorId: messages.authorId, guildId: channels.guildId })
      .from(messages)
      .innerJoin(channels, eq(channels.id, messages.channelId))
      .where(eq(messages.id, BigInt(messageId)))
      .limit(1);
    if (!row?.guildId || row.authorId === userId) return this.assertAuthor(userId, messageId);
    await this.assertReadable(userId, messageId);
    const guild = await this.guildOf(row.guildId);
    if (!(await this.perms.has(userId, guild, 'manage_messages'))) {
      return this.assertAuthor(userId, messageId);
    }
    await this.perms.assertOutranks(userId, row.authorId, guild);
    return this.assertAuthor(row.authorId, messageId, true);
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
  private async assertAuthor(userId: string, messageId: string, moderated = false) {
    const [row] = await this.db
      .select({
        id: messages.id,
        authorId: messages.authorId,
        channelId: messages.channelId,
        kind: messages.kind,
        audioKey: messages.audioKey,
        fileKey: messages.fileKey,
        channelKind: channels.kind,
        content: messages.content,
        threadRootId: messages.threadRootId,
      })
      .from(messages)
      .innerJoin(channels, eq(channels.id, messages.channelId))
      .where(eq(messages.id, BigInt(messageId)))
      .limit(1);
    if (!row) throw notFound('Nachricht nicht gefunden');
    if (!moderated) await this.channels.assertAccess(userId, row.channelId);
    if (row.authorId !== userId) {
      throw forbidden('Nur der Autor darf diese Nachricht ändern', 'NOT_AUTHOR');
    }
    return row;
  }
}
