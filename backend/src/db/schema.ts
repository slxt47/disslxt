import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  index,
  integer,
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
    /** Shown instead of the username where set (profile settings). */
    displayName: varchar('display_name', { length: 32 }),
    /** Profile picture: file name in UPLOAD_DIR/avatars (a new name per upload busts caches). */
    avatarKey: varchar('avatar_key', { length: 64 }),
    /**
     * 'owner' (exactly one, enforced by a unique index), 'admin' or 'user'. Only the owner can
     * change roles, and only between 'admin' and 'user'; nothing in the API sets 'owner'.
     */
    role: varchar('role', { length: 8 }).notNull().default('user'),
    /** Ids of the badges shown next to the name (a subset of what the user may wear). */
    shownBadges: varchar('shown_badges', { length: 32 })
      .array()
      .notNull()
      .default(sql`'{}'::varchar[]`),
    /** Custom status: an emoji and/or a short text. */
    statusEmoji: varchar('status_emoji', { length: 16 }),
    statusText: varchar('status_text', { length: 80 }),
    /**
     * The server tag this person wears next to their name (a guild they are a member of). Text and
     * emoji are copied here so every message author etc. can be shown without another join; they
     * are updated when the owner changes the tag and cleared when it goes away.
     */
    tagGuildId: uuid('tag_guild_id'),
    tagText: varchar('tag_text', { length: 4 }),
    tagEmoji: varchar('tag_emoji', { length: 16 }),
    // Accounts are only created once the address is confirmed, so this is always set for new
    // users; the migration backfills accounts that existed before verification was introduced.
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('users_email_lower_uq').on(sql`lower(${t.email})`),
    // Friends are added by username, so it must name exactly one person.
    uniqueIndex('users_username_lower_uq').on(sql`lower(${t.username})`),
    // There is only ever one owner.
    uniqueIndex('users_single_owner_uq')
      .on(t.role)
      .where(sql`${t.role} = 'owner'`),
    check('users_role_chk', sql`${t.role} in ('owner', 'admin', 'user')`),
  ],
);

/**
 * Badge catalogue. `requirement` says who may wear a badge: everybody ('all'), admins and the
 * owner ('admin'), only the owner ('owner'), or only people it was granted to ('manual', see
 * userBadges).
 */
export const badges = pgTable(
  'badges',
  {
    id: varchar('id', { length: 32 }).primaryKey(),
    label: varchar('label', { length: 40 }).notNull(),
    emoji: varchar('emoji', { length: 16 }).notNull(),
    description: varchar('description', { length: 120 }).notNull(),
    requirement: varchar('requirement', { length: 8 }).notNull().default('manual'),
    sort: integer('sort').notNull().default(0),
  },
  (t) => [
    check('badges_requirement_chk', sql`${t.requirement} in ('all', 'admin', 'owner', 'manual')`),
  ],
);

/** Manually granted badges (requirement 'manual'); the operator inserts rows here. */
export const userBadges = pgTable(
  'user_badges',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    badgeId: varchar('badge_id', { length: 32 })
      .notNull()
      .references(() => badges.id, { onDelete: 'cascade' }),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.badgeId] })],
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

/** "Passwort vergessen": one-time link, valid for a short time. */
export const passwordResets = pgTable(
  'password_resets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: char('token_hash', { length: 64 }).notNull().unique('password_resets_token_uq'),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('password_resets_user_idx').on(t.userId)],
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
  /** Server picture: file name in UPLOAD_DIR/avatars (set by the owner). */
  iconKey: varchar('icon_key', { length: 64 }),
  /** Server tag (2–4 letters/digits) and its emoji; members can wear it next to their name. */
  tag: varchar('tag', { length: 4 }),
  tagEmoji: varchar('tag_emoji', { length: 16 }),
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
    /** Null for direct messages (kind 'dm'), which belong to two friends instead of a guild. */
    guildId: uuid('guild_id').references(() => guilds.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 32 }).notNull(),
    kind: varchar('kind', { length: 16 }).notNull().default('text'),
    /** Direct messages: both user ids, sorted and joined by ':' (one conversation per pair). */
    dmKey: varchar('dm_key', { length: 80 }).unique('channels_dm_key_uq'),
    /** Group chats: who started it (may rename, add and remove people); passes on when they leave. */
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('channels_guild_id_name_uq').on(t.guildId, t.name),
    index('channels_guild_id_idx').on(t.guildId),
    // Private conversations ('dm', 'group') have no guild; only a 'dm' has a pair key.
    check(
      'channels_dm_shape_chk',
      sql`(${t.kind} in ('dm', 'group')) = (${t.guildId} is null) and (${t.kind} = 'dm') = (${t.dmKey} is not null)`,
    ),
  ],
);

/** The two participants of a direct-message channel. */
export const dmMembers = pgTable(
  'dm_members',
  {
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.channelId, t.userId] }),
    index('dm_members_user_id_idx').on(t.userId),
  ],
);

/**
 * Friendship between two users. A request is a 'pending' row from requester to addressee; once
 * accepted both are friends. At most one row per pair, whichever direction it was sent in.
 */
export const friendships = pgTable(
  'friendships',
  {
    requesterId: uuid('requester_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    addresseeId: uuid('addressee_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    createdAt: createdAt(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.requesterId, t.addresseeId] }),
    uniqueIndex('friendships_pair_uq').on(
      sql`least(${t.requesterId}, ${t.addresseeId})`,
      sql`greatest(${t.requesterId}, ${t.addresseeId})`,
    ),
    index('friendships_addressee_idx').on(t.addresseeId),
    check('friendships_not_self_chk', sql`${t.requesterId} <> ${t.addresseeId}`),
    check('friendships_status_chk', sql`${t.status} in ('pending', 'accepted')`),
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
    kind: varchar('kind', { length: 16 }).notNull().default('text'),
    content: text('content').notNull(),
    /** Voice messages: file name in UPLOAD_DIR/voice, length and MIME type of the stored file. */
    audioKey: varchar('audio_key', { length: 64 }),
    audioDurationMs: integer('audio_duration_ms'),
    audioMime: varchar('audio_mime', { length: 64 }),
    /** Shared files: name in UPLOAD_DIR/files, original (sanitised) name, size, served type. */
    fileKey: varchar('file_key', { length: 64 }),
    fileName: varchar('file_name', { length: 255 }),
    fileSize: integer('file_size'),
    fileMime: varchar('file_mime', { length: 64 }),
    /** GIFs: the GIPHY id (embedded from GIPHY, never stored here) and its size for the layout. */
    gifId: varchar('gif_id', { length: 64 }),
    gifWidth: integer('gif_width'),
    gifHeight: integer('gif_height'),
    createdAt: createdAt(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
  },
  (t) => [
    check(
      'messages_content_len_chk',
      sql`(${t.kind} = 'text' and char_length(${t.content}) between 1 and 2000) or (${t.kind} = 'voice' and ${t.audioKey} is not null and char_length(${t.content}) <= 2000) or (${t.kind} = 'file' and ${t.fileKey} is not null and char_length(${t.content}) <= 2000) or (${t.kind} = 'gif' and ${t.gifId} is not null and char_length(${t.content}) <= 2000)`,
    ),
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

/**
 * Bytes relayed through TURN per calendar month (UTC), as measured and reported by the clients.
 * Used to stop handing out TURN credentials before the free quota is used up.
 */
export const turnUsage = pgTable('turn_usage', {
  month: char('month', { length: 7 }).primaryKey(),
  bytes: bigint('bytes', { mode: 'number' }).notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type PendingRegistration = typeof pendingRegistrations.$inferSelect;
export type Guild = typeof guilds.$inferSelect;
export type Channel = typeof channels.$inferSelect;
export type Message = typeof messages.$inferSelect;
