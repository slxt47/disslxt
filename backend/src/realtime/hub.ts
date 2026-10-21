import type { WebSocket } from 'ws';
import type { PresenceStatus, WsServerMessage } from '@disslxt/shared';

/** One connected WebSocket (a browser tab). */
export interface Client {
  socket: WebSocket;
  userId: string;
  /** sha256 of the session token that authenticated this socket. */
  sessionHash: string;
  guildIds: Set<string>;
  /** The single channel this socket is subscribed to (if any) and its guild. */
  channel: { id: string; guildId: string } | null;
  isAlive: boolean;
}

/**
 * In-memory realtime hub for a single instance: tracks sockets per user, guild rooms and channel
 * rooms, and per-user connection counts for presence. All operations are O(room size) with no
 * I/O; payloads are serialised once per publish.
 */
export class Hub {
  private readonly socketsByUser = new Map<string, Set<Client>>();
  private readonly guildRooms = new Map<string, Set<Client>>();
  private readonly channelRooms = new Map<string, Set<Client>>();

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
      client.guildIds.delete(guildId);
      removeFrom(this.guildRooms, guildId, client);
      if (client.channel?.guildId === guildId) this.unsubscribe(client);
    }
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
