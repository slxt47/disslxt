import { useCallback, useEffect, useState } from 'react';
import type { ChannelDto } from '@chat-mvp/shared';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import { useRealtime } from '../realtime/RealtimeProvider';
import { useAuthStore } from '../store/auth';
import { useChatStore } from '../store/chat';
import { Composer } from './Composer';
import { ConnectionBanner } from './ConnectionBanner';
import { MessageList } from './MessageList';

const EMPTY: never[] = [];

export interface ChatViewProps {
  channel: ChannelDto;
  onOpenMenu: () => void;
}

export function ChatView({ channel, onOpenMenu }: ChatViewProps) {
  const channelId = channel.id;
  const realtime = useRealtime();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const messages = useChatStore((s) => s.messagesByChannel[channelId] ?? EMPTY);
  const hasMore = useChatStore((s) => s.hasMoreByChannel[channelId] ?? false);
  const subscribed = useChatStore((s) => s.subscribedChannelId === channelId);
  const [loading, setLoading] = useState(true);

  const loadLatest = useCallback(
    async (replace = false) => {
      try {
        const page = await api.listMessages(channelId);
        useChatStore.getState().applyLatestPage(channelId, page.messages, page.hasMore, {
          replace,
        });
      } catch (err) {
        useChatStore.getState().setError(errorMessage(err));
      }
    },
    [channelId],
  );

  // Open the channel: subscribe and load the newest page. The cache from an earlier visit may be
  // stale (missed messages, edits, deletes), so the page replaces it.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadLatest(true).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [loadLatest]);

  useEffect(() => {
    if (!realtime) return;
    realtime.setActiveChannel(channelId);
    return () => realtime.setActiveChannel(null);
  }, [realtime, channelId]);

  // Once the subscription is confirmed, refetch to close the gap between the first page and the
  // moment events started flowing.
  useEffect(() => {
    if (subscribed) void loadLatest();
  }, [subscribed, loadLatest]);

  const onLoadOlder = useCallback(async () => {
    const oldest = useChatStore.getState().messagesByChannel[channelId]?.[0];
    if (!oldest) return;
    const page = await api.listMessages(channelId, { before: oldest.id });
    useChatStore.getState().prependOlder(channelId, page.messages, page.hasMore);
  }, [channelId]);

  const onSend = useCallback(
    async (content: string) => {
      const { message } = await api.sendMessage(channelId, content);
      useChatStore.getState().upsertMessage(message);
    },
    [channelId],
  );

  const onEdit = useCallback(async (id: string, content: string) => {
    const { message } = await api.editMessage(id, content);
    useChatStore.getState().upsertMessage(message);
  }, []);

  const onDelete = useCallback(
    async (id: string) => {
      await api.deleteMessage(id);
      useChatStore.getState().removeMessage(channelId, id);
    },
    [channelId],
  );

  return (
    <section className="chat-view" aria-label={`Kanal #${channel.name}`}>
      <header className="chat-header">
        <button
          className="icon-btn mobile-only"
          data-testid="mobile-menu-button"
          aria-label="Menü öffnen"
          onClick={onOpenMenu}
        >
          ☰
        </button>
        <h1 className="chat-title" data-testid="channel-title">
          <span aria-hidden="true">#</span> {channel.name}
        </h1>
      </header>
      <ConnectionBanner />
      <MessageList
        channelId={channelId}
        messages={messages}
        hasMore={hasMore}
        currentUserId={userId}
        loading={loading}
        subscribed={subscribed}
        onLoadOlder={onLoadOlder}
        onEdit={onEdit}
        onDelete={onDelete}
      />
      <Composer key={channelId} channelName={channel.name} onSend={onSend} />
    </section>
  );
}
