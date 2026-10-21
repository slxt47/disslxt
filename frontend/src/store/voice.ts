import { create } from 'zustand';
import type { VoicePeerDto } from '@disslxt/shared';

export type PeerConnection = RTCPeerConnectionState | 'new';

export interface VoicePeerState extends VoicePeerDto {
  connection: PeerConnection;
  speaking: boolean;
}

export interface VoiceState {
  /** Voice channel this tab is in (or joining). */
  channelId: string | null;
  guildId: string | null;
  status: 'idle' | 'joining' | 'connected';
  selfPeerId: string | null;
  muted: boolean;
  selfSpeaking: boolean;
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
  selfSpeaking: false,
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
