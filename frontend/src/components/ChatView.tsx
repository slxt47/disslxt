import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ChannelDto } from '@disslxt/shared';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import { useRealtime } from '../realtime/RealtimeProvider';
import { useAuthStore } from '../store/auth';
import { useChatStore } from '../store/chat';
import { Composer } from './Composer';
import { ConnectionBanner } from './ConnectionBanner';
import { Icon } from './Icon';
import { MessageList } from './MessageList';
import { UploadQueue, useUploads } from './UploadQueue';

const EMPTY: never[] = [];

export interface ChatViewProps {
  channel: ChannelDto;
  onOpenMenu: () => void;
  /** Member list shown next to the chat; the header button toggles it. */
  membersOpen?: boolean;
  onToggleMembers?: () => void;
  /** Private conversation: shown instead of "# name" (e.g. the friend's picture and name). */
  title?: ReactNode;
  /** Who messages go to, e.g. "@Bob" (default "#channel"). */
  target?: string;
  /** Extra buttons in the header (e.g. call). */
  headerActions?: ReactNode;
  /** Between header and messages (e.g. an ongoing call). */
  top?: ReactNode;
}

export function ChatView({
  channel,
  onOpenMenu,
  membersOpen,
  onToggleMembers,
  title,
  target = `#${channel.name}`,
  headerActions,
  top,
}: ChatViewProps) {
  const channelId = channel.id;
  const realtime = useRealtime();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const messages = useChatStore((s) => s.messagesByChannel[channelId] ?? EMPTY);
  const hasMore = useChatStore((s) => s.hasMoreByChannel[channelId] ?? false);
  const subscribed = useChatStore((s) => s.subscribedChannelId === channelId);
  const [loading, setLoading] = useState(true);
  const { uploads, start: startUploads, remove: removeUpload } = useUploads(channelId);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

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

  const onSendVoice = useCallback(
    async (audio: Blob, durationMs: number) => {
      const { message } = await api.sendVoiceMessage(channelId, audio, durationMs);
      useChatStore.getState().upsertMessage(message);
    },
    [channelId],
  );

  const onSendGif = useCallback(
    async (gif: { id: string }) => {
      const { message } = await api.sendGif(channelId, gif.id);
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
    <section
      className={`chat-view${dragging ? ' dragging' : ''}`}
      aria-label={channel.kind === 'dm' ? `Unterhaltung mit ${target}` : `Kanal #${channel.name}`}
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        startUploads([...e.dataTransfer.files]);
      }}
    >
      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <Icon name="paperclip" size={32} />
          <span>Loslassen, um mit {target} zu teilen</span>
        </div>
      )}
      <header className="chat-header">
        <button
          className="icon-btn mobile-only"
          data-testid="mobile-menu-button"
          aria-label="Menü öffnen"
          onClick={onOpenMenu}
        >
          <Icon name="menu" />
        </button>
        <h1 className="chat-title" data-testid="channel-title">
          {title ?? (
            <>
              <Icon name="hash" size={18} />
              <span className="sr-only">#</span>
              {channel.name}
            </>
          )}
        </h1>
        {(onToggleMembers || headerActions) && (
          <div className="chat-header-actions">
            {headerActions}
            {onToggleMembers && (
              <button
                className={`icon-btn wide-only${membersOpen ? ' active' : ''}`}
                data-testid="toggle-members"
                aria-pressed={!!membersOpen}
                aria-label={membersOpen ? 'Mitglieder ausblenden' : 'Mitglieder anzeigen'}
                title={membersOpen ? 'Mitglieder ausblenden' : 'Mitglieder anzeigen'}
                onClick={onToggleMembers}
              >
                <Icon name="users" size={20} />
              </button>
            )}
          </div>
        )}
      </header>
      <ConnectionBanner />
      {top}
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
      <UploadQueue uploads={uploads} onRemove={removeUpload} />
      <Composer
        key={channelId}
        onAttachFiles={startUploads}
        channelName={channel.name}
        target={target}
        onSend={onSend}
        onSendVoice={onSendVoice}
        onSendGif={onSendGif}
      />
    </section>
  );
}
