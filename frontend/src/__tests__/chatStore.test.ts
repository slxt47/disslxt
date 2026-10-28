import { beforeEach, describe, expect, it } from 'vitest';
import type { ChannelDto, GuildDto } from '@disslxt/shared';
import { compareIds, mergeMessages, useChatStore } from '../store/chat';
import { CHANNEL, ME, OTHER, msg } from './fixtures';

const GUILD = '22222222-2222-4222-8222-222222222222';
const guild: GuildDto = {
  id: GUILD,
  name: 'Test',
  ownerId: ME.id,
  iconUrl: null,
  tag: null,
  tagEmoji: null,
  inviteCode: 'abc123',
  createdAt: '2026-10-20T12:00:00.000Z',
};
const general: ChannelDto = {
  id: CHANNEL,
  guildId: GUILD,
  name: 'general',
  kind: 'text',
  createdAt: '2026-10-20T12:00:00.000Z',
};

const ids = () => (useChatStore.getState().messagesByChannel[CHANNEL] ?? []).map((m) => m.id);

describe('chat store', () => {
  beforeEach(() => useChatStore.getState().reset());

  it('compares bigint ids numerically', () => {
    expect(compareIds('9', '10')).toBeLessThan(0);
    expect(compareIds('100', '99')).toBeGreaterThan(0);
    expect(compareIds('42', '42')).toBe(0);
  });

  it('merges by id, deduplicates and sorts ascending', () => {
    const merged = mergeMessages([msg(3), msg(1)], [msg(2), msg(3, { content: 'neu' })]);
    expect(merged.map((m) => m.id)).toEqual(['1', '2', '3']);
    expect(merged[2]?.content).toBe('neu');
  });

  it('does not duplicate the REST response and the WS echo', () => {
    const s = useChatStore.getState();
    s.applyLatestPage(CHANNEL, [msg(1)], false);
    s.upsertMessage(msg(2, { author: ME }));
    s.applyEvent({ type: 'message.created', data: { message: msg(2, { author: ME }) } }, ME.id);
    expect(ids()).toEqual(['1', '2']);
  });

  it('applyLatestPage drops messages deleted while away but keeps older and newer ones', () => {
    const s = useChatStore.getState();
    s.applyLatestPage(CHANNEL, [msg(10), msg(11), msg(12)], true);
    s.prependOlder(CHANNEL, [msg(5), msg(6)], false);
    s.upsertMessage(msg(20)); // arrived via WS after the snapshot
    // Server now says: 11 was deleted, 13 is new.
    s.applyLatestPage(CHANNEL, [msg(10), msg(12), msg(13)], true);
    expect(ids()).toEqual(['5', '6', '10', '12', '13', '20']);
    // Older pages were kept, so hasMore stays as it was after prependOlder.
    expect(useChatStore.getState().hasMoreByChannel[CHANNEL]).toBe(false);
  });

  const range = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => msg(from + i));
  const hasMore = () => useChatStore.getState().hasMoreByChannel[CHANNEL];

  it('D1: a page that does not reach the cache replaces it and takes its hasMore', () => {
    const s = useChatStore.getState();
    s.applyLatestPage(CHANNEL, range(1, 3), false);
    // 55 messages (4–58) arrived while away; the newest page is 9–58 with hasMore.
    s.applyLatestPage(CHANNEL, range(9, 58), true);
    expect(ids()).toEqual(range(9, 58).map((m) => m.id));
    expect(hasMore()).toBe(true);
    // "Load older" then fetches 1–8 without a gap.
    s.prependOlder(CHANNEL, range(1, 8), false);
    expect(ids()).toEqual(range(1, 58).map((m) => m.id));
    expect(hasMore()).toBe(false);
  });

  it('D1: a gap is detected even when a WS message newer than the page is cached', () => {
    const s = useChatStore.getState();
    s.applyLatestPage(CHANNEL, range(1, 3), false);
    s.upsertMessage(msg(60)); // arrived via WS before the refetch returned
    s.applyLatestPage(CHANNEL, range(10, 59), true);
    expect(ids()).toEqual([...range(10, 59), msg(60)].map((m) => m.id));
    expect(hasMore()).toBe(true);
  });

  it('D1: stale edits of cached older messages do not survive a gap', () => {
    const s = useChatStore.getState();
    // Message 10 is cached with old content; it was edited on the server while away.
    s.applyLatestPage(
      CHANNEL,
      [...range(1, 9), msg(10, { content: 'alt' }), ...range(11, 20)],
      false,
    );
    s.applyLatestPage(CHANNEL, range(120, 169), true);
    const list = useChatStore.getState().messagesByChannel[CHANNEL] ?? [];
    expect(list.some((m) => m.content === 'alt')).toBe(false);
    expect(list[0]?.id).toBe('120');
  });

  it('D1: an overlapping page keeps paged-in history and its hasMore', () => {
    const s = useChatStore.getState();
    s.applyLatestPage(CHANNEL, range(51, 100), true);
    s.prependOlder(CHANNEL, range(1, 50), false);
    s.applyLatestPage(CHANNEL, range(61, 110), true); // 10 new messages, overlaps 61–100
    expect(ids()).toEqual(range(1, 110).map((m) => m.id));
    expect(hasMore()).toBe(false);
  });

  it('D1: without hasMore, cached messages older than the page were deleted', () => {
    const s = useChatStore.getState();
    s.applyLatestPage(CHANNEL, range(1, 5), false);
    s.applyLatestPage(CHANNEL, range(3, 7), false); // 1 and 2 deleted, 6 and 7 new
    expect(ids()).toEqual(['3', '4', '5', '6', '7']);
    expect(hasMore()).toBe(false);
  });

  it('D1: replace drops all cached older messages (channel re-opened)', () => {
    const s = useChatStore.getState();
    s.applyLatestPage(CHANNEL, range(51, 100), true);
    s.prependOlder(CHANNEL, range(1, 50), false);
    s.upsertMessage(msg(101));
    s.applyLatestPage(CHANNEL, range(52, 100), true, { replace: true });
    expect(ids()).toEqual(range(52, 101).map((m) => m.id));
    expect(hasMore()).toBe(true);
  });

  it('prependOlder adds older messages and updates hasMore', () => {
    const s = useChatStore.getState();
    s.applyLatestPage(CHANNEL, [msg(51), msg(52)], true);
    s.prependOlder(CHANNEL, [msg(1), msg(2)], false);
    expect(ids()).toEqual(['1', '2', '51', '52']);
    expect(useChatStore.getState().hasMoreByChannel[CHANNEL]).toBe(false);
  });

  it('reduces message.updated and message.deleted events', () => {
    const s = useChatStore.getState();
    s.applyLatestPage(CHANNEL, [msg(1), msg(2)], false);
    s.applyEvent(
      {
        type: 'message.updated',
        data: { message: msg(1, { content: 'edit', editedAt: '2026-10-20T12:01:00.000Z' }) },
      },
      ME.id,
    );
    s.applyEvent({ type: 'message.deleted', data: { id: '2', channelId: CHANNEL } }, ME.id);
    const list = useChatStore.getState().messagesByChannel[CHANNEL];
    expect(list?.map((m) => [m.id, m.content, !!m.editedAt])).toEqual([['1', 'edit', true]]);
  });

  it('ignores message events for channels that were never opened', () => {
    useChatStore
      .getState()
      .applyEvent({ type: 'message.created', data: { message: msg(1) } }, ME.id);
    expect(useChatStore.getState().messagesByChannel[CHANNEL]).toBeUndefined();
  });

  it('adds channels from channel.created once', () => {
    const s = useChatStore.getState();
    s.setChannels(GUILD, [general]);
    const ch: ChannelDto = { ...general, id: '33333333-3333-4333-8333-333333333333', name: 'dev' };
    s.applyEvent({ type: 'channel.created', data: { channel: ch } }, ME.id);
    s.applyEvent({ type: 'channel.created', data: { channel: ch } }, ME.id);
    expect(useChatStore.getState().channelsByGuild[GUILD]?.map((c) => c.name)).toEqual([
      'general',
      'dev',
    ]);
  });

  it('handles member.joined, presence.update and member.left', () => {
    const s = useChatStore.getState();
    s.setMembers(GUILD, [
      { userId: ME.id, username: ME.username, displayName: null, avatarUrl: null, online: true },
    ]);
    s.applyEvent(
      {
        type: 'member.joined',
        data: {
          guildId: GUILD,
          member: {
            userId: OTHER.id,
            username: 'bob',
            displayName: null,
            avatarUrl: null,
            online: false,
          },
        },
      },
      ME.id,
    );
    s.applyEvent(
      { type: 'presence.update', data: { guildId: GUILD, userId: OTHER.id, status: 'online' } },
      ME.id,
    );
    let members = useChatStore.getState().membersByGuild[GUILD];
    expect(members?.find((m) => m.userId === OTHER.id)?.online).toBe(true);

    s.applyEvent(
      { type: 'presence.update', data: { guildId: GUILD, userId: OTHER.id, status: 'offline' } },
      ME.id,
    );
    members = useChatStore.getState().membersByGuild[GUILD];
    expect(members?.find((m) => m.userId === OTHER.id)?.online).toBe(false);

    s.applyEvent({ type: 'member.left', data: { guildId: GUILD, userId: OTHER.id } }, ME.id);
    expect(useChatStore.getState().membersByGuild[GUILD]?.map((m) => m.username)).toEqual([
      'alice',
    ]);
  });

  it('removes the guild when the current user left it (e.g. from another tab)', () => {
    const s = useChatStore.getState();
    s.setGuilds([guild]);
    s.setChannels(GUILD, [general]);
    s.applyEvent({ type: 'member.left', data: { guildId: GUILD, userId: ME.id } }, ME.id);
    expect(useChatStore.getState().guilds).toEqual([]);
    expect(useChatStore.getState().channelsByGuild[GUILD]).toBeUndefined();
  });

  it('tracks the confirmed subscription and clears it when the connection drops', () => {
    const s = useChatStore.getState();
    s.setConnection('open');
    s.applyEvent({ type: 'subscribed', data: { channelId: CHANNEL } }, ME.id);
    expect(useChatStore.getState().subscribedChannelId).toBe(CHANNEL);
    s.setConnection('reconnecting');
    expect(useChatStore.getState().subscribedChannelId).toBeNull();
  });
});
