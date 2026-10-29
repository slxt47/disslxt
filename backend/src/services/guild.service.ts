import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { and, asc, count, eq, isNotNull, or } from 'drizzle-orm';
import {
  DEFAULT_CHANNEL_NAME,
  GUILDS_PER_USER_MAX,
  type ChannelDto,
  type GuildDto,
  type InvitePreviewDto,
  type MemberDto,
  type UserDto,
} from '@disslxt/shared';
import type { Database } from '../db/client.js';
import { channels, guildMembers, guilds, messages, users, type Guild } from '../db/schema.js';
import { AppError, conflict, forbidden, notFound } from '../lib/errors.js';
import type { ImageStore } from '../lib/images.js';
import { isUniqueViolation } from '../lib/pgErrors.js';
import { inviteCode } from '../lib/tokens.js';
import type { Hub } from '../realtime/hub.js';
import { profileColumns, toChannelDto, toGuildDto, toPublicUser } from './dto.js';
import type { PushService } from './push.service.js';

export class GuildService {
  constructor(
    private readonly db: Database,
    private readonly hub: Hub,
    private readonly push: PushService,
    /** Where uploaded files of messages live (removed together with the guild). */
    private readonly uploads: { voiceDir: string; fileDir: string },
    /** Server pictures. */
    private readonly images: ImageStore,
  ) {}

  /** Owner only: renames the server. */
  /**
   * Owner only: name and/or tag. A changed tag is updated on everyone wearing it; a removed tag
   * disappears from them.
   */
  async update(
    userId: string,
    guildId: string,
    patch: { name?: string; tag?: string; tagEmoji?: string | null },
  ): Promise<GuildDto> {
    await this.assertOwner(userId, guildId);
    const set: Partial<typeof guilds.$inferInsert> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.tag !== undefined) set.tag = patch.tag || null;
    if (patch.tagEmoji !== undefined) set.tagEmoji = patch.tagEmoji;
    if (patch.tag === '') set.tagEmoji = null;
    const [row] = Object.keys(set).length
      ? await this.db.update(guilds).set(set).where(eq(guilds.id, guildId)).returning()
      : await this.db.select().from(guilds).where(eq(guilds.id, guildId)).limit(1);
    if (!row) throw notFound('Server nicht gefunden');
    if (patch.tag !== undefined || patch.tagEmoji !== undefined) {
      const wearers = row.tag
        ? await this.db
            .update(users)
            .set({ tagText: row.tag, tagEmoji: row.tagEmoji })
            .where(eq(users.tagGuildId, guildId))
            .returning({ id: users.id })
        : await this.clearTag(guildId);
      await this.profilesChanged(wearers.map((w) => w.id));
    }
    return this.publishUpdate(row);
  }

  /** Owner only: new server picture (bytes checked); the previous one is removed. */
  async setIcon(userId: string, guildId: string, body: unknown): Promise<GuildDto> {
    const old = await this.assertOwner(userId, guildId);
    const key = await this.images.save(body);
    const [row] = await this.db
      .update(guilds)
      .set({ iconKey: key })
      .where(eq(guilds.id, guildId))
      .returning();
    if (!row) {
      await this.images.remove(key);
      throw notFound('Server nicht gefunden');
    }
    await this.images.remove(old.iconKey);
    return this.publishUpdate(row);
  }

  async removeIcon(userId: string, guildId: string): Promise<GuildDto> {
    const old = await this.assertOwner(userId, guildId);
    const [row] = await this.db
      .update(guilds)
      .set({ iconKey: null })
      .where(eq(guilds.id, guildId))
      .returning();
    if (!row) throw notFound('Server nicht gefunden');
    await this.images.remove(old.iconKey);
    return this.publishUpdate(row);
  }

  /** Members only. */
  async icon(userId: string, guildId: string) {
    const guild = await this.assertMember(userId, guildId);
    return this.images.read(guild.iconKey);
  }

  /** Set by createServices: re-announces changed profiles (user.updated) to everyone concerned. */
  profilesChanged: (userIds: string[]) => Promise<void> = async () => undefined;

  /** Takes a server's tag off the people wearing it (optionally only one person). */
  private async clearTag(guildId: string, userId?: string) {
    return this.db
      .update(users)
      .set({ tagGuildId: null, tagText: null, tagEmoji: null })
      .where(
        userId
          ? and(eq(users.tagGuildId, guildId), eq(users.id, userId))
          : eq(users.tagGuildId, guildId),
      )
      .returning({ id: users.id });
  }

  /** Servers someone created (for the per-person limit). */
  private async ownedCount(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(guilds)
      .where(eq(guilds.ownerId, userId));
    return row?.n ?? 0;
  }

  private async assertOwner(userId: string, guildId: string): Promise<Guild> {
    const guild = await this.assertMember(userId, guildId);
    if (guild.ownerId !== userId) {
      throw forbidden('Nur der Besitzer kann die Server-Einstellungen ändern');
    }
    return guild;
  }

  private publishUpdate(row: Guild): GuildDto {
    const guild = toGuildDto(row);
    this.hub.publishToGuild(row.id, { type: 'guild.updated', data: { guild } });
    return guild;
  }

  /**
   * Owner only, and only with the guild's exact name as confirmation. Channels, messages and
   * memberships go with it (FK cascade); stored voice files are removed afterwards.
   */
  async delete(userId: string, guildId: string, confirmName: string): Promise<void> {
    const guild = await this.assertMember(userId, guildId);
    if (guild.ownerId !== userId) throw forbidden('Nur der Besitzer kann den Server löschen');
    if (confirmName.trim() !== guild.name) {
      throw new AppError('BAD_REQUEST', 400, 'Der eingegebene Name stimmt nicht überein');
    }
    const files = await this.db
      .select({ audioKey: messages.audioKey, fileKey: messages.fileKey })
      .from(messages)
      .innerJoin(channels, eq(channels.id, messages.channelId))
      .where(
        and(
          eq(channels.guildId, guildId),
          or(isNotNull(messages.audioKey), isNotNull(messages.fileKey)),
        ),
      );
    const wearers = await this.clearTag(guildId);
    await this.db.delete(guilds).where(eq(guilds.id, guildId));
    this.hub.removeGuild(guildId);
    await this.profilesChanged(wearers.map((w) => w.id));
    await this.images.remove(guild.iconKey);
    await Promise.all(
      files.flatMap((f) => [
        ...(f.audioKey ? [rm(join(this.uploads.voiceDir, f.audioKey), { force: true })] : []),
        ...(f.fileKey ? [rm(join(this.uploads.fileDir, f.fileKey), { force: true })] : []),
      ]),
    );
  }

  /** Creates a guild with the creator as member and a #general channel. */
  async create(
    user: Pick<UserDto, 'id'>,
    name: string,
  ): Promise<{ guild: GuildDto; channels: ChannelDto[] }> {
    if ((await this.ownedCount(user.id)) >= GUILDS_PER_USER_MAX) {
      throw conflict(
        'GUILD_LIMIT',
        `Du kannst höchstens ${GUILDS_PER_USER_MAX} Server erstellen. Lösche einen, um einen neuen anzulegen.`,
      );
    }
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await this.db.transaction(async (tx) => {
          const [guild] = await tx
            .insert(guilds)
            .values({ name, ownerId: user.id, inviteCode: inviteCode() })
            .returning();
          if (!guild) throw new Error('insert returned no row');
          await tx.insert(guildMembers).values({ guildId: guild.id, userId: user.id });
          const [general] = await tx
            .insert(channels)
            .values({ guildId: guild.id, name: DEFAULT_CHANNEL_NAME })
            .returning();
          if (!general) throw new Error('insert returned no row');
          return { guild: toGuildDto(guild), channels: [toChannelDto(general)] };
        });
        this.hub.addUserToGuild(user.id, result.guild.id);
        return result;
      } catch (err) {
        // Extremely unlikely invite-code collision: retry with a fresh code.
        if (attempt < 3 && isUniqueViolation(err, 'guilds_invite_code_uq')) continue;
        throw err;
      }
    }
  }

  async listForUser(userId: string): Promise<GuildDto[]> {
    const rows = await this.db
      .select({ guild: guilds })
      .from(guildMembers)
      .innerJoin(guilds, eq(guilds.id, guildMembers.guildId))
      .where(eq(guildMembers.userId, userId))
      .orderBy(asc(guildMembers.joinedAt), asc(guilds.createdAt));
    return rows.map((r) => toGuildDto(r.guild));
  }

  /** Throws 404 if the guild does not exist and 403 if the user is not a member. */
  async assertMember(userId: string, guildId: string): Promise<Guild> {
    const [row] = await this.db
      .select({ guild: guilds, memberId: guildMembers.userId })
      .from(guilds)
      .leftJoin(
        guildMembers,
        and(eq(guildMembers.guildId, guilds.id), eq(guildMembers.userId, userId)),
      )
      .where(eq(guilds.id, guildId))
      .limit(1);
    if (!row) throw notFound('Server nicht gefunden');
    if (!row.memberId) throw forbidden('Du bist kein Mitglied dieses Servers');
    return row.guild;
  }

  async isMember(userId: string, guildId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ userId: guildMembers.userId })
      .from(guildMembers)
      .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, userId)))
      .limit(1);
    return !!row;
  }

  async get(userId: string, guildId: string): Promise<GuildDto> {
    return toGuildDto(await this.assertMember(userId, guildId));
  }

  async guildIdsForUser(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ guildId: guildMembers.guildId })
      .from(guildMembers)
      .where(eq(guildMembers.userId, userId));
    return rows.map((r) => r.guildId);
  }

  async members(userId: string, guildId: string): Promise<MemberDto[]> {
    await this.assertMember(userId, guildId);
    const rows = await this.db
      .select(profileColumns)
      .from(guildMembers)
      .innerJoin(users, eq(users.id, guildMembers.userId))
      .where(eq(guildMembers.guildId, guildId))
      .orderBy(asc(users.username));
    return rows.map((r) => {
      const { id, ...profile } = toPublicUser(r);
      const presence = this.hub.presence(id);
      return { userId: id, ...profile, online: presence !== 'offline', presence };
    });
  }

  private async findByInvite(code: string): Promise<Guild> {
    const [guild] = await this.db.select().from(guilds).where(eq(guilds.inviteCode, code)).limit(1);
    if (!guild) throw notFound('Einladung ungültig oder abgelaufen', 'INVITE_NOT_FOUND');
    return guild;
  }

  async invitePreview(userId: string, code: string): Promise<InvitePreviewDto> {
    const guild = await this.findByInvite(code);
    const [[countRow], alreadyMember] = await Promise.all([
      this.db.select({ n: count() }).from(guildMembers).where(eq(guildMembers.guildId, guild.id)),
      this.isMember(userId, guild.id),
    ]);
    return {
      guild: { id: guild.id, name: guild.name, memberCount: countRow?.n ?? 0 },
      alreadyMember,
    };
  }

  /** Joins via invite code. Idempotent: joining again returns the guild without events. */
  async join(
    user: Pick<
      UserDto,
      'id' | 'username' | 'displayName' | 'avatarUrl' | 'badge' | 'tag' | 'status'
    >,
    code: string,
  ): Promise<GuildDto> {
    const guild = await this.findByInvite(code);
    const inserted = await this.db
      .insert(guildMembers)
      .values({ guildId: guild.id, userId: user.id })
      .onConflictDoNothing()
      .returning({ userId: guildMembers.userId });
    if (inserted.length > 0) {
      const online = this.hub.isOnline(user.id);
      this.hub.addUserToGuild(user.id, guild.id);
      this.hub.publishToGuild(guild.id, {
        type: 'member.joined',
        data: {
          guildId: guild.id,
          member: {
            userId: user.id,
            username: user.username,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
            badge: user.badge ?? null,
            tag: user.tag ?? null,
            status: user.status ?? null,
            online,
            presence: this.hub.presence(user.id),
          },
        },
      });
      if (online) {
        this.hub.publishToGuild(guild.id, {
          type: 'presence.update',
          data: { guildId: guild.id, userId: user.id, status: this.hub.presence(user.id) },
        });
      }
      this.push.memberJoined(guild.id, user);
    }
    return toGuildDto(guild);
  }

  async leave(userId: string, guildId: string): Promise<void> {
    const guild = await this.assertMember(userId, guildId);
    if (guild.ownerId === userId) {
      throw conflict('OWNER_CANNOT_LEAVE', 'Der Besitzer kann den Server nicht verlassen');
    }
    await this.db
      .delete(guildMembers)
      .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, userId)));
    // Publish first so the leaving user's other tabs learn about it too, then drop their rooms.
    this.hub.publishToGuild(guildId, { type: 'member.left', data: { guildId, userId } });
    this.hub.removeUserFromGuild(userId, guildId);
    const wore = await this.clearTag(guildId, userId);
    if (wore.length > 0) await this.profilesChanged([userId]);
  }
}
