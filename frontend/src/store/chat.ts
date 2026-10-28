import { create } from 'zustand';
import type {
  ChannelDto,
  DmChannelDto,
  FriendDto,
  GuildDto,
  MemberDto,
  MessageDto,
  PublicUserDto,
  WsServerMessage,
} from '@disslxt/shared';
import { nameOf } from '../profile';
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
    return nameOf(a).localeCompare(nameOf(b));
  });
}

/** Newest activity first. */
function sortDms(dms: DmChannelDto[]): DmChannelDto[] {
  return [...dms].sort((a, b) =>
    (b.lastMessageAt ?? b.channel.createdAt).localeCompare(a.lastMessageAt ?? a.channel.createdAt),
  );
}

const FRIEND_ORDER = { incoming: 0, friend: 1, outgoing: 2 } as const;
function sortFriends(friends: FriendDto[]): FriendDto[] {
  return [...friends].sort(
    (a, b) =>
      FRIEND_ORDER[a.status] - FRIEND_ORDER[b.status] ||
      nameOf(a.user).localeCompare(nameOf(b.user)),
  );
}

/** Applies a changed profile wherever the person appears. */
function withProfile<T extends { id: string; username: string }>(u: T, p: PublicUserDto): T {
  return u.id === p.id ? { ...u, displayName: p.displayName, avatarUrl: p.avatarUrl } : u;
}

export interface ChatState {
  guilds: GuildDto[];
  guildsLoaded: boolean;
  channelsByGuild: Record<string, ChannelDto[]>;
  messagesByChannel: Record<string, MessageDto[]>;
  hasMoreByChannel: Record<string, boolean>;
  membersByGuild: Record<string, MemberDto[]>;
  /** Friends and open friend requests. */
  friends: FriendDto[];
  friendsLoaded: boolean;
  /** Private conversations, newest activity first. */
  dms: DmChannelDto[];
  dmsLoaded: boolean;
  /** Unread messages per private conversation (since this tab was opened). */
  unreadDms: Record<string, number>;
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
  setFriends: (friends: FriendDto[]) => void;
  upsertFriend: (friend: FriendDto) => void;
  removeFriend: (userId: string) => void;
  setDms: (dms: DmChannelDto[]) => void;
  upsertDm: (dm: DmChannelDto) => void;
  removeDm: (channelId: string) => void;
  /** New message in a private conversation: moves it up, optionally counting it as unread. */
  bumpDm: (channelId: string, at: string, unread: boolean) => void;
  markDmRead: (channelId: string) => void;
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
  friends: [] as FriendDto[],
  friendsLoaded: false,
  dms: [] as DmChannelDto[],
  dmsLoaded: false,
  unreadDms: {} as Record<string, number>,
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
      const guildId = channel.guildId;
      if (!guildId) return {};
      const list = s.channelsByGuild[guildId];
      if (!list) return {};
      if (list.some((c) => c.id === channel.id)) return {};
      return { channelsByGuild: { ...s.channelsByGuild, [guildId]: [...list, channel] } };
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

  setFriends: (friends) => set({ friends: sortFriends(friends), friendsLoaded: true }),

  upsertFriend: (friend) =>
    set((s) => ({
      friends: sortFriends([...s.friends.filter((f) => f.user.id !== friend.user.id), friend]),
    })),

  removeFriend: (userId) =>
    set((s) => ({ friends: s.friends.filter((f) => f.user.id !== userId) })),

  setDms: (dms) => set({ dms: sortDms(dms), dmsLoaded: true }),

  upsertDm: (dm) =>
    set((s) => ({
      dms: sortDms([...s.dms.filter((d) => d.channel.id !== dm.channel.id), dm]),
    })),

  removeDm: (channelId) =>
    set((s) => {
      const unreadDms = { ...s.unreadDms };
      delete unreadDms[channelId];
      return { dms: s.dms.filter((d) => d.channel.id !== channelId), unreadDms };
    }),

  bumpDm: (channelId, at, unread) =>
    set((s) => {
      if (!s.dms.some((d) => d.channel.id === channelId)) return {};
      return {
        dms: sortDms(
          s.dms.map((d) => (d.channel.id === channelId ? { ...d, lastMessageAt: at } : d)),
        ),
        unreadDms: unread
          ? { ...s.unreadDms, [channelId]: (s.unreadDms[channelId] ?? 0) + 1 }
          : s.unreadDms,
      };
    }),

  markDmRead: (channelId) =>
    set((s) => {
      if (!s.unreadDms[channelId]) return {};
      const unreadDms = { ...s.unreadDms };
      delete unreadDms[channelId];
      return { unreadDms };
    }),

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
      case 'guild.updated':
        if (s.guilds.some((g) => g.id === event.data.guild.id)) s.upsertGuild(event.data.guild);
        return;
      case 'user.updated': {
        const p = event.data.user;
        const membersByGuild: Record<string, MemberDto[]> = {};
        for (const [g, list] of Object.entries(s.membersByGuild)) {
          membersByGuild[g] = list.map((m) =>
            m.userId === p.id ? { ...m, displayName: p.displayName, avatarUrl: p.avatarUrl } : m,
          );
        }
        const messagesByChannel: Record<string, MessageDto[]> = {};
        for (const [c, list] of Object.entries(s.messagesByChannel)) {
          messagesByChannel[c] = list.some((m) => m.author.id === p.id)
            ? list.map((m) =>
                m.author.id === p.id ? { ...m, author: withProfile(m.author, p) } : m,
              )
            : list;
        }
        set({
          membersByGuild,
          messagesByChannel,
          dms: s.dms.map((d) => ({
            ...d,
            peer: withProfile(d.peer, p),
            members: d.members.map((m) => withProfile(m, p)),
          })),
          friends: s.friends.map((f) => ({ ...f, user: withProfile(f.user, p) })),
        });
        return;
      }
      case 'friend.updated':
        s.upsertFriend(event.data.friend);
        return;
      case 'friend.removed':
        s.removeFriend(event.data.userId);
        return;
      case 'friend.presence': {
        const { userId, online } = event.data;
        set({
          friends: s.friends.map((f) => (f.user.id === userId ? { ...f, online } : f)),
          // A conversation is "online" when anyone else in it is; for groups that needs the
          // others' state, which only the server knows for non-friends – keep it for those.
          dms: s.dms.map((d) =>
            d.channel.kind === 'dm' && d.peer.id === userId ? { ...d, online } : d,
          ),
        });
        return;
      }
      case 'dm.updated':
        s.upsertDm(event.data.dm);
        return;
      case 'dm.removed':
        s.removeDm(event.data.channelId);
        return;
      case 'guild.deleted':
        s.removeGuild(event.data.guildId);
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
