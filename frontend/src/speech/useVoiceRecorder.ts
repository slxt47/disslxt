import { useCallback, useEffect, useRef, useState } from 'react';
import { VOICE_MAX_BYTES, VOICE_MAX_SECONDS } from '@disslxt/shared';

/** Recorder formats in order of preference: Opus where possible, AAC/MP4 on Safari. */
const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/webm',
];

export function recorderSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined'
  );
}

export function pickRecorderMime(isSupported: (t: string) => boolean): string | undefined {
  return MIME_CANDIDATES.find((t) => isSupported(t));
}

export const RECORDER_ERRORS: Record<string, string> = {
  NotAllowedError: 'Mikrofon-Zugriff verweigert. Erlaube ihn in den Einstellungen deines Browsers.',
  SecurityError: 'Mikrofon-Zugriff verweigert. Erlaube ihn in den Einstellungen deines Browsers.',
  NotFoundError: 'Kein Mikrofon gefunden.',
  NotReadableError: 'Das Mikrofon wird gerade von einer anderen App benutzt.',
};

export type RecorderState = 'idle' | 'requesting' | 'recording';

/**
 * Records one voice message. `stop(true)` hands the finished recording to `onDone`, `stop(false)`
 * discards it. Recording stops by itself after VOICE_MAX_SECONDS.
 */
export function useVoiceRecorder(onDone: (audio: Blob, durationMs: number) => void) {
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<{
    recorder: MediaRecorder;
    stream: MediaStream;
    chunks: Blob[];
    startedAt: number;
    send: boolean;
    timer: ReturnType<typeof setInterval>;
  } | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const stop = useCallback((send: boolean) => {
    const r = rec.current;
    if (!r) return;
    r.send = send;
    if (r.recorder.state !== 'inactive') r.recorder.stop();
  }, []);

  const start = useCallback(async () => {
    if (rec.current || !recorderSupported()) return;
    setError(null);
    setState('requesting');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      setError(RECORDER_ERRORS[name] ?? 'Aufnahme nicht möglich.');
      setState('idle');
      return;
    }
    const mimeType = pickRecorderMime((t) => MediaRecorder.isTypeSupported(t));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const ms = Date.now() - startedAt;
      setElapsedMs(ms);
      if (ms >= VOICE_MAX_SECONDS * 1000) stop(true);
    }, 200);
    rec.current = { recorder, stream, chunks, startedAt, send: false, timer };

    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunks.push(ev.data);
    };
    recorder.onstop = () => {
      const r = rec.current;
      rec.current = null;
      clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      setState('idle');
      setElapsedMs(0);
      if (!r?.send) return;
      const durationMs = Math.min(Date.now() - startedAt, VOICE_MAX_SECONDS * 1000);
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
      if (blob.size === 0) {
        setError('Die Aufnahme ist leer.');
        return;
      }
      if (blob.size > VOICE_MAX_BYTES) {
        setError('Die Aufnahme ist zu groß (max. 5 MB).');
        return;
      }
      onDoneRef.current(blob, durationMs);
    };
    // Timeslice: data arrives during recording, so a long message is not one huge chunk.
    recorder.start(1000);
    setState('recording');
  }, [stop]);

  // Leaving the channel mid-recording releases the microphone.
  useEffect(() => () => stop(false), [stop]);

  return { supported: recorderSupported(), state, elapsedMs, error, start, stop };
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
