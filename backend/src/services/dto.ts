import type {
  ChannelDto,
  GifDto,
  GuildDto,
  MessageDto,
  PublicUserDto,
  UserDto,
} from '@disslxt/shared';
import type { Channel, Guild, Message, User } from '../db/schema.js';

/** The key changes with every upload, so the URL changes too and caches never show an old one. */
export const avatarUrl = (userId: string, key: string | null): string | null =>
  key ? `/api/users/${userId}/avatar?v=${key.slice(0, 12)}` : null;

export const guildIconUrl = (guildId: string, key: string | null): string | null =>
  key ? `/api/guilds/${guildId}/icon?v=${key.slice(0, 12)}` : null;

type ProfileRow = Pick<User, 'id' | 'username' | 'displayName' | 'avatarKey'>;

export const toPublicUser = (u: ProfileRow): PublicUserDto => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  avatarUrl: avatarUrl(u.id, u.avatarKey),
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
  createdAt: g.createdAt.toISOString(),
});

export const toChannelDto = (c: Channel): ChannelDto => ({
  id: c.id,
  guildId: c.guildId,
  name: c.name,
  kind: c.kind === 'voice' || c.kind === 'dm' || c.kind === 'group' ? c.kind : 'text',
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

export const toMessageDto = (m: Message, author: PublicUserDto): MessageDto => ({
  id: m.id.toString(),
  channelId: m.channelId,
  author: {
    id: author.id,
    username: author.username,
    displayName: author.displayName,
    avatarUrl: author.avatarUrl,
  },
  kind: m.kind === 'voice' || m.kind === 'file' || m.kind === 'gif' ? m.kind : 'text',
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
  createdAt: m.createdAt.toISOString(),
  editedAt: m.editedAt ? m.editedAt.toISOString() : null,
});
