import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { MESSAGE_MAX_LEN, textLength, VOICE_MAX_SECONDS } from '@disslxt/shared';
import { ApiRequestError, errorMessage } from '../api/client';
import { useDictation } from '../speech/useDictation';
import { formatDuration, useVoiceRecorder } from '../speech/useVoiceRecorder';
import { Icon } from './Icon';

export interface ComposerProps {
  channelName: string;
  onSend: (content: string) => Promise<void>;
  /** Sends a recorded voice message; without it there is no record button. */
  onSendVoice?: (audio: Blob, durationMs: number) => Promise<void>;
  /** Files picked, pasted or dropped; without it there is no attach button. */
  onAttachFiles?: (files: File[]) => void;
}

/** Counter appears this many characters before the limit. */
const COUNTER_THRESHOLD = MESSAGE_MAX_LEN - 200;

/** True for Enter presses that should submit (no Shift, not while an IME is composing). */
export function isSubmitKey(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
  return e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229;
}

export function Composer({ channelName, onSend, onSendVoice, onAttachFiles }: ComposerProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
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
    const content = value.trim();
    if (!content || textLength(content) > MESSAGE_MAX_LEN || sending) return;
    if (dictation.listening) dictation.stop();
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
          <textarea
            ref={ref}
            data-testid="composer-input"
            className="composer-input"
            rows={1}
            placeholder={dictation.listening ? 'Sprich jetzt…' : `Nachricht an #${channelName}`}
            aria-label={`Nachricht an #${channelName}`}
            value={value}
            disabled={sending}
            onChange={(e) => setValue(e.target.value)}
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
