import { create } from 'zustand';
import type { ChannelDto, GuildDto, MemberDto, MessageDto, WsServerMessage } from '@disslxt/shared';
import type { ConnectionStatus } from '../realtime/socket';

/** Compares decimal bigint ids without BigInt (ids have no leading zeros). */
export function compareIds(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Merges messages by id (incoming wins) and sorts ascending. */
export function mergeMessages(existing: MessageDto[], incoming: MessageDto[]): MessageDto[] {
  const byId = new Map<string, MessageDto>();
  for (const m of existing) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => compareIds(a.id, b.id));
}

function sortMembers(members: MemberDto[]): MemberDto[] {
  return [...members].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.username.localeCompare(b.username);
  });
}

export interface ChatState {
  guilds: GuildDto[];
  guildsLoaded: boolean;
  channelsByGuild: Record<string, ChannelDto[]>;
  messagesByChannel: Record<string, MessageDto[]>;
  hasMoreByChannel: Record<string, boolean>;
  membersByGuild: Record<string, MemberDto[]>;
  connection: ConnectionStatus;
  /** Channel whose WS subscription the server has confirmed. */
  subscribedChannelId: string | null;
  /** Last user-facing error (shown as a toast). */
  error: string | null;

  setGuilds: (guilds: GuildDto[]) => void;
  upsertGuild: (guild: GuildDto) => void;
  removeGuild: (guildId: string) => void;
  setChannels: (guildId: string, channels: ChannelDto[]) => void;
  addChannel: (channel: ChannelDto) => void;
  /** Applies the newest page of a channel: merges it, dropping messages inside the page's id
   *  range that the server no longer returns (deleted while we were away). Cached older messages
   *  are only kept when they connect to the page without a gap; with `replace` (channel opened
   *  again) they are always dropped so no stale edits/deletes survive. */
  applyLatestPage: (
    channelId: string,
    messages: MessageDto[],
    hasMore: boolean,
    opts?: { replace?: boolean },
  ) => void;
  prependOlder: (channelId: string, messages: MessageDto[], hasMore: boolean) => void;
  upsertMessage: (message: MessageDto) => void;
  removeMessage: (channelId: string, messageId: string) => void;
  setMembers: (guildId: string, members: MemberDto[]) => void;
  setConnection: (status: ConnectionStatus) => void;
  setError: (error: string | null) => void;
  /** Reducer for server → client WS events. `selfId` is the current user's id. */
  applyEvent: (event: WsServerMessage, selfId: string | null) => void;
  reset: () => void;
}

const initial = {
  guilds: [] as GuildDto[],
  guildsLoaded: false,
  channelsByGuild: {} as Record<string, ChannelDto[]>,
  messagesByChannel: {} as Record<string, MessageDto[]>,
  hasMoreByChannel: {} as Record<string, boolean>,
  membersByGuild: {} as Record<string, MemberDto[]>,
  connection: 'stopped' as ConnectionStatus,
  subscribedChannelId: null as string | null,
  error: null as string | null,
};

export const useChatStore = create<ChatState>()((set, get) => ({
  ...initial,

  setGuilds: (guilds) => set({ guilds, guildsLoaded: true }),

  upsertGuild: (guild) =>
    set((s) => {
      const exists = s.guilds.some((g) => g.id === guild.id);
      return {
        guilds: exists
          ? s.guilds.map((g) => (g.id === guild.id ? guild : g))
          : [...s.guilds, guild],
      };
    }),

  removeGuild: (guildId) =>
    set((s) => {
      const channelsByGuild = { ...s.channelsByGuild };
      delete channelsByGuild[guildId];
      const membersByGuild = { ...s.membersByGuild };
      delete membersByGuild[guildId];
      return { guilds: s.guilds.filter((g) => g.id !== guildId), channelsByGuild, membersByGuild };
    }),

  setChannels: (guildId, channels) =>
    set((s) => ({ channelsByGuild: { ...s.channelsByGuild, [guildId]: channels } })),

  addChannel: (channel) =>
    set((s) => {
      const list = s.channelsByGuild[channel.guildId];
      if (!list) return {};
      if (list.some((c) => c.id === channel.id)) return {};
      return { channelsByGuild: { ...s.channelsByGuild, [channel.guildId]: [...list, channel] } };
    }),

  applyLatestPage: (channelId, messages, hasMore, opts = {}) =>
    set((s) => {
      const existing = s.messagesByChannel[channelId] ?? [];
      const first = messages[0];
      const last = messages[messages.length - 1];
      let kept = existing;
      let more = hasMore;
      if (first && last) {
        // Newer messages arrived via WS after the snapshot: always keep them.
        const newer = existing.filter((m) => compareIds(m.id, last.id) > 0);
        const older = existing.filter((m) => compareIds(m.id, first.id) < 0);
        // Cached older messages connect to the page only if the cache already holds the page's
        // oldest message (the cache is contiguous). Otherwise there may be unfetched messages in
        // between (e.g. > 1 page missed while away), so they are dropped and "load older" fetches
        // them again. Without hasMore the page reaches back to the channel start, so anything
        // older that is still cached was deleted.
        const contiguous = hasMore && existing.some((m) => m.id === first.id);
        if (opts.replace || !contiguous || older.length === 0) {
          kept = newer;
        } else {
          // Keep older (paged-in) messages and their hasMore.
          kept = [...older, ...newer];
          more = s.hasMoreByChannel[channelId] ?? hasMore;
        }
      }
      return {
        messagesByChannel: { ...s.messagesByChannel, [channelId]: mergeMessages(kept, messages) },
        hasMoreByChannel: { ...s.hasMoreByChannel, [channelId]: more },
      };
    }),

  prependOlder: (channelId, messages, hasMore) =>
    set((s) => ({
      messagesByChannel: {
        ...s.messagesByChannel,
        [channelId]: mergeMessages(s.messagesByChannel[channelId] ?? [], messages),
      },
      hasMoreByChannel: { ...s.hasMoreByChannel, [channelId]: hasMore },
    })),

  upsertMessage: (message) =>
    set((s) => {
      const list = s.messagesByChannel[message.channelId];
      // Only track channels that were opened; others are loaded fresh on open.
      if (!list) return {};
      return {
        messagesByChannel: {
          ...s.messagesByChannel,
          [message.channelId]: mergeMessages(list, [message]),
        },
      };
    }),

  removeMessage: (channelId, messageId) =>
    set((s) => {
      const list = s.messagesByChannel[channelId];
      if (!list) return {};
      return {
        messagesByChannel: {
          ...s.messagesByChannel,
          [channelId]: list.filter((m) => m.id !== messageId),
        },
      };
    }),

  setMembers: (guildId, members) =>
    set((s) => ({ membersByGuild: { ...s.membersByGuild, [guildId]: sortMembers(members) } })),

  setConnection: (connection) =>
    set((s) => ({
      connection,
      subscribedChannelId: connection === 'open' ? s.subscribedChannelId : null,
    })),

  setError: (error) => set({ error }),

  applyEvent: (event, selfId) => {
    const s = get();
    switch (event.type) {
      case 'message.created':
      case 'message.updated':
        s.upsertMessage(event.data.message);
        return;
      case 'message.deleted':
        s.removeMessage(event.data.channelId, event.data.id);
        return;
      case 'subscribed':
        set({ subscribedChannelId: event.data.channelId });
        return;
      case 'unsubscribed':
        if (s.subscribedChannelId === event.data.channelId) set({ subscribedChannelId: null });
        return;
      case 'channel.created':
        s.addChannel(event.data.channel);
        return;
      case 'member.joined': {
        const { guildId, member } = event.data;
        const list = s.membersByGuild[guildId];
        if (!list) return;
        s.setMembers(guildId, [...list.filter((m) => m.userId !== member.userId), member]);
        return;
      }
      case 'member.left': {
        const { guildId, userId } = event.data;
        if (userId === selfId) {
          s.removeGuild(guildId);
          return;
        }
        const list = s.membersByGuild[guildId];
        if (!list) return;
        s.setMembers(
          guildId,
          list.filter((m) => m.userId !== userId),
        );
        return;
      }
      case 'presence.update': {
        const { guildId, userId, status } = event.data;
        const list = s.membersByGuild[guildId];
        if (!list) return;
        s.setMembers(
          guildId,
          list.map((m) => (m.userId === userId ? { ...m, online: status === 'online' } : m)),
        );
        return;
      }
      default:
        return;
    }
  },

  reset: () => set({ ...initial }),
}));
