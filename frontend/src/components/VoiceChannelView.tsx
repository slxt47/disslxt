import { useState } from 'react';
import type { ChannelDto } from '@disslxt/shared';
import { useAuthStore } from '../store/auth';
import { useVoiceStore, type VoicePeerState } from '../store/voice';
import { useVoice, voiceSupported } from '../voice/VoiceProvider';
import { ConnectionBanner } from './ConnectionBanner';
import { CallControls, CallTiles } from './CallTiles';
import { Icon } from './Icon';
import { VoiceSetupDialog } from './VoiceSetupDialog';

const EMPTY: never[] = [];

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
        .map((p) => ({ ...p, connection: 'new' as const, speaking: false }));
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
        <CallTiles here={here} me={me} others={others} />
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
          <CallControls onDevices={() => setSetup('call')} />
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
