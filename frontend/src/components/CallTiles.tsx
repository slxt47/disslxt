import { useEffect, useRef } from 'react';
import type { UserDto } from '@disslxt/shared';
import { nameOf } from '../profile';
import { useVoiceStore, type VoicePeerState } from '../store/voice';
import { useVoice } from '../voice/VoiceProvider';
import { Avatar, Icon } from './Icon';

const CONNECTION_TEXT: Record<string, string> = {
  new: 'Verbinde…',
  connecting: 'Verbinde…',
  disconnected: 'Verbindung unterbrochen…',
  failed: 'Keine Verbindung',
  closed: 'Getrennt',
};

/** Plays a camera picture. Muted: the sound comes through the hidden audio elements. */
export function VideoView({ stream, mirror = false }: { stream: MediaStream; mirror?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    void el.play().catch(() => undefined);
  }, [stream]);
  return (
    <video
      ref={ref}
      className={`call-video${mirror ? ' mirror' : ''}`}
      autoPlay
      playsInline
      muted
      aria-hidden="true"
    />
  );
}

/**
 * Everyone in a voice channel or call: camera picture where it is on, otherwise the profile
 * picture with a ring while speaking (as in FaceTime).
 */
export function CallTiles({
  here,
  me,
  others,
  outsideLabel = 'Im Kanal',
}: {
  /** This tab is in the call (live state), not just looking at it from outside. */
  here: boolean;
  /** What participants are, seen from outside ("Im Kanal", "Im Anruf"). */
  outsideLabel?: string;
  me: UserDto | null;
  others: VoicePeerState[];
}) {
  const status = useVoiceStore((s) => s.status);
  const muted = useVoiceStore((s) => s.muted);
  const video = useVoiceStore((s) => s.video);
  const localVideo = useVoiceStore((s) => s.localVideo);
  const selfSpeaking = useVoiceStore((s) => s.selfSpeaking);
  const streams = useVoiceStore((s) => s.streams);
  const anyVideo = (here && video) || others.some((p) => here && p.video && streams[p.peerId]);

  return (
    <ul className={`voice-tiles${anyVideo ? ' has-video' : ''}`}>
      {here && me && (
        <li
          className={`voice-tile self${selfSpeaking ? ' speaking' : ''}${video && localVideo ? ' video' : ''}`}
          data-testid={`voice-tile-${me.username}`}
        >
          {video && localVideo ? (
            <VideoView stream={localVideo} mirror />
          ) : (
            <Avatar name={nameOf(me)} url={me.avatarUrl} />
          )}
          <span className="voice-name">{nameOf(me)} (du)</span>
          <span className="voice-sub">
            {status === 'joining' ? 'Verbinde…' : muted ? 'Stummgeschaltet' : 'Verbunden'}
          </span>
          {muted && <Icon name="mic-off" size={16} />}
        </li>
      )}
      {others.map((p) => {
        const stream = here && p.video ? streams[p.peerId] : undefined;
        return (
          <li
            key={p.peerId}
            className={`voice-tile${p.speaking ? ' speaking' : ''}${stream ? ' video' : ''}`}
            data-testid={`voice-tile-${p.username}`}
            data-connection={here ? p.connection : 'outside'}
          >
            {stream ? <VideoView stream={stream} /> : <Avatar name={nameOf(p)} url={p.avatarUrl} />}
            <span className="voice-name">{nameOf(p)}</span>
            <span className="voice-sub">
              {here
                ? p.connection === 'connected'
                  ? p.muted
                    ? 'Stummgeschaltet'
                    : 'Verbunden'
                  : (CONNECTION_TEXT[p.connection] ?? '')
                : outsideLabel}
            </span>
            {p.muted && <Icon name="mic-off" size={16} />}
          </li>
        );
      })}
    </ul>
  );
}

/** Mute, camera, devices, hang up – while in a call. */
export function CallControls({ onDevices }: { onDevices?: () => void }) {
  const voice = useVoice();
  const muted = useVoiceStore((s) => s.muted);
  const video = useVoiceStore((s) => s.video);
  return (
    <>
      <button
        className={`btn round${muted ? ' active' : ''}`}
        data-testid="voice-mute"
        aria-pressed={muted}
        aria-label={muted ? 'Stummschaltung aufheben' : 'Stummschalten'}
        title={muted ? 'Stummschaltung aufheben' : 'Stummschalten'}
        onClick={() => voice?.setMuted(!muted)}
      >
        <Icon name={muted ? 'mic-off' : 'mic'} size={22} />
      </button>
      <button
        className={`btn round${video ? ' on' : ''}`}
        data-testid="voice-camera"
        aria-pressed={video}
        aria-label={video ? 'Kamera ausschalten' : 'Kamera einschalten'}
        title={video ? 'Kamera ausschalten' : 'Kamera einschalten'}
        onClick={() => void voice?.setVideo(!video)}
      >
        <Icon name={video ? 'video' : 'video-off'} size={22} />
      </button>
      {onDevices && (
        <button
          className="btn round"
          data-testid="voice-devices"
          aria-label="Audio-Geräte"
          title="Audio-Geräte"
          onClick={onDevices}
        >
          <Icon name="gear" size={22} />
        </button>
      )}
      <button
        className="btn round danger"
        data-testid="voice-leave"
        aria-label="Auflegen"
        title="Auflegen"
        onClick={() => voice?.leave()}
      >
        <Icon name="phone-off" size={22} />
      </button>
    </>
  );
}
