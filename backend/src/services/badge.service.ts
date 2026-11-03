import { and, asc, eq, or, sql } from 'drizzle-orm';
import { BADGES_SHOWN_MAX, type BadgeDto, type MyBadgesDto, type UserRole } from '@disslxt/shared';
import type { Database } from '../db/client.js';
import { badges, userBadges, users } from '../db/schema.js';
import { AppError, notFound } from '../lib/errors.js';
import { toRole } from './dto.js';

/** Badge catalogue, which badges a person may wear, and which of them they show. */
export class BadgeService {
  constructor(private readonly db: Database) {}

  /** All badges that exist (for rendering badge ids). */
  async catalogue(): Promise<BadgeDto[]> {
    const rows = await this.db.select().from(badges).orderBy(asc(badges.sort), asc(badges.id));
    return rows.map(toBadgeDto);
  }

  /** The badges this person may wear, judged by their *current* role. */
  async available(userId: string, role: UserRole): Promise<BadgeDto[]> {
    const rows = await this.db
      .select({ badge: badges })
      .from(badges)
      .leftJoin(userBadges, and(eq(userBadges.badgeId, badges.id), eq(userBadges.userId, userId)))
      .where(
        or(
          eq(badges.requirement, 'all'),
          and(eq(badges.requirement, 'admin'), sql`${role} in ('admin', 'owner')`),
          and(eq(badges.requirement, 'owner'), sql`${role} = 'owner'`),
          and(eq(badges.requirement, 'manual'), sql`${userBadges.userId} is not null`),
        ),
      )
      .orderBy(asc(badges.sort), asc(badges.id));
    return rows.map((r) => toBadgeDto(r.badge));
  }

  async mine(userId: string): Promise<MyBadgesDto> {
    const user = await this.user(userId);
    const available = await this.available(userId, toRole(user.role));
    return { available, shown: user.shownBadges };
  }

  /** Replaces the shown badges. Every id must be available to the user, none twice. */
  async setShown(userId: string, ids: string[]): Promise<string[]> {
    const user = await this.user(userId);
    const available = new Set((await this.available(userId, toRole(user.role))).map((b) => b.id));
    if (new Set(ids).size !== ids.length) {
      throw new AppError('BAD_REQUEST', 400, 'Jedes Abzeichen kann nur einmal gewählt werden');
    }
    if (ids.length > BADGES_SHOWN_MAX) {
      throw new AppError('BAD_REQUEST', 400, `Höchstens ${BADGES_SHOWN_MAX} Abzeichen anzeigen`);
    }
    if (ids.some((id) => !available.has(id))) {
      throw new AppError('FORBIDDEN', 403, 'Dieses Abzeichen steht dir nicht zur Verfügung');
    }
    await this.db.update(users).set({ shownBadges: ids }).where(eq(users.id, userId));
    return ids;
  }

  /** After a role changed: stop showing badges the person no longer qualifies for. */
  async prune(userId: string): Promise<void> {
    const user = await this.user(userId);
    const available = new Set((await this.available(userId, toRole(user.role))).map((b) => b.id));
    const kept = user.shownBadges.filter((id) => available.has(id));
    if (kept.length !== user.shownBadges.length) {
      await this.db.update(users).set({ shownBadges: kept }).where(eq(users.id, userId));
    }
  }

  private async user(userId: string) {
    const [row] = await this.db
      .select({ role: users.role, shownBadges: users.shownBadges })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) throw notFound('Benutzer nicht gefunden');
    return row;
  }
}

const toBadgeDto = (b: typeof badges.$inferSelect): BadgeDto => ({
  id: b.id,
  label: b.label,
  emoji: b.emoji,
  description: b.description,
  requirement:
    b.requirement === 'all' || b.requirement === 'admin' || b.requirement === 'owner'
      ? b.requirement
      : 'manual',
});
