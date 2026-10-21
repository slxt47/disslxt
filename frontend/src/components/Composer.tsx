import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { MESSAGE_MAX_LEN, textLength } from '@disslxt/shared';
import { ApiRequestError, errorMessage } from '../api/client';
import { Icon } from './Icon';

export interface ComposerProps {
  channelName: string;
  onSend: (content: string) => Promise<void>;
}

/** Counter appears this many characters before the limit. */
const COUNTER_THRESHOLD = MESSAGE_MAX_LEN - 200;

/** True for Enter presses that should submit (no Shift, not while an IME is composing). */
export function isSubmitKey(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
  return e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229;
}

export function Composer({ channelName, onSend }: ComposerProps) {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Code points, like the server (an emoji counts as one character).
  const length = textLength(value.trim());
  const tooLong = length > MESSAGE_MAX_LEN;
  const canSend = length > 0 && !tooLong && !sending;

  // Re-focus after a send finished (the textarea is disabled while sending).
  useEffect(() => {
    if (!sending) ref.current?.focus();
  }, [sending]);

  async function submit() {
    const content = value.trim();
    if (!content || textLength(content) > MESSAGE_MAX_LEN || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSend(content);
      setValue('');
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
      {error && (
        <p className="composer-error" role="alert" data-testid="composer-error">
          {error}
        </p>
      )}
      <div className="composer-row">
        <textarea
          ref={ref}
          data-testid="composer-input"
          className="composer-input"
          rows={1}
          placeholder={`Nachricht an #${channelName}`}
          aria-label={`Nachricht an #${channelName}`}
          value={value}
          disabled={sending}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
        />
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
      {length > COUNTER_THRESHOLD && (
        <p className={`composer-counter${tooLong ? ' over' : ''}`} data-testid="composer-counter">
          {length}/{MESSAGE_MAX_LEN}
          {tooLong && ' – Nachricht ist zu lang'}
        </p>
      )}
    </form>
  );
}
