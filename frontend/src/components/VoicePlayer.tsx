import { useEffect, useRef, useState } from 'react';
import type { VoiceAudioDto } from '@disslxt/shared';
import { formatDuration } from '../speech/useVoiceRecorder';
import { Icon } from './Icon';

/** Compact player for a voice message: play/pause, scrubbable progress, time. */
export function VoicePlayer({ audio }: { audio: VoiceAudioDto }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [failed, setFailed] = useState(false);
  // WebM from MediaRecorder often reports an infinite duration; the server's value is reliable.
  const durationMs = audio.durationMs;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onTime = () => setPosition(el.currentTime * 1000);
    const onEnd = () => {
      setPlaying(false);
      setPosition(0);
    };
    const onPause = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    const onError = () => setFailed(true);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('ended', onEnd);
    el.addEventListener('pause', onPause);
    el.addEventListener('play', onPlay);
    el.addEventListener('error', onError);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('ended', onEnd);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('error', onError);
    };
  }, []);

  function toggle() {
    const el = ref.current;
    if (!el) return;
    if (el.paused) {
      // Only one voice message at a time.
      document.querySelectorAll('audio').forEach((a) => a !== el && a.pause());
      void el.play().catch(() => setFailed(true));
    } else {
      el.pause();
    }
  }

  function seek(ms: number) {
    const el = ref.current;
    if (!el) return;
    el.currentTime = ms / 1000;
    setPosition(ms);
  }

  const progress = durationMs > 0 ? Math.min(1, position / durationMs) : 0;
  return (
    <div className={`voice-player${playing ? ' playing' : ''}`} data-testid="voice-player">
      <audio ref={ref} src={audio.url} preload="metadata" />
      <button
        type="button"
        className="voice-play"
        data-testid="voice-play"
        aria-label={playing ? 'Pause' : 'Sprachnachricht abspielen'}
        onClick={toggle}
      >
        <Icon name={playing ? 'pause' : 'play'} size={18} />
      </button>
      <input
        type="range"
        className="voice-progress"
        aria-label="Position"
        min={0}
        max={Math.max(1, durationMs)}
        step={100}
        value={Math.min(position, durationMs)}
        style={{ '--progress': `${progress * 100}%` } as React.CSSProperties}
        onChange={(e) => seek(Number(e.target.value))}
      />
      <span className="voice-time" data-testid="voice-time">
        {playing || position > 0 ? formatDuration(position) : formatDuration(durationMs)}
      </span>
      {failed && (
        <span className="voice-failed" role="alert">
          Kann nicht abgespielt werden
        </span>
      )}
    </div>
  );
}
