import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type {
  MessageDto,
  PushConfigDto,
  PushPayload,
  PushSubscriptionInput,
} from '@disslxt/shared';
import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import {
  channels,
  guildMembers,
  guildNotificationSettings,
  guilds,
  pushSubscriptions,
  users,
} from '../db/schema.js';
import type { PushSender } from '../lib/push.js';
import type { Hub } from '../realtime/hub.js';

const BODY_MAX = 140;
/** Devices per account; the oldest subscription goes when a new one would exceed it. */
export const MAX_SUBSCRIPTIONS_PER_USER = 20;
/** Parallel requests to the push services per fan-out. */
const CONCURRENCY = 8;

/** `@name` mentions (usernames are [A-Za-z0-9_]{3,32}). */
export function mentionedNames(content: string): Set<string> {
  const names = new Set<string>();
  for (const m of content.matchAll(/(?:^|[^A-Za-z0-9_@])@([A-Za-z0-9_]{3,32})(?![A-Za-z0-9_])/g)) {
    if (m[1]) names.add(m[1].toLowerCase());
  }
  return names;
}

function truncate(s: string, max = BODY_MAX): string {
  const chars = [...s.replace(/\s+/g, ' ').trim()];
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join('');
}

/**
 * Web Push: stores subscriptions and per-guild mute settings and fans out notifications for
 * messages, @mentions and other important events. Sending happens in the background; a request
 * never waits for the push services. Without VAPID keys (`sender` null) everything is a no-op.
 */
export class PushService {
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly db: Database,
    private readonly hub: Hub,
    private readonly config: Pick<Config, 'push'>,
    private readonly sender: PushSender | null,
    private readonly log: FastifyBaseLogger,
  ) {}

  get enabled(): boolean {
    return this.sender !== null && this.config.push !== null;
  }

  async clientConfig(userId: string): Promise<PushConfigDto> {
    return {
      enabled: this.enabled,
      publicKey: this.config.push?.publicKey ?? null,
      mutedGuildIds: await this.mutedGuildIds(userId),
    };
  }

  /** Stores (or moves to this user) the subscription of one browser. */
  async subscribe(userId: string, sub: PushSubscriptionInput, userAgent?: string): Promise<void> {
    const values = {
      userId,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      userAgent: userAgent?.slice(0, 300) ?? null,
    };
    await this.db
      .insert(pushSubscriptions)
      .values(values)
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: values });
    // Bounded fan-out: every message is sent to every subscription of a recipient.
    const surplus = await this.db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))
      .orderBy(desc(pushSubscriptions.createdAt))
      .offset(MAX_SUBSCRIPTIONS_PER_USER);
    if (surplus.length > 0) {
      await this.db.delete(pushSubscriptions).where(
        inArray(
          pushSubscriptions.id,
          surplus.map((s) => s.id),
        ),
      );
    }
  }

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
  }

  /** Membership must be checked by the caller. */
  async setGuildMuted(userId: string, guildId: string, muted: boolean): Promise<void> {
    await this.db
      .insert(guildNotificationSettings)
      .values({ userId, guildId, muted })
      .onConflictDoUpdate({
        target: [guildNotificationSettings.userId, guildNotificationSettings.guildId],
        set: { muted },
      });
  }

  async mutedGuildIds(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ guildId: guildNotificationSettings.guildId })
      .from(guildNotificationSettings)
      .where(
        and(
          eq(guildNotificationSettings.userId, userId),
          eq(guildNotificationSettings.muted, true),
        ),
      );
    return rows.map((r) => r.guildId);
  }

  /** Sends a test notification to all of the user's devices; returns how many were reached. */
  async sendTest(userId: string): Promise<number> {
    if (!this.enabled) return 0;
    return this.sendToUsers([userId], {
      title: 'disslxt',
      body: 'Mitteilungen sind aktiv. So sehen neue Nachrichten aus.',
      url: '/',
      tag: 'test',
    });
  }

  /**
   * New message: every member except the author gets a push, unless they are looking at the
   * channel right now or muted the guild. @mentions get their own wording and pass the mute.
   */
  messageCreated(message: MessageDto): void {
    if (!this.enabled) return;
    this.background(async () => {
      const [ctx] = await this.db
        .select({ guildId: guilds.id, guildName: guilds.name, channelName: channels.name })
        .from(channels)
        .innerJoin(guilds, eq(guilds.id, channels.guildId))
        .where(eq(channels.id, message.channelId))
        .limit(1);
      if (!ctx) return;
      const members = await this.recipients(ctx.guildId, message.author.id);
      const mentioned = mentionedNames(message.content);
      const url = `/guilds/${ctx.guildId}/channels/${message.channelId}`;
      const text =
        message.kind === 'voice'
          ? `${message.author.username}: 🎤 Sprachnachricht`
          : truncate(`${message.author.username}: ${message.content}`);

      const plain: string[] = [];
      const mentions: string[] = [];
      for (const m of members) {
        if (this.hub.isViewingChannel(m.userId, message.channelId)) continue;
        if (mentioned.has(m.username.toLowerCase())) mentions.push(m.userId);
        else if (!m.muted) plain.push(m.userId);
      }
      await Promise.all([
        this.sendToUsers(plain, {
          title: `#${ctx.channelName} · ${ctx.guildName}`,
          body: text,
          url,
          tag: `channel-${message.channelId}`,
        }),
        this.sendToUsers(mentions, {
          title: `${message.author.username} hat dich erwähnt`,
          body: truncate(`#${ctx.channelName}: ${message.content}`),
          url,
          tag: `mention-${message.id}`,
        }),
      ]);
    });
  }

  /** Someone joined via invite: tell the owner (unless muted or it is the owner). */
  memberJoined(guildId: string, user: { id: string; username: string }): void {
    if (!this.enabled) return;
    this.background(async () => {
      const [guild] = await this.db.select().from(guilds).where(eq(guilds.id, guildId)).limit(1);
      if (!guild || guild.ownerId === user.id) return;
      if ((await this.mutedGuildIds(guild.ownerId)).includes(guildId)) return;
      await this.sendToUsers([guild.ownerId], {
        title: guild.name,
        body: `${user.username} ist dem Server beigetreten.`,
        url: `/guilds/${guildId}`,
        tag: `members-${guildId}`,
      });
    });
  }

  /** The first person entered a voice channel: invite the other members (mute applies). */
  voiceStarted(channelId: string, user: { id: string; username: string }): void {
    if (!this.enabled) return;
    this.background(async () => {
      const [ctx] = await this.db
        .select({ guildId: guilds.id, guildName: guilds.name, channelName: channels.name })
        .from(channels)
        .innerJoin(guilds, eq(guilds.id, channels.guildId))
        .where(eq(channels.id, channelId))
        .limit(1);
      if (!ctx) return;
      const members = await this.recipients(ctx.guildId, user.id);
      await this.sendToUsers(
        members.filter((m) => !m.muted).map((m) => m.userId),
        {
          title: `🔊 ${ctx.channelName} · ${ctx.guildName}`,
          body: `${user.username} ist im Sprachkanal. Komm dazu!`,
          url: `/guilds/${ctx.guildId}/channels/${channelId}`,
          tag: `voice-${channelId}`,
        },
      );
    });
  }

  /** Resolves when all background sends have finished (tests, graceful shutdown). */
  async idle(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  private async recipients(guildId: string, exceptUserId: string) {
    return this.db
      .select({
        userId: guildMembers.userId,
        username: users.username,
        muted: guildNotificationSettings.muted,
      })
      .from(guildMembers)
      .innerJoin(users, eq(users.id, guildMembers.userId))
      .leftJoin(
        guildNotificationSettings,
        and(
          eq(guildNotificationSettings.guildId, guildMembers.guildId),
          eq(guildNotificationSettings.userId, guildMembers.userId),
        ),
      )
      .where(and(eq(guildMembers.guildId, guildId), ne(guildMembers.userId, exceptUserId)))
      .then((rows) => rows.map((r) => ({ ...r, muted: r.muted ?? false })));
  }

  /** Sends to every device of the given users; drops subscriptions the push service rejects. */
  private async sendToUsers(userIds: string[], payload: PushPayload): Promise<number> {
    if (!this.sender || userIds.length === 0) return 0;
    const subs = await this.db
      .select()
      .from(pushSubscriptions)
      .where(inArray(pushSubscriptions.userId, userIds));
    const body = JSON.stringify(payload);
    const gone: string[] = [];
    let delivered = 0;
    for (let i = 0; i < subs.length; i += CONCURRENCY) {
      await Promise.all(
        subs.slice(i, i + CONCURRENCY).map(async (s) => {
          try {
            const { statusCode } = await this.sender!.send(
              { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
              body,
            );
            if (statusCode === 404 || statusCode === 410) gone.push(s.id);
            else if (statusCode >= 200 && statusCode < 300) delivered += 1;
            else this.log.warn({ statusCode }, 'push service rejected a notification');
          } catch (err) {
            this.log.warn({ err }, 'push delivery failed');
          }
        }),
      );
    }
    if (gone.length > 0) {
      await this.db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone));
    }
    return delivered;
  }

  private background(task: () => Promise<void>): void {
    const p = task()
      .catch((err: unknown) => this.log.error({ err }, 'push fan-out failed'))
      .finally(() => this.pending.delete(p));
    this.pending.add(p);
  }
}
