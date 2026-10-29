import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { and, count, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { GROUP_MAX_MEMBERS, type DmChannelDto, type PublicUserDto } from '@disslxt/shared';
import type { Database } from '../db/client.js';
import { channels, dmMembers, messages, users, type Channel } from '../db/schema.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { isUniqueViolation } from '../lib/pgErrors.js';
import type { Hub } from '../realtime/hub.js';
import { profileColumns, toChannelDto, toPublicUser } from './dto.js';
import type { FriendService } from './friend.service.js';

/** Both user ids, sorted: the same pair always maps to the same conversation. */
export const dmKey = (a: string, b: string): string => [a, b].sort().join(':');

const PRIVATE = ['dm', 'group'];

/**
 * Private conversations: between two friends (kind 'dm') and group chats (kind 'group', up to
 * GROUP_MAX_MEMBERS people). Both are channels without a guild, so messages, files, voice
 * messages, GIFs and calls work exactly like in a server channel.
 */
export class DmService {
  constructor(
    private readonly db: Database,
    private readonly hub: Hub,
    private readonly friends: FriendService,
    /** Where uploads of messages live (removed when the last person leaves a group). */
    private readonly uploads: { voiceDir: string; fileDir: string },
  ) {}

  /** Opens the conversation with a friend, creating it on first use. */
  async open(userId: string, peerId: string): Promise<DmChannelDto> {
    if (!(await this.friends.areFriends(userId, peerId))) {
      throw forbidden('Private Nachrichten gibt es nur unter Freunden', 'NOT_FRIENDS');
    }
    const key = dmKey(userId, peerId);
    let [channel] = await this.db.select().from(channels).where(eq(channels.dmKey, key)).limit(1);
    let created = false;
    if (!channel) {
      try {
        channel = await this.db.transaction(async (tx) => {
          const [row] = await tx
            .insert(channels)
            .values({ guildId: null, name: 'dm', kind: 'dm', dmKey: key })
            .returning();
          if (!row) throw new Error('insert returned no row');
          await tx.insert(dmMembers).values([
            { channelId: row.id, userId },
            { channelId: row.id, userId: peerId },
          ]);
          return row;
        });
        created = true;
      } catch (err) {
        // Both opened it at the same moment: use the one that won.
        if (!isUniqueViolation(err, 'channels_dm_key_uq')) throw err;
        [channel] = await this.db.select().from(channels).where(eq(channels.dmKey, key)).limit(1);
        if (!channel) throw err;
      }
    }
    if (created) await this.announce(channel);
    return this.toDto(channel, userId);
  }

  /** New group chat with friends of the creator; the creator becomes its owner. */
  async createGroup(
    userId: string,
    name: string | undefined,
    userIds: string[],
  ): Promise<DmChannelDto> {
    const others = userIds.filter((id) => id !== userId);
    if (others.length < 2) {
      throw new AppError('BAD_REQUEST', 400, 'Eine Gruppe braucht mindestens zwei Freunde');
    }
    await this.assertFriendsOf(userId, others);
    const channel = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(channels)
        .values({ guildId: null, name: name ?? '', kind: 'group', ownerId: userId })
        .returning();
      if (!row) throw new Error('insert returned no row');
      await tx
        .insert(dmMembers)
        .values([userId, ...others].map((id) => ({ channelId: row.id, userId: id })));
      return row;
    });
    await this.announce(channel);
    return this.toDto(channel, userId);
  }

  /** Any member may rename a group; an empty name shows the members' names instead. */
  async renameGroup(userId: string, channelId: string, name: string): Promise<DmChannelDto> {
    await this.groupOf(userId, channelId);
    const [row] = await this.db
      .update(channels)
      .set({ name })
      .where(eq(channels.id, channelId))
      .returning();
    if (!row) throw notFound('Gruppe nicht gefunden');
    await this.announce(row);
    return this.toDto(row, userId);
  }

  /** Any member may add one of their friends while there is room. */
  async addMember(userId: string, channelId: string, newId: string): Promise<DmChannelDto> {
    const channel = await this.groupOf(userId, channelId);
    await this.assertFriendsOf(userId, [newId]);
    const [size] = await this.db
      .select({ n: count() })
      .from(dmMembers)
      .where(eq(dmMembers.channelId, channelId));
    if ((size?.n ?? 0) >= GROUP_MAX_MEMBERS) {
      throw new AppError(
        'BAD_REQUEST',
        400,
        `Eine Gruppe hat höchstens ${GROUP_MAX_MEMBERS} Personen`,
      );
    }
    await this.db.insert(dmMembers).values({ channelId, userId: newId }).onConflictDoNothing();
    await this.announce(channel);
    return this.toDto(channel, userId);
  }

  /**
   * Leaving (target = yourself) or removing someone (owner only). The owner role passes on when
   * the owner leaves; the last one out deletes the group with its messages and files.
   */
  async removeMember(userId: string, channelId: string, targetId: string): Promise<void> {
    const channel = await this.groupOf(userId, channelId);
    if (targetId !== userId && channel.ownerId !== userId) {
      throw forbidden('Nur wer die Gruppe erstellt hat, kann andere entfernen');
    }
    const deleted = await this.db
      .delete(dmMembers)
      .where(and(eq(dmMembers.channelId, channelId), eq(dmMembers.userId, targetId)))
      .returning({ userId: dmMembers.userId });
    if (deleted.length === 0) throw notFound('Diese Person ist nicht in der Gruppe');
    this.hub.leaveConversation(targetId, channelId);
    this.hub.publishToUsers([targetId], { type: 'dm.removed', data: { channelId } });

    const rest = await this.memberIds(channelId);
    if (rest.length === 0) {
      await this.deleteGroup(channelId);
      return;
    }
    let current = channel;
    if (channel.ownerId === targetId) {
      const [row] = await this.db
        .update(channels)
        .set({ ownerId: rest[0]! })
        .where(eq(channels.id, channelId))
        .returning();
      if (row) current = row;
    }
    await this.announce(current);
  }

  /** My conversations and groups, newest activity first. */
  async list(userId: string): Promise<DmChannelDto[]> {
    const mine = await this.db
      .select({ channel: channels })
      .from(dmMembers)
      .innerJoin(channels, eq(channels.id, dmMembers.channelId))
      .where(eq(dmMembers.userId, userId));
    if (mine.length === 0) return [];
    const ids = mine.map((m) => m.channel.id);
    const [people, last] = await Promise.all([
      this.people(ids),
      this.db
        .select({
          channelId: messages.channelId,
          at: sql<Date>`max(${messages.createdAt})`.mapWith((v: string) => new Date(v)),
        })
        .from(messages)
        .where(inArray(messages.channelId, ids))
        .groupBy(messages.channelId),
    ]);
    const lastBy = new Map(last.map((l) => [l.channelId, l.at]));
    return mine
      .flatMap(({ channel }) => {
        const members = (people.get(channel.id) ?? []).filter((p) => p.id !== userId);
        // A 'dm' needs its other person; a group can be down to just you.
        if (channel.kind === 'dm' && members.length === 0) return [];
        const at = lastBy.get(channel.id);
        return [this.dto(channel, members, at ? at.toISOString() : null, userId)];
      })
      .sort((a, b) =>
        (b.lastMessageAt ?? b.channel.createdAt).localeCompare(
          a.lastMessageAt ?? a.channel.createdAt,
        ),
      );
  }

  async memberIds(channelId: string): Promise<string[]> {
    const rows = await this.db
      .select({ userId: dmMembers.userId })
      .from(dmMembers)
      .where(eq(dmMembers.channelId, channelId));
    return rows.map((r) => r.userId);
  }

  /** Each member gets the conversation from their own point of view. */
  private async announce(channel: Channel): Promise<void> {
    const people = (await this.people([channel.id])).get(channel.id) ?? [];
    const last = await this.lastAt(channel.id);
    for (const p of people) {
      const dm = this.dto(
        channel,
        people.filter((o) => o.id !== p.id),
        last,
        p.id,
      );
      this.hub.publishToUsers([p.id], { type: 'dm.updated', data: { dm } });
    }
  }

  private async toDto(channel: Channel, viewerId: string): Promise<DmChannelDto> {
    const people = (await this.people([channel.id])).get(channel.id) ?? [];
    return this.dto(
      channel,
      people.filter((p) => p.id !== viewerId),
      await this.lastAt(channel.id),
      viewerId,
    );
  }

  private dto(
    channel: Channel,
    members: PublicUserDto[],
    lastMessageAt: string | null,
    viewerId: string,
  ): DmChannelDto {
    // An empty group (just you) still needs a "peer" for older clients: yourself.
    const peer = members[0] ?? { id: viewerId, username: '', displayName: null, avatarUrl: null };
    return {
      channel: toChannelDto(channel),
      peer,
      members,
      ownerId: channel.kind === 'group' ? channel.ownerId : null,
      online: members.some((m) => this.hub.isOnline(m.id)),
      presence: channel.kind === 'dm' && members[0] ? this.hub.presence(members[0].id) : undefined,
      lastMessageAt,
    };
  }

  private async people(channelIds: string[]): Promise<Map<string, PublicUserDto[]>> {
    const rows = await this.db
      .select({
        channelId: dmMembers.channelId,
        ...profileColumns,
      })
      .from(dmMembers)
      .innerJoin(users, eq(users.id, dmMembers.userId))
      .where(inArray(dmMembers.channelId, channelIds))
      .orderBy(users.username);
    const out = new Map<string, PublicUserDto[]>();
    for (const r of rows) {
      const list = out.get(r.channelId) ?? [];
      list.push(toPublicUser(r));
      out.set(r.channelId, list);
    }
    return out;
  }

  private async lastAt(channelId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ at: sql<Date>`max(${messages.createdAt})`.mapWith((v: string) => new Date(v)) })
      .from(messages)
      .where(eq(messages.channelId, channelId));
    return row?.at && !Number.isNaN(row.at.getTime()) ? row.at.toISOString() : null;
  }

  /** The group, if the user is one of its members (404 / 403 otherwise). */
  private async groupOf(userId: string, channelId: string): Promise<Channel> {
    const [row] = await this.db
      .select({ channel: channels, member: dmMembers.userId })
      .from(channels)
      .leftJoin(dmMembers, and(eq(dmMembers.channelId, channels.id), eq(dmMembers.userId, userId)))
      .where(and(eq(channels.id, channelId), inArray(channels.kind, PRIVATE)))
      .limit(1);
    if (!row || row.channel.kind !== 'group') throw notFound('Gruppe nicht gefunden');
    if (!row.member) throw forbidden('Du bist nicht in dieser Gruppe');
    return row.channel;
  }

  private async assertFriendsOf(userId: string, ids: string[]): Promise<void> {
    const friends = new Set(await this.friends.friendIds(userId));
    if (ids.some((id) => !friends.has(id))) {
      throw forbidden('In Gruppen kannst du nur deine Freunde holen', 'NOT_FRIENDS');
    }
  }

  private async deleteGroup(channelId: string): Promise<void> {
    const files = await this.db
      .select({ audioKey: messages.audioKey, fileKey: messages.fileKey })
      .from(messages)
      .where(
        and(
          eq(messages.channelId, channelId),
          or(isNotNull(messages.audioKey), isNotNull(messages.fileKey)),
        ),
      );
    await this.db.delete(channels).where(eq(channels.id, channelId));
    await Promise.all(
      files.flatMap((f) => [
        ...(f.audioKey ? [rm(join(this.uploads.voiceDir, f.audioKey), { force: true })] : []),
        ...(f.fileKey ? [rm(join(this.uploads.fileDir, f.fileKey), { force: true })] : []),
      ]),
    );
  }
}
