import { useState } from 'react';
import type { ChannelDto } from '@disslxt/shared';
import { useAuthStore } from '../store/auth';
import { useVoiceStore, type VoicePeerState } from '../store/voice';
import { useVoice, voiceSupported } from '../voice/VoiceProvider';
import { ConnectionBanner } from './ConnectionBanner';
import { Avatar, Icon } from './Icon';
import { VoiceSetupDialog } from './VoiceSetupDialog';

const EMPTY: never[] = [];

const CONNECTION_TEXT: Record<string, string> = {
  new: 'Verbinde…',
  connecting: 'Verbinde…',
  disconnected: 'Verbindung unterbrochen…',
  failed: 'Keine Verbindung',
  closed: 'Getrennt',
};

/** Main pane of a voice channel: who is there, join/leave, mute. */
export function VoiceChannelView({
  channel,
  onOpenMenu,
}: {
  channel: ChannelDto;
  onOpenMenu: () => void;
}) {
  const voice = useVoice();
  const me = useAuthStore((s) => s.user);
  const inChannelId = useVoiceStore((s) => s.channelId);
  const status = useVoiceStore((s) => s.status);
  const muted = useVoiceStore((s) => s.muted);
  const selfSpeaking = useVoiceStore((s) => s.selfSpeaking);
  const peers = useVoiceStore((s) => s.peers);
  const error = useVoiceStore((s) => s.error);
  const participants = useVoiceStore((s) => s.participants[channel.id] ?? EMPTY);
  const here = inChannelId === channel.id;
  const [setup, setSetup] = useState<'join' | 'call' | null>(null);
  const supported = voiceSupported();

  // Inside the channel the live peer list is authoritative; outside, the guild-wide list.
  const others: VoicePeerState[] = here
    ? Object.values(peers)
    : participants
        .filter((p) => p.userId !== me?.id)
        .map((p) => ({ ...p, connection: 'new', speaking: false }));
  const failed = here && others.some((p) => p.connection === 'failed');

  return (
    <section className="chat-view voice-view" aria-label={`Sprachkanal ${channel.name}`}>
      <header className="chat-header">
        <button
          className="icon-btn mobile-only"
          data-testid="mobile-menu-button"
          aria-label="Menü öffnen"
          onClick={onOpenMenu}
        >
          <Icon name="menu" />
        </button>
        <h1 className="chat-title" data-testid="channel-title">
          <Icon name="speaker" size={18} />
          {channel.name}
        </h1>
      </header>
      <ConnectionBanner />

      <div
        className="voice-stage"
        data-testid="voice-stage"
        data-status={here ? status : 'outside'}
      >
        <ul className="voice-tiles">
          {here && me && (
            <li
              className={`voice-tile self${selfSpeaking ? ' speaking' : ''}`}
              data-testid={`voice-tile-${me.username}`}
            >
              <Avatar name={me.username} />
              <span className="voice-name">{me.username} (du)</span>
              <span className="voice-sub">
                {status === 'joining' ? 'Verbinde…' : muted ? 'Stummgeschaltet' : 'Verbunden'}
              </span>
              {muted && <Icon name="mic-off" size={16} />}
            </li>
          )}
          {others.map((p) => (
            <li
              key={p.peerId}
              className={`voice-tile${p.speaking ? ' speaking' : ''}`}
              data-testid={`voice-tile-${p.username}`}
              data-connection={here ? p.connection : 'outside'}
            >
              <Avatar name={p.username} />
              <span className="voice-name">{p.username}</span>
              <span className="voice-sub">
                {here
                  ? p.connection === 'connected'
                    ? p.muted
                      ? 'Stummgeschaltet'
                      : 'Verbunden'
                    : (CONNECTION_TEXT[p.connection] ?? '')
                  : 'Im Kanal'}
              </span>
              {p.muted && <Icon name="mic-off" size={16} />}
            </li>
          ))}
        </ul>
        {!here && others.length === 0 && (
          <p className="voice-empty muted">
            Noch niemand da. Tritt bei und die anderen bekommen Bescheid.
          </p>
        )}
        {error && (
          <p className="form-error" role="alert" data-testid="voice-error">
            {error}
          </p>
        )}
        {failed && (
          <p className="settings-hint" data-testid="voice-failed-hint">
            Zu manchen Teilnehmenden kommt keine direkte Verbindung zustande (z. B. strenge Firewall
            oder Mobilfunk). Abhilfe schafft ein TURN-Server – siehe README.
          </p>
        )}
      </div>

      <footer className="voice-controls">
        {!supported ? (
          <p className="muted">Dieser Browser unterstützt keine Sprachkanäle.</p>
        ) : here ? (
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
              className="btn round"
              data-testid="voice-devices"
              aria-label="Audio-Geräte"
              title="Audio-Geräte"
              onClick={() => setSetup('call')}
            >
              <Icon name="gear" size={22} />
            </button>
            <button
              className="btn round danger"
              data-testid="voice-leave"
              aria-label="Verlassen"
              title="Verlassen"
              onClick={() => voice?.leave()}
            >
              <Icon name="phone-off" size={22} />
            </button>
          </>
        ) : (
          <button
            className="btn primary"
            data-testid="voice-join"
            disabled={!voice}
            onClick={() => setSetup('join')}
          >
            <Icon name="headphones" size={20} />
            {inChannelId ? 'Hierher wechseln' : 'Beitreten'}
          </button>
        )}
      </footer>
      {setup && (
        <VoiceSetupDialog
          mode={setup}
          channelName={channel.name}
          onJoin={(devices) => void voice?.join(channel.id, channel.guildId, devices)}
          onClose={() => setSetup(null)}
        />
      )}
    </section>
  );
}
