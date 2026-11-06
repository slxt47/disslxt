import { Link } from 'react-router-dom';
import { useChatStore } from '../store/chat';
import { useVoiceStore } from '../store/voice';
import { useVoice } from '../voice/VoiceProvider';
import { conversationName } from '../profile';
import { usePrefs } from '../store/prefs';
import { usePushToTalk } from '../voice/usePushToTalk';
import { Icon } from './Icon';

/** Shown above the user footer while this tab is in a voice channel (from anywhere in the app). */
export function VoiceBar({ onNavigate }: { onNavigate: () => void }) {
  const voice = useVoice();
  const channelId = useVoiceStore((s) => s.channelId);
  const guildId = useVoiceStore((s) => s.guildId);
  const status = useVoiceStore((s) => s.status);
  const muted = useVoiceStore((s) => s.muted);
  const pushToTalk = usePrefs((s) => s.pushToTalk);
  usePushToTalk();
  const channel = useChatStore((s) =>
    guildId ? s.channelsByGuild[guildId]?.find((c) => c.id === channelId) : undefined,
  );
  const dm = useChatStore((s) =>
    guildId ? undefined : s.dms.find((d) => d.channel.id === channelId),
  );
  if (!channelId) return null;
  const to = guildId ? `/guilds/${guildId}/channels/${channelId}` : `/me/${channelId}`;
  const label = guildId ? (channel?.name ?? '') : dm ? `Anruf: ${conversationName(dm)}` : 'Anruf';
  return (
    <div className="voice-bar" data-testid="voice-bar" data-status={status}>
      <Link to={to} className="voice-bar-info" onClick={onNavigate}>
        <strong>{status === 'connected' ? 'Verbunden' : 'Verbinde…'}</strong>
        <span>{label}</span>
      </Link>
      {pushToTalk ? (
        <button
          className={`icon-btn ptt-button${muted ? '' : ' talking'}`}
          data-testid="ptt-button"
          aria-pressed={!muted}
          aria-label="Halten zum Sprechen"
          title="Halten zum Sprechen"
          onPointerDown={() => voice?.setMuted(false)}
          onPointerUp={() => voice?.setMuted(true)}
          onPointerCancel={() => voice?.setMuted(true)}
          onPointerLeave={() => voice?.setMuted(true)}
          onContextMenu={(e) => e.preventDefault()}
        >
          <Icon name="mic" size={20} />
        </button>
      ) : (
        <button
          className={`icon-btn${muted ? ' muted-on' : ''}`}
          aria-pressed={muted}
          aria-label={muted ? 'Stummschaltung aufheben' : 'Stummschalten'}
          onClick={() => voice?.setMuted(!muted)}
        >
          <Icon name={muted ? 'mic-off' : 'mic'} size={20} />
        </button>
      )}
      <button
        className="icon-btn danger"
        data-testid="voice-bar-leave"
        aria-label="Sprachkanal verlassen"
        onClick={() => voice?.leave()}
      >
        <Icon name="phone-off" size={20} />
      </button>
    </div>
  );
}
