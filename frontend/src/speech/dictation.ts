/**
 * Dictation via the Web Speech API (SpeechRecognition). Availability and privacy differ by
 * browser: Chrome/Edge send the audio to the vendor's servers (needs internet), Safari uses
 * Apple's speech service (Siri dictation must be enabled), Firefox has no implementation.
 */

/** Minimal surface of SpeechRecognition used here (not in TypeScript's DOM lib). */
export interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: RecognitionEventLike) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export interface RecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

type RecognitionCtor = new () => RecognitionLike;

export function recognitionCtor(w: object = globalThis): RecognitionCtor | null {
  const g = w as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return g.SpeechRecognition ?? g.webkitSpeechRecognition ?? null;
}

export function dictationSupported(): boolean {
  return recognitionCtor() !== null;
}

export const DICTATION_ERRORS: Record<string, string> = {
  'not-allowed': 'Mikrofon-Zugriff verweigert. Erlaube ihn in den Browser-Einstellungen.',
  'service-not-allowed':
    'Diktieren ist auf diesem Gerät nicht erlaubt (auf iPhone: Einstellungen › Allgemein › Tastaturen › Diktierfunktion).',
  network: 'Diktieren braucht eine Internetverbindung.',
  'audio-capture': 'Kein Mikrofon gefunden.',
  'language-not-supported': 'Deutsch wird von der Spracherkennung nicht unterstützt.',
};

/** Joins the transcripts of all results so far into final and interim text. */
export function transcriptOf(ev: RecognitionEventLike): { final: string; interim: string } {
  let final = '';
  let interim = '';
  for (let i = 0; i < ev.results.length; i++) {
    const r = ev.results[i];
    const text = r?.[0]?.transcript ?? '';
    if (r?.isFinal) final += text;
    else interim += text;
  }
  return { final: final.trim(), interim: interim.trim() };
}
