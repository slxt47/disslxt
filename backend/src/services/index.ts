import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import type { Mailer } from '../lib/mailer.js';
import type { Hub } from '../realtime/hub.js';
import { ImageStore } from '../lib/images.js';
import { AuthService } from './auth.service.js';
import { ChannelService } from './channel.service.js';
import { DmService } from './dm.service.js';
import { FriendService } from './friend.service.js';
import { GuildService } from './guild.service.js';
import { MessageService } from './message.service.js';
import { IceService } from './ice.service.js';
import { PushService } from './push.service.js';
import { TurnUsageService } from './turnUsage.service.js';
import { UserService } from './user.service.js';
import { GifService } from './gif.service.js';
import type { PushSender } from '../lib/push.js';

export interface Services {
  auth: AuthService;
  guilds: GuildService;
  channels: ChannelService;
  messages: MessageService;
  push: PushService;
  ice: IceService;
  turnUsage: TurnUsageService;
  friends: FriendService;
  dms: DmService;
  users: UserService;
  gifs: GifService;
}

export function createServices(
  db: Database,
  hub: Hub,
  config: Config,
  mailer: Mailer,
  log: FastifyBaseLogger,
  pushSender: PushSender | null,
  opts: { fetchFn?: typeof fetch } = {},
): Services {
  const auth = new AuthService(db, config, mailer, log);
  const push = new PushService(db, hub, config, pushSender, log);
  const images = new ImageStore(config.avatars.dir);
  const guilds = new GuildService(
    db,
    hub,
    push,
    { voiceDir: config.voice.dir, fileDir: config.files.dir },
    images,
  );
  const friends = new FriendService(db, hub);
  const dms = new DmService(db, hub, friends, {
    voiceDir: config.voice.dir,
    fileDir: config.files.dir,
  });
  const gifs = new GifService(config.giphyApiKey, opts.fetchFn ?? fetch);
  const users = new UserService(db, hub, guilds, friends, images);
  const channels = new ChannelService(db, hub, guilds, friends);
  const messages = new MessageService(db, hub, channels, push, config.voice.dir, config.files.dir);
  const turnUsage = new TurnUsageService(db, config.ice.monthlyLimitBytes);
  const ice = new IceService(config, log, fetch, async () => (await turnUsage.status()).exhausted);
  return { auth, guilds, channels, messages, push, ice, turnUsage, friends, dms, users, gifs };
}
