import { asc, eq } from 'drizzle-orm';
import { WS_CLOSE, type AdminUserDto, type UserRole } from '@disslxt/shared';
import type { Database } from '../db/client.js';
import { sessions, users } from '../db/schema.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import type { Hub } from '../realtime/hub.js';
import { avatarUrl, toRole } from './dto.js';
import type { BadgeService } from './badge.service.js';
import type { UserService } from './user.service.js';

/** The permission rules in one place: who may kick whom, and who may change roles. */
export function canKick(actor: UserRole, target: UserRole): boolean {
  if (target === 'owner') return false;
  if (actor === 'owner') return true;
  return actor === 'admin' && target === 'user';
}

/**
 * Moderation. Every rule is checked here on the server against the roles stored in the database
 * (never against anything the client sends). The owner can neither be kicked nor demoted: no
 * code path sets or removes the 'owner' role, and the database allows only one.
 */
export class AdminService {
  constructor(
    private readonly db: Database,
    private readonly hub: Hub,
    private readonly users: UserService,
    private readonly badges: BadgeService,
  ) {}

  /** Admins and the owner. */
  assertModerator(role: UserRole): void {
    if (role !== 'owner' && role !== 'admin') throw forbidden('Nur für Admins');
  }

  async listUsers(actorRole: UserRole): Promise<AdminUserDto[]> {
    this.assertModerator(actorRole);
    const rows = await this.db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        avatarKey: users.avatarKey,
        role: users.role,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(asc(users.username));
    return rows.map((r) => ({
      id: r.id,
      username: r.username,
      displayName: r.displayName,
      avatarUrl: avatarUrl(r.id, r.avatarKey),
      role: toRole(r.role),
      online: this.hub.isOnline(r.id),
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /**
   * Throws a user out: all sessions are deleted (so the next request is answered 401) and every
   * open socket is closed. The target row is locked while the roles are checked, so a role change
   * running at the same time cannot slip a protected target through.
   */
  async kick(actorId: string, targetId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const actor = await this.lockedRole(tx, actorId);
      this.assertModerator(actor);
      if (actorId === targetId) {
        throw new AppError('BAD_REQUEST', 400, 'Du kannst dich nicht selbst rauswerfen');
      }
      const target = await this.lockedRole(tx, targetId);
      if (target === 'owner') {
        throw forbidden('Der Owner kann nicht rausgeworfen werden', 'OWNER_PROTECTED');
      }
      if (!canKick(actor, target)) throw forbidden('Admins können nur normale User rauswerfen');
      await tx.delete(sessions).where(eq(sessions.userId, targetId));
    });
    for (const c of this.hub.allClients()) {
      if (c.userId === targetId) c.socket.close(WS_CLOSE.UNAUTHORIZED, 'kicked');
    }
  }

  /** Owner only: 'admin' promotes, 'user' takes the role away. The owner's own role is fixed. */
  async setRole(actorId: string, targetId: string, role: 'admin' | 'user'): Promise<void> {
    await this.db.transaction(async (tx) => {
      const actor = await this.lockedRole(tx, actorId);
      if (actor !== 'owner') throw forbidden('Nur der Owner kann Rollen vergeben');
      const target = await this.lockedRole(tx, targetId);
      if (target === 'owner') {
        throw forbidden('Die Rolle des Owners kann nicht geändert werden', 'OWNER_PROTECTED');
      }
      await tx.update(users).set({ role }).where(eq(users.id, targetId));
    });
    await this.badges.prune(targetId);
    await this.users.republish([targetId]);
  }

  private async lockedRole(tx: Pick<Database, 'select'>, userId: string): Promise<UserRole> {
    const [row] = await tx
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .for('update');
    if (!row) throw notFound('Benutzer nicht gefunden');
    return toRole(row.role);
  }
}
