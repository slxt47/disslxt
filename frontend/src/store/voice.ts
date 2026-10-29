import { create } from 'zustand';
import type { PublicUserDto, VoicePeerDto } from '@disslxt/shared';

export type PeerConnection = RTCPeerConnectionState | 'new';

export interface VoicePeerState extends VoicePeerDto {
  connection: PeerConnection;
  speaking: boolean;
}

export interface VoiceState {
  /** Voice channel (or private call) this tab is in (or joining). */
  channelId: string | null;
  /** Null in a call of a private conversation. */
  guildId: string | null;
  status: 'idle' | 'joining' | 'connected';
  selfPeerId: string | null;
  muted: boolean;
  /** Own camera is on; its picture for the preview. */
  video: boolean;
  localVideo: MediaStream | null;
  selfSpeaking: boolean;
  /** Remote audio+video per participant (for the video tiles). */
  streams: Record<string, MediaStream>;
  /** A friend is calling (private conversation), shown until answered, declined or ended. */
  incoming: { channelId: string; from: PublicUserDto; video: boolean; group: string | null } | null;
  /** Other participants of the channel this tab is in, with their WebRTC state. */
  peers: Record<string, VoicePeerState>;
  /** Everyone in every voice channel of the loaded guilds (for the channel list). */
  participants: Record<string, VoicePeerDto[]>;
  error: string | null;
}

const initial: VoiceState = {
  channelId: null,
  guildId: null,
  status: 'idle',
  selfPeerId: null,
  muted: false,
  video: false,
  localVideo: null,
  selfSpeaking: false,
  streams: {},
  incoming: null,
  peers: {},
  participants: {},
  error: null,
};

export const useVoiceStore = create<VoiceState>()(() => initial);

export function patchPeer(peerId: string, patch: Partial<VoicePeerState>): void {
  useVoiceStore.setState((s) => {
    const peer = s.peers[peerId];
    if (!peer) return {};
    return { peers: { ...s.peers, [peerId]: { ...peer, ...patch } } };
  });
}

export function resetVoiceStore(): void {
  useVoiceStore.setState(initial);
}
