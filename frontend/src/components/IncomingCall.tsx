import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { nameOf } from '../profile';
import { useRealtime } from '../realtime/RealtimeProvider';
import { useVoiceStore } from '../store/voice';
import { useStartCall } from './DmView';
import { Avatar, Icon } from './Icon';

/** Soft two-note ring while a call comes in (silently skipped where audio is not allowed yet). */
function useRingtone(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    let ctx: AudioContext;
    try {
      ctx = new Ctx();
    } catch {
      return;
    }
    const ring = () => {
      if (ctx.state !== 'running') return;
      [659, 784].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const t = ctx.currentTime + i * 0.22;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.12, t + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.22);
      });
    };
    void ctx.resume().then(ring, () => undefined);
    const timer = setInterval(ring, 2200);
    navigator.vibrate?.([300, 200, 300]);
    return () => {
      clearInterval(timer);
      void ctx.close().catch(() => undefined);
    };
  }, [active]);
}

/** A friend calls: answer (with or without camera) or decline, from anywhere in the app. */
export function IncomingCall() {
  const incoming = useVoiceStore((s) => s.incoming);
  const realtime = useRealtime();
  const navigate = useNavigate();
  const start = useStartCall();
  useRingtone(!!incoming);
  if (!incoming) return null;
  const name = nameOf(incoming.from);

  const answer = (video: boolean) => {
    start(incoming.channelId, video);
    useVoiceStore.setState({ incoming: null });
    navigate(`/me/${incoming.channelId}`);
  };
  const decline = () => {
    realtime?.send({ type: 'call.decline', data: { channelId: incoming.channelId } });
    useVoiceStore.setState({ incoming: null });
  };

  return (
    <div
      className="incoming-call"
      role="alertdialog"
      aria-live="assertive"
      aria-label={`Anruf von ${name}`}
      data-testid="incoming-call"
    >
      <Avatar name={name} url={incoming.from.avatarUrl} size="lg" />
      <div className="incoming-text">
        <strong>{name}</strong>
        <span>{incoming.video ? 'Videoanruf…' : 'Ruft an…'}</span>
      </div>
      <div className="incoming-actions">
        <button
          className="btn round danger"
          data-testid="call-decline"
          aria-label="Ablehnen"
          title="Ablehnen"
          onClick={decline}
        >
          <Icon name="phone-off" size={22} />
        </button>
        {incoming.video && (
          <button
            className="btn round accept"
            data-testid="call-accept-video"
            aria-label="Mit Video annehmen"
            title="Mit Video annehmen"
            onClick={() => answer(true)}
          >
            <Icon name="video" size={22} />
          </button>
        )}
        <button
          className="btn round accept"
          data-testid="call-accept"
          aria-label="Annehmen"
          title="Annehmen"
          onClick={() => answer(false)}
        >
          <Icon name="phone" size={22} />
        </button>
      </div>
    </div>
  );
}
