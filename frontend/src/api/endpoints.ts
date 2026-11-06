import type {
  CategoryDto,
  CreatePollInput,
  EventDto,
  PollDto,
  RsvpAnswer,
  ScheduleInput,
  ScheduledDto,
  StatusEntryDto,
  WebhookDto,
  ChannelDto,
  ChannelKind,
  DmChannelDto,
  FriendDto,
  AdminUserDto,
  BadgeDto,
  GifDto,
  MyBadgesDto,
  ProfileDto,
  UserRole,
  VoicePeerDto,
  GuildBanDto,
  GuildDto,
  GuildRolesDto,
  InvitePreviewDto,
  InviteSettingsInput,
  LoginResultDto,
  MemberDto,
  MessageDto,
  PushConfigDto,
  ReactionDto,
  RoleDto,
  RoleInput,
  SearchResultDto,
  SessionDto,
  TurnUsageDto,
  TwoFactorSetupDto,
  TwoFactorStatusDto,
  UnreadDto,
  UpdateChannelInput,
  UserDto,
} from '@disslxt/shared';
import { apiRequest, apiUpload, apiUploadWithProgress } from './client';

const enc = encodeURIComponent;

export interface SearchParams {
  q: string;
  guildId?: string;
  channelId?: string;
  privateOnly?: boolean;
  authorId?: string;
  after?: string;
  until?: string;
  beforeId?: string;
}

export const api = {
  register: (input: { email: string; username: string; password: string; next?: string }) =>
    apiRequest<{ status: 'verification_sent' }>('POST', '/auth/register', input),
  verifyEmail: (token: string) =>
    apiRequest<{ user: UserDto; next: string | null }>('POST', '/auth/verify-email', { token }),
  resendVerification: (email: string) =>
    apiRequest<{ status: 'verification_sent' }>('POST', '/auth/resend-verification', { email }),
  login: (input: { email: string; password: string }) =>
    apiRequest<LoginResultDto>('POST', '/auth/login', input),
  loginTwoFactor: (ticket: string, code: string) =>
    apiRequest<{ user: UserDto }>('POST', '/auth/login/two-factor', { ticket, code }),
  twoFactorStatus: () => apiRequest<TwoFactorStatusDto>('GET', '/account/two-factor'),
  twoFactorSetup: (password: string) =>
    apiRequest<TwoFactorSetupDto>('POST', '/account/two-factor/setup', { password }),
  twoFactorEnable: (code: string) =>
    apiRequest<{ recoveryCodes: string[] }>('POST', '/account/two-factor/enable', { code }),
  twoFactorDisable: (password: string, code: string) =>
    apiRequest<void>('POST', '/account/two-factor/disable', { password, code }),
  twoFactorRecoveryCodes: (password: string, code: string) =>
    apiRequest<{ recoveryCodes: string[] }>('POST', '/account/two-factor/recovery-codes', {
      password,
      code,
    }),
  listSessions: () => apiRequest<{ sessions: SessionDto[] }>('GET', '/account/sessions'),
  endSession: (id: string) => apiRequest<void>('DELETE', `/account/sessions/${enc(id)}`),
  endOtherSessions: () => apiRequest<{ ended: number }>('POST', '/account/sessions/end-others'),
  logout: () => apiRequest<void>('POST', '/auth/logout'),
  forgotPassword: (email: string) =>
    apiRequest<{ status: 'reset_sent' }>('POST', '/auth/forgot-password', { email }),
  resetPassword: (token: string, password: string) =>
    apiRequest<{ user: UserDto } | { signIn: true }>('POST', '/auth/reset-password', {
      token,
      password,
    }),
  adminStorage: () =>
    apiRequest<{ usedBytes: number; limitBytes: number }>('GET', '/admin/storage'),
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
  listThread: (messageId: string) =>
    apiRequest<{ replies: MessageDto[] }>('GET', `/messages/${enc(messageId)}/thread`),
  sendMessage: (channelId: string, content: string, replyToId?: string, threadRootId?: string) =>
    apiRequest<{ message: MessageDto }>('POST', `/channels/${enc(channelId)}/messages`, {
      content,
      ...(replyToId ? { replyToId } : {}),
      ...(threadRootId ? { threadRootId } : {}),
    }),
  search: (params: SearchParams) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) q.set(key, String(value));
    return apiRequest<{ results: SearchResultDto[] }>('GET', `/search?${q.toString()}`);
  },
  listWebhooks: (channelId: string) =>
    apiRequest<{ webhooks: WebhookDto[] }>('GET', `/channels/${enc(channelId)}/webhooks`),
  createWebhook: (channelId: string, name: string) =>
    apiRequest<{ webhook: WebhookDto; token: string }>(
      'POST',
      `/channels/${enc(channelId)}/webhooks`,
      {
        name,
      },
    ),
  deleteWebhook: (channelId: string, id: string) =>
    apiRequest<void>('DELETE', `/channels/${enc(channelId)}/webhooks/${enc(id)}`),
  statusBoard: () => apiRequest<{ entries: StatusEntryDto[] }>('GET', '/admin/status'),
  schedule: (channelId: string, input: ScheduleInput) =>
    apiRequest<{ scheduled: ScheduledDto }>('POST', `/channels/${enc(channelId)}/scheduled`, input),
  listScheduled: () => apiRequest<{ scheduled: ScheduledDto[] }>('GET', '/scheduled'),
  cancelScheduled: (id: string) => apiRequest<void>('DELETE', `/scheduled/${enc(id)}`),
  createEvent: (channelId: string, title: string, startsAt: string) =>
    apiRequest<{ message: MessageDto }>('POST', `/channels/${enc(channelId)}/events`, {
      title,
      startsAt,
    }),
  rsvp: (messageId: string, answer: RsvpAnswer | null) =>
    apiRequest<{ event: EventDto }>('POST', `/messages/${enc(messageId)}/rsvp`, { answer }),
  createPoll: (channelId: string, input: CreatePollInput) =>
    apiRequest<{ message: MessageDto }>('POST', `/channels/${enc(channelId)}/polls`, input),
  vote: (messageId: string, option: number) =>
    apiRequest<{ poll: PollDto }>('POST', `/messages/${enc(messageId)}/vote`, { option }),
  hidePreview: (messageId: string) =>
    apiRequest<{ message: MessageDto }>('POST', `/messages/${enc(messageId)}/hide-preview`),
  toggleReaction: (messageId: string, emoji: string) =>
    apiRequest<{ reactions: ReactionDto[] }>('POST', `/messages/${enc(messageId)}/reactions`, {
      emoji,
    }),
  setPinned: (messageId: string, pinned: boolean) =>
    apiRequest<{ message: MessageDto }>('POST', `/messages/${enc(messageId)}/pin`, { pinned }),
  listPins: (channelId: string) =>
    apiRequest<{ messages: MessageDto[] }>('GET', `/channels/${enc(channelId)}/pins`),
  unread: () => apiRequest<{ unread: UnreadDto[] }>('GET', '/unread'),
  markRead: (channelId: string, messageId: string) =>
    apiRequest<void>('POST', `/channels/${enc(channelId)}/read`, { messageId }),
  listRoles: (guildId: string) => apiRequest<GuildRolesDto>('GET', `/guilds/${enc(guildId)}/roles`),
  createRole: (guildId: string, input: RoleInput) =>
    apiRequest<{ role: RoleDto }>('POST', `/guilds/${enc(guildId)}/roles`, input),
  updateRole: (guildId: string, roleId: string, patch: Partial<RoleInput>) =>
    apiRequest<{ role: RoleDto }>('PATCH', `/guilds/${enc(guildId)}/roles/${enc(roleId)}`, patch),
  deleteRole: (guildId: string, roleId: string) =>
    apiRequest<void>('DELETE', `/guilds/${enc(guildId)}/roles/${enc(roleId)}`),
  orderRoles: (guildId: string, roleIds: string[]) =>
    apiRequest<void>('PUT', `/guilds/${enc(guildId)}/roles/order`, { roleIds }),
  setMemberRoles: (guildId: string, userId: string, roleIds: string[]) =>
    apiRequest<void>('PUT', `/guilds/${enc(guildId)}/members/${enc(userId)}/roles`, { roleIds }),
  kickMember: (guildId: string, userId: string) =>
    apiRequest<void>('DELETE', `/guilds/${enc(guildId)}/members/${enc(userId)}`),
  banMember: (guildId: string, userId: string) =>
    apiRequest<void>('POST', `/guilds/${enc(guildId)}/bans`, { userId }),
  unbanMember: (guildId: string, userId: string) =>
    apiRequest<void>('DELETE', `/guilds/${enc(guildId)}/bans/${enc(userId)}`),
  listBans: (guildId: string) =>
    apiRequest<{ bans: GuildBanDto[] }>('GET', `/guilds/${enc(guildId)}/bans`),
  updateChannel: (channelId: string, patch: UpdateChannelInput) =>
    apiRequest<{ channel: ChannelDto }>('PATCH', `/channels/${enc(channelId)}`, patch),
  deleteChannel: (channelId: string, name: string) =>
    apiRequest<void>('DELETE', `/channels/${enc(channelId)}`, { name }),
  orderChannels: (guildId: string, channels: { id: string; categoryId: string | null }[]) =>
    apiRequest<void>('PUT', `/guilds/${enc(guildId)}/channels/order`, { channels }),
  listCategories: (guildId: string) =>
    apiRequest<{ categories: CategoryDto[] }>('GET', `/guilds/${enc(guildId)}/categories`),
  createCategory: (guildId: string, name: string) =>
    apiRequest<{ category: CategoryDto }>('POST', `/guilds/${enc(guildId)}/categories`, { name }),
  deleteCategory: (guildId: string, categoryId: string) =>
    apiRequest<void>('DELETE', `/guilds/${enc(guildId)}/categories/${enc(categoryId)}`),
  orderCategories: (guildId: string, categoryIds: string[]) =>
    apiRequest<void>('PUT', `/guilds/${enc(guildId)}/categories/order`, { categoryIds }),
  channelAccess: (channelId: string) =>
    apiRequest<{ roleIds: string[] }>('GET', `/channels/${enc(channelId)}/access`),
  setChannelAccess: (channelId: string, restricted: boolean, roleIds: string[]) =>
    apiRequest<void>('PUT', `/channels/${enc(channelId)}/access`, { restricted, roleIds }),
  updateInvite: (guildId: string, settings: InviteSettingsInput) =>
    apiRequest<{ guild: GuildDto }>('POST', `/guilds/${enc(guildId)}/invite`, settings),
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

  sendFile: (
    channelId: string,
    file: File,
    onProgress: (f: number) => void,
    signal?: AbortSignal,
  ) =>
    apiUploadWithProgress<{ message: MessageDto }>(
      `/channels/${enc(channelId)}/files?name=${enc(file.name)}`,
      file,
      onProgress,
      signal,
    ),

  updateProfile: (patch: {
    displayName?: string | null;
    statusEmoji?: string | null;
    statusText?: string | null;
    tagGuildId?: string | null;
  }) => apiRequest<{ user: UserDto }>('PATCH', '/users/me', patch),
  uploadAvatar: (image: Blob) =>
    apiUpload<{ user: UserDto }>('/users/me/avatar', image, 'application/octet-stream', 'PUT'),
  removeAvatar: () => apiRequest<{ user: UserDto }>('DELETE', '/users/me/avatar'),
  getProfile: (userId: string) =>
    apiRequest<{ profile: ProfileDto }>('GET', `/users/${enc(userId)}/profile`),
  badgeCatalogue: () => apiRequest<{ badges: BadgeDto[] }>('GET', '/badges'),
  myBadges: () => apiRequest<MyBadgesDto>('GET', '/users/me/badges'),
  setBadges: (badgeIds: string[]) =>
    apiRequest<{ user: UserDto }>('PUT', '/users/me/badges', { badgeIds }),
  adminUsers: () => apiRequest<{ users: AdminUserDto[] }>('GET', '/admin/users'),
  adminKick: (userId: string) => apiRequest<void>('POST', `/admin/users/${enc(userId)}/kick`),
  adminSetRole: (userId: string, role: Exclude<UserRole, 'owner'>) =>
    apiRequest<void>('PUT', `/admin/users/${enc(userId)}/role`, { role }),
  deleteAccount: (password: string) => apiRequest<void>('DELETE', '/users/me', { password }),

  updateGuild: (
    guildId: string,
    patch: { name?: string; tag?: string; tagEmoji?: string | null },
  ) => apiRequest<{ guild: GuildDto }>('PATCH', `/guilds/${enc(guildId)}`, patch),
  uploadGuildIcon: (guildId: string, image: Blob) =>
    apiUpload<{ guild: GuildDto }>(
      `/guilds/${enc(guildId)}/icon`,
      image,
      'application/octet-stream',
      'PUT',
    ),
  removeGuildIcon: (guildId: string) =>
    apiRequest<{ guild: GuildDto }>('DELETE', `/guilds/${enc(guildId)}/icon`),

  listFriends: () => apiRequest<{ friends: FriendDto[] }>('GET', '/friends'),
  requestFriend: (username: string) =>
    apiRequest<{ friend: FriendDto }>('POST', '/friends/requests', { username }),
  acceptFriend: (userId: string) =>
    apiRequest<{ friend: FriendDto }>('POST', `/friends/${enc(userId)}/accept`),
  removeFriend: (userId: string) => apiRequest<void>('DELETE', `/friends/${enc(userId)}`),
  listDms: () => apiRequest<{ dms: DmChannelDto[] }>('GET', '/dms'),
  openDm: (userId: string) => apiRequest<{ dm: DmChannelDto }>('POST', '/dms', { userId }),
  createGroup: (userIds: string[], name?: string) =>
    apiRequest<{ dm: DmChannelDto }>('POST', '/groups', { userIds, ...(name ? { name } : {}) }),
  renameGroup: (channelId: string, name: string) =>
    apiRequest<{ dm: DmChannelDto }>('PATCH', `/groups/${enc(channelId)}`, { name }),
  addGroupMember: (channelId: string, userId: string) =>
    apiRequest<{ dm: DmChannelDto }>('POST', `/groups/${enc(channelId)}/members`, { userId }),
  /** `userId` 'me' leaves the group. */
  removeGroupMember: (channelId: string, userId: string) =>
    apiRequest<void>('DELETE', `/groups/${enc(channelId)}/members/${enc(userId)}`),

  gifStatus: () => apiRequest<{ enabled: boolean }>('GET', '/gifs/status'),
  searchGifs: (q: string, offset = 0) =>
    apiRequest<{ gifs: GifDto[] }>(
      'GET',
      `/gifs/search?${new URLSearchParams({ ...(q ? { q } : {}), offset: String(offset) }).toString()}`,
    ),
  sendGif: (channelId: string, id: string) =>
    apiRequest<{ message: MessageDto }>('POST', `/channels/${enc(channelId)}/gifs`, { id }),

  callPeers: (channelId: string) =>
    apiRequest<{ peers: VoicePeerDto[] }>('GET', `/dms/${enc(channelId)}/call`),

  pushConfig: () => apiRequest<PushConfigDto>('GET', '/push/config'),
  subscribePush: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
    apiRequest<{ status: string }>('POST', '/push/subscriptions', sub),
  unsubscribePush: (endpoint: string) =>
    apiRequest<void>('DELETE', '/push/subscriptions', { endpoint }),
  testPush: () => apiRequest<{ delivered: number }>('POST', '/push/test'),
  setGuildMuted: (guildId: string, muted: boolean) =>
    apiRequest<{ muted: boolean }>('PUT', `/guilds/${enc(guildId)}/notifications`, { muted }),
};
