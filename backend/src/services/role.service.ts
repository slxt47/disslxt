import { and, asc, count, eq, inArray, max } from 'drizzle-orm';
import {
  ROLES_PER_GUILD_MAX,
  type GuildBanDto,
  type GuildPermission,
  type GuildRolesDto,
  type RoleDto,
  type RoleInput,
} from '@disslxt/shared';
import type { Database } from '../db/client.js';
import {
  channelRoles,
  channels,
  guildBans,
  guildMemberRoles,
  guildRoles,
  users,
  type Guild,
} from '../db/schema.js';
import { AppError, conflict, forbidden, notFound } from '../lib/errors.js';
import { isUniqueViolation } from '../lib/pgErrors.js';
import type { Hub } from '../realtime/hub.js';
import { profileColumns, toPublicUser } from './dto.js';
import type { GuildService } from './guild.service.js';
import type { PermissionService } from './permission.service.js';

const toRoleDto = (r: typeof guildRoles.$inferSelect): RoleDto => ({
  id: r.id,
  name: r.name,
  color: r.color,
  permissions: r.permissions as GuildPermission[],
  position: r.position,
});

/** Server roles: the owner defines them; who sees which channel hangs on them. */
export class RoleService {
  constructor(
    private readonly db: Database,
    private readonly hub: Hub,
    private readonly guilds: GuildService,
    private readonly perms: PermissionService,
  ) {}

  private async assertOwner(userId: string, guildId: string): Promise<Guild> {
    const guild = await this.guilds.assertMember(userId, guildId);
    if (guild.ownerId !== userId) throw forbidden('Rollen verwaltet nur der Besitzer');
    return guild;
  }

  /** Tells the server to reload and takes away at once what someone can no longer see. */
  private async changed(guild: Pick<Guild, 'id' | 'ownerId'>): Promise<void> {
    this.hub.applyChannelAccess(
      guild.id,
      await this.perms.restrictedAudience(guild.id, guild.ownerId),
    );
    this.hub.publishToGuild(guild.id, {
      type: 'guild.roles-changed',
      data: { guildId: guild.id },
    });
  }

  async list(userId: string, guildId: string): Promise<GuildRolesDto> {
    const guild = await this.guilds.assertMember(userId, guildId);
    const rows = await this.db
      .select()
      .from(guildRoles)
      .where(eq(guildRoles.guildId, guildId))
      .orderBy(asc(guildRoles.position), asc(guildRoles.createdAt));
    return { roles: rows.map(toRoleDto), myPermissions: await this.perms.of(userId, guild) };
  }

  async create(userId: string, guildId: string, input: RoleInput): Promise<RoleDto> {
    const guild = await this.assertOwner(userId, guildId);
    const [stats] = await this.db
      .select({ n: count(), last: max(guildRoles.position) })
      .from(guildRoles)
      .where(eq(guildRoles.guildId, guildId));
    if ((stats?.n ?? 0) >= ROLES_PER_GUILD_MAX) {
      throw new AppError('BAD_REQUEST', 400, `Höchstens ${ROLES_PER_GUILD_MAX} Rollen pro Server`);
    }
    try {
      const [row] = await this.db
        .insert(guildRoles)
        .values({ ...input, guildId, position: (stats?.last ?? -1) + 1 })
        .returning();
      if (!row) throw new Error('insert returned no row');
      await this.changed(guild);
      return toRoleDto(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('CONFLICT', 'Diese Rolle gibt es schon');
      throw err;
    }
  }

  async update(
    userId: string,
    guildId: string,
    roleId: string,
    patch: Partial<RoleInput>,
  ): Promise<RoleDto> {
    const guild = await this.assertOwner(userId, guildId);
    try {
      const [row] = await this.db
        .update(guildRoles)
        .set(patch)
        .where(and(eq(guildRoles.id, roleId), eq(guildRoles.guildId, guildId)))
        .returning();
      if (!row) throw notFound('Rolle nicht gefunden');
      await this.changed(guild);
      return toRoleDto(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('CONFLICT', 'Diese Rolle gibt es schon');
      throw err;
    }
  }

  async delete(userId: string, guildId: string, roleId: string): Promise<void> {
    const guild = await this.assertOwner(userId, guildId);
    const gone = await this.db
      .delete(guildRoles)
      .where(and(eq(guildRoles.id, roleId), eq(guildRoles.guildId, guildId)))
      .returning({ id: guildRoles.id });
    if (gone.length === 0) throw notFound('Rolle nicht gefunden');
    await this.changed(guild);
  }

  /** New order, highest first; must name every role of the server. */
  async reorder(userId: string, guildId: string, roleIds: string[]): Promise<void> {
    const guild = await this.assertOwner(userId, guildId);
    const rows = await this.db
      .select({ id: guildRoles.id })
      .from(guildRoles)
      .where(eq(guildRoles.guildId, guildId));
    const known = new Set(rows.map((r) => r.id));
    if (roleIds.length !== known.size || roleIds.some((id) => !known.has(id))) {
      throw new AppError('BAD_REQUEST', 400, 'Die Liste muss alle Rollen enthalten');
    }
    await this.db.transaction(async (tx) => {
      for (const [position, id] of roleIds.entries()) {
        await tx.update(guildRoles).set({ position }).where(eq(guildRoles.id, id));
      }
    });
    await this.changed(guild);
  }

  private async assertRoles(guildId: string, roleIds: string[]): Promise<void> {
    if (roleIds.length === 0) return;
    const rows = await this.db
      .select({ id: guildRoles.id })
      .from(guildRoles)
      .where(and(eq(guildRoles.guildId, guildId), inArray(guildRoles.id, roleIds)));
    if (rows.length !== roleIds.length) throw notFound('Rolle nicht gefunden');
  }

  async setMemberRoles(
    userId: string,
    guildId: string,
    memberId: string,
    roleIds: string[],
  ): Promise<void> {
    const guild = await this.assertOwner(userId, guildId);
    if (!(await this.guilds.isMember(memberId, guildId))) {
      throw notFound('Mitglied nicht gefunden');
    }
    await this.assertRoles(guildId, roleIds);
    await this.db.transaction(async (tx) => {
      await tx
        .delete(guildMemberRoles)
        .where(and(eq(guildMemberRoles.guildId, guildId), eq(guildMemberRoles.userId, memberId)));
      if (roleIds.length > 0) {
        await tx
          .insert(guildMemberRoles)
          .values(roleIds.map((roleId) => ({ guildId, userId: memberId, roleId })));
      }
    });
    await this.changed(guild);
  }

  /** Who may see a channel; needs manage_channels. */
  async channelAccess(userId: string, channelId: string): Promise<{ roleIds: string[] }> {
    await this.managedChannel(userId, channelId);
    const rows = await this.db
      .select({ roleId: channelRoles.roleId })
      .from(channelRoles)
      .where(eq(channelRoles.channelId, channelId));
    return { roleIds: rows.map((r) => r.roleId) };
  }

  async setChannelAccess(
    userId: string,
    channelId: string,
    restricted: boolean,
    roleIds: string[],
  ): Promise<void> {
    const { guild } = await this.managedChannel(userId, channelId);
    await this.assertRoles(guild.id, roleIds);
    await this.db.transaction(async (tx) => {
      await tx.update(channels).set({ restricted }).where(eq(channels.id, channelId));
      await tx.delete(channelRoles).where(eq(channelRoles.channelId, channelId));
      if (restricted && roleIds.length > 0) {
        await tx.insert(channelRoles).values(roleIds.map((roleId) => ({ channelId, roleId })));
      }
    });
    await this.changed(guild);
  }

  /** The channel must be one you can see; hidden ones stay 404 even with the permission. */
  private async managedChannel(userId: string, channelId: string): Promise<{ guild: Guild }> {
    const [channel] = await this.db
      .select()
      .from(channels)
      .where(eq(channels.id, channelId))
      .limit(1);
    if (!channel?.guildId) throw notFound('Kanal nicht gefunden');
    const guild = await this.guilds.assertMember(userId, channel.guildId);
    if (!(await this.perms.canSeeChannel(userId, channel, guild))) {
      throw notFound('Kanal nicht gefunden');
    }
    await this.perms.assert(userId, guild, 'manage_channels', 'Dafür fehlt dir das Recht');
    return { guild };
  }

  async bans(userId: string, guildId: string): Promise<GuildBanDto[]> {
    const guild = await this.guilds.assertMember(userId, guildId);
    await this.perms.assert(userId, guild, 'ban_members', 'Dafür fehlt dir das Recht');
    const rows = await this.db
      .select({ user: profileColumns, createdAt: guildBans.createdAt })
      .from(guildBans)
      .innerJoin(users, eq(users.id, guildBans.userId))
      .where(eq(guildBans.guildId, guildId))
      .orderBy(asc(guildBans.createdAt));
    return rows.map((r) => ({
      user: toPublicUser(r.user),
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
