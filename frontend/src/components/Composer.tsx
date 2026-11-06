import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  MESSAGE_MAX_LEN,
  textLength,
  TYPING_REPEAT_MS,
  VOICE_MAX_SECONDS,
  type MessageDto,
} from '@disslxt/shared';
import { ApiRequestError, errorMessage } from '../api/client';
import { useDictation } from '../speech/useDictation';
import { formatDuration, useVoiceRecorder } from '../speech/useVoiceRecorder';
import type { GifDto } from '@disslxt/shared';
import { runCommand, SLASH_COMMANDS } from '../lib/commands';
import { loadDraft, saveDraft } from '../lib/drafts';
import { messagePreview } from '../lib/preview';
import { emojiForCode, replaceShortcodes, searchEmoji } from '../lib/emoji';
import { nameOf } from '../profile';
import { EmojiPanel } from './EmojiPanel';
import { GifPicker, useGifsEnabled } from './Gif';
import { Avatar, Icon } from './Icon';

export interface ComposerProps {
  channelName: string;
  /** Who the message goes to, e.g. "@Bob" in a private conversation (default: #channel). */
  target?: string;
  onSend: (content: string) => Promise<void>;
  /** Sends a recorded voice message; without it there is no record button. */
  onSendVoice?: (audio: Blob, durationMs: number) => Promise<void>;
  /** Files picked, pasted or dropped; without it there is no attach button. */
  onAttachFiles?: (files: File[]) => void;
  /** Posts a GIF from the picker; without it (or without a GIPHY key) there is no GIF button. */
  onSendGif?: (gif: GifDto) => Promise<void>;
  /** Sends what /umfrage typed. */
  onSendPoll?: (poll: { question: string; options: string[] }) => Promise<void>;
  /** Keeps the unsent text of this channel when you switch away. */
  draftKey?: string;
  /** People @ can suggest. */
  people?: Person[];
  /** The message being answered; shown above the field. */
  replyTo?: MessageDto | null;
  onCancelReply?: () => void;
  /** ↑ in the empty field: edit your last message. */
  onEditLast?: () => void;
  /** Called while writing, every few seconds at most. */
  onTyping?: () => void;
}

export interface Person {
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

interface Suggestion {
  key: string;
  /** Replaces what was typed. */
  insert: string;
  label: ReactNode;
  hint?: string;
}

/** What is being typed right before the cursor: `@na`, `:smi` or `/wü`. */
export function activeToken(
  value: string,
  caret: number,
): { kind: '@' | ':' | '/'; query: string; start: number } | null {
  const before = value.slice(0, caret);
  const slash = /^\/([^\s/]*)$/.exec(before);
  if (slash) return { kind: '/', query: slash[1] ?? '', start: 0 };
  const match = /(?:^|\s)([@:])([^\s@:]*)$/.exec(before);
  if (!match) return null;
  const query = match[2] ?? '';
  const kind = match[1] as '@' | ':';
  if (kind === ':' && query.length < 2) return null;
  return { kind, query, start: before.length - query.length - 1 };
}

/** Counter appears this many characters before the limit. */
const COUNTER_THRESHOLD = MESSAGE_MAX_LEN - 200;

/** True for Enter presses that should submit (no Shift, not while an IME is composing). */
export function isSubmitKey(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
  return e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229;
}

export function Composer({
  channelName,
  target = `#${channelName}`,
  onSend,
  onSendVoice,
  onAttachFiles,
  onSendGif,
  onSendPoll,
  draftKey,
  people,
  replyTo = null,
  onCancelReply,
  onEditLast,
  onTyping,
}: ComposerProps) {
  const gifsEnabled = useGifsEnabled();
  const [gifOpen, setGifOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [value, setValueRaw] = useState(() => (draftKey ? loadDraft(draftKey) : ''));
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [caret, setCaret] = useState(0);
  const [picked, setPicked] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const lastTyping = useRef(0);
  function setValue(next: string) {
    setValueRaw(next);
    if (draftKey) saveDraft(draftKey, next);
  }
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  /** Text in the field when dictation started; recognised speech is appended to it. */
  const dictationBase = useRef('');
  const dictation = useDictation((spoken) => {
    const base = dictationBase.current;
    setValue(base && spoken ? `${base.trimEnd()} ${spoken}` : base || spoken);
  });

  const recorder = useVoiceRecorder((audio, durationMs) => {
    if (!onSendVoice) return;
    setSending(true);
    setError(null);
    onSendVoice(audio, durationMs)
      .catch((err: unknown) =>
        setError(
          err instanceof ApiRequestError && err.status === 429
            ? 'Zu viele Nachrichten, bitte kurz warten'
            : errorMessage(err),
        ),
      )
      .finally(() => setSending(false));
  });
  const recording = recorder.state !== 'idle';

  const token = dismissed ? null : activeToken(value, caret);
  const suggestions: Suggestion[] = !token
    ? []
    : token.kind === '@'
      ? (people ?? [])
          .filter((p) =>
            `${p.username} ${p.displayName ?? ''}`
              .toLowerCase()
              .includes(token.query.toLowerCase()),
          )
          .slice(0, 8)
          .map((p) => ({
            key: p.username,
            insert: `@${p.username} `,
            label: (
              <>
                <Avatar name={nameOf({ ...p })} url={p.avatarUrl} size="sm" />
                {nameOf({ ...p })}
              </>
            ),
            hint: `@${p.username}`,
          }))
      : token.kind === ':'
        ? searchEmoji(token.query).map((e) => ({
            key: e.code,
            insert: `${e.emoji} `,
            label: <span className="suggest-emoji">{e.emoji}</span>,
            hint: `:${e.code}:`,
          }))
        : SLASH_COMMANDS.filter((c) => c.name.startsWith(token.query.toLowerCase())).map((c) => ({
            key: c.name,
            insert: `/${c.name} `,
            label: (
              <>
                <strong>/{c.name}</strong> {c.args}
              </>
            ),
            hint: c.description,
          }));
  const selected = Math.min(picked, Math.max(0, suggestions.length - 1));

  function accept(s: Suggestion) {
    if (!token) return;
    const next = value.slice(0, token.start) + s.insert + value.slice(caret);
    const at = token.start + s.insert.length;
    setValue(next);
    setPicked(0);
    setCaret(at);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(at, at);
    });
  }

  function insertAtCaret(text: string) {
    const el = ref.current;
    const at = el?.selectionStart ?? value.length;
    const next = value.slice(0, at) + text + value.slice(el?.selectionEnd ?? at);
    setValue(next);
    const end = at + text.length;
    setCaret(end);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(end, end);
    });
  }

  function changed(next: string, cursor: number) {
    // A complete :kürzel: turns into its emoji right away.
    const before = next.slice(0, cursor);
    const code = /(?:^|\s):([a-z0-9_+-]{2,32}):$/i.exec(before);
    const emoji = code ? emojiForCode(code[1] ?? '') : null;
    if (code && emoji) {
      const start = before.length - (code[1] ?? '').length - 2;
      const replaced = next.slice(0, start) + emoji + next.slice(cursor);
      const at = start + emoji.length;
      setValue(replaced);
      setCaret(at);
      requestAnimationFrame(() => ref.current?.setSelectionRange(at, at));
    } else {
      setValue(next);
      setCaret(cursor);
    }
    setPicked(0);
    setDismissed(false);
    const now = Date.now();
    if (next.trim() && !next.startsWith('/') && now - lastTyping.current >= TYPING_REPEAT_MS) {
      lastTyping.current = now;
      onTyping?.();
    }
  }

  function toggleDictation() {
    if (dictation.listening) {
      dictation.stop();
      return;
    }
    dictationBase.current = value;
    dictation.start();
  }

  // Code points, like the server (an emoji counts as one character).
  const length = textLength(value.trim());
  const tooLong = length > MESSAGE_MAX_LEN;
  const canSend = length > 0 && !tooLong && !sending;

  // Re-focus after a send finished (the textarea is disabled while sending).
  useEffect(() => {
    if (!sending) ref.current?.focus();
  }, [sending]);

  async function submit() {
    const typed = value.trim();
    if (!typed || sending) return;
    const command = runCommand(typed);
    if (command && 'error' in command) {
      setError(command.error);
      return;
    }
    if (command && 'poll' in command) {
      setSending(true);
      setError(null);
      try {
        await onSendPoll?.(command.poll);
        setValue('');
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setSending(false);
      }
      return;
    }
    const content = replaceShortcodes(command ? command.text : typed);
    if (textLength(content) > MESSAGE_MAX_LEN) return;
    if (dictation.listening) dictation.stop();
    setSending(true);
    setError(null);
    try {
      await onSend(content);
      setValue('');
      // The others saw "schreibt" end with this message; the next word starts it again.
      lastTyping.current = 0;
    } catch (err) {
      setError(
        err instanceof ApiRequestError && err.status === 429
          ? 'Zu viele Nachrichten, bitte kurz warten'
          : errorMessage(err),
      );
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : suggestions.length - 1;
        setPicked((selected + step) % suggestions.length);
        return;
      }
      if (e.key === 'Tab' || isSubmitKey(e)) {
        const pick = suggestions[selected];
        // Fully typed already (a name, a command): Enter sends instead of completing it again.
        const typed = token ? value.slice(token.start, caret).toLowerCase() : '';
        if (pick && !(isSubmitKey(e) && typed === pick.insert.trim().toLowerCase())) {
          e.preventDefault();
          accept(pick);
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissed(true);
        return;
      }
    }
    if (e.key === 'Escape' && replyTo) {
      e.preventDefault();
      onCancelReply?.();
      return;
    }
    if (e.key === 'ArrowUp' && !value && !e.altKey && onEditLast) {
      e.preventDefault();
      onEditLast();
      return;
    }
    if (isSubmitKey(e)) {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {gifOpen && onSendGif && (
        <GifPicker
          onClose={() => setGifOpen(false)}
          onPick={(gif) => {
            setGifOpen(false);
            setError(null);
            onSendGif(gif).catch((err: unknown) => setError(errorMessage(err)));
          }}
        />
      )}
      {emojiOpen && (
        <div className="composer-emoji">
          <EmojiPanel
            label="Emoji einfügen"
            onClose={() => setEmojiOpen(false)}
            onPick={(emoji) => {
              setEmojiOpen(false);
              insertAtCaret(emoji);
            }}
          />
        </div>
      )}
      {suggestions.length > 0 && (
        <ul className="suggestions" role="listbox" data-testid="suggestions">
          {suggestions.map((s, i) => (
            <li key={s.key} role="option" aria-selected={i === selected}>
              <button
                type="button"
                className={i === selected ? 'active' : ''}
                data-testid={`suggestion-${s.key}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => accept(s)}
              >
                <span className="suggest-label">{s.label}</span>
                {s.hint && <span className="suggest-hint">{s.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {replyTo && (
        <div className="composer-reply" data-testid="composer-reply">
          <Icon name="reply" size={16} />
          <span>
            Antwort an <strong>{nameOf(replyTo.author)}</strong>
            <em>{messagePreview(replyTo)}</em>
          </span>
          <button
            type="button"
            className="icon-btn"
            aria-label="Antwort abbrechen"
            data-testid="composer-reply-cancel"
            onClick={onCancelReply}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
      {(error ?? dictation.error ?? recorder.error) && (
        <p className="composer-error" role="alert" data-testid="composer-error">
          {error ?? dictation.error ?? recorder.error}
        </p>
      )}
      {recording ? (
        <div className="composer-row recording-bar" data-testid="recording-bar">
          <button
            type="button"
            className="icon-btn danger"
            data-testid="voice-cancel"
            aria-label="Aufnahme verwerfen"
            title="Verwerfen"
            onClick={() => recorder.stop(false)}
          >
            <Icon name="trash" size={20} />
          </button>
          <span className="rec-dot" aria-hidden="true" />
          <span className="rec-time" data-testid="recording-time" aria-live="off">
            {recorder.state === 'requesting'
              ? 'Mikrofon…'
              : `${formatDuration(recorder.elapsedMs)} / ${formatDuration(VOICE_MAX_SECONDS * 1000)}`}
          </span>
          <span className="sr-only" role="status">
            Aufnahme läuft
          </span>
          <button
            type="button"
            className="btn primary composer-send"
            data-testid="voice-send"
            aria-label="Sprachnachricht senden"
            title="Senden"
            disabled={recorder.state !== 'recording'}
            onClick={() => recorder.stop(true)}
          >
            <Icon name="send" size={20} />
          </button>
        </div>
      ) : (
        <div className="composer-row">
          {onAttachFiles && (
            <>
              <button
                type="button"
                className="icon-btn composer-tool attach"
                data-testid="attach-file"
                aria-label="Datei anhängen"
                title="Datei oder Bild teilen (max. 25 MB)"
                onClick={() => fileInput.current?.click()}
              >
                <Icon name="paperclip" size={20} />
              </button>
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                data-testid="file-input"
                onChange={(e) => {
                  const files = [...(e.target.files ?? [])];
                  e.target.value = '';
                  if (files.length > 0) onAttachFiles(files);
                }}
              />
            </>
          )}
          {onSendGif && gifsEnabled && (
            <button
              type="button"
              className={`icon-btn composer-tool gif-button${gifOpen ? ' active' : ''}`}
              data-testid="gif-button"
              aria-label="GIF senden"
              aria-expanded={gifOpen}
              title="GIF senden"
              onClick={() => setGifOpen((o) => !o)}
            >
              GIF
            </button>
          )}
          <textarea
            ref={ref}
            data-testid="composer-input"
            className="composer-input"
            rows={1}
            placeholder={dictation.listening ? 'Sprich jetzt…' : `Nachricht an ${target}`}
            aria-label={`Nachricht an ${target}`}
            value={value}
            disabled={sending}
            onChange={(e) => changed(e.target.value, e.target.selectionStart)}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            onPaste={(e) => {
              // Pasting a screenshot shares it as a file.
              const files = [...e.clipboardData.files];
              if (onAttachFiles && files.length > 0) {
                e.preventDefault();
                onAttachFiles(files);
              }
            }}
          />
          <button
            type="button"
            className={`icon-btn composer-tool${emojiOpen ? ' active' : ''}`}
            data-testid="emoji-button"
            aria-label="Emoji einfügen"
            aria-expanded={emojiOpen}
            title="Emoji einfügen"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setEmojiOpen((o) => !o)}
          >
            <Icon name="smile" size={20} />
          </button>
          {dictation.supported && (
            <button
              type="button"
              className={`icon-btn composer-tool${dictation.listening ? ' recording' : ''}`}
              data-testid="dictate-button"
              aria-pressed={dictation.listening}
              aria-label={dictation.listening ? 'Diktieren beenden' : 'Diktieren'}
              title={dictation.listening ? 'Diktieren beenden' : 'Diktieren (Sprache zu Text)'}
              disabled={sending}
              onClick={toggleDictation}
            >
              <Icon name="mic" size={20} />
            </button>
          )}
          {onSendVoice && recorder.supported && !value.trim() && (
            <button
              type="button"
              className="icon-btn composer-tool"
              data-testid="record-voice"
              aria-label="Sprachnachricht aufnehmen"
              title="Sprachnachricht aufnehmen (max. 2 Minuten)"
              disabled={sending || dictation.listening}
              onClick={() => void recorder.start()}
            >
              <Icon name="waveform" size={20} />
            </button>
          )}
          <button
            type="submit"
            className="btn primary composer-send"
            data-testid="composer-send"
            disabled={!canSend}
            aria-label="Senden"
            title="Senden"
          >
            <Icon name="send" size={20} />
          </button>
        </div>
      )}
      {length > COUNTER_THRESHOLD && (
        <p className={`composer-counter${tooLong ? ' over' : ''}`} data-testid="composer-counter">
          {length}/{MESSAGE_MAX_LEN}
          {tooLong && ' – Nachricht ist zu lang'}
        </p>
      )}
    </form>
  );
}
