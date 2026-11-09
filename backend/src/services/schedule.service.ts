import { and, asc, count, eq, gt, inArray, lte } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import {
  SCHEDULED_PER_USER_MAX,
  type EventDto,
  type MessageDto,
  type PublicUserDto,
  type RsvpAnswer,
  type ScheduledDto,
  type ScheduleInput,
} from '@disslxt/shared';
import type { Database } from '../db/client.js';
import {
  channels,
  eventRsvps,
  messageEvents,
  messages,
  scheduledMessages,
  users,
} from '../db/schema.js';
import { AppError, notFound } from '../lib/errors.js';
import type { ChannelService } from './channel.service.js';
import { profileColumns, toPublicUser } from './dto.js';
import type { MessageService } from './message.service.js';
import type { PushService } from './push.service.js';
import type { Hub } from '../realtime/hub.js';

/** Events remind this long before they start. */
const EVENT_REMINDER_MS = 15 * 60 * 1000;

const urlOf = (channel: { id: string; guildId: string | null }) =>
  channel.guildId ? `/guilds/${channel.guildId}/channels/${channel.id}` : `/me/${channel.id}`;

/** Messages for later, reminders and event reminders; `tick` runs them when they are due. */
export class ScheduleService {
  constructor(
    private readonly db: Database,
    private readonly hub: Hub,
    private readonly channels: ChannelService,
    private readonly messages: MessageService,
    private readonly push: PushService,
    private readonly log: FastifyBaseLogger,
  ) {}

  async create(
    user: PublicUserDto,
    channelId: string,
    input: ScheduleInput,
  ): Promise<ScheduledDto> {
    await this.channels.assertAccess(user.id, channelId);
    const [row] = await this.db
      .select({ n: count() })
      .from(scheduledMessages)
      .where(eq(scheduledMessages.userId, user.id));
    if ((row?.n ?? 0) >= SCHEDULED_PER_USER_MAX) {
      throw new AppError('BAD_REQUEST', 400, `Höchstens ${SCHEDULED_PER_USER_MAX} geplante Dinge`);
    }
    const [saved] = await this.db
      .insert(scheduledMessages)
      .values({
        userId: user.id,
        channelId,
        kind: input.kind,
        content: input.content,
        sendAt: new Date(input.sendAt),
      })
      .returning();
    if (!saved) throw new Error('insert returned no row');
    return {
      id: saved.id,
      channelId,
      kind: input.kind,
      content: saved.content,
      sendAt: saved.sendAt.toISOString(),
    };
  }

  async list(userId: string): Promise<ScheduledDto[]> {
    const rows = await this.db
      .select()
      .from(scheduledMessages)
      .where(eq(scheduledMessages.userId, userId))
      .orderBy(asc(scheduledMessages.sendAt));
    return rows.map((r) => ({
      id: r.id,
      channelId: r.channelId,
      kind: r.kind === 'remind' ? 'remind' : 'send',
      content: r.content,
      sendAt: r.sendAt.toISOString(),
    }));
  }

  async cancel(userId: string, id: string): Promise<void> {
    const gone = await this.db
      .delete(scheduledMessages)
      .where(and(eq(scheduledMessages.id, id), eq(scheduledMessages.userId, userId)))
      .returning({ id: scheduledMessages.id });
    if (gone.length === 0) throw notFound('Nicht gefunden');
  }

  async createEvent(
    user: PublicUserDto,
    channelId: string,
    title: string,
    startsAt: string,
  ): Promise<MessageDto> {
    return this.messages.createEvent(user, channelId, title, new Date(startsAt));
  }

  async rsvp(userId: string, messageId: string, answer: RsvpAnswer | null): Promise<EventDto> {
    return this.messages.rsvp(userId, messageId, answer);
  }

  /** Runs what is due. Each row is taken out first, so nothing goes out twice. */
  async tick(now = new Date()): Promise<void> {
    const due = await this.db
      .delete(scheduledMessages)
      .where(lte(scheduledMessages.sendAt, now))
      .returning();
    for (const job of due) {
      try {
        await this.run(job);
      } catch (err) {
        this.log.warn({ err, id: job.id }, 'scheduled message failed');
        this.push.notify([job.userId], {
          title: 'Geplante Nachricht nicht gesendet',
          body: job.content.slice(0, 120),
          url: '/',
          tag: `scheduled-${job.id}`,
        });
      }
    }
    await this.remindEvents(now);
  }

  private async run(job: typeof scheduledMessages.$inferSelect): Promise<void> {
    const [author] = await this.db
      .select(profileColumns)
      .from(users)
      .where(eq(users.id, job.userId))
      .limit(1);
    if (!author) return;
    if (job.kind === 'send') {
      // Goes through the normal checks: access lost in the meantime means it fails.
      await this.messages.create(toPublicUser(author), job.channelId, job.content);
      return;
    }
    const channel = await this.channels.assertAccess(job.userId, job.channelId);
    this.hub.publishToUsers([job.userId], {
      type: 'reminder',
      data: { channelId: job.channelId, text: job.content },
    });
    this.push.notify([job.userId], {
      title: '⏰ Erinnerung',
      body: job.content.slice(0, 140),
      url: urlOf(channel),
      tag: `reminder-${job.id}`,
    });
  }

  private async remindEvents(now: Date): Promise<void> {
    const soon = await this.db
      .update(messageEvents)
      .set({ reminded: true })
      .where(
        and(
          eq(messageEvents.reminded, false),
          gt(messageEvents.startsAt, now),
          lte(messageEvents.startsAt, new Date(now.getTime() + EVENT_REMINDER_MS)),
        ),
      )
      .returning({ messageId: messageEvents.messageId });
    if (soon.length === 0) return;
    const ids = soon.map((e) => e.messageId);
    const [rows, going] = await Promise.all([
      this.db
        .select({
          id: messages.id,
          title: messages.content,
          channelId: channels.id,
          guildId: channels.guildId,
        })
        .from(messages)
        .innerJoin(channels, eq(channels.id, messages.channelId))
        .where(inArray(messages.id, ids)),
      this.db
        .select()
        .from(eventRsvps)
        .where(
          and(inArray(eventRsvps.messageId, ids), inArray(eventRsvps.answer, ['yes', 'maybe'])),
        ),
    ]);
    for (const row of rows) {
      this.push.notify(
        going.filter((g) => g.messageId === row.id).map((g) => g.userId),
        {
          title: '📅 Gleich geht es los',
          body: row.title,
          url: urlOf({ id: row.channelId, guildId: row.guildId }),
          tag: `event-${row.id}`,
        },
      );
    }
  }
}
