import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { MESSAGE_MAX_LEN, textLength, type MessageDto } from '@disslxt/shared';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import { QUICK_REACTIONS } from '../lib/emoji';
import { messagePreview } from '../lib/preview';
import { mentionsUser, renderMarkdown } from '../lib/markdown';
import { speak, spokenText, ttsSupported } from '../speech/tts';
import { usePrefs } from '../store/prefs';
import { isSubmitKey } from './Composer';
import { EmojiPanel } from './EmojiPanel';
import { FileAttachment } from './FileAttachment';
import { GifView } from './Gif';
import { PollView } from './PollView';
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
  /** The own user, for reactions and highlighting mentions. */
  selfId?: string | null;
  selfName?: string | null;
  /** First message you have not read yet: a "Neue Nachrichten" line above it. */
  firstUnread?: boolean;
  onReact?: (id: string, emoji: string) => Promise<void>;
  onReply?: (message: MessageDto) => void;
  /** Without it there is no pin button. */
  onPin?: (id: string, pinned: boolean) => Promise<void>;
  /** May delete this message although it is someone else's. */
  canModerate?: boolean;
  authorColor?: string;
  onJump?: (id: string) => void;
  /** Open this message for editing (↑ in the empty composer). */
  editRequested?: boolean;
  onEditHandled?: () => void;
}

/** Welcome lines; the message id picks one, so everybody sees the same. */
const GREETINGS = [
  (n: string) => `${n} ist da!`,
  (n: string) => `Willkommen, ${n}!`,
  (n: string) => `${n} ist dem Server beigetreten.`,
  (n: string) => `Schön, dass du da bist, ${n}!`,
];
const greeting = (id: string, name: string): string =>
  (GREETINGS[Number(id.slice(-4)) % GREETINGS.length] ?? GREETINGS[0]!)(name);

/** Next to the button, on the screen: the message list would cut off anything inside it. */
function pickerPosition(button: HTMLElement): CSSProperties {
  const WIDTH = 340;
  const HEIGHT = 380;
  const rect = button.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.right - WIDTH, window.innerWidth - WIDTH - 8));
  return rect.top > HEIGHT + 8
    ? { left, bottom: window.innerHeight - rect.top + 6 }
    : { left, top: Math.min(rect.bottom + 6, window.innerHeight - HEIGHT - 8) };
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
  selfId = null,
  selfName = null,
  firstUnread = false,
  onReact,
  onReply,
  onPin,
  canModerate = false,
  authorColor,
  onJump,
  editRequested = false,
  onEditHandled,
}: MessageItemProps) {
  const [mode, setMode] = useState<'view' | 'edit' | 'confirm-delete'>('view');
  const [draft, setDraft] = useState(message.content);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  /** Touch screens have no hover: a tap on the message shows its actions. */
  const [selected, setSelected] = useState(false);
  /** Where the reaction picker opens; null: closed. */
  const [picking, setPicking] = useState<CSSProperties | null>(null);
  const closePicker = useCallback(() => setPicking(null), []);

  useEffect(() => {
    if (mode === 'edit') {
      const el = editRef.current;
      el?.focus();
      el?.setSelectionRange(el.value.length, el.value.length);
    }
  }, [mode]);

  useEffect(() => {
    if (!editRequested) return;
    setDraft(message.content);
    setError(null);
    setMode('edit');
    onEditHandled?.();
  }, [editRequested, message.content, onEditHandled]);

  const created = new Date(message.createdAt);
  const mentioned =
    !isOwn &&
    ((!!selfName && mentionsUser(message.content, selfName)) ||
      (!!selfId && message.replyTo?.author.id === selfId));

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

  function react(emoji: string) {
    setPicking(null);
    onReact?.(message.id, emoji).catch((err: unknown) => setError(errorMessage(err)));
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

  const dividers = (
    <>
      {dayLabel && (
        <div className="day-divider" role="separator" data-testid="day-divider">
          <span>{dayLabel}</span>
        </div>
      )}
      {firstUnread && (
        <div className="unread-divider" role="separator" data-testid="unread-divider">
          <span>Neue Nachrichten</span>
        </div>
      )}
    </>
  );

  if (message.kind === 'join') {
    return (
      <li className="message join" data-testid={`message-${message.id}`}>
        {dividers}
        <div className="join-line" data-testid="join-line">
          <span className="join-wave" aria-hidden="true">
            👋
          </span>
          <span>{greeting(message.id, nameOf(message.author))}</span>
          <time dateTime={message.createdAt} title={fullFormat.format(created)}>
            {timeFormat.format(created)}
          </time>
        </div>
      </li>
    );
  }

  return (
    <li
      className={`message${isOwn ? ' own' : ''}${grouped ? ' grouped' : ''}${selected ? ' selected' : ''}${mentioned ? ' mentions-me' : ''}`}
      data-testid={`message-${message.id}`}
      id={`m-${message.id}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button, a, textarea, input, audio, pre, code'))
          return;
        setSelected((s) => !s);
      }}
    >
      {dividers}
      {message.replyTo && (
        <button
          type="button"
          className="message-reply"
          data-testid="message-reply"
          title="Zur Nachricht springen"
          onClick={() => message.replyTo && onJump?.(message.replyTo.id)}
        >
          <Icon name="reply" size={14} />
          <strong>{nameOf(message.replyTo.author)}</strong>
          <span>
            {messagePreview({ kind: message.replyTo.kind, content: message.replyTo.excerpt })}
          </span>
        </button>
      )}
      {message.pinnedAt && (
        <span className="message-pinned" data-testid="message-pinned">
          <Icon name="pin" size={13} />
          Angepinnt
        </span>
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
          style={authorColor ? { color: authorColor } : undefined}
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
        <>
          <VoicePlayer audio={message.audio} />
          {message.content && (
            <p className="voice-transcript" data-testid="voice-transcript">
              <span className="sr-only">Abschrift: </span>
              {message.content}
            </p>
          )}
        </>
      ) : message.kind === 'poll' && message.poll ? (
        <PollView
          messageId={message.id}
          channelId={message.channelId}
          question={message.content}
          poll={message.poll}
          selfId={selfId}
        />
      ) : message.kind === 'file' && message.file ? (
        <FileAttachment file={message.file} />
      ) : message.kind === 'gif' && message.gif ? (
        <GifView gif={message.gif} />
      ) : (
        <div className="message-content" data-testid="message-content">
          {renderMarkdown(message.content, selfName)}
        </div>
      )}
      {message.editedAt && grouped && mode !== 'edit' && (
        <span className="message-edited below" data-testid="message-edited">
          (bearbeitet)
        </span>
      )}

      {message.linkPreview && mode === 'view' && (
        <div className="link-card" data-testid="link-preview">
          <a href={message.linkPreview.url} target="_blank" rel="noopener noreferrer nofollow ugc">
            {message.linkPreview.siteName && <small>{message.linkPreview.siteName}</small>}
            <strong>{message.linkPreview.title}</strong>
            {message.linkPreview.description && <span>{message.linkPreview.description}</span>}
          </a>
          {message.linkPreview.imageUrl && (
            <img src={message.linkPreview.imageUrl} alt="" loading="lazy" />
          )}
          {isOwn && (
            <button
              className="icon-btn link-hide"
              aria-label="Vorschau entfernen"
              title="Vorschau entfernen"
              data-testid="link-preview-hide"
              onClick={() =>
                void api
                  .hidePreview(message.id)
                  .catch((err: unknown) => setError(errorMessage(err)))
              }
            >
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
      )}

      {message.reactions.length > 0 && (
        <div className="reactions" data-testid="reactions">
          {message.reactions.map((r) => {
            const mine = !!selfId && r.userIds.includes(selfId);
            return (
              <button
                key={r.emoji}
                type="button"
                className={`reaction${mine ? ' mine' : ''}`}
                aria-pressed={mine}
                aria-label={`${r.emoji} ${r.count}`}
                data-testid={`reaction-${r.emoji}`}
                onClick={() => react(r.emoji)}
              >
                <span aria-hidden="true">{r.emoji}</span>
                <span>{r.count}</span>
              </button>
            );
          })}
        </div>
      )}

      {picking &&
        createPortal(
          <div className="reaction-picker" style={picking}>
            <EmojiPanel
              label="Reagieren"
              onPick={react}
              onClose={closePicker}
              top={
                <div className="quick-reactions">
                  {QUICK_REACTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      className="emoji-cell"
                      onClick={() => react(emoji)}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              }
            />
          </div>,
          document.body,
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

      {mode === 'view' && (
        <div className="message-actions">
          {onReact && (
            <button
              className="icon-btn"
              data-testid="message-react"
              aria-label="Reagieren"
              title="Reagieren"
              onClick={(e) => setPicking((p) => (p ? null : pickerPosition(e.currentTarget)))}
            >
              <Icon name="smile" size={18} />
            </button>
          )}
          {onReply && (
            <button
              className="icon-btn"
              data-testid="message-reply-button"
              aria-label="Antworten"
              title="Antworten"
              onClick={() => onReply(message)}
            >
              <Icon name="reply" size={18} />
            </button>
          )}
          {onPin && (
            <button
              className={`icon-btn${message.pinnedAt ? ' active' : ''}`}
              data-testid="message-pin"
              aria-pressed={!!message.pinnedAt}
              aria-label={message.pinnedAt ? 'Lösen' : 'Anpinnen'}
              title={message.pinnedAt ? 'Lösen' : 'Anpinnen'}
              onClick={() =>
                void onPin(message.id, !message.pinnedAt).catch((err: unknown) =>
                  setError(errorMessage(err)),
                )
              }
            >
              <Icon name="pin" size={18} />
            </button>
          )}
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
            </>
          )}
          {(isOwn || canModerate) && (
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
          )}
        </div>
      )}
    </li>
  );
}

export const MessageItem = memo(MessageItemImpl);
