import { randomBytes } from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  VOICE_CHANNEL_MAX_PARTICIPANTS,
  type PresenceStatus,
  type VoicePeerDto,
  type VoiceSignal,
  type WsServerMessage,
} from '@disslxt/shared';

/** One connected WebSocket (a browser tab). */
export interface Client {
  socket: WebSocket;
  userId: string;
  username: string;
  /** sha256 of the session token that authenticated this socket. */
  sessionHash: string;
  guildIds: Set<string>;
  /** The single channel this socket is subscribed to (if any) and its guild. */
  channel: { id: string; guildId: string } | null;
  /** The tab is in the foreground (reported by the client; assumed until told otherwise). */
  visible: boolean;
  /** Live voice channel this socket takes part in. */
  voice: { channelId: string; guildId: string; peerId: string; muted: boolean } | null;
  isAlive: boolean;
}

export type VoiceJoinResult = { ok: true; first: boolean } | { ok: false; code: 'VOICE_FULL' };

/**
 * In-memory realtime hub for a single instance: tracks sockets per user, guild rooms and channel
 * rooms, and per-user connection counts for presence. All operations are O(room size) with no
 * I/O; payloads are serialised once per publish.
 */
export class Hub {
  private readonly socketsByUser = new Map<string, Set<Client>>();
  private readonly guildRooms = new Map<string, Set<Client>>();
  private readonly channelRooms = new Map<string, Set<Client>>();
  /** channelId → peerId → socket */
  private readonly voiceRooms = new Map<string, Map<string, Client>>();

  get clientCount(): number {
    let n = 0;
    for (const set of this.socketsByUser.values()) n += set.size;
    return n;
  }

  allClients(): Client[] {
    const out: Client[] = [];
    for (const set of this.socketsByUser.values()) out.push(...set);
    return out;
  }

  isOnline(userId: string): boolean {
    return (this.socketsByUser.get(userId)?.size ?? 0) > 0;
  }

  /** True if one of the user's tabs shows this channel in the foreground (no push needed). */
  isViewingChannel(userId: string, channelId: string): boolean {
    for (const client of this.socketsByUser.get(userId) ?? []) {
      if (client.visible && client.channel?.id === channelId) return true;
    }
    return false;
  }

  /** Registers a socket and joins it to the given guild rooms. Broadcasts presence on 0→1. */
  addClient(client: Client): void {
    let set = this.socketsByUser.get(client.userId);
    const first = !set || set.size === 0;
    if (!set) {
      set = new Set();
      this.socketsByUser.set(client.userId, set);
    }
    set.add(client);
    for (const guildId of client.guildIds) addTo(this.guildRooms, guildId, client);
    if (first) this.broadcastPresence(client.userId, client.guildIds, 'online');
  }

  /** Removes a socket from all rooms. Broadcasts presence offline on 1→0. */
  removeClient(client: Client): void {
    const set = this.socketsByUser.get(client.userId);
    if (!set || !set.delete(client)) return;
    this.leaveVoice(client, 'left');
    for (const guildId of client.guildIds) removeFrom(this.guildRooms, guildId, client);
    if (client.channel) removeFrom(this.channelRooms, client.channel.id, client);
    client.channel = null;
    if (set.size === 0) {
      this.socketsByUser.delete(client.userId);
      this.broadcastPresence(client.userId, client.guildIds, 'offline');
    }
  }

  /** Subscribes a socket to one channel, dropping any previous subscription. */
  subscribe(client: Client, channelId: string, guildId: string): void {
    if (client.channel?.id === channelId) return;
    this.unsubscribe(client);
    client.channel = { id: channelId, guildId };
    addTo(this.channelRooms, channelId, client);
  }

  unsubscribe(client: Client, channelId?: string): void {
    if (!client.channel) return;
    if (channelId !== undefined && client.channel.id !== channelId) return;
    removeFrom(this.channelRooms, client.channel.id, client);
    client.channel = null;
  }

  publishToChannel(channelId: string, msg: WsServerMessage): void {
    sendAll(this.channelRooms.get(channelId), msg);
  }

  publishToGuild(guildId: string, msg: WsServerMessage): void {
    sendAll(this.guildRooms.get(guildId), msg);
  }

  /** After a user joined a guild: add all of their sockets to the guild room. */
  addUserToGuild(userId: string, guildId: string): void {
    for (const client of this.socketsByUser.get(userId) ?? []) {
      client.guildIds.add(guildId);
      addTo(this.guildRooms, guildId, client);
    }
  }

  /** After a user left a guild: drop their sockets from the guild room and its channel rooms. */
  removeUserFromGuild(userId: string, guildId: string): void {
    for (const client of this.socketsByUser.get(userId) ?? []) {
      if (client.voice?.guildId === guildId) this.leaveVoice(client, 'left');
      client.guildIds.delete(guildId);
      removeFrom(this.guildRooms, guildId, client);
      if (client.channel?.guildId === guildId) this.unsubscribe(client);
    }
  }

  // --- Live voice ------------------------------------------------------------------------------

  voicePeers(channelId: string): VoicePeerDto[] {
    return [...(this.voiceRooms.get(channelId)?.values() ?? [])].map(peerDto);
  }

  /** Participants of every voice channel of a guild that is not empty. */
  voiceStateForGuild(guildId: string): Record<string, VoicePeerDto[]> {
    const out: Record<string, VoicePeerDto[]> = {};
    for (const [channelId, room] of this.voiceRooms) {
      const first = room.values().next().value;
      if (first?.voice?.guildId === guildId) out[channelId] = [...room.values()].map(peerDto);
    }
    return out;
  }

  /**
   * Puts a socket into a voice channel. A person is in at most one voice channel on one device:
   * the socket leaves its previous channel, and other sockets of the same user are moved out.
   * The joiner learns who is there and starts the WebRTC offers to them.
   */
  joinVoice(client: Client, channel: { id: string; guildId: string }): VoiceJoinResult {
    if (client.voice) this.leaveVoice(client, 'left');
    for (const other of this.socketsByUser.get(client.userId) ?? []) {
      if (other !== client && other.voice) this.leaveVoice(other, 'other-device');
    }
    let room = this.voiceRooms.get(channel.id);
    if ((room?.size ?? 0) >= VOICE_CHANNEL_MAX_PARTICIPANTS)
      return { ok: false, code: 'VOICE_FULL' };
    if (!room) {
      room = new Map();
      this.voiceRooms.set(channel.id, room);
    }
    const peerId = randomBytes(12).toString('base64url');
    const existing = [...room.values()];
    client.voice = { channelId: channel.id, guildId: channel.guildId, peerId, muted: false };
    room.set(peerId, client);

    sendTo(client, {
      type: 'voice.joined',
      data: { channelId: channel.id, peerId, peers: existing.map(peerDto) },
    });
    const joined: WsServerMessage = {
      type: 'voice.peer-joined',
      data: { channelId: channel.id, peer: peerDto(client) },
    };
    for (const peer of existing) sendTo(peer, joined);
    this.broadcastVoiceState(channel.guildId, channel.id);
    return { ok: true, first: existing.length === 0 };
  }

  leaveVoice(client: Client, reason: 'left' | 'other-device'): void {
    const voice = client.voice;
    if (!voice) return;
    client.voice = null;
    const room = this.voiceRooms.get(voice.channelId);
    room?.delete(voice.peerId);
    if (room && room.size === 0) this.voiceRooms.delete(voice.channelId);
    const left: WsServerMessage = {
      type: 'voice.peer-left',
      data: { channelId: voice.channelId, peerId: voice.peerId },
    };
    for (const peer of room?.values() ?? []) sendTo(peer, left);
    sendTo(client, { type: 'voice.left', data: { channelId: voice.channelId, reason } });
    this.broadcastVoiceState(voice.guildId, voice.channelId);
  }

  setVoiceMuted(client: Client, muted: boolean): void {
    const voice = client.voice;
    if (!voice || voice.muted === muted) return;
    voice.muted = muted;
    const msg: WsServerMessage = {
      type: 'voice.peer-muted',
      data: { channelId: voice.channelId, peerId: voice.peerId, muted },
    };
    for (const peer of this.voiceRooms.get(voice.channelId)?.values() ?? []) {
      if (peer !== client) sendTo(peer, msg);
    }
    this.broadcastVoiceState(voice.guildId, voice.channelId);
  }

  /** Relays SDP/ICE to another participant of the same channel. False if there is no such peer. */
  relaySignal(client: Client, to: string, signal: VoiceSignal): boolean {
    const voice = client.voice;
    if (!voice || to === voice.peerId) return false;
    const target = this.voiceRooms.get(voice.channelId)?.get(to);
    if (!target) return false;
    sendTo(target, { type: 'voice.signal', data: { from: voice.peerId, signal } });
    return true;
  }

  private broadcastVoiceState(guildId: string, channelId: string): void {
    this.publishToGuild(guildId, {
      type: 'voice.state',
      data: { guildId, channelId, peers: this.voicePeers(channelId) },
    });
  }

  /** Closes every socket authenticated by the given session (used on logout). */
  closeSession(sessionHash: string, code: number, reason: string): void {
    for (const client of this.allClients()) {
      if (client.sessionHash === sessionHash) client.socket.close(code, reason);
    }
  }

  private broadcastPresence(userId: string, guildIds: Iterable<string>, status: PresenceStatus) {
    for (const guildId of guildIds) {
      this.publishToGuild(guildId, { type: 'presence.update', data: { guildId, userId, status } });
    }
  }
}

function peerDto(client: Client): VoicePeerDto {
  return {
    peerId: client.voice?.peerId ?? '',
    userId: client.userId,
    username: client.username,
    muted: client.voice?.muted ?? false,
  };
}

function addTo(map: Map<string, Set<Client>>, key: string, client: Client): void {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(client);
}

function removeFrom(map: Map<string, Set<Client>>, key: string, client: Client): void {
  const set = map.get(key);
  if (!set) return;
  set.delete(client);
  if (set.size === 0) map.delete(key);
}

const OPEN = 1;

function sendAll(clients: Set<Client> | undefined, msg: WsServerMessage): void {
  if (!clients || clients.size === 0) return;
  const payload = JSON.stringify(msg);
  for (const client of clients) {
    if (client.socket.readyState === OPEN) client.socket.send(payload);
  }
}

export function sendTo(client: Client, msg: WsServerMessage): void {
  if (client.socket.readyState === OPEN) client.socket.send(JSON.stringify(msg));
}
