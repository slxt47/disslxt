import { and, count, eq, inArray, or, sql } from 'drizzle-orm';
import {
  FRIEND_REQUESTS_MAX_PENDING,
  type FriendDto,
  type FriendStatus,
  type PublicUserDto,
} from '@disslxt/shared';
import type { Database } from '../db/client.js';
import { friendships, users } from '../db/schema.js';
import { AppError, conflict, notFound } from '../lib/errors.js';
import type { Hub } from '../realtime/hub.js';
import { profileColumns, toPublicUser } from './dto.js';

type Row = typeof friendships.$inferSelect;

/**
 * Friends: requests by username, accepting, removing. Only friends can open a private
 * conversation, write in it and call each other; presence is shared between friends.
 */
export class FriendService {
  constructor(
    private readonly db: Database,
    private readonly hub: Hub,
  ) {}

  async areFriends(a: string, b: string): Promise<boolean> {
    const row = await this.between(a, b);
    return row?.status === 'accepted';
  }

  async friendIds(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ requesterId: friendships.requesterId, addresseeId: friendships.addresseeId })
      .from(friendships)
      .where(
        and(
          eq(friendships.status, 'accepted'),
          or(eq(friendships.requesterId, userId), eq(friendships.addresseeId, userId)),
        ),
      );
    return rows.map((r) => (r.requesterId === userId ? r.addresseeId : r.requesterId));
  }

  /** Friends first (by name), then open requests. */
  async list(userId: string): Promise<FriendDto[]> {
    const rows = await this.db
      .select()
      .from(friendships)
      .where(or(eq(friendships.requesterId, userId), eq(friendships.addresseeId, userId)));
    const otherIds = rows.map((r) => (r.requesterId === userId ? r.addresseeId : r.requesterId));
    const profiles = await this.profiles(otherIds);
    const order: Record<FriendStatus, number> = { incoming: 0, friend: 1, outgoing: 2 };
    return rows
      .map((r) => this.toDto(r, userId, profiles))
      .filter((f): f is FriendDto => f !== null)
      .sort(
        (a, b) =>
          order[a.status] - order[b.status] ||
          (a.user.displayName ?? a.user.username).localeCompare(
            b.user.displayName ?? b.user.username,
          ),
      );
  }

  /**
   * Sends a request to the user with this username. A request the other person already sent me
   * is accepted instead; sending the same request again changes nothing.
   */
  async request(userId: string, username: string): Promise<FriendDto> {
    const [target] = await this.db
      .select()
      .from(users)
      .where(eq(sql`lower(${users.username})`, username.toLowerCase()))
      .limit(1);
    if (!target) throw notFound('Niemanden mit diesem Benutzernamen gefunden');
    if (target.id === userId) {
      throw new AppError('BAD_REQUEST', 400, 'Du kannst dir nicht selbst eine Anfrage schicken');
    }
    const existing = await this.between(userId, target.id);
    if (existing?.status === 'accepted') throw conflict('CONFLICT', 'Ihr seid schon befreundet');
    if (existing && existing.requesterId === target.id) return this.accept(userId, target.id);
    if (!existing) {
      const [open] = await this.db
        .select({ n: count() })
        .from(friendships)
        .where(and(eq(friendships.requesterId, userId), eq(friendships.status, 'pending')));
      if ((open?.n ?? 0) >= FRIEND_REQUESTS_MAX_PENDING) {
        throw new AppError(
          'RATE_LIMITED',
          429,
          'Zu viele offene Anfragen. Warte, bis einige angenommen wurden.',
        );
      }
      await this.db
        .insert(friendships)
        .values({ requesterId: userId, addresseeId: target.id })
        .onConflictDoNothing();
    }
    return this.publish(userId, target.id);
  }

  /** Accepts a request the other user sent me. */
  async accept(userId: string, otherId: string): Promise<FriendDto> {
    const updated = await this.db
      .update(friendships)
      .set({ status: 'accepted', acceptedAt: new Date() })
      .where(
        and(
          eq(friendships.requesterId, otherId),
          eq(friendships.addresseeId, userId),
          eq(friendships.status, 'pending'),
        ),
      )
      .returning({ requesterId: friendships.requesterId });
    if (updated.length === 0) {
      if (await this.areFriends(userId, otherId)) return this.publish(userId, otherId);
      throw notFound('Keine offene Anfrage von dieser Person');
    }
    this.hub.setFriends(userId, otherId, true);
    return this.publish(userId, otherId);
  }

  /** Ends a friendship, declines an incoming or withdraws an outgoing request. */
  async remove(userId: string, otherId: string): Promise<void> {
    const deleted = await this.db
      .delete(friendships)
      .where(
        or(
          and(eq(friendships.requesterId, userId), eq(friendships.addresseeId, otherId)),
          and(eq(friendships.requesterId, otherId), eq(friendships.addresseeId, userId)),
        ),
      )
      .returning({ status: friendships.status });
    if (deleted.length === 0) throw notFound('Keine Freundschaft oder Anfrage gefunden');
    if (deleted[0]?.status === 'accepted') this.hub.setFriends(userId, otherId, false);
    this.hub.publishToUsers([userId], { type: 'friend.removed', data: { userId: otherId } });
    this.hub.publishToUsers([otherId], { type: 'friend.removed', data: { userId } });
  }

  /** Tells both sides about the current state of their relation; returns my view of it. */
  private async publish(userId: string, otherId: string): Promise<FriendDto> {
    const row = await this.between(userId, otherId);
    const profiles = await this.profiles([userId, otherId]);
    const mine = row && this.toDto(row, userId, profiles);
    const theirs = row && this.toDto(row, otherId, profiles);
    if (!mine || !theirs) throw notFound('Nicht gefunden');
    this.hub.publishToUsers([userId], { type: 'friend.updated', data: { friend: mine } });
    this.hub.publishToUsers([otherId], { type: 'friend.updated', data: { friend: theirs } });
    return mine;
  }

  private async between(a: string, b: string): Promise<Row | undefined> {
    const [row] = await this.db
      .select()
      .from(friendships)
      .where(
        or(
          and(eq(friendships.requesterId, a), eq(friendships.addresseeId, b)),
          and(eq(friendships.requesterId, b), eq(friendships.addresseeId, a)),
        ),
      )
      .limit(1);
    return row;
  }

  private async profiles(ids: string[]): Promise<Map<string, PublicUserDto>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db.select(profileColumns).from(users).where(inArray(users.id, ids));
    return new Map(rows.map((r) => [r.id, toPublicUser(r)]));
  }

  private toDto(
    row: Row,
    viewerId: string,
    profiles: Map<string, PublicUserDto>,
  ): FriendDto | null {
    const otherId = row.requesterId === viewerId ? row.addresseeId : row.requesterId;
    const user = profiles.get(otherId);
    if (!user) return null;
    const status: FriendStatus =
      row.status === 'accepted' ? 'friend' : row.requesterId === viewerId ? 'outgoing' : 'incoming';
    return {
      user,
      status,
      online: status === 'friend' && this.hub.isOnline(otherId),
      presence: status === 'friend' ? this.hub.presence(otherId) : 'offline',
      since: (row.acceptedAt ?? row.createdAt).toISOString(),
    };
  }
}
