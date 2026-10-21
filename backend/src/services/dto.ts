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
  createdAt: c.createdAt.toISOString(),
});

export const toMessageDto = (m: Message, author: { id: string; username: string }): MessageDto => ({
  id: m.id.toString(),
  channelId: m.channelId,
  author: { id: author.id, username: author.username },
  kind: m.kind === 'voice' ? 'voice' : 'text',
  content: m.content,
  audio:
    m.kind === 'voice' && m.audioKey
      ? {
          url: `/api/voice-messages/${m.id.toString()}`,
          durationMs: m.audioDurationMs ?? 0,
          mime: m.audioMime ?? 'audio/mp4',
        }
      : null,
  createdAt: m.createdAt.toISOString(),
  editedAt: m.editedAt ? m.editedAt.toISOString() : null,
});
