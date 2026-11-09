import { useEffect } from 'react';
import { usePrefs } from '../store/prefs';
import { useVoiceStore } from '../store/voice';
import { useVoice } from './VoiceProvider';

const typingIn = (el: EventTarget | null): boolean =>
  el instanceof HTMLElement && el.matches('input, textarea, select, [contenteditable="true"]');

/** Push-to-talk: while in a call the microphone is only open when the chosen key is held. */
export function usePushToTalk(): void {
  const voice = useVoice();
  const on = usePrefs((s) => s.pushToTalk);
  const key = usePrefs((s) => s.pushToTalkKey);
  const inCall = useVoiceStore((s) => s.channelId !== null);

  useEffect(() => {
    if (!voice || !on || !inCall) return;
    voice.setMuted(true);
    let held = false;
    const release = () => {
      if (held) voice.setMuted(true);
      held = false;
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== key || e.repeat || typingIn(e.target)) return;
      e.preventDefault();
      held = true;
      voice.setMuted(false);
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code === key) release();
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', release);
    };
  }, [voice, on, key, inCall]);
}
