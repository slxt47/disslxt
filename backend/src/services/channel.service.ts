import { and, asc, eq } from 'drizzle-orm';
import type { ChannelDto, ChannelKind, VoicePeerDto, WsServerMessage } from '@disslxt/shared';
import type { Database } from '../db/client.js';
import { channels, dmMembers, type Channel } from '../db/schema.js';
import { AppError, conflict, forbidden, notFound } from '../lib/errors.js';
import { isUniqueViolation } from '../lib/pgErrors.js';
import type { Hub } from '../realtime/hub.js';
import { toChannelDto } from './dto.js';
import type { FriendService } from './friend.service.js';
import type { GuildService } from './guild.service.js';

export class ChannelService {
  constructor(
    private readonly db: Database,
    private readonly hub: Hub,
    private readonly guilds: GuildService,
    private readonly friends: FriendService,
  ) {}

  async list(userId: string, guildId: string): Promise<ChannelDto[]> {
    await this.guilds.assertMember(userId, guildId);
    const rows = await this.db
      .select()
      .from(channels)
      .where(eq(channels.guildId, guildId))
      .orderBy(asc(channels.createdAt), asc(channels.name));
    return rows.map(toChannelDto);
  }

  /** Owner only. `name` must already be normalised by the shared schema. */
  async create(
    userId: string,
    guildId: string,
    name: string,
    kind: ChannelKind = 'text',
  ): Promise<ChannelDto> {
    const guild = await this.guilds.assertMember(userId, guildId);
    if (guild.ownerId !== userId) throw forbidden('Nur der Besitzer kann Kanäle anlegen');
    let row: Channel | undefined;
    try {
      [row] = await this.db.insert(channels).values({ guildId, name, kind }).returning();
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

  /** Who is in the call of a private conversation (access checked by the caller). */
  callPeers(channelId: string): VoicePeerDto[] {
    return this.hub.callPeers(channelId);
  }

  /** Who is in which voice channel of a guild right now (members only). */
  async voiceState(userId: string, guildId: string): Promise<Record<string, VoicePeerDto[]>> {
    await this.guilds.assertMember(userId, guildId);
    return this.hub.voiceStateForGuild(guildId);
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
      await this.guilds.assertMember(userId, channel.guildId);
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

  /** Delivers an event to everyone who reads the channel: its subscribers, or both DM members. */
  async publish(channel: Pick<Channel, 'id' | 'kind'>, msg: WsServerMessage): Promise<void> {
    if (channel.kind === 'dm' || channel.kind === 'group') {
      this.hub.publishToUsers(await this.dmMemberIds(channel.id), msg);
    } else this.hub.publishToChannel(channel.id, msg);
  }
}
