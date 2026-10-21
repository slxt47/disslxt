export interface UserDto {
  id: string;
  email: string;
  username: string;
}

export interface GuildDto {
  id: string;
  name: string;
  ownerId: string;
  inviteCode: string;
  createdAt: string;
}

export interface ChannelDto {
  id: string;
  guildId: string;
  name: string;
  createdAt: string;
}

export interface MessageAuthorDto {
  id: string;
  username: string;
}

export type MessageKind = 'text' | 'voice';

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
  createdAt: string;
  editedAt: string | null;
}

export interface MemberDto {
  userId: string;
  username: string;
  online: boolean;
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
