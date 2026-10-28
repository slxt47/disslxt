import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { DmChannelDto, PublicUserDto } from '@disslxt/shared';
import type { Database } from '../db/client.js';
import { channels, dmMembers, messages, users, type Channel } from '../db/schema.js';
import { forbidden } from '../lib/errors.js';
import { isUniqueViolation } from '../lib/pgErrors.js';
import type { Hub } from '../realtime/hub.js';
import { toChannelDto, toPublicUser } from './dto.js';
import type { FriendService } from './friend.service.js';

/** Both user ids, sorted: the same pair always maps to the same conversation. */
export const dmKey = (a: string, b: string): string => [a, b].sort().join(':');

/**
 * Private conversations between two friends. They are channels of kind 'dm' without a guild, so
 * messages, files, voice messages and calls work exactly like in a server channel.
 */
export class DmService {
  constructor(
    private readonly db: Database,
    private readonly hub: Hub,
    private readonly friends: FriendService,
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
    const [mine, theirs] = await Promise.all([
      this.toDto(channel, userId),
      this.toDto(channel, peerId),
    ]);
    if (created) {
      this.hub.publishToUsers([userId], { type: 'dm.updated', data: { dm: mine } });
      this.hub.publishToUsers([peerId], { type: 'dm.updated', data: { dm: theirs } });
    }
    return mine;
  }

  /** My conversations, newest activity first. */
  async list(userId: string): Promise<DmChannelDto[]> {
    const mine = await this.db
      .select({ channel: channels })
      .from(dmMembers)
      .innerJoin(channels, eq(channels.id, dmMembers.channelId))
      .where(eq(dmMembers.userId, userId));
    if (mine.length === 0) return [];
    const ids = mine.map((m) => m.channel.id);
    const [peers, last] = await Promise.all([
      this.db
        .select({
          channelId: dmMembers.channelId,
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          avatarKey: users.avatarKey,
        })
        .from(dmMembers)
        .innerJoin(users, eq(users.id, dmMembers.userId))
        .where(and(inArray(dmMembers.channelId, ids), ne(dmMembers.userId, userId))),
      this.db
        .select({
          channelId: messages.channelId,
          at: sql<Date>`max(${messages.createdAt})`.mapWith((v: string) => new Date(v)),
        })
        .from(messages)
        .where(inArray(messages.channelId, ids))
        .groupBy(messages.channelId),
    ]);
    const peerBy = new Map(peers.map((p) => [p.channelId, toPublicUser(p)]));
    const lastBy = new Map(last.map((l) => [l.channelId, l.at]));
    return mine
      .flatMap(({ channel }) => {
        const peer = peerBy.get(channel.id);
        if (!peer) return [];
        const at = lastBy.get(channel.id);
        return [this.dto(channel, peer, at ? at.toISOString() : null)];
      })
      .sort((a, b) =>
        (b.lastMessageAt ?? b.channel.createdAt).localeCompare(
          a.lastMessageAt ?? a.channel.createdAt,
        ),
      );
  }

  private async toDto(channel: Channel, viewerId: string): Promise<DmChannelDto> {
    const [peer] = await this.db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        avatarKey: users.avatarKey,
      })
      .from(dmMembers)
      .innerJoin(users, eq(users.id, dmMembers.userId))
      .where(and(eq(dmMembers.channelId, channel.id), ne(dmMembers.userId, viewerId)))
      .limit(1);
    const [last] = await this.db
      .select({ at: messages.createdAt })
      .from(messages)
      .where(eq(messages.channelId, channel.id))
      .orderBy(desc(messages.id))
      .limit(1);
    if (!peer) throw forbidden();
    return this.dto(channel, toPublicUser(peer), last ? last.at.toISOString() : null);
  }

  private dto(channel: Channel, peer: PublicUserDto, lastMessageAt: string | null): DmChannelDto {
    return {
      channel: toChannelDto(channel),
      peer,
      online: this.hub.isOnline(peer.id),
      lastMessageAt,
    };
  }
}
