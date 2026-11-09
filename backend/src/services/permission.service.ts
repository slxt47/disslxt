import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { GUILD_PERMISSIONS, type GuildPermission } from '@disslxt/shared';
import type { Database } from '../db/client.js';
import { channels, guildBans, guildMemberRoles, guildRoles } from '../db/schema.js';
import { forbidden } from '../lib/errors.js';

/**
 * The one definition of "may this user see this channel", for SQL over several rows. `channelId`
 * and `userId` are column references or parameters of the surrounding query.
 */
export function channelVisibleSql(channelId: SQL, userId: SQL): SQL<boolean> {
  return sql<boolean>`(
    not exists (select 1 from channels vc where vc.id = ${channelId} and vc.restricted)
    or exists (
      select 1 from channels vc join guilds vg on vg.id = vc.guild_id
      where vc.id = ${channelId} and vg.owner_id = ${userId}
    )
    or exists (
      select 1 from channel_roles vcr
      join guild_member_roles vmr on vmr.role_id = vcr.role_id
      where vcr.channel_id = ${channelId} and vmr.user_id = ${userId}
    )
  )`;
}

/** Answers what someone may do on a server. Membership is checked by the caller. */
export class PermissionService {
  constructor(private readonly db: Database) {}

  async of(userId: string, guild: { id: string; ownerId: string }): Promise<GuildPermission[]> {
    if (guild.ownerId === userId) return [...GUILD_PERMISSIONS];
    const rows = await this.db
      .select({ permissions: guildRoles.permissions })
      .from(guildMemberRoles)
      .innerJoin(guildRoles, eq(guildRoles.id, guildMemberRoles.roleId))
      .where(and(eq(guildMemberRoles.guildId, guild.id), eq(guildMemberRoles.userId, userId)));
    const granted = new Set(rows.flatMap((r) => r.permissions));
    return GUILD_PERMISSIONS.filter((p) => granted.has(p));
  }

  async has(
    userId: string,
    guild: { id: string; ownerId: string },
    permission: GuildPermission,
  ): Promise<boolean> {
    return (await this.of(userId, guild)).includes(permission);
  }

  async assert(
    userId: string,
    guild: { id: string; ownerId: string },
    permission: GuildPermission,
    message: string,
  ): Promise<void> {
    if (!(await this.has(userId, guild, permission))) throw forbidden(message);
  }

  /** Highest role of someone: lower outranks higher, the owner beats every role. */
  private async rank(userId: string, guild: { id: string; ownerId: string }): Promise<number> {
    if (guild.ownerId === userId) return -1;
    const [row] = await this.db
      .select({ top: sql<number | null>`min(${guildRoles.position})` })
      .from(guildMemberRoles)
      .innerJoin(guildRoles, eq(guildRoles.id, guildMemberRoles.roleId))
      .where(and(eq(guildMemberRoles.guildId, guild.id), eq(guildMemberRoles.userId, userId)));
    return row?.top ?? Number.MAX_SAFE_INTEGER;
  }

  /** Moderating someone needs a higher rank: nobody touches the owner or their equals. */
  async assertOutranks(
    userId: string,
    targetId: string,
    guild: { id: string; ownerId: string },
  ): Promise<void> {
    const [mine, theirs] = await Promise.all([
      this.rank(userId, guild),
      this.rank(targetId, guild),
    ]);
    if (mine >= theirs) throw forbidden('Das geht nur bei Mitgliedern unter deiner Rolle');
  }

  async canSeeChannel(
    userId: string,
    channel: { id: string; restricted: boolean; guildId: string | null },
    guild: { ownerId: string },
  ): Promise<boolean> {
    if (!channel.restricted || guild.ownerId === userId) return true;
    const rows = await this.db.execute(
      sql`select 1 from channel_roles cr
          join guild_member_roles mr on mr.role_id = cr.role_id
          where cr.channel_id = ${channel.id} and mr.user_id = ${userId} limit 1`,
    );
    return rows.rows.length > 0;
  }

  /** Everyone who sees the restricted channels of a server, per channel. */
  async restrictedAudience(guildId: string, ownerId: string): Promise<Map<string, Set<string>>> {
    const restricted = await this.db
      .select({ id: channels.id })
      .from(channels)
      .where(and(eq(channels.guildId, guildId), eq(channels.restricted, true)));
    const out = new Map(restricted.map((c) => [c.id, new Set([ownerId])]));
    if (restricted.length === 0) return out;
    const rows = await this.db.execute<{ channel_id: string; user_id: string }>(
      sql`select cr.channel_id, mr.user_id from channel_roles cr
          join guild_member_roles mr on mr.role_id = cr.role_id
          join channels c on c.id = cr.channel_id
          where c.guild_id = ${guildId} and c.restricted`,
    );
    for (const row of rows.rows) out.get(row.channel_id)?.add(row.user_id);
    return out;
  }

  async isBanned(userId: string, guildId: string): Promise<boolean> {
    const rows = await this.db
      .select({ userId: guildBans.userId })
      .from(guildBans)
      .where(and(eq(guildBans.guildId, guildId), eq(guildBans.userId, userId)))
      .limit(1);
    return rows.length > 0;
  }

  /** Role ids of a set of members. */
  async memberRoleIds(guildId: string, userIds: string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (userIds.length === 0) return out;
    const rows = await this.db
      .select({ userId: guildMemberRoles.userId, roleId: guildMemberRoles.roleId })
      .from(guildMemberRoles)
      .where(and(eq(guildMemberRoles.guildId, guildId), inArray(guildMemberRoles.userId, userIds)));
    for (const row of rows) out.set(row.userId, [...(out.get(row.userId) ?? []), row.roleId]);
    return out;
  }
}
