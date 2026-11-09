import { useEffect, useLayoutEffect, useRef, useState, type UIEvent } from 'react';
import type { MessageDto } from '@disslxt/shared';
import { errorMessage } from '../api/client';
import { compareIds } from '../store/chat';
import { MessageItem } from './MessageItem';
import { MessageSkeleton } from './Skeleton';

/** Distance from the bottom (px) within which new messages auto-scroll the list. */
export const NEAR_BOTTOM_PX = 120;

/** Messages of the same author within this gap are shown as one group. */
export const GROUP_GAP_MS = 7 * 60 * 1000;

const dayFormat = new Intl.DateTimeFormat('de-DE', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** "Heute", "Gestern" or the full date. */
export function dayLabel(d: Date, now = new Date()): string {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(d) === dayKey(now)) return 'Heute';
  if (dayKey(d) === dayKey(yesterday)) return 'Gestern';
  return dayFormat.format(d);
}

/** Per message: is it grouped with the one before, and does it start a new day? */
export function layoutMessages(
  messages: MessageDto[],
  now = new Date(),
): { grouped: boolean; dayLabel: string | null }[] {
  return messages.map((m, i) => {
    const prev = messages[i - 1];
    const at = new Date(m.createdAt);
    const prevAt = prev ? new Date(prev.createdAt) : null;
    const newDay = !prevAt || dayKey(prevAt) !== dayKey(at);
    const grouped =
      !!prev &&
      !newDay &&
      prev.author.id === m.author.id &&
      // A webhook posts under its creator's id: a bot never joins that person's messages.
      (prev.botName ?? null) === (m.botName ?? null) &&
      prev.kind !== 'join' &&
      m.kind !== 'join' &&
      !m.replyTo &&
      at.getTime() - (prevAt?.getTime() ?? 0) < GROUP_GAP_MS;
    return { grouped, dayLabel: newDay ? dayLabel(at, now) : null };
  });
}

export interface MessageListProps {
  channelId: string;
  messages: MessageDto[];
  hasMore: boolean;
  currentUserId: string | null;
  loading?: boolean;
  subscribed?: boolean;
  onLoadOlder: () => Promise<void>;
  onEdit: (id: string, content: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  selfName?: string | null;
  /** Everything up to this message was read before opening the channel. */
  readUpTo?: string | null;
  onReact?: (id: string, emoji: string) => Promise<void>;
  onReply?: (message: MessageDto) => void;
  onThread?: (message: MessageDto) => void;
  /** Without it messages cannot be pinned. */
  onPin?: (id: string, pinned: boolean) => Promise<void>;
  /** May delete other people's messages (the server checks the rank). */
  canModerate?: boolean;
  /** Colour of a name, from its highest role. */
  authorColors?: Record<string, string>;
  /** Message to open for editing, cleared with onEditHandled. */
  editId?: string | null;
  onEditHandled?: () => void;
}

/** Scrolls a message into view and lets it light up for a moment. */
export function jumpToMessage(id: string): boolean {
  const el = document.getElementById(`m-${id}`);
  if (!el) return false;
  el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
  return true;
}

function distanceFromBottom(el: HTMLElement): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight;
}

export function MessageList({
  channelId,
  messages,
  hasMore,
  currentUserId,
  loading = false,
  subscribed = false,
  onLoadOlder,
  onEdit,
  onDelete,
  selfName = null,
  readUpTo = null,
  onReact,
  onReply,
  onThread,
  onPin,
  canModerate = false,
  authorColors,
  editId = null,
  onEditHandled,
}: MessageListProps) {
  const ref = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const prevChannel = useRef<string | null>(null);
  const prevLastId = useRef<string | null>(null);
  const prevFirstId = useRef<string | null>(null);
  const restore = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const [showPill, setShowPill] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);

  const layout = layoutMessages(messages);
  const last = messages[messages.length - 1];
  const lastId = last?.id ?? null;
  const firstId = messages[0]?.id ?? null;
  const firstUnreadId = readUpTo
    ? (messages.find(
        (m) => compareIds(m.id, readUpTo) > 0 && m.author.id !== currentUserId && m.kind !== 'join',
      )?.id ?? null)
    : null;

  function scrollToBottom() {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    nearBottom.current = true;
    setShowPill(false);
  }

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Channel switched (or first render): jump to the newest message.
    if (prevChannel.current !== channelId) {
      prevChannel.current = channelId;
      prevLastId.current = lastId;
      prevFirstId.current = firstId;
      restore.current = null;
      scrollToBottom();
      return;
    }

    // Older messages were prepended: keep the visible message in place.
    const firstChanged = firstId !== prevFirstId.current;
    prevFirstId.current = firstId;
    if (restore.current && firstChanged) {
      const r = restore.current;
      restore.current = null;
      el.scrollTop = el.scrollHeight - r.scrollHeight + r.scrollTop;
      prevLastId.current = lastId;
      return;
    }

    // A new newest message arrived.
    if (lastId !== prevLastId.current) {
      const hadMessages = prevLastId.current !== null;
      prevLastId.current = lastId;
      if (!last) return;
      if (!hadMessages || nearBottom.current || last.author.id === currentUserId) {
        scrollToBottom();
      } else {
        setShowPill(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, firstId, lastId, messages.length]);

  // With unread messages the channel opens at the line, not at the very end.
  useEffect(() => {
    if (!firstUnreadId) return;
    ref.current?.querySelector('.unread-divider')?.scrollIntoView?.({ block: 'center' });
  }, [firstUnreadId, channelId]);

  function onScroll(e: UIEvent<HTMLDivElement>) {
    const near = distanceFromBottom(e.currentTarget) < NEAR_BOTTOM_PX;
    nearBottom.current = near;
    if (near) setShowPill(false);
  }

  async function loadOlder() {
    const el = ref.current;
    if (!el || loadingOlder) return;
    setLoadingOlder(true);
    setOlderError(null);
    restore.current = { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop };
    try {
      await onLoadOlder();
    } catch (err) {
      restore.current = null;
      setOlderError(errorMessage(err));
    } finally {
      setLoadingOlder(false);
      // The prepend has been committed by now; drop a restore that found nothing to prepend.
      setTimeout(() => {
        restore.current = null;
      }, 0);
    }
  }

  return (
    <div className="message-list-wrap">
      <div
        ref={ref}
        className="message-list"
        data-testid="message-list"
        data-subscribed={subscribed ? 'true' : 'false'}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-busy={loading}
      >
        {hasMore && (
          <div className="load-older-row">
            <button
              className="btn small"
              data-testid="load-older"
              disabled={loadingOlder}
              onClick={() => void loadOlder()}
            >
              {loadingOlder ? 'Lädt…' : 'Ältere laden'}
            </button>
          </div>
        )}
        {olderError && (
          <p className="form-error small" role="alert">
            {olderError}
          </p>
        )}
        {loading && messages.length === 0 && <MessageSkeleton />}
        {!loading && messages.length === 0 && (
          <p className="empty-channel muted" data-testid="empty-channel">
            Noch keine Nachrichten. Schreib die erste!
          </p>
        )}
        <ul className="messages">
          {messages.map((m, i) => (
            <MessageItem
              key={m.id}
              message={m}
              isOwn={m.author.id === currentUserId}
              grouped={layout[i]?.grouped}
              dayLabel={layout[i]?.dayLabel}
              onEdit={onEdit}
              onDelete={onDelete}
              selfId={currentUserId}
              selfName={selfName}
              firstUnread={m.id === firstUnreadId}
              onReact={onReact}
              onReply={onReply}
              onThread={onThread}
              onPin={onPin}
              canModerate={canModerate}
              authorColor={authorColors?.[m.author.id]}
              onJump={jumpToMessage}
              editRequested={m.id === editId}
              onEditHandled={onEditHandled}
            />
          ))}
        </ul>
      </div>
      {showPill && (
        <button
          className="new-messages-pill"
          data-testid="new-messages-pill"
          onClick={scrollToBottom}
        >
          Neue Nachrichten ↓
        </button>
      )}
    </div>
  );
}
