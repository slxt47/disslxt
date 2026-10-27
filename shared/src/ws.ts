import { z } from 'zod';
import type { ChannelDto, MemberDto, MessageDto, VoicePeerDto } from './types.js';

/** WebRTC signalling payload relayed between two peers of a voice channel. */
export const voiceSignalSchema = z.discriminatedUnion('type', [
  z.object({ type: z.enum(['offer', 'answer']), sdp: z.string().min(1).max(12_000) }),
  z.object({
    type: z.literal('candidate'),
    candidate: z.object({
      candidate: z.string().max(1024),
      sdpMid: z.string().max(64).nullable().optional(),
      sdpMLineIndex: z.number().int().min(0).max(64).nullable().optional(),
      usernameFragment: z.string().max(256).nullable().optional(),
    }),
  }),
]);
export type VoiceSignal = z.infer<typeof voiceSignalSchema>;
const peerIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,32}$/);

export const wsClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('subscribe'), data: z.object({ channelId: z.guid() }) }),
  z.object({ type: z.literal('unsubscribe'), data: z.object({ channelId: z.guid() }) }),
  z.object({ type: z.literal('ping'), data: z.unknown().optional() }),
  // Whether the tab is in the foreground; a visible tab on a channel gets no push for it.
  z.object({ type: z.literal('visibility'), data: z.object({ visible: z.boolean() }) }),
  z.object({ type: z.literal('voice.join'), data: z.object({ channelId: z.guid() }) }),
  z.object({ type: z.literal('voice.leave'), data: z.unknown().optional() }),
  z.object({ type: z.literal('voice.mute'), data: z.object({ muted: z.boolean() }) }),
  z.object({
    type: z.literal('voice.signal'),
    data: z.object({ to: peerIdSchema, signal: voiceSignalSchema }),
  }),
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
        code: 'FORBIDDEN' | 'NOT_FOUND' | 'BAD_REQUEST' | 'VOICE_FULL' | 'RATE_LIMITED';
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
  | { type: 'channel.created'; data: { channel: ChannelDto } }
  /** The owner deleted the guild; it is gone for every member. */
  | { type: 'guild.deleted'; data: { guildId: string } }
  /** To the joining socket: its peer id and who is already there (it sends the offers). */
  | { type: 'voice.joined'; data: { channelId: string; peerId: string; peers: VoicePeerDto[] } }
  /** To this socket: it is no longer in the channel (left, or joined from another device). */
  | { type: 'voice.left'; data: { channelId: string; reason: 'left' | 'other-device' } }
  | { type: 'voice.peer-joined'; data: { channelId: string; peer: VoicePeerDto } }
  | { type: 'voice.peer-left'; data: { channelId: string; peerId: string } }
  | { type: 'voice.peer-muted'; data: { channelId: string; peerId: string; muted: boolean } }
  | { type: 'voice.signal'; data: { from: string; signal: VoiceSignal } }
  /** To the whole guild: who is in which voice channel (for the channel list). */
  | { type: 'voice.state'; data: { guildId: string; channelId: string; peers: VoicePeerDto[] } };

export type WsServerMessageType = WsServerMessage['type'];
