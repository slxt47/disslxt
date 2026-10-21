import type { ChannelDto, GuildDto, MessageDto, UserDto } from '@disslxt/shared';
import type { Channel, Guild, Message, User } from '../db/schema.js';

export const toUserDto = (u: Pick<User, 'id' | 'email' | 'username'>): UserDto => ({
  id: u.id,
  email: u.email,
  username: u.username,
});

export const toGuildDto = (g: Guild): GuildDto => ({
  id: g.id,
  name: g.name,
  ownerId: g.ownerId,
  inviteCode: g.inviteCode,
  createdAt: g.createdAt.toISOString(),
});

export const toChannelDto = (c: Channel): ChannelDto => ({
  id: c.id,
  guildId: c.guildId,
  name: c.name,
  kind: c.kind === 'voice' ? 'voice' : 'text',
  createdAt: c.createdAt.toISOString(),
});

export const toMessageDto = (m: Message, author: { id: string; username: string }): MessageDto => ({
  id: m.id.toString(),
  channelId: m.channelId,
  author: { id: author.id, username: author.username },
  kind: m.kind === 'voice' || m.kind === 'file' ? m.kind : 'text',
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
  createdAt: m.createdAt.toISOString(),
  editedAt: m.editedAt ? m.editedAt.toISOString() : null,
});
