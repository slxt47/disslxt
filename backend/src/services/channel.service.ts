import { asc, eq } from 'drizzle-orm';
import type { ChannelDto } from '@disslxt/shared';
import type { Database } from '../db/client.js';
import { channels, type Channel } from '../db/schema.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { isUniqueViolation } from '../lib/pgErrors.js';
import type { Hub } from '../realtime/hub.js';
import { toChannelDto } from './dto.js';
import type { GuildService } from './guild.service.js';

export class ChannelService {
  constructor(
    private readonly db: Database,
    private readonly hub: Hub,
    private readonly guilds: GuildService,
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
  async create(userId: string, guildId: string, name: string): Promise<ChannelDto> {
    const guild = await this.guilds.assertMember(userId, guildId);
    if (guild.ownerId !== userId) throw forbidden('Nur der Besitzer kann Kanäle anlegen');
    let row: Channel | undefined;
    try {
      [row] = await this.db.insert(channels).values({ guildId, name }).returning();
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

  /** Loads a channel and checks the user is a member of its guild (404 / 403). */
  async assertAccess(userId: string, channelId: string): Promise<Channel> {
    const [channel] = await this.db
      .select()
      .from(channels)
      .where(eq(channels.id, channelId))
      .limit(1);
    if (!channel) throw notFound('Kanal nicht gefunden');
    await this.guilds.assertMember(userId, channel.guildId);
    return channel;
  }
}
