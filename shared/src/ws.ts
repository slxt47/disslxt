import { z } from 'zod';
import type { ChannelDto, MemberDto, MessageDto } from './types.js';

export const wsClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('subscribe'), data: z.object({ channelId: z.guid() }) }),
  z.object({ type: z.literal('unsubscribe'), data: z.object({ channelId: z.guid() }) }),
  z.object({ type: z.literal('ping'), data: z.unknown().optional() }),
  // Whether the tab is in the foreground; a visible tab on a channel gets no push for it.
  z.object({ type: z.literal('visibility'), data: z.object({ visible: z.boolean() }) }),
]);
export type WsClientMessage = z.infer<typeof wsClientMessageSchema>;

export type PresenceStatus = 'online' | 'offline';

export type WsServerMessage =
  | { type: 'ready'; data: { userId: string } }
  | { type: 'subscribed'; data: { channelId: string } }
  | { type: 'unsubscribed'; data: { channelId: string } }
  | { type: 'pong' }
  | {
      type: 'error';
      data: {
        code: 'FORBIDDEN' | 'NOT_FOUND' | 'BAD_REQUEST';
        channelId?: string;
        message?: string;
      };
    }
  | { type: 'message.created'; data: { message: MessageDto } }
  | { type: 'message.updated'; data: { message: MessageDto } }
  | { type: 'message.deleted'; data: { id: string; channelId: string } }
  | {
      type: 'presence.update';
      data: { guildId: string; userId: string; status: PresenceStatus };
    }
  | { type: 'member.joined'; data: { guildId: string; member: MemberDto } }
  | { type: 'member.left'; data: { guildId: string; userId: string } }
  | { type: 'channel.created'; data: { channel: ChannelDto } };

export type WsServerMessageType = WsServerMessage['type'];
