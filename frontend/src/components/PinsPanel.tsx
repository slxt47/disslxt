import { useEffect, useState } from 'react';
import type { MessageDto } from '@disslxt/shared';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import { renderMarkdown } from '../lib/markdown';
import { messagePreview } from '../lib/preview';
import { nameOf } from '../profile';
import { useChatStore } from '../store/chat';
import { Avatar, Icon } from './Icon';
import { Modal } from './Modal';
import { LineSkeleton } from './Skeleton';

/** Pinned messages of a channel. */
export function PinsPanel({
  channelId,
  canPin,
  onJump,
  onClose,
}: {
  channelId: string;
  canPin: boolean;
  onJump: (messageId: string) => void;
  onClose: () => void;
}) {
  const [pins, setPins] = useState<MessageDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listPins(channelId).then(
      (r) => setPins(r.messages),
      (err: unknown) => setError(errorMessage(err)),
    );
  }, [channelId]);

  async function unpin(id: string) {
    try {
      const { message } = await api.setPinned(id, false);
      useChatStore.getState().upsertMessage(message);
      setPins((list) => list?.filter((m) => m.id !== id) ?? null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Modal title="Angepinnt" onClose={onClose} testId="pins-panel">
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!pins && !error && <LineSkeleton rows={3} />}
      {pins?.length === 0 && <p className="muted">In diesem Kanal ist noch nichts angepinnt.</p>}
      <ul className="pins-list">
        {pins?.map((m) => (
          <li key={m.id} data-testid={`pin-${m.id}`}>
            <Avatar name={nameOf(m.author)} url={m.author.avatarUrl} size="sm" />
            <button className="pin-body" type="button" onClick={() => onJump(m.id)}>
              <strong>{nameOf(m.author)}</strong>
              <span>{m.kind === 'text' ? renderMarkdown(m.content) : messagePreview(m)}</span>
            </button>
            {canPin && (
              <button
                className="icon-btn"
                aria-label="Lösen"
                title="Lösen"
                data-testid={`unpin-${m.id}`}
                onClick={() => void unpin(m.id)}
              >
                <Icon name="close" size={16} />
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="dialog-actions">
        <button className="btn" onClick={onClose}>
          Fertig
        </button>
      </div>
    </Modal>
  );
}
