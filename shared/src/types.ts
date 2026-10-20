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

export interface MessageDto {
  /** bigint as decimal string */
  id: string;
  channelId: string;
  author: MessageAuthorDto;
  content: string;
  createdAt: string;
  editedAt: string | null;
}

export interface MemberDto {
  userId: string;
  username: string;
  online: boolean;
}

export interface InvitePreviewDto {
  guild: { id: string; name: string; memberCount: number };
  alreadyMember: boolean;
}

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'INVALID_CREDENTIALS'
  | 'FORBIDDEN'
  | 'BAD_ORIGIN'
  | 'NOT_AUTHOR'
  | 'NOT_FOUND'
  | 'INVITE_NOT_FOUND'
  | 'CONFLICT'
  | 'EMAIL_TAKEN'
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
