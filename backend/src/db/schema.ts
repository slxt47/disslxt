import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  foreignKey,
  index,
  type AnyPgColumn,
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
    /** Authenticator secret, encrypted (see secretBox); set during setup, active with the date. */
    totpSecret: text('totp_secret'),
    totpEnabledAt: timestamp('totp_enabled_at', { withTimezone: true }),
    /** Last used time step: a code works once. */
    totpLastStep: bigint('totp_last_step', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    /** Wrong second factors in a row, and until when further tries are refused. */
    totpFailures: integer('totp_failures').notNull().default(0),
    totpLockedUntil: timestamp('totp_locked_until', { withTimezone: true }),
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
    /** Browser and system at sign-in, shown in the list of devices. No IP address is kept. */
    device: varchar('device', { length: 80 }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

/** The step between password and second factor; proves that the password was right. */
export const loginChallenges = pgTable(
  'login_challenges',
  {
    tokenHash: char('token_hash', { length: 64 }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    device: varchar('device', { length: 80 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('login_challenges_user_idx').on(t.userId)],
);

/** One-time codes for when the authenticator is gone; only their hashes are stored. */
export const recoveryCodes = pgTable(
  'recovery_codes',
  {
    codeHash: char('code_hash', { length: 64 }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [index('recovery_codes_user_idx').on(t.userId)],
);

export const guilds = pgTable('guilds', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id),
  inviteCode: varchar('invite_code', { length: 16 }).notNull().unique('guilds_invite_code_uq'),
  /** The link stops working after this time / this many joins (null: no limit). */
  inviteExpiresAt: timestamp('invite_expires_at', { withTimezone: true }),
  inviteMaxUses: integer('invite_max_uses'),
  /** Joins through the current link; starts over whenever the owner changes its limits. */
  inviteUses: integer('invite_uses').notNull().default(0),
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

/** Groups of channels in the sidebar. */
export const channelCategories = pgTable(
  'channel_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 32 }).notNull(),
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    unique('channel_categories_guild_name_uq').on(t.guildId, t.name),
    index('channel_categories_guild_idx').on(t.guildId),
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
    /** Only the owner and people with a role from channel_roles see this channel. */
    restricted: boolean('restricted').notNull().default(false),
    /** What the channel is for, shown in its header. */
    description: varchar('description', { length: 200 }),
    /** Null: above all categories. */
    categoryId: uuid('category_id').references(() => channelCategories.id, {
      onDelete: 'set null',
    }),
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    unique('channels_guild_id_name_uq').on(t.guildId, t.name),
    index('channels_guild_id_idx').on(t.guildId),
    index('channels_category_idx').on(t.categoryId),
    // Private conversations ('dm', 'group') have no guild; only a 'dm' has a pair key.
    check(
      'channels_dm_shape_chk',
      sql`(${t.kind} in ('dm', 'group')) = (${t.guildId} is null) and (${t.kind} = 'dm') = (${t.dmKey} is not null)`,
    ),
  ],
);

/** Roles of one server. `position`: lower ranks higher; only the owner manages them. */
export const guildRoles = pgTable(
  'guild_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 32 }).notNull(),
    /** "#rrggbb", null: no colour. */
    color: char('color', { length: 7 }),
    permissions: varchar('permissions', { length: 32 })
      .array()
      .notNull()
      .default(sql`'{}'::varchar[]`),
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [unique('guild_roles_guild_name_uq').on(t.guildId, t.name)],
);

/** Goes away with the membership and with the role. */
export const guildMemberRoles = pgTable(
  'guild_member_roles',
  {
    guildId: uuid('guild_id').notNull(),
    userId: uuid('user_id').notNull(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => guildRoles.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.guildId, t.userId, t.roleId] }),
    foreignKey({
      columns: [t.guildId, t.userId],
      foreignColumns: [guildMembers.guildId, guildMembers.userId],
    }).onDelete('cascade'),
    index('guild_member_roles_role_idx').on(t.roleId),
    index('guild_member_roles_user_idx').on(t.userId),
  ],
);

/** Which roles may see a restricted channel. */
export const channelRoles = pgTable(
  'channel_roles',
  {
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => guildRoles.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.channelId, t.roleId] }),
    index('channel_roles_role_idx').on(t.roleId),
  ],
);

/** Banned from a server: cannot join again until unbanned. */
export const guildBans = pgTable(
  'guild_bans',
  {
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bannedBy: uuid('banned_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.userId] })],
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

/** What a linked page says about itself; shared by all messages with the same link. */
export const linkPreviews = pgTable('link_previews', {
  id: uuid('id').primaryKey().defaultRandom(),
  urlHash: char('url_hash', { length: 64 }).notNull().unique('link_previews_url_uq'),
  url: text('url').notNull(),
  /** Null: the page had nothing to show (kept, so it is not fetched again right away). */
  title: varchar('title', { length: 200 }),
  description: varchar('description', { length: 300 }),
  siteName: varchar('site_name', { length: 80 }),
  /** Copy of the page's picture in UPLOAD_DIR/previews. */
  imageKey: varchar('image_key', { length: 64 }),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});

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
    /** The message this one answers; emptied when that message is deleted. */
    replyToId: bigint('reply_to_id', { mode: 'bigint' }).references(
      (): AnyPgColumn => messages.id,
      { onDelete: 'set null' },
    ),
    /** Reply inside a thread; if its first message goes, the reply moves to the channel. */
    threadRootId: bigint('thread_root_id', { mode: 'bigint' }).references(
      (): AnyPgColumn => messages.id,
      { onDelete: 'set null' },
    ),
    /** Posted by a webhook: its name is shown instead of the author. */
    botName: varchar('bot_name', { length: 32 }),
    linkPreviewId: uuid('link_preview_id').references(() => linkPreviews.id, {
      onDelete: 'set null',
    }),
    /** The author took the preview away; it does not come back. */
    previewHidden: boolean('preview_hidden').notNull().default(false),
    /** Pinned to its channel since then (null: not pinned). */
    pinnedAt: timestamp('pinned_at', { withTimezone: true }),
    createdAt: createdAt(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
  },
  (t) => [
    check(
      'messages_content_len_chk',
      sql`(${t.kind} = 'text' and char_length(${t.content}) between 1 and 2000) or (${t.kind} = 'voice' and ${t.audioKey} is not null and char_length(${t.content}) <= 2000) or (${t.kind} = 'file' and ${t.fileKey} is not null and char_length(${t.content}) <= 2000) or (${t.kind} = 'gif' and ${t.gifId} is not null and char_length(${t.content}) <= 2000) or (${t.kind} = 'join' and ${t.content} = '') or (${t.kind} in ('poll', 'event') and char_length(${t.content}) between 1 and 200) or (${t.kind} = 'bot' and char_length(${t.content}) between 1 and 2000)`,
    ),
    index('messages_channel_id_id_idx').on(t.channelId, t.id.desc()),
    // Words, lower-cased, without stemming: German and English are mixed here.
    index('messages_search_idx').using('gin', sql`to_tsvector('simple', ${t.content})`),
    index('messages_thread_root_idx')
      .on(t.threadRootId)
      .where(sql`${t.threadRootId} is not null`),
    index('messages_reply_to_idx')
      .on(t.replyToId)
      .where(sql`${t.replyToId} is not null`),
    index('messages_pinned_idx')
      .on(t.channelId)
      .where(sql`${t.pinnedAt} is not null`),
  ],
);

/** One row per person, emoji and message. */
export const messageReactions = pgTable(
  'message_reactions',
  {
    messageId: bigint('message_id', { mode: 'bigint' })
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    emoji: varchar('emoji', { length: 16 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.userId, t.emoji] }),
    index('message_reactions_user_idx').on(t.userId),
  ],
);

/** How far someone has read a channel; the base of the unread counters. */
export const channelReads = pgTable(
  'channel_reads',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    lastReadId: bigint('last_read_id', { mode: 'bigint' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.channelId] }),
    index('channel_reads_channel_idx').on(t.channelId),
  ],
);

/** Sent later, or a reminder only for yourself. */
export const scheduledMessages = pgTable(
  'scheduled_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 8 }).notNull(),
    content: text('content').notNull(),
    sendAt: timestamp('send_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('scheduled_messages_send_at_idx').on(t.sendAt),
    index('scheduled_messages_user_idx').on(t.userId),
    check('scheduled_messages_kind_chk', sql`${t.kind} in ('send', 'remind')`),
  ],
);

/** An event is a message whose text is the title. */
export const messageEvents = pgTable(
  'message_events',
  {
    messageId: bigint('message_id', { mode: 'bigint' })
      .primaryKey()
      .references(() => messages.id, { onDelete: 'cascade' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    reminded: boolean('reminded').notNull().default(false),
  },
  (t) => [index('message_events_starts_idx').on(t.startsAt)],
);

export const eventRsvps = pgTable(
  'event_rsvps',
  {
    messageId: bigint('message_id', { mode: 'bigint' })
      .notNull()
      .references(() => messageEvents.messageId, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    answer: varchar('answer', { length: 8 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.userId] }),
    check('event_rsvps_answer_chk', sql`${t.answer} in ('yes', 'maybe', 'no')`),
  ],
);

/** A program allowed to post into a channel; only the hash of its secret is kept. */
export const channelWebhooks = pgTable(
  'channel_webhooks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 32 }).notNull(),
    tokenHash: char('token_hash', { length: 64 }).notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [index('channel_webhooks_channel_idx').on(t.channelId)],
);

/** The answers of a poll; the question is the message's text. */
export const polls = pgTable('polls', {
  messageId: bigint('message_id', { mode: 'bigint' })
    .primaryKey()
    .references(() => messages.id, { onDelete: 'cascade' }),
  options: varchar('options', { length: 80 }).array().notNull(),
  /** Several answers per person. */
  multiple: boolean('multiple').notNull().default(false),
});

export const pollVotes = pgTable(
  'poll_votes',
  {
    messageId: bigint('message_id', { mode: 'bigint' })
      .notNull()
      .references(() => polls.messageId, { onDelete: 'cascade' }),
    option: integer('option').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.option, t.userId] }),
    index('poll_votes_user_idx').on(t.userId),
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
