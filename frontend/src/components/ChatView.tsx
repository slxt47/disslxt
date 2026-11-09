import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ChannelDto, MessageDto } from '@disslxt/shared';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import { useRealtime } from '../realtime/RealtimeProvider';
import { useAuthStore } from '../store/auth';
import { useChatStore } from '../store/chat';
import { typingText, useTypingStore } from '../store/typing';
import { compareIds } from '../store/chat';
import { Composer, type Person } from './Composer';
import { ConnectionBanner } from './ConnectionBanner';
import { Icon } from './Icon';
import { jumpToMessage, MessageList } from './MessageList';
import { PinsPanel } from './PinsPanel';
import { SearchDialog } from './SearchDialog';
import { StatusDialog } from './StatusDialog';
import { ThreadPanel } from './ThreadPanel';
import { UploadQueue, useUploads } from './UploadQueue';

const EMPTY: never[] = [];
const NOBODY: Record<string, string> = {};

/** "Anna schreibt gerade…"; the line keeps its height so the chat does not jump. */
function TypingLine({ channelId }: { channelId: string }) {
  const typing = useTypingStore((s) => s.byChannel[channelId] ?? NOBODY);
  const text = typingText(Object.values(typing));
  return (
    <p className="typing-line" data-testid="typing-line" aria-live="polite">
      {text && (
        <>
          <span className="typing-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {text}
        </>
      )}
    </p>
  );
}

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
  /** Private conversation: who @ can suggest (on a server: its members). */
  people?: Person[];
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
  people,
}: ChatViewProps) {
  const channelId = channel.id;
  const realtime = useRealtime();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const username = useAuthStore((s) => s.user?.username ?? null);
  const members = useChatStore((s) =>
    channel.guildId ? s.membersByGuild[channel.guildId] : undefined,
  );
  const canModerate = useChatStore(
    (s) =>
      !!channel.guildId &&
      !!s.rolesByGuild[channel.guildId]?.myPermissions.includes('manage_messages'),
  );
  const canPin = !channel.guildId || canModerate;
  const roles = useChatStore((s) =>
    channel.guildId ? s.rolesByGuild[channel.guildId]?.roles : undefined,
  );
  const authorColors = useMemo(() => {
    const colors: Record<string, string> = {};
    for (const m of members ?? []) {
      const top = roles?.find((r) => r.color && m.roleIds?.includes(r.id));
      if (top?.color) colors[m.userId] = top.color;
    }
    return colors;
  }, [members, roles]);
  const [replyTo, setReplyTo] = useState<MessageDto | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [pinsOpen, setPinsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [threadRootId, setThreadRootId] = useState<string | null>(null);
  const jumpTarget = useChatStore((s) => s.jumpTarget);
  /** Read state when the channel was opened: the "Neue Nachrichten" line stays until you leave. */
  const [readUpTo, setReadUpTo] = useState<string | null>(null);
  const unreadEntry = useChatStore((s) => s.unread[channelId]);
  const lastSentRead = useRef<string | null>(null);
  const messages = useChatStore((s) => s.messagesByChannel[channelId] ?? EMPTY);
  const hasMore = useChatStore((s) => s.hasMoreByChannel[channelId] ?? false);
  const subscribed = useChatStore((s) => s.subscribedChannelId === channelId);
  const [loading, setLoading] = useState(true);
  const { uploads, start: startUploads, remove: removeUpload } = useUploads(channelId);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  useEffect(() => {
    setReadUpTo(null);
    setReplyTo(null);
    setEditId(null);
    setThreadRootId(null);
    lastSentRead.current = null;
  }, [channelId]);

  const unreadSince = unreadEntry?.lastReadId;
  useEffect(() => {
    if (unreadSince) setReadUpTo((old) => old ?? unreadSince);
  }, [unreadSince]);

  // What you see counts as read: on opening, on new messages and on coming back to the tab.
  const lastMessageId = messages[messages.length - 1]?.id ?? null;
  useEffect(() => {
    if (!lastMessageId) return;
    const mark = () => {
      if (document.visibilityState !== 'visible') return;
      const sent = lastSentRead.current;
      if (sent && compareIds(lastMessageId, sent) <= 0) return;
      lastSentRead.current = lastMessageId;
      useChatStore.getState().clearUnread(channelId);
      api.markRead(channelId, lastMessageId).catch(() => {
        lastSentRead.current = sent;
      });
    };
    const timer = setTimeout(mark, 300);
    document.addEventListener('visibilitychange', mark);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', mark);
    };
  }, [channelId, lastMessageId]);

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

  // Coming from the search: load older pages until the message is there, then go to it.
  useEffect(() => {
    if (loading || jumpTarget?.channelId !== channelId) return;
    const { messageId } = jumpTarget;
    let cancelled = false;
    void (async () => {
      const chat = useChatStore.getState();
      const loaded = () =>
        useChatStore.getState().messagesByChannel[channelId]?.some((m) => m.id === messageId);
      try {
        for (let page = 0; page < 10 && !loaded() && !cancelled; page += 1) {
          const oldest = useChatStore.getState().messagesByChannel[channelId]?.[0];
          if (!oldest || !useChatStore.getState().hasMoreByChannel[channelId]) break;
          const older = await api.listMessages(channelId, { before: oldest.id, limit: 100 });
          chat.prependOlder(channelId, older.messages, older.hasMore);
        }
      } catch (err) {
        chat.setError(errorMessage(err));
      }
      if (cancelled) return;
      chat.setJumpTarget(null);
      if (!loaded()) {
        chat.setError('Diese Nachricht liegt zu weit zurück oder wurde gelöscht.');
        return;
      }
      // After the list has settled at its usual place.
      setTimeout(() => jumpToMessage(messageId), 120);
    })();
    return () => {
      cancelled = true;
    };
  }, [jumpTarget, channelId, loading]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onLoadOlder = useCallback(async () => {
    const oldest = useChatStore.getState().messagesByChannel[channelId]?.[0];
    if (!oldest) return;
    const page = await api.listMessages(channelId, { before: oldest.id });
    useChatStore.getState().prependOlder(channelId, page.messages, page.hasMore);
  }, [channelId]);

  const onSend = useCallback(
    async (content: string) => {
      const { message } = await api.sendMessage(channelId, content, replyTo?.id);
      useChatStore.getState().upsertMessage(message);
      setReplyTo(null);
    },
    [channelId, replyTo],
  );

  const onReact = useCallback(
    async (id: string, emoji: string) => {
      const { reactions } = await api.toggleReaction(id, emoji);
      useChatStore.getState().setReactions(channelId, id, reactions);
    },
    [channelId],
  );

  const onPin = useCallback(async (id: string, pinned: boolean) => {
    const { message } = await api.setPinned(id, pinned);
    useChatStore.getState().upsertMessage(message);
  }, []);

  const onReply = useCallback((message: MessageDto) => {
    setReplyTo(message);
    requestAnimationFrame(() =>
      document.querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]')?.focus(),
    );
  }, []);

  const onThread = useCallback((message: MessageDto) => setThreadRootId(message.id), []);

  const onEditHandled = useCallback(() => setEditId(null), []);

  const onEditLast = useCallback(() => {
    const list = useChatStore.getState().messagesByChannel[channelId] ?? [];
    const own = [...list].reverse().find((m) => m.author.id === userId && m.kind === 'text');
    if (own) setEditId(own.id);
  }, [channelId, userId]);

  const onTyping = useCallback(() => {
    realtime?.send({ type: 'typing', data: { channelId } });
  }, [realtime, channelId]);

  const onSendVoice = useCallback(
    async (audio: Blob, durationMs: number) => {
      const { message } = await api.sendVoiceMessage(channelId, audio, durationMs);
      useChatStore.getState().upsertMessage(message);
    },
    [channelId],
  );

  const onSendPoll = useCallback(
    async (poll: { question: string; options: string[] }) => {
      const { message } = await api.createPoll(channelId, { ...poll, multiple: false });
      useChatStore.getState().upsertMessage(message);
    },
    [channelId],
  );

  const onSendEvent = useCallback(
    async (event: { title: string; startsAt: string }) => {
      const { message } = await api.createEvent(channelId, event.title, event.startsAt);
      useChatStore.getState().upsertMessage(message);
    },
    [channelId],
  );

  const onSchedule = useCallback(
    async (item: { kind: 'send' | 'remind'; content: string; sendAt: string }) => {
      await api.schedule(channelId, item);
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

  const threadRoot = threadRootId ? (messages.find((m) => m.id === threadRootId) ?? null) : null;

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
          {channel.description && (
            <span className="chat-description" data-testid="channel-description">
              {channel.description}
            </span>
          )}
        </h1>
        <div className="chat-header-actions">
          {headerActions}
          <button
            className="icon-btn"
            data-testid="search-button"
            aria-label="Suchen"
            title="Suchen (Strg+Shift+F)"
            onClick={() => setSearchOpen(true)}
          >
            <Icon name="search" size={20} />
          </button>
          <button
            className={`icon-btn${pinsOpen ? ' active' : ''}`}
            data-testid="pins-button"
            aria-label="Angepinnte Nachrichten"
            title="Angepinnte Nachrichten"
            onClick={() => setPinsOpen(true)}
          >
            <Icon name="pin" size={20} />
          </button>
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
        selfName={username}
        readUpTo={readUpTo}
        onReact={onReact}
        onReply={onReply}
        onThread={onThread}
        onPin={canPin ? onPin : undefined}
        canModerate={canModerate}
        authorColors={authorColors}
        editId={editId}
        onEditHandled={onEditHandled}
      />
      <TypingLine channelId={channelId} />
      <UploadQueue uploads={uploads} onRemove={removeUpload} />
      <Composer
        key={channelId}
        onAttachFiles={startUploads}
        channelName={channel.name}
        target={target}
        onSend={onSend}
        onSendVoice={onSendVoice}
        onSendGif={onSendGif}
        onSendPoll={onSendPoll}
        onSendEvent={onSendEvent}
        onOpenStatus={() => setStatusOpen(true)}
        onSchedule={onSchedule}
        draftKey={channelId}
        people={(channel.guildId ? members : people)?.filter((p) => p.username !== username)}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        onEditLast={onEditLast}
        onTyping={onTyping}
      />
      {threadRoot && (
        <ThreadPanel
          key={threadRoot.id}
          root={threadRoot}
          people={channel.guildId ? members : people}
          onClose={() => setThreadRootId(null)}
        />
      )}
      {statusOpen && <StatusDialog onClose={() => setStatusOpen(false)} />}
      {searchOpen && <SearchDialog channel={channel} onClose={() => setSearchOpen(false)} />}
      {pinsOpen && (
        <PinsPanel
          channelId={channelId}
          canPin={canPin}
          onClose={() => setPinsOpen(false)}
          onJump={(id) => {
            setPinsOpen(false);
            if (!jumpToMessage(id)) {
              useChatStore
                .getState()
                .setError('Diese Nachricht ist weiter oben, lade ältere Nachrichten.');
            }
          }}
        />
      )}
    </section>
  );
}
