import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { and, asc, count, eq, inArray, isNotNull, max, ne, or, sql } from 'drizzle-orm';
import {
  CATEGORIES_PER_GUILD_MAX,
  type CategoryDto,
  type ChannelDto,
  type ChannelKind,
  type UpdateChannelInput,
  type VoicePeerDto,
  type WsServerMessage,
} from '@disslxt/shared';
import type { Database } from '../db/client.js';
import {
  channelCategories,
  channels,
  dmMembers,
  messages,
  type Channel,
  type Guild,
} from '../db/schema.js';
import { AppError, conflict, forbidden, notFound } from '../lib/errors.js';
import { isUniqueViolation } from '../lib/pgErrors.js';
import type { Hub } from '../realtime/hub.js';
import { toChannelDto } from './dto.js';
import type { FriendService } from './friend.service.js';
import type { GuildService } from './guild.service.js';
import { channelVisibleSql, type PermissionService } from './permission.service.js';
import type { StorageService } from './storage.service.js';

const NO_RIGHT = 'Dafür fehlt dir das Recht';
const toCategoryDto = (c: typeof channelCategories.$inferSelect): CategoryDto => ({
  id: c.id,
  name: c.name,
  position: c.position,
});

export class ChannelService {
  constructor(
    private readonly db: Database,
    private readonly hub: Hub,
    private readonly guilds: GuildService,
    private readonly friends: FriendService,
    private readonly perms: PermissionService,
    /** Where files of messages live (removed together with the channel). */
    private readonly uploads: { voiceDir: string; fileDir: string },
    private readonly storage: StorageService,
  ) {}

  async list(userId: string, guildId: string): Promise<ChannelDto[]> {
    await this.guilds.assertMember(userId, guildId);
    const rows = await this.db
      .select()
      .from(channels)
      .where(
        and(
          eq(channels.guildId, guildId),
          channelVisibleSql(sql`${channels.id}`, sql`${userId}::uuid`),
        ),
      )
      .orderBy(asc(channels.position), asc(channels.createdAt), asc(channels.name));
    return rows.map(toChannelDto);
  }

  /** Needs manage_channels. `name` must already be normalised by the shared schema. */
  async create(
    userId: string,
    guildId: string,
    name: string,
    kind: ChannelKind = 'text',
  ): Promise<ChannelDto> {
    const guild = await this.guilds.assertMember(userId, guildId);
    await this.perms.assert(userId, guild, 'manage_channels', 'Dafür fehlt dir das Recht');
    let row: Channel | undefined;
    try {
      const [last] = await this.db
        .select({ position: max(channels.position) })
        .from(channels)
        .where(eq(channels.guildId, guildId));
      [row] = await this.db
        .insert(channels)
        .values({ guildId, name, kind, position: (last?.position ?? -1) + 1 })
        .returning();
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw conflict('CHANNEL_EXISTS', 'Ein Kanal mit diesem Namen existiert bereits');
      }
      throw err;
    }
    if (!row) throw new Error('insert returned no row');
    const channel = toChannelDto(row);
    this.hub.publishToGuild(guildId, { type: 'channel.created', data: { channel } });
    return channel;
  }

  /** A server channel you see and may manage (404 for anything else). */
  private async managed(
    userId: string,
    channelId: string,
  ): Promise<{ channel: Channel; guild: Guild }> {
    const channel = await this.assertAccess(userId, channelId);
    if (!channel.guildId) throw notFound('Kanal nicht gefunden');
    const guild = await this.guilds.assertMember(userId, channel.guildId);
    await this.perms.assert(userId, guild, 'manage_channels', NO_RIGHT);
    return { channel, guild };
  }

  private async managedGuild(userId: string, guildId: string): Promise<Guild> {
    const guild = await this.guilds.assertMember(userId, guildId);
    await this.perms.assert(userId, guild, 'manage_channels', NO_RIGHT);
    return guild;
  }

  private changed(guildId: string): void {
    this.hub.publishToGuild(guildId, { type: 'guild.channels-changed', data: { guildId } });
  }

  private async assertCategory(guildId: string, categoryId: string): Promise<void> {
    const [row] = await this.db
      .select({ id: channelCategories.id })
      .from(channelCategories)
      .where(and(eq(channelCategories.id, categoryId), eq(channelCategories.guildId, guildId)))
      .limit(1);
    if (!row) throw notFound('Kategorie nicht gefunden');
  }

  async update(userId: string, channelId: string, patch: UpdateChannelInput): Promise<ChannelDto> {
    const { channel, guild } = await this.managed(userId, channelId);
    if (patch.categoryId) await this.assertCategory(guild.id, patch.categoryId);
    const set: Partial<typeof channels.$inferInsert> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.description !== undefined) set.description = patch.description || null;
    if (patch.categoryId !== undefined) set.categoryId = patch.categoryId;
    if (Object.keys(set).length === 0) return toChannelDto(channel);
    try {
      const [row] = await this.db
        .update(channels)
        .set(set)
        .where(eq(channels.id, channelId))
        .returning();
      if (!row) throw notFound('Kanal nicht gefunden');
      this.changed(guild.id);
      return toChannelDto(row);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw conflict('CHANNEL_EXISTS', 'Ein Kanal mit diesem Namen existiert bereits');
      }
      throw err;
    }
  }

  /**
   * Deletes a channel with all its messages and files. The name confirms it, and a server keeps
   * at least one text channel, because people arrive and get greeted there.
   */
  async remove(userId: string, channelId: string, confirmName: string): Promise<void> {
    const { channel, guild } = await this.managed(userId, channelId);
    if (confirmName.trim() !== channel.name) {
      throw new AppError('BAD_REQUEST', 400, 'Der eingegebene Name stimmt nicht überein');
    }
    if (channel.kind === 'text') {
      const [others] = await this.db
        .select({ n: count() })
        .from(channels)
        .where(
          and(
            eq(channels.guildId, guild.id),
            eq(channels.kind, 'text'),
            eq(channels.restricted, false),
            ne(channels.id, channelId),
          ),
        );
      if ((others?.n ?? 0) === 0) {
        throw new AppError('BAD_REQUEST', 400, 'Der letzte offene Textkanal bleibt bestehen');
      }
    }
    const files = await this.db
      .select({ audioKey: messages.audioKey, fileKey: messages.fileKey })
      .from(messages)
      .where(
        and(
          eq(messages.channelId, channelId),
          or(isNotNull(messages.audioKey), isNotNull(messages.fileKey)),
        ),
      );
    this.hub.closeChannel(guild.id, channelId);
    await this.db.delete(channels).where(eq(channels.id, channelId));
    await Promise.all(
      files.flatMap((f) => [
        ...(f.audioKey ? [rm(join(this.uploads.voiceDir, f.audioKey), { force: true })] : []),
        ...(f.fileKey ? [rm(join(this.uploads.fileDir, f.fileKey), { force: true })] : []),
      ]),
    );
    this.storage.changed();
    this.changed(guild.id);
  }

  /**
   * New order, top to bottom. Only names channels you see: hidden ones keep their place, so moving
   * things around reveals nothing about them.
   */
  async reorder(
    userId: string,
    guildId: string,
    order: { id: string; categoryId: string | null }[],
  ): Promise<void> {
    await this.managedGuild(userId, guildId);
    const visible = new Set((await this.list(userId, guildId)).map((c) => c.id));
    if (order.some((c) => !visible.has(c.id))) throw notFound('Kanal nicht gefunden');
    const categoryIds = [...new Set(order.flatMap((c) => (c.categoryId ? [c.categoryId] : [])))];
    if (categoryIds.length > 0) {
      const known = await this.db
        .select({ id: channelCategories.id })
        .from(channelCategories)
        .where(
          and(eq(channelCategories.guildId, guildId), inArray(channelCategories.id, categoryIds)),
        );
      if (known.length !== categoryIds.length) throw notFound('Kategorie nicht gefunden');
    }
    await this.db.transaction(async (tx) => {
      for (const [position, c] of order.entries()) {
        await tx
          .update(channels)
          .set({ position, categoryId: c.categoryId })
          .where(eq(channels.id, c.id));
      }
    });
    this.changed(guildId);
  }

  async categories(userId: string, guildId: string): Promise<CategoryDto[]> {
    await this.guilds.assertMember(userId, guildId);
    const rows = await this.db
      .select()
      .from(channelCategories)
      .where(eq(channelCategories.guildId, guildId))
      .orderBy(asc(channelCategories.position), asc(channelCategories.createdAt));
    return rows.map(toCategoryDto);
  }

  async createCategory(userId: string, guildId: string, name: string): Promise<CategoryDto> {
    await this.managedGuild(userId, guildId);
    const [stats] = await this.db
      .select({ n: count(), last: max(channelCategories.position) })
      .from(channelCategories)
      .where(eq(channelCategories.guildId, guildId));
    if ((stats?.n ?? 0) >= CATEGORIES_PER_GUILD_MAX) {
      throw new AppError(
        'BAD_REQUEST',
        400,
        `Höchstens ${CATEGORIES_PER_GUILD_MAX} Kategorien pro Server`,
      );
    }
    try {
      const [row] = await this.db
        .insert(channelCategories)
        .values({ guildId, name, position: (stats?.last ?? -1) + 1 })
        .returning();
      if (!row) throw new Error('insert returned no row');
      this.changed(guildId);
      return toCategoryDto(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('CONFLICT', 'Diese Kategorie gibt es schon');
      throw err;
    }
  }

  async renameCategory(
    userId: string,
    guildId: string,
    categoryId: string,
    name: string,
  ): Promise<CategoryDto> {
    await this.managedGuild(userId, guildId);
    try {
      const [row] = await this.db
        .update(channelCategories)
        .set({ name })
        .where(and(eq(channelCategories.id, categoryId), eq(channelCategories.guildId, guildId)))
        .returning();
      if (!row) throw notFound('Kategorie nicht gefunden');
      this.changed(guildId);
      return toCategoryDto(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('CONFLICT', 'Diese Kategorie gibt es schon');
      throw err;
    }
  }

  /** Its channels stay, they move out of the category. */
  async deleteCategory(userId: string, guildId: string, categoryId: string): Promise<void> {
    await this.managedGuild(userId, guildId);
    const gone = await this.db
      .delete(channelCategories)
      .where(and(eq(channelCategories.id, categoryId), eq(channelCategories.guildId, guildId)))
      .returning({ id: channelCategories.id });
    if (gone.length === 0) throw notFound('Kategorie nicht gefunden');
    this.changed(guildId);
  }

  async reorderCategories(userId: string, guildId: string, ids: string[]): Promise<void> {
    await this.managedGuild(userId, guildId);
    const known = new Set((await this.categories(userId, guildId)).map((c) => c.id));
    if (ids.length !== known.size || ids.some((id) => !known.has(id))) {
      throw new AppError('BAD_REQUEST', 400, 'Die Liste muss alle Kategorien enthalten');
    }
    await this.db.transaction(async (tx) => {
      for (const [position, id] of ids.entries()) {
        await tx.update(channelCategories).set({ position }).where(eq(channelCategories.id, id));
      }
    });
    this.changed(guildId);
  }

  /** Who is in the call of a private conversation (access checked by the caller). */
  callPeers(channelId: string): VoicePeerDto[] {
    return this.hub.callPeers(channelId);
  }

  /** Who is in which voice channel of a guild right now (members only). */
  async voiceState(userId: string, guildId: string): Promise<Record<string, VoicePeerDto[]>> {
    await this.guilds.assertMember(userId, guildId);
    const visible = new Set((await this.list(userId, guildId)).map((c) => c.id));
    return Object.fromEntries(
      Object.entries(this.hub.voiceStateForGuild(guildId)).filter(([id]) => visible.has(id)),
    );
  }

  /**
   * Like assertAccess, for posting messages: voice channels have no text chat, and in a private
   * conversation only friends can write (the history stays readable after unfriending).
   */
  async assertTextChannel(userId: string, channelId: string): Promise<Channel> {
    const channel = await this.assertAccess(userId, channelId);
    if (channel.kind === 'voice') {
      throw new AppError('BAD_REQUEST', 400, 'In Sprachkanälen gibt es keine Textnachrichten');
    }
    if (channel.kind === 'dm') await this.assertDmOpen(userId, channel);
    return channel;
  }

  /**
   * Who hears about a call in a private conversation: both friends of a 'dm' (only while still
   * friends) or every member of a group. Undefined for server voice channels.
   */
  async callAudience(userId: string, channel: Channel): Promise<string[] | undefined> {
    if (channel.kind === 'dm') return this.assertDmOpen(userId, channel);
    if (channel.kind === 'group') return this.dmMemberIds(channel.id);
    return undefined;
  }

  /** Writing and calling in a private conversation: both must still be friends. */
  async assertDmOpen(userId: string, channel: Channel): Promise<string[]> {
    const members = await this.dmMemberIds(channel.id);
    const peer = members.find((id) => id !== userId);
    if (!peer || !(await this.friends.areFriends(userId, peer))) {
      throw forbidden('Ihr seid nicht mehr befreundet', 'NOT_FRIENDS');
    }
    return members;
  }

  async dmMemberIds(channelId: string): Promise<string[]> {
    const rows = await this.db
      .select({ userId: dmMembers.userId })
      .from(dmMembers)
      .where(eq(dmMembers.channelId, channelId));
    return rows.map((r) => r.userId);
  }

  /**
   * Loads a channel and checks the user may read it: member of its guild, or one of the two
   * people of a private conversation (404 / 403).
   */
  async assertAccess(userId: string, channelId: string): Promise<Channel> {
    const [channel] = await this.db
      .select()
      .from(channels)
      .where(eq(channels.id, channelId))
      .limit(1);
    if (!channel) throw notFound('Kanal nicht gefunden');
    if (channel.guildId) {
      const guild = await this.guilds.assertMember(userId, channel.guildId);
      // A channel you may not see does not exist for you.
      if (!(await this.perms.canSeeChannel(userId, channel, guild))) {
        throw notFound('Kanal nicht gefunden');
      }
    } else {
      const [row] = await this.db
        .select({ userId: dmMembers.userId })
        .from(dmMembers)
        .where(and(eq(dmMembers.channelId, channelId), eq(dmMembers.userId, userId)))
        .limit(1);
      if (!row) throw forbidden('Das ist nicht deine Unterhaltung');
    }
    return channel;
  }

  /** Restricted server channel: who sees it (null: everyone on the server). */
  async audience(
    channel: Pick<Channel, 'id' | 'guildId' | 'restricted'>,
  ): Promise<string[] | null> {
    if (!channel.restricted || !channel.guildId) return null;
    const ownerId = await this.guilds.ownerOf(channel.guildId);
    const all = await this.perms.restrictedAudience(channel.guildId, ownerId);
    return [...(all.get(channel.id) ?? [])];
  }

  /** Delivers an event to everyone who reads the channel: its subscribers, or both DM members. */
  async publish(channel: Pick<Channel, 'id' | 'kind'>, msg: WsServerMessage): Promise<void> {
    if (channel.kind === 'dm' || channel.kind === 'group') {
      this.hub.publishToUsers(await this.dmMemberIds(channel.id), msg);
    } else this.hub.publishToChannel(channel.id, msg);
  }
}
