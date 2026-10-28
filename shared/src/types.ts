export interface UserDto {
  id: string;
  email: string;
  username: string;
  /** Chosen display name; null → the username is shown. */
  displayName: string | null;
  /** Same-origin URL of the profile picture, null → initials. */
  avatarUrl: string | null;
}

/** What other people see of a user. */
export interface PublicUserDto {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface GuildDto {
  id: string;
  name: string;
  ownerId: string;
  inviteCode: string;
  /** Same-origin URL of the server picture, null → initials. */
  iconUrl: string | null;
  createdAt: string;
}

/** 'dm': a private conversation of two friends (text, files and calls). */
export type ChannelKind = 'text' | 'voice' | 'dm';

export interface ChannelDto {
  id: string;
  /** Null for direct messages. */
  guildId: string | null;
  name: string;
  kind: ChannelKind;
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
  /** Camera is on. */
  video: boolean;
}

export type MessageAuthorDto = PublicUserDto;

export type MessageKind = 'text' | 'voice' | 'file';

export interface FileAttachmentDto {
  /** Same-origin URL, only readable by members of the guild. */
  url: string;
  name: string;
  size: number;
  /** Only real images (checked by their bytes) are shown inline; everything else downloads. */
  isImage: boolean;
}

export interface VoiceAudioDto {
  /** Same-origin URL, only readable by members of the guild. */
  url: string;
  durationMs: number;
  mime: string;
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
  createdAt: string;
  editedAt: string | null;
}

export interface MemberDto {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  online: boolean;
}

/** 'friend' once accepted; otherwise a request sent to me ('incoming') or by me ('outgoing'). */
export type FriendStatus = 'friend' | 'incoming' | 'outgoing';

export interface FriendDto {
  user: PublicUserDto;
  status: FriendStatus;
  online: boolean;
  /** When the request was sent, or when it was accepted for friends. */
  since: string;
}

/** A private conversation with one friend. */
export interface DmChannelDto {
  channel: ChannelDto;
  peer: PublicUserDto;
  online: boolean;
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
  | 'BAD_ORIGIN'
  | 'NOT_AUTHOR'
  | 'NOT_FOUND'
  | 'INVITE_NOT_FOUND'
  | 'CONFLICT'
  | 'CHANNEL_EXISTS'
  | 'USERNAME_TAKEN'
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
