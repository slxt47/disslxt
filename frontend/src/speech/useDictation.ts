import { useCallback, useEffect, useRef, useState } from 'react';
import { DICTATION_ERRORS, recognitionCtor, transcriptOf, type RecognitionLike } from './dictation';

/**
 * Dictation into a text field. `onText(base, spoken)` is called with the text that was in the
 * field when dictation started and everything recognised so far (final + interim), so the caller
 * can show interim results live and they get replaced by the final wording.
 */
export function useDictation(onText: (spoken: string) => void) {
  const Ctor = recognitionCtor();
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<RecognitionLike | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const stop = useCallback(() => rec.current?.stop(), []);

  const start = useCallback(() => {
    if (!Ctor || rec.current) return;
    setError(null);
    const r = new Ctor();
    r.lang = 'de-DE';
    r.interimResults = true;
    // iOS Safari ends continuous sessions unpredictably; one utterance per tap is reliable.
    r.continuous = !/iPhone|iPad|iPod/.test(navigator.userAgent);
    r.onresult = (ev) => {
      const { final, interim } = transcriptOf(ev);
      onTextRef.current([final, interim].filter(Boolean).join(' '));
    };
    r.onerror = (ev) => {
      if (ev.error !== 'no-speech' && ev.error !== 'aborted') {
        setError(DICTATION_ERRORS[ev.error] ?? 'Diktieren ist fehlgeschlagen.');
      }
    };
    r.onend = () => {
      rec.current = null;
      setListening(false);
    };
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      rec.current = null;
      setError('Diktieren konnte nicht gestartet werden.');
    }
  }, [Ctor]);

  useEffect(() => () => rec.current?.abort(), []);

  return { supported: !!Ctor, listening, error, start, stop, clearError: () => setError(null) };
}
