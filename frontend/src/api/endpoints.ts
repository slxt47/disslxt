import type {
  ChannelDto,
  ChannelKind,
  VoicePeerDto,
  GuildDto,
  InvitePreviewDto,
  MemberDto,
  MessageDto,
  PushConfigDto,
  TurnUsageDto,
  UserDto,
} from '@disslxt/shared';
import { apiRequest, apiUpload } from './client';

const enc = encodeURIComponent;

export const api = {
  register: (input: { email: string; username: string; password: string; next?: string }) =>
    apiRequest<{ status: 'verification_sent' }>('POST', '/auth/register', input),
  verifyEmail: (token: string) =>
    apiRequest<{ user: UserDto; next: string | null }>('POST', '/auth/verify-email', { token }),
  resendVerification: (email: string) =>
    apiRequest<{ status: 'verification_sent' }>('POST', '/auth/resend-verification', { email }),
  login: (input: { email: string; password: string }) =>
    apiRequest<{ user: UserDto }>('POST', '/auth/login', input),
  logout: () => apiRequest<void>('POST', '/auth/logout'),
  me: () => apiRequest<{ user: UserDto }>('GET', '/auth/me'),

  listGuilds: () => apiRequest<{ guilds: GuildDto[] }>('GET', '/guilds'),
  createGuild: (name: string) =>
    apiRequest<{ guild: GuildDto; channels: ChannelDto[] }>('POST', '/guilds', { name }),
  getGuild: (guildId: string) => apiRequest<{ guild: GuildDto }>('GET', `/guilds/${enc(guildId)}`),
  leaveGuild: (guildId: string) => apiRequest<void>('POST', `/guilds/${enc(guildId)}/leave`),
  deleteGuild: (guildId: string, name: string) =>
    apiRequest<void>('DELETE', `/guilds/${enc(guildId)}`, { name }),
  listMembers: (guildId: string) =>
    apiRequest<{ members: MemberDto[] }>('GET', `/guilds/${enc(guildId)}/members`),

  invitePreview: (code: string) => apiRequest<InvitePreviewDto>('GET', `/invites/${enc(code)}`),
  joinInvite: (code: string) =>
    apiRequest<{ guild: GuildDto }>('POST', `/invites/${enc(code)}/join`),

  listChannels: (guildId: string) =>
    apiRequest<{ channels: ChannelDto[] }>('GET', `/guilds/${enc(guildId)}/channels`),
  createChannel: (guildId: string, name: string, kind: ChannelKind = 'text') =>
    apiRequest<{ channel: ChannelDto }>('POST', `/guilds/${enc(guildId)}/channels`, {
      name,
      kind,
    }),
  voiceState: (guildId: string) =>
    apiRequest<{ channels: Record<string, VoicePeerDto[]> }>(
      'GET',
      `/guilds/${enc(guildId)}/voice`,
    ),
  iceServers: () => apiRequest<{ iceServers: RTCIceServer[] }>('GET', '/voice/ice-servers'),
  reportTurnUsage: (bytes: number) => apiRequest<void>('POST', '/voice/turn-usage', { bytes }),
  turnUsage: () => apiRequest<TurnUsageDto>('GET', '/voice/turn-usage'),

  listMessages: (channelId: string, opts: { before?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.before) q.set('before', opts.before);
    if (opts.limit) q.set('limit', String(opts.limit));
    const qs = q.toString();
    return apiRequest<{ messages: MessageDto[]; hasMore: boolean }>(
      'GET',
      `/channels/${enc(channelId)}/messages${qs ? `?${qs}` : ''}`,
    );
  },
  sendMessage: (channelId: string, content: string) =>
    apiRequest<{ message: MessageDto }>('POST', `/channels/${enc(channelId)}/messages`, {
      content,
    }),
  editMessage: (messageId: string, content: string) =>
    apiRequest<{ message: MessageDto }>('PATCH', `/messages/${enc(messageId)}`, { content }),
  deleteMessage: (messageId: string) => apiRequest<void>('DELETE', `/messages/${enc(messageId)}`),

  sendVoiceMessage: (channelId: string, audio: Blob, durationMs: number) =>
    apiUpload<{ message: MessageDto }>(
      `/channels/${enc(channelId)}/voice-messages?durationMs=${Math.round(durationMs)}`,
      audio,
      // The server checks the bytes; the type only has to name an audio container.
      audio.type.split(';')[0] || 'audio/webm',
    ),

  pushConfig: () => apiRequest<PushConfigDto>('GET', '/push/config'),
  subscribePush: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
    apiRequest<{ status: string }>('POST', '/push/subscriptions', sub),
  unsubscribePush: (endpoint: string) =>
    apiRequest<void>('DELETE', '/push/subscriptions', { endpoint }),
  testPush: () => apiRequest<{ delivered: number }>('POST', '/push/test'),
  setGuildMuted: (guildId: string, muted: boolean) =>
    apiRequest<{ muted: boolean }>('PUT', `/guilds/${enc(guildId)}/notifications`, { muted }),
};
