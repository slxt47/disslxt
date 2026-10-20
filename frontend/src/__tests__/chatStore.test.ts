import { beforeEach, describe, expect, it } from 'vitest';
import type { ChannelDto, GuildDto } from '@chat-mvp/shared';
import { compareIds, mergeMessages, useChatStore } from '../store/chat';
import { CHANNEL, ME, OTHER, msg } from './fixtures';

const GUILD = '22222222-2222-4222-8222-222222222222';
const guild: GuildDto = {
  id: GUILD,
  name: 'Test',
  ownerId: ME.id,
  inviteCode: 'abc123',
  createdAt: '2026-10-20T12:00:00.000Z',
};
const general: ChannelDto = {
  id: CHANNEL,
  guildId: GUILD,
  name: 'general',
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
    s.setMembers(GUILD, [{ userId: ME.id, username: ME.username, online: true }]);
    s.applyEvent(
      {
        type: 'member.joined',
        data: { guildId: GUILD, member: { userId: OTHER.id, username: 'bob', online: false } },
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
