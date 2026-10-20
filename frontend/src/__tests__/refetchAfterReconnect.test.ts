import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/endpoints';
import { activeView, refetchAfterReconnect } from '../realtime/RealtimeProvider';
import { useChatStore } from '../store/chat';
import { CHANNEL, msg } from './fixtures';

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => msg(from + i));

describe('refetchAfterReconnect (D1)', () => {
  beforeEach(() => {
    useChatStore.getState().reset();
    vi.restoreAllMocks();
    activeView.guildId = null;
    activeView.channelId = CHANNEL;
  });

  it('more than one page missed while offline: no gap, load-older available', async () => {
    useChatStore.getState().applyLatestPage(CHANNEL, range(1, 3), false);
    vi.spyOn(api, 'listGuilds').mockResolvedValue({ guilds: [] });
    vi.spyOn(api, 'listMessages').mockResolvedValue({ messages: range(9, 58), hasMore: true });

    await refetchAfterReconnect();

    const s = useChatStore.getState();
    expect(s.messagesByChannel[CHANNEL]?.map((m) => m.id)).toEqual(range(9, 58).map((m) => m.id));
    expect(s.hasMoreByChannel[CHANNEL]).toBe(true);
  });
});
