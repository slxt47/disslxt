import type { MessageDto } from '@disslxt/shared';

/** Read-aloud via speechSynthesis (on-device in all major browsers, works offline). */
export function ttsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/** Best German voice: a local one first (no network, lower latency), else any de-* voice. */
export function pickGermanVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const german = voices.filter((v) => v.lang.toLowerCase().startsWith('de'));
  return (
    german.find((v) => v.localService && v.lang.toLowerCase() === 'de-de') ??
    german.find((v) => v.localService) ??
    german[0] ??
    null
  );
}

/** Spoken form of a message (voice messages are announced, not read). */
export function spokenText(message: Pick<MessageDto, 'author' | 'content'> & { kind?: string }) {
  return message.kind === 'voice'
    ? `${message.author.username} hat eine Sprachnachricht geschickt.`
    : `${message.author.username}: ${message.content}`;
}

/**
 * Speaks `text`. `interrupt` (manual "read aloud") cancels whatever is playing; auto-read
 * queues behind it instead.
 */
export function speak(text: string, opts: { rate?: number; interrupt?: boolean } = {}): void {
  if (!ttsSupported()) return;
  const synth = window.speechSynthesis;
  if (opts.interrupt) synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'de-DE';
  u.rate = opts.rate ?? 1;
  const voice = pickGermanVoice(synth.getVoices());
  if (voice) u.voice = voice;
  synth.speak(u);
}

export function stopSpeaking(): void {
  if (ttsSupported()) window.speechSynthesis.cancel();
}
