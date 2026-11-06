import type {
  ChannelDto,
  GifDto,
  GuildDto,
  MessageDto,
  MessageRefDto,
  ReactionDto,
  PublicUserDto,
  UserDto,
  UserRole,
} from '@disslxt/shared';
import { users, type Channel, type Guild, type Message, type User } from '../db/schema.js';

/** The key changes with every upload, so the URL changes too and caches never show an old one. */
export const avatarUrl = (userId: string, key: string | null): string | null =>
  key ? `/api/users/${userId}/avatar?v=${key.slice(0, 12)}` : null;

export const guildIconUrl = (guildId: string, key: string | null): string | null =>
  key ? `/api/guilds/${guildId}/icon?v=${key.slice(0, 12)}` : null;

/** The user columns every public profile needs (spread into selects). */
export const profileColumns = {
  id: users.id,
  username: users.username,
  displayName: users.displayName,
  avatarKey: users.avatarKey,
  role: users.role,
  shownBadges: users.shownBadges,
  statusEmoji: users.statusEmoji,
  statusText: users.statusText,
  tagGuildId: users.tagGuildId,
  tagText: users.tagText,
  tagEmoji: users.tagEmoji,
};

export type ProfileRow = Pick<
  User,
  | 'id'
  | 'username'
  | 'displayName'
  | 'avatarKey'
  | 'role'
  | 'shownBadges'
  | 'statusEmoji'
  | 'statusText'
  | 'tagGuildId'
  | 'tagText'
  | 'tagEmoji'
>;

export const toRole = (r: string): UserRole => (r === 'owner' || r === 'admin' ? r : 'user');

export const toPublicUser = (u: ProfileRow): PublicUserDto => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  avatarUrl: avatarUrl(u.id, u.avatarKey),
  role: toRole(u.role),
  badges: u.shownBadges,
  tag:
    u.tagGuildId && u.tagText
      ? { guildId: u.tagGuildId, text: u.tagText, emoji: u.tagEmoji }
      : null,
  status: u.statusEmoji || u.statusText ? { emoji: u.statusEmoji, text: u.statusText } : null,
});

export const toUserDto = (u: ProfileRow & Pick<User, 'email'>): UserDto => ({
  ...toPublicUser(u),
  email: u.email,
});

export const toGuildDto = (g: Guild): GuildDto => ({
  id: g.id,
  name: g.name,
  ownerId: g.ownerId,
  inviteCode: g.inviteCode,
  iconUrl: guildIconUrl(g.id, g.iconKey),
  tag: g.tag,
  tagEmoji: g.tagEmoji,
  inviteExpiresAt: g.inviteExpiresAt ? g.inviteExpiresAt.toISOString() : null,
  inviteMaxUses: g.inviteMaxUses,
  inviteUses: g.inviteUses,
  createdAt: g.createdAt.toISOString(),
});

export const toChannelDto = (c: Channel): ChannelDto => ({
  id: c.id,
  guildId: c.guildId,
  name: c.name,
  kind: c.kind === 'voice' || c.kind === 'dm' || c.kind === 'group' ? c.kind : 'text',
  restricted: c.restricted,
  description: c.description,
  categoryId: c.categoryId,
  position: c.position,
  createdAt: c.createdAt.toISOString(),
});

/** Embedded straight from GIPHY's CDN (their terms: embed, do not copy). */
export const giphyGif = (id: string, width: number, height: number, title: string): GifDto => ({
  id,
  mp4: `https://media.giphy.com/media/${id}/giphy.mp4`,
  webp: `https://media.giphy.com/media/${id}/200w.webp`,
  width,
  height,
  title,
});

const toKind = (kind: string): MessageDto['kind'] =>
  kind === 'voice' || kind === 'file' || kind === 'gif' || kind === 'join' ? kind : 'text';

const EXCERPT_MAX = 120;

export const toMessageRef = (
  m: Pick<Message, 'id' | 'kind' | 'content'>,
  author: Pick<PublicUserDto, 'id' | 'username' | 'displayName'>,
): MessageRefDto => ({
  id: m.id.toString(),
  author: { id: author.id, username: author.username, displayName: author.displayName },
  kind: toKind(m.kind),
  excerpt: m.kind === 'text' ? [...m.content].slice(0, EXCERPT_MAX).join('') : '',
});

export const toMessageDto = (
  m: Message,
  author: PublicUserDto,
  extras: { reactions?: ReactionDto[]; replyTo?: MessageRefDto | null } = {},
): MessageDto => ({
  id: m.id.toString(),
  channelId: m.channelId,
  author: {
    id: author.id,
    username: author.username,
    displayName: author.displayName,
    avatarUrl: author.avatarUrl,
    role: author.role ?? 'user',
    badges: author.badges ?? [],
    tag: author.tag ?? null,
    status: author.status ?? null,
  },
  kind: toKind(m.kind),
  content: m.content,
  audio:
    m.kind === 'voice' && m.audioKey
      ? {
          url: `/api/voice-messages/${m.id.toString()}`,
          durationMs: m.audioDurationMs ?? 0,
          mime: m.audioMime ?? 'audio/mp4',
        }
      : null,
  file:
    m.kind === 'file' && m.fileKey
      ? {
          url: `/api/files/${m.id.toString()}`,
          name: m.fileName ?? 'datei',
          size: m.fileSize ?? 0,
          isImage: (m.fileMime ?? '').startsWith('image/'),
        }
      : null,
  gif:
    m.kind === 'gif' && m.gifId
      ? giphyGif(m.gifId, m.gifWidth ?? 200, m.gifHeight ?? 200, m.content)
      : null,
  reactions: extras.reactions ?? [],
  replyTo: extras.replyTo ?? null,
  pinnedAt: m.pinnedAt ? m.pinnedAt.toISOString() : null,
  createdAt: m.createdAt.toISOString(),
  editedAt: m.editedAt ? m.editedAt.toISOString() : null,
});
