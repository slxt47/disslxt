import { useEffect, useState } from 'react';
import type { MessageDto } from '@disslxt/shared';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import { useAuthStore } from '../store/auth';
import { useChatStore } from '../store/chat';
import { Composer, type Person } from './Composer';
import { Icon } from './Icon';
import { MessageItem } from './MessageItem';
import { LineSkeleton } from './Skeleton';

const NONE: MessageDto[] = [];

/** One conversation hanging off a message, next to the channel. */
export function ThreadPanel({
  root,
  people,
  onClose,
}: {
  root: MessageDto;
  people?: Person[];
  onClose: () => void;
}) {
  const replies = useChatStore((s) => s.threadsByRoot[root.id] ?? NONE);
  const loaded = useChatStore((s) => !!s.threadsByRoot[root.id]);
  const user = useAuthStore((s) => s.user);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listThread(root.id).then(
      (r) => useChatStore.getState().setThread(root.id, r.replies),
      (err: unknown) => setError(errorMessage(err)),
    );
  }, [root.id]);

  const onEdit = async (id: string, content: string) => {
    const { message } = await api.editMessage(id, content);
    useChatStore.getState().upsertMessage(message);
  };
  const onDelete = async (id: string) => {
    await api.deleteMessage(id);
    useChatStore.getState().removeMessage(root.channelId, id);
  };
  const onReact = async (id: string, emoji: string) => {
    const { reactions } = await api.toggleReaction(id, emoji);
    useChatStore.getState().setReactions(root.channelId, id, reactions);
  };

  return (
    <aside className="thread-panel" aria-label="Thread" data-testid="thread-panel">
      <header>
        <h2>Thread</h2>
        <button
          className="icon-btn"
          aria-label="Thread schließen"
          data-testid="thread-close"
          onClick={onClose}
        >
          <Icon name="close" size={18} />
        </button>
      </header>
      <div className="thread-scroll">
        <ul className="messages">
          <MessageItem
            message={root}
            isOwn={root.author.id === user?.id}
            selfId={user?.id ?? null}
            selfName={user?.username ?? null}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </ul>
        <p className="thread-count" data-testid="thread-count">
          {replies.length === 1 ? '1 Antwort' : `${replies.length} Antworten`}
        </p>
        {!loaded && !error && <LineSkeleton rows={2} />}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <ul className="messages" data-testid="thread-replies">
          {replies.map((m) => (
            <MessageItem
              key={m.id}
              message={m}
              isOwn={m.author.id === user?.id}
              selfId={user?.id ?? null}
              selfName={user?.username ?? null}
              onEdit={onEdit}
              onDelete={onDelete}
              onReact={onReact}
            />
          ))}
        </ul>
      </div>
      <Composer
        key={root.id}
        channelName="thread"
        target="den Thread"
        draftKey={`thread-${root.id}`}
        people={people}
        onSend={async (content) => {
          const { message } = await api.sendMessage(root.channelId, content, undefined, root.id);
          useChatStore.getState().upsertMessage(message);
        }}
      />
    </aside>
  );
}
