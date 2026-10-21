import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import type { Mailer } from '../lib/mailer.js';
import type { Hub } from '../realtime/hub.js';
import { AuthService } from './auth.service.js';
import { ChannelService } from './channel.service.js';
import { GuildService } from './guild.service.js';
import { MessageService } from './message.service.js';
import { IceService } from './ice.service.js';
import { PushService } from './push.service.js';
import type { PushSender } from '../lib/push.js';

export interface Services {
  auth: AuthService;
  guilds: GuildService;
  channels: ChannelService;
  messages: MessageService;
  push: PushService;
  ice: IceService;
}

export function createServices(
  db: Database,
  hub: Hub,
  config: Config,
  mailer: Mailer,
  log: FastifyBaseLogger,
  pushSender: PushSender | null,
): Services {
  const auth = new AuthService(db, config, mailer, log);
  const push = new PushService(db, hub, config, pushSender, log);
  const guilds = new GuildService(db, hub, push);
  const channels = new ChannelService(db, hub, guilds);
  const messages = new MessageService(db, hub, guilds, channels, push, config.voice.dir);
  const ice = new IceService(config, log);
  return { auth, guilds, channels, messages, push, ice };
}
