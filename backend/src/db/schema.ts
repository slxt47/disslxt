import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 254 }).notNull(),
    username: varchar('username', { length: 32 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    // Accounts are only created once the address is confirmed, so this is always set for new
    // users; the migration backfills accounts that existed before verification was introduced.
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('users_email_lower_uq').on(sql`lower(${t.email})`)],
);

/**
 * A registration waiting for its e-mail confirmation. The user row is only created when the
 * link is used, from the data stored here, so an unconfirmed sign-up can never squat an address
 * or set the password of somebody else's future account.
 */
export const pendingRegistrations = pgTable(
  'pending_registrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 254 }).notNull(),
    username: varchar('username', { length: 32 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    tokenHash: char('token_hash', { length: 64 })
      .notNull()
      .unique('pending_registrations_token_uq'),
    nextPath: varchar('next_path', { length: 200 }),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('pending_registrations_email_idx').on(sql`lower(${t.email})`)],
);

/** One row per e-mail sent to an address; backs the per-address limit against mail bombing. */
export const mailLog = pgTable(
  'mail_log',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    /** sha256 of the lowercased address, so the log itself holds no plain addresses. */
    addressHash: char('address_hash', { length: 64 }).notNull(),
    kind: varchar('kind', { length: 32 }).notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('mail_log_address_sent_idx').on(t.addressHash, t.sentAt)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: char('token_hash', { length: 64 }).notNull().unique('sessions_token_hash_uq'),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

export const guilds = pgTable('guilds', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id),
  inviteCode: varchar('invite_code', { length: 16 }).notNull().unique('guilds_invite_code_uq'),
  createdAt: createdAt(),
});

export const guildMembers = pgTable(
  'guild_members',
  {
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.guildId, t.userId] }),
    index('guild_members_user_id_idx').on(t.userId),
  ],
);

export const channels = pgTable(
  'channels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 32 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('channels_guild_id_name_uq').on(t.guildId, t.name),
    index('channels_guild_id_idx').on(t.guildId),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    content: text('content').notNull(),
    createdAt: createdAt(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
  },
  (t) => [
    check('messages_content_len_chk', sql`char_length(${t.content}) between 1 and 2000`),
    index('messages_channel_id_id_idx').on(t.channelId, t.id.desc()),
  ],
);

/** One row per browser/device that allowed notifications. */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique('push_subscriptions_endpoint_uq'),
    p256dh: varchar('p256dh', { length: 128 }).notNull(),
    auth: varchar('auth', { length: 64 }).notNull(),
    userAgent: varchar('user_agent', { length: 300 }),
    createdAt: createdAt(),
  },
  (t) => [index('push_subscriptions_user_id_idx').on(t.userId)],
);

/** Per-user, per-guild notification preferences (a row only exists once something was set). */
export const guildNotificationSettings = pgTable(
  'guild_notification_settings',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    muted: boolean('muted').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.userId, t.guildId] })],
);

export type User = typeof users.$inferSelect;
export type PendingRegistration = typeof pendingRegistrations.$inferSelect;
export type Guild = typeof guilds.$inferSelect;
export type Channel = typeof channels.$inferSelect;
export type Message = typeof messages.$inferSelect;
