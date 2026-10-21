import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { WsServerMessage } from '@disslxt/shared';
import { api } from '../api/endpoints';
import { speak, spokenText } from '../speech/tts';
import { usePrefs } from '../store/prefs';
import { useAuthStore } from '../store/auth';
import { useChatStore } from '../store/chat';
import { RealtimeClient } from './socket';
import { loadVoiceState } from '../voice/voiceState';

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
    tasks.push(
      api.listChannels(guildId).then(async (r) => {
        chat.setChannels(guildId, r.channels);
        const voiceIds = r.channels.filter((c) => c.kind === 'voice').map((c) => c.id);
        if (voiceIds.length > 0) await loadVoiceState(guildId, voiceIds);
      }),
    );
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

/** Reads new messages of others in the open channel aloud, if switched on in the settings. */
export function autoRead(ev: WsServerMessage, selfId: string): void {
  if (ev.type !== 'message.created') return;
  const { message } = ev.data;
  const prefs = usePrefs.getState();
  if (!prefs.autoRead || message.author.id === selfId) return;
  if (message.channelId !== activeView.channelId) return;
  speak(spokenText(message), { rate: prefs.speechRate });
}

/** Owns the tab's single WebSocket while a user is logged in. */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [client, setClient] = useState<RealtimeClient | null>(null);

  useEffect(() => {
    if (!userId) return;
    const c = new RealtimeClient();
    const chat = useChatStore.getState();
    const offEvent = c.onEvent((ev) => {
      useChatStore.getState().applyEvent(ev, userId);
      autoRead(ev, userId);
    });
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
