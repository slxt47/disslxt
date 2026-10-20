import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api/endpoints';
import { useAuthStore } from '../store/auth';
import { useChatStore } from '../store/chat';
import { RealtimeClient } from './socket';

const RealtimeContext = createContext<RealtimeClient | null>(null);

export function useRealtime(): RealtimeClient | null {
  return useContext(RealtimeContext);
}

/** Channel/guild currently shown; read by the reconnect handler to refetch the right data. */
export const activeView: { guildId: string | null; channelId: string | null } = {
  guildId: null,
  channelId: null,
};

/** Refetches guilds, the active guild's channels + members and the active channel's newest page. */
export async function refetchAfterReconnect(): Promise<void> {
  const chat = useChatStore.getState();
  const { guildId, channelId } = activeView;
  const tasks: Promise<unknown>[] = [api.listGuilds().then((r) => chat.setGuilds(r.guilds))];
  if (guildId) {
    tasks.push(api.listChannels(guildId).then((r) => chat.setChannels(guildId, r.channels)));
    tasks.push(api.listMembers(guildId).then((r) => chat.setMembers(guildId, r.members)));
  }
  if (channelId) {
    tasks.push(
      api
        .listMessages(channelId)
        .then((r) => chat.applyLatestPage(channelId, r.messages, r.hasMore)),
    );
  }
  await Promise.allSettled(tasks);
}

/** Owns the tab's single WebSocket while a user is logged in. */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [client, setClient] = useState<RealtimeClient | null>(null);

  useEffect(() => {
    if (!userId) return;
    const c = new RealtimeClient();
    const chat = useChatStore.getState();
    const offEvent = c.onEvent((ev) => useChatStore.getState().applyEvent(ev, userId));
    const offStatus = c.onStatus((status) => {
      chat.setConnection(status);
      if (status === 'unauthorized') useAuthStore.getState().setGuest();
    });
    const offReady = c.onReady(({ reconnect }) => {
      if (reconnect) void refetchAfterReconnect();
    });
    c.start();
    setClient(c);
    return () => {
      offEvent();
      offStatus();
      offReady();
      c.stop();
      setClient(null);
    };
  }, [userId]);

  return <RealtimeContext.Provider value={client}>{children}</RealtimeContext.Provider>;
}
