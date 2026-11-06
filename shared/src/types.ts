import type { GUILD_PERMISSIONS } from './constants.js';

/** A short server tag (e.g. "GAME" + 🎮) someone wears next to their name. */
export interface UserTagDto {
  guildId: string;
  text: string;
  emoji: string | null;
}

/** Custom status: an emoji and/or a short text ("🎧 Hört Musik"). */
export interface UserStatusDto {
  emoji: string | null;
  text: string | null;
}

/** owner: the operator (exactly one); admin: may kick normal users; user: everybody else. */
export type UserRole = 'owner' | 'admin' | 'user';

/** A badge from the catalogue. `requirement` tells who may wear it. */
export interface BadgeDto {
  id: string;
  label: string;
  emoji: string;
  description: string;
  requirement: 'all' | 'admin' | 'owner' | 'manual';
}

/** What other people see of a user. */
export interface PublicUserDto {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  role?: UserRole;
  /** Ids of the badges the person chose to show (see BadgeDto), in display order. */
  badges?: string[];
  tag?: UserTagDto | null;
  status?: UserStatusDto | null;
}

/** The full profile page of a user. */
export interface ProfileDto extends PublicUserDto {
  role: UserRole;
  badges: string[];
  /** Sign-up date. */
  createdAt: string;
}

/** Own badge settings: what is available and what is shown. */
export interface MyBadgesDto {
  available: BadgeDto[];
  shown: string[];
}

/** A row of the user list in the admin area. */
export interface AdminUserDto {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: UserRole;
  online: boolean;
  createdAt: string;
}

/** The signed-in user: their public profile plus the e-mail address. */
export interface UserDto extends PublicUserDto {
  email: string;
}

/** Green = online, red = in a call, grey = offline. */
export type PresenceStatus = 'online' | 'call' | 'offline';

export interface GuildDto {
  id: string;
  name: string;
  ownerId: string;
  inviteCode: string;
  /** Same-origin URL of the server picture, null → initials. */
  iconUrl: string | null;
  /** Server tag members can wear (2–4 letters/digits) and its emoji. */
  tag: string | null;
  tagEmoji: string | null;
  /** Limits of the invite link (null: none) and how often it was used since they were set. */
  inviteExpiresAt: string | null;
  inviteMaxUses: number | null;
  inviteUses: number;
  createdAt: string;
}

/** 'dm': a private conversation of two friends; 'group': a group chat (text, files and calls). */
export type ChannelKind = 'text' | 'voice' | 'dm' | 'group';

export interface ChannelDto {
  id: string;
  /** Null for direct messages. */
  guildId: string | null;
  name: string;
  kind: ChannelKind;
  /** Only certain roles see it. */
  restricted: boolean;
  description: string | null;
  categoryId: string | null;
  position: number;
  createdAt: string;
}

/** A group of channels in the sidebar. */
export interface CategoryDto {
  id: string;
  name: string;
  position: number;
}

export type GuildPermission = (typeof GUILD_PERMISSIONS)[number];

/** A role of a server. `position`: lower ranks higher. */
export interface RoleDto {
  id: string;
  name: string;
  color: string | null;
  permissions: GuildPermission[];
  position: number;
}

/** Roles of a server and what they allow the person asking. */
export interface GuildRolesDto {
  roles: RoleDto[];
  /** The owner has all of them. */
  myPermissions: GuildPermission[];
}

/** Answer of a login: signed in, or the second factor is still missing. */
export type LoginResultDto = { user: UserDto } | { twoFactor: true; ticket: string };

export interface TwoFactorStatusDto {
  enabled: boolean;
  /** Unused recovery codes. */
  recoveryCodesLeft: number;
  /** The server has a key for it (otherwise setup is not possible). */
  available: boolean;
}

export interface TwoFactorSetupDto {
  /** For typing in by hand. */
  secret: string;
  /** otpauth:// link, shown as a QR code. */
  uri: string;
}

/** A signed-in device. */
export interface SessionDto {
  id: string;
  device: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  current: boolean;
}

export interface GuildBanDto {
  user: PublicUserDto;
  createdAt: string;
}

/** Someone in a live voice channel. One person can be in one voice channel at a time. */
export interface VoicePeerDto {
  /** Per join; addresses this participant for WebRTC signalling. */
  peerId: string;
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  muted: boolean;
  /** Sends a picture: camera or screen. */
  video: boolean;
  /** The picture is a shared screen. */
  screen?: boolean;
}

export type MessageAuthorDto = PublicUserDto;

/** 'join': someone joined the server (shown as a greeting, has no text of its own). */
export type MessageKind = 'text' | 'voice' | 'file' | 'gif' | 'join';

/** One emoji under a message: how often, and from whom. */
export interface ReactionDto {
  emoji: string;
  count: number;
  userIds: string[];
}

/** The message an answer refers to, enough to show one line of it. */
export interface MessageRefDto {
  id: string;
  author: Pick<PublicUserDto, 'id' | 'username' | 'displayName'>;
  kind: MessageKind;
  /** Start of the text; empty for voice messages, files and GIFs. */
  excerpt: string;
}

/** Unread messages of a channel or private conversation (only channels with any are listed). */
export interface UnreadDto {
  channelId: string;
  /** Null for private conversations. */
  guildId: string | null;
  count: number;
  /** Of these, how many mention you or answer you. */
  mentions: number;
  /** Everything up to here counts as read ("0": nothing yet). */
  lastReadId: string;
}

export interface FileAttachmentDto {
  /** Same-origin URL, only readable by members of the guild. */
  url: string;
  name: string;
  size: number;
  /** Only real images (checked by their bytes) are shown inline; everything else downloads. */
  isImage: boolean;
}

/** A GIF from GIPHY: embedded from GIPHY's servers, never copied to ours. */
export interface GifDto {
  id: string;
  /** Short looping video (smaller than the .gif) and a still/animated WebP fallback. */
  mp4: string;
  webp: string;
  width: number;
  height: number;
  title: string;
}

export interface VoiceAudioDto {
  /** Same-origin URL, only readable by members of the guild. */
  url: string;
  durationMs: number;
  mime: string;
}

/** What a linked page says about itself. */
export interface LinkPreviewDto {
  url: string;
  title: string;
  description: string | null;
  siteName: string | null;
  /** Same-origin copy of the page's picture. */
  imageUrl: string | null;
}

export interface MessageDto {
  /** bigint as decimal string */
  id: string;
  channelId: string;
  author: MessageAuthorDto;
  kind: MessageKind;
  /** Empty for voice messages. */
  content: string;
  audio: VoiceAudioDto | null;
  file: FileAttachmentDto | null;
  gif: GifDto | null;
  reactions: ReactionDto[];
  replyTo: MessageRefDto | null;
  /** When it was pinned to the channel (null: not pinned). */
  pinnedAt: string | null;
  linkPreview: LinkPreviewDto | null;
  createdAt: string;
  editedAt: string | null;
}

/** A hit of the message search, with where it was written. */
export interface SearchResultDto {
  message: MessageDto;
  channelName: string;
  channelKind: ChannelKind;
  /** Null for private conversations. */
  guildId: string | null;
  guildName: string | null;
}

export interface MemberDto {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  online: boolean;
  presence?: PresenceStatus;
  role?: UserRole;
  badges?: string[];
  tag?: UserTagDto | null;
  status?: UserStatusDto | null;
  /** Roles on this server. */
  roleIds?: string[];
}

/** 'friend' once accepted; otherwise a request sent to me ('incoming') or by me ('outgoing'). */
export type FriendStatus = 'friend' | 'incoming' | 'outgoing';

export interface FriendDto {
  user: PublicUserDto;
  status: FriendStatus;
  online: boolean;
  presence?: PresenceStatus;
  /** When the request was sent, or when it was accepted for friends. */
  since: string;
}

/**
 * A private conversation: with one friend (kind 'dm') or a group chat (kind 'group', its name is
 * channel.name, empty = not named yet).
 */
export interface DmChannelDto {
  channel: ChannelDto;
  /** The other person; in a group the first other member. */
  peer: PublicUserDto;
  /** Everyone else in the conversation (one person in a 'dm'). */
  members: PublicUserDto[];
  /** Group chats: may rename and remove people. Null for a 'dm'. */
  ownerId: string | null;
  /** The other person (or anyone else in a group) is online. */
  online: boolean;
  /** Of the other person in a conversation of two. */
  presence?: PresenceStatus;
  /** Newest message, for sorting the list (null: nothing written yet). */
  lastMessageAt: string | null;
}

export interface TurnUsageDto {
  /** Calendar month (UTC), "YYYY-MM". */
  month: string;
  usedBytes: number;
  limitBytes: number;
  exhausted: boolean;
  /** A TURN server is set up at all. */
  configured: boolean;
}

export interface PushConfigDto {
  /** False when the server has no VAPID keys configured. */
  enabled: boolean;
  publicKey: string | null;
  mutedGuildIds: string[];
}

/** Payload of a push message, as the service worker receives it. */
export interface PushPayload {
  title: string;
  body: string;
  /** In-app path to open on click. */
  url: string;
  /** Notifications with the same tag replace each other (one per channel). */
  tag: string;
}

export interface InvitePreviewDto {
  guild: { id: string; name: string; memberCount: number };
  alreadyMember: boolean;
}

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'BAD_REQUEST'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNAUTHORIZED'
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_NOT_VERIFIED'
  | 'VERIFICATION_INVALID'
  | 'FORBIDDEN'
  | 'OWNER_PROTECTED'
  | 'BANNED'
  | 'TWO_FACTOR_INVALID'
  | 'TWO_FACTOR_LOCKED'
  | 'BAD_ORIGIN'
  | 'NOT_AUTHOR'
  | 'NOT_FOUND'
  | 'INVITE_NOT_FOUND'
  | 'CONFLICT'
  | 'CHANNEL_EXISTS'
  | 'USERNAME_TAKEN'
  | 'GUILD_LIMIT'
  | 'STORAGE_FULL'
  | 'RESET_INVALID'
  | 'NOT_FRIENDS'
  | 'OWNER_CANNOT_LEAVE'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL';

export interface ApiError {
  error: {
    code: ErrorCode | (string & {});
    message: string;
    details?: unknown;
  };
}
