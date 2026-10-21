import { memo, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { MESSAGE_MAX_LEN, textLength, type MessageDto } from '@disslxt/shared';
import { errorMessage } from '../api/client';
import { isSubmitKey } from './Composer';
import { Avatar, Icon } from './Icon';

export interface MessageItemProps {
  message: MessageDto;
  isOwn: boolean;
  onEdit: (id: string, content: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const timeFormat = new Intl.DateTimeFormat('de-DE', {
  hour: '2-digit',
  minute: '2-digit',
});
const fullFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

function MessageItemImpl({ message, isOwn, onEdit, onDelete }: MessageItemProps) {
  const [mode, setMode] = useState<'view' | 'edit' | 'confirm-delete'>('view');
  const [draft, setDraft] = useState(message.content);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (mode === 'edit') {
      const el = editRef.current;
      el?.focus();
      el?.setSelectionRange(el.value.length, el.value.length);
    }
  }, [mode]);

  const created = new Date(message.createdAt);

  function startEdit() {
    setDraft(message.content);
    setError(null);
    setMode('edit');
  }

  async function saveEdit() {
    const content = draft.trim();
    if (!content || textLength(content) > MESSAGE_MAX_LEN) {
      setError(content ? 'Nachricht ist zu lang' : 'Nachricht ist leer');
      return;
    }
    if (content === message.content) {
      setMode('view');
      return;
    }
    setBusy(true);
    try {
      await onEdit(message.id, content);
      setMode('view');
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    setBusy(true);
    try {
      await onDelete(message.id);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
      setMode('view');
    }
  }

  function onEditKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      setMode('view');
      setError(null);
    } else if (isSubmitKey(e)) {
      e.preventDefault();
      void saveEdit();
    }
  }

  return (
    <li className={`message${isOwn ? ' own' : ''}`} data-testid={`message-${message.id}`}>
      <Avatar name={message.author.username} />
      <div className="message-meta">
        <span className="message-author" data-testid="message-author">
          {message.author.username}
        </span>
        <time
          className="message-time"
          dateTime={message.createdAt}
          title={fullFormat.format(created)}
        >
          {timeFormat.format(created)}
        </time>
        {message.editedAt && (
          <span className="message-edited" data-testid="message-edited">
            (bearbeitet)
          </span>
        )}
      </div>

      {mode === 'edit' ? (
        <div className="message-edit">
          <textarea
            ref={editRef}
            data-testid="message-edit-input"
            className="message-edit-input"
            aria-label="Nachricht bearbeiten"
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onEditKeyDown}
          />
          <div className="message-edit-actions">
            <span className="muted">Enter speichern · Esc abbrechen</span>
            <button
              className="btn small"
              data-testid="message-edit-cancel"
              onClick={() => setMode('view')}
            >
              Abbrechen
            </button>
            <button
              className="btn small primary"
              data-testid="message-edit-save"
              disabled={busy}
              onClick={() => void saveEdit()}
            >
              Speichern
            </button>
          </div>
        </div>
      ) : (
        <div className="message-content" data-testid="message-content">
          {message.content}
        </div>
      )}

      {mode === 'confirm-delete' && (
        <div className="message-confirm" role="group" aria-label="Löschen bestätigen">
          <span>Nachricht löschen?</span>
          <button
            className="btn small danger"
            data-testid="message-delete-confirm"
            disabled={busy}
            onClick={() => void confirmDelete()}
          >
            Ja, löschen
          </button>
          <button
            className="btn small"
            data-testid="message-delete-cancel"
            disabled={busy}
            onClick={() => setMode('view')}
          >
            Abbrechen
          </button>
        </div>
      )}

      {error && (
        <p className="form-error small" role="alert" data-testid="message-error">
          {error}
        </p>
      )}

      {isOwn && mode === 'view' && (
        <div className="message-actions">
          <button
            className="icon-btn"
            data-testid="message-edit"
            aria-label="Bearbeiten"
            title="Bearbeiten"
            onClick={startEdit}
          >
            <Icon name="edit" size={18} />
          </button>
          <button
            className="icon-btn danger"
            data-testid="message-delete"
            aria-label="Löschen"
            title="Löschen"
            onClick={() => {
              setError(null);
              setMode('confirm-delete');
            }}
          >
            <Icon name="trash" size={18} />
          </button>
        </div>
      )}
    </li>
  );
}

export const MessageItem = memo(MessageItemImpl);
