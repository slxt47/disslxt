import { memo, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { MESSAGE_MAX_LEN, textLength, type MessageDto } from '@disslxt/shared';
import { errorMessage } from '../api/client';
import { speak, spokenText, ttsSupported } from '../speech/tts';
import { usePrefs } from '../store/prefs';
import { isSubmitKey } from './Composer';
import { FileAttachment } from './FileAttachment';
import { GifView } from './Gif';
import { ProfileLink, UserBadges } from './Social';
import { VoicePlayer } from './VoicePlayer';
import { Avatar, Icon } from './Icon';
import { nameOf } from '../profile';

export interface MessageItemProps {
  message: MessageDto;
  isOwn: boolean;
  onEdit: (id: string, content: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  /** Follows a message of the same author shortly before: no avatar and header, time on hover. */
  grouped?: boolean;
  /** First message of a day: a divider with this label ("Heute", "Gestern", date) above it. */
  dayLabel?: string | null;
}

const timeFormat = new Intl.DateTimeFormat('de-DE', {
  hour: '2-digit',
  minute: '2-digit',
});
const fullFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

function MessageItemImpl({
  message,
  isOwn,
  onEdit,
  onDelete,
  grouped = false,
  dayLabel = null,
}: MessageItemProps) {
  const [mode, setMode] = useState<'view' | 'edit' | 'confirm-delete'>('view');
  const [draft, setDraft] = useState(message.content);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  /** Touch screens have no hover: a tap on the message shows its actions. */
  const [selected, setSelected] = useState(false);

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
    <li
      className={`message${isOwn ? ' own' : ''}${grouped ? ' grouped' : ''}${selected ? ' selected' : ''}`}
      data-testid={`message-${message.id}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button, a, textarea, input, audio')) return;
        setSelected((s) => !s);
      }}
    >
      {dayLabel && (
        <div className="day-divider" role="separator" data-testid="day-divider">
          <span>{dayLabel}</span>
        </div>
      )}
      {grouped ? (
        <time
          className="message-gutter-time"
          dateTime={message.createdAt}
          title={fullFormat.format(created)}
          aria-hidden="true"
        >
          {timeFormat.format(created)}
        </time>
      ) : (
        <Avatar name={nameOf(message.author)} url={message.author.avatarUrl} />
      )}
      {/* In a group the header is only for screen readers (who wrote it, when). */}
      <div className={`message-meta${grouped ? ' sr-only' : ''}`}>
        <span
          className="message-author"
          data-testid="message-author"
          title={message.author.displayName ? `@${message.author.username}` : undefined}
        >
          <ProfileLink userId={message.author.id}>{nameOf(message.author)}</ProfileLink>
        </span>
        <UserBadges user={message.author} />
        <time
          className="message-time"
          dateTime={message.createdAt}
          title={fullFormat.format(created)}
        >
          {timeFormat.format(created)}
        </time>
        {message.editedAt && !grouped && (
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
      ) : message.kind === 'voice' && message.audio ? (
        <VoicePlayer audio={message.audio} />
      ) : message.kind === 'file' && message.file ? (
        <FileAttachment file={message.file} />
      ) : message.kind === 'gif' && message.gif ? (
        <GifView gif={message.gif} />
      ) : (
        <div className="message-content" data-testid="message-content">
          {message.content}
        </div>
      )}
      {message.editedAt && grouped && mode !== 'edit' && (
        <span className="message-edited below" data-testid="message-edited">
          (bearbeitet)
        </span>
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

      {mode === 'view' && (ttsSupported() || isOwn) && (
        <div className="message-actions">
          {ttsSupported() && (
            <button
              className="icon-btn"
              data-testid="message-speak"
              aria-label="Vorlesen"
              title="Vorlesen"
              onClick={() =>
                speak(spokenText(message), {
                  rate: usePrefs.getState().speechRate,
                  interrupt: true,
                })
              }
            >
              <Icon name="speaker" size={18} />
            </button>
          )}
          {isOwn && (
            <>
              {message.kind === 'text' && (
                <button
                  className="icon-btn"
                  data-testid="message-edit"
                  aria-label="Bearbeiten"
                  title="Bearbeiten"
                  onClick={startEdit}
                >
                  <Icon name="edit" size={18} />
                </button>
              )}
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
            </>
          )}
        </div>
      )}
    </li>
  );
}

export const MessageItem = memo(MessageItemImpl);
