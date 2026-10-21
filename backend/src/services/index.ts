import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import type { Mailer } from '../lib/mailer.js';
import type { Hub } from '../realtime/hub.js';
import { AuthService } from './auth.service.js';
import { ChannelService } from './channel.service.js';
import { GuildService } from './guild.service.js';
import { MessageService } from './message.service.js';

export interface Services {
  auth: AuthService;
  guilds: GuildService;
  channels: ChannelService;
  messages: MessageService;
}

export function createServices(
  db: Database,
  hub: Hub,
  config: Config,
  mailer: Mailer,
  log: FastifyBaseLogger,
): Services {
  const auth = new AuthService(db, config, mailer, log);
  const guilds = new GuildService(db, hub);
  const channels = new ChannelService(db, hub, guilds);
  const messages = new MessageService(db, hub, guilds, channels);
  return { auth, guilds, channels, messages };
}
