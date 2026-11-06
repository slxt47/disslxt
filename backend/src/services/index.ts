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
import { LinkPreviewService, type Fetcher } from './linkPreview.service.js';
import { TranscriptionService } from './transcription.service.js';
import { whisperTranscriber, type Transcriber } from '../lib/whisper.js';
import { PermissionService } from './permission.service.js';
import { RoleService } from './role.service.js';
import { ScheduleService } from './schedule.service.js';
import { parseStatusTargets, StatusService } from './status.service.js';
import { WebhookService } from './webhook.service.js';
import { SecurityService } from './security.service.js';
import { IceService } from './ice.service.js';
import { PushService } from './push.service.js';
import { TurnUsageService } from './turnUsage.service.js';
import { UserService } from './user.service.js';
import { GifService } from './gif.service.js';
import { StorageService } from './storage.service.js';
import { BadgeService } from './badge.service.js';
import { AdminService } from './admin.service.js';
import { AccountService } from './account.service.js';
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
  storage: StorageService;
  accounts: AccountService;
  badges: BadgeService;
  admin: AdminService;
  roles: RoleService;
  security: SecurityService;
  schedule: ScheduleService;
  webhooks: WebhookService;
  status: StatusService;
  linkPreviews: LinkPreviewService;
  transcripts: TranscriptionService;
}

export function createServices(
  db: Database,
  hub: Hub,
  config: Config,
  mailer: Mailer,
  log: FastifyBaseLogger,
  pushSender: PushSender | null,
  opts: { fetchFn?: typeof fetch; linkFetcher?: Fetcher; transcriber?: Transcriber } = {},
): Services {
  const auth = new AuthService(db, config, mailer, log);
  const security = new SecurityService(db, hub, auth, config);
  const push = new PushService(db, hub, config, pushSender, log);
  const storage = new StorageService(db, config.storage.root, config.storage.limitBytes);
  const images = new ImageStore(config.avatars.dir, storage);
  const perms = new PermissionService(db);
  const guilds = new GuildService(
    db,
    hub,
    push,
    { voiceDir: config.voice.dir, fileDir: config.files.dir },
    images,
    perms,
  );
  const friends = new FriendService(db, hub);
  const dms = new DmService(db, hub, friends, {
    voiceDir: config.voice.dir,
    fileDir: config.files.dir,
  });
  const gifs = new GifService(config.giphyApiKey, opts.fetchFn ?? fetch);
  const badges = new BadgeService(db);
  const users = new UserService(db, hub, guilds, friends, images, badges);
  const admin = new AdminService(db, hub, users, badges);
  const channels = new ChannelService(
    db,
    hub,
    guilds,
    friends,
    perms,
    { voiceDir: config.voice.dir, fileDir: config.files.dir },
    storage,
  );
  const roles = new RoleService(db, hub, guilds, perms);
  guilds.profilesChanged = (ids) => users.republish(ids);
  const linkPreviews = new LinkPreviewService(
    db,
    new ImageStore(config.linkPreviews.dir, storage),
    log,
    config.linkPreviews.enabled,
    opts.linkFetcher,
  );
  const transcripts = new TranscriptionService(
    opts.transcriber ??
      (config.whisperUrl ? whisperTranscriber(config.whisperUrl, config.voice.ffmpegPath) : null),
    log,
  );
  const messages = new MessageService(
    db,
    hub,
    storage,
    channels,
    push,
    config.voice.dir,
    config.files.dir,
    perms,
    linkPreviews,
    transcripts,
  );
  const schedule = new ScheduleService(db, hub, channels, messages, push, log);
  const webhooks = new WebhookService(db, channels, messages);
  const status = new StatusService(parseStatusTargets(config.statusTargets), opts.fetchFn ?? fetch);
  guilds.memberJoined = (user, guild) => messages.joined(user, guild);
  const accounts = new AccountService(db, hub, guilds, channels, dms, images, storage, {
    voiceDir: config.voice.dir,
    fileDir: config.files.dir,
  });
  const turnUsage = new TurnUsageService(db, config.ice.monthlyLimitBytes);
  const ice = new IceService(config, log, fetch, async () => (await turnUsage.status()).exhausted);
  return {
    auth,
    guilds,
    channels,
    messages,
    push,
    ice,
    turnUsage,
    friends,
    dms,
    users,
    gifs,
    storage,
    accounts,
    badges,
    admin,
    roles,
    security,
    schedule,
    webhooks,
    status,
    linkPreviews,
    transcripts,
  };
}
