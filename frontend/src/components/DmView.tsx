import { useEffect, useState } from 'react';
import type { DmChannelDto } from '@disslxt/shared';
import { api } from '../api/endpoints';
import { conversationName, nameOf } from '../profile';
import { useAuthStore } from '../store/auth';
import { useChatStore } from '../store/chat';
import { usePrefs } from '../store/prefs';
import { useVoiceStore, type VoicePeerState } from '../store/voice';
import { useVoice, voiceSupported } from '../voice/VoiceProvider';
import { CallControls, CallTiles } from './CallTiles';
import { ChatView } from './ChatView';
import { GroupAvatar, GroupInfoDialog } from './GroupDialogs';
import { Avatar, Icon } from './Icon';

const EMPTY: never[] = [];

/** Starts or joins the call of a private conversation with the devices from the settings. */
export function useStartCall() {
  const voice = useVoice();
  return (channelId: string, video: boolean) => {
    const { audioInputId, audioOutputId } = usePrefs.getState();
    void voice?.join(
      channelId,
      null,
      { inputId: audioInputId, outputId: audioOutputId },
      { video },
    );
  };
}

/** The call of a private conversation, above the messages while someone is in it. */
function CallPanel({ dm }: { dm: DmChannelDto }) {
  const me = useAuthStore((s) => s.user);
  const channelId = dm.channel.id;
  const inChannelId = useVoiceStore((s) => s.channelId);
  const peers = useVoiceStore((s) => s.peers);
  const error = useVoiceStore((s) => s.error);
  const participants = useVoiceStore((s) => s.participants[channelId] ?? EMPTY);
  const start = useStartCall();
  const here = inChannelId === channelId;
  const others: VoicePeerState[] = here
    ? Object.values(peers)
    : participants
        .filter((p) => p.userId !== me?.id)
        .map((p) => ({ ...p, connection: 'new' as const, speaking: false }));

  if (!here && others.length === 0) {
    return error ? (
      <p className="call-note form-error" role="alert" data-testid="voice-error">
        {error}
      </p>
    ) : null;
  }
  return (
    <section className="call-panel" aria-label="Anruf" data-testid="call-panel">
      <CallTiles here={here} me={me} others={others} outsideLabel="Im Anruf" />
      {here && others.length === 0 && (
        <p className="call-note" data-testid="call-ringing">
          {dm.channel.kind === 'group'
            ? 'Klingelt bei den anderen…'
            : `Klingelt bei ${nameOf(dm.peer)}…`}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert" data-testid="voice-error">
          {error}
        </p>
      )}
      <div className="voice-controls">
        {here ? (
          <CallControls />
        ) : (
          <>
            <button
              className="btn primary"
              data-testid="call-join"
              onClick={() => start(channelId, false)}
            >
              <Icon name="phone" size={18} />
              Beitreten
            </button>
            <button
              className="btn"
              data-testid="call-join-video"
              onClick={() => start(channelId, true)}
            >
              <Icon name="video" size={18} />
              Mit Video
            </button>
          </>
        )}
      </div>
    </section>
  );
}

/** A private conversation: the chat, call buttons in the header and the call on top. */
export function DmView({ dm, onOpenMenu }: { dm: DmChannelDto; onOpenMenu: () => void }) {
  const channelId = dm.channel.id;
  const inCall = useVoiceStore((s) => s.channelId === channelId);
  const start = useStartCall();
  const group = dm.channel.kind === 'group';
  const friend = useChatStore((s) =>
    s.friends.some((f) => f.user.id === dm.peer.id && f.status === 'friend'),
  );
  // In a group everyone may write and call; between two only while still friends.
  const open = group || friend;
  const [info, setInfo] = useState(false);
  const supported = voiceSupported();

  // Reading it counts as read; and who is in its call right now (kept current by voice.state).
  useEffect(() => {
    useChatStore.getState().markDmRead(channelId);
    api.callPeers(channelId).then(
      (r) =>
        useVoiceStore.setState((s) => ({
          participants: { ...s.participants, [channelId]: r.peers },
        })),
      () => undefined,
    );
  }, [channelId]);

  const name = conversationName(dm);
  return (
    <>
      <ChatView
        channel={dm.channel}
        onOpenMenu={onOpenMenu}
        target={group ? name : `@${name}`}
        title={
          group ? (
            <button
              type="button"
              className="dm-title group-title"
              data-testid="group-info-button"
              title="Gruppe: Mitglieder und Name"
              onClick={() => setInfo(true)}
            >
              <GroupAvatar members={dm.members} />
              <span className="dm-title-name">{name}</span>
              <span className="muted group-count">{dm.members.length + 1}</span>
            </button>
          ) : (
            <span className="dm-title">
              <span className={`member-avatar${dm.online ? ' online' : ''}`}>
                <Avatar name={name} url={dm.peer.avatarUrl} size="sm" />
                <span className="presence-dot" aria-hidden="true" />
              </span>
              <span className="dm-title-name">{name}</span>
              <span className="sr-only">{dm.online ? '(online)' : '(offline)'}</span>
            </span>
          )
        }
        headerActions={
          open && supported && !inCall ? (
            <>
              <button
                className="icon-btn"
                data-testid="call-start"
                aria-label={`${name} anrufen`}
                title="Anrufen"
                onClick={() => start(channelId, false)}
              >
                <Icon name="phone" size={20} />
              </button>
              <button
                className="icon-btn"
                data-testid="call-start-video"
                aria-label={`Videoanruf mit ${name}`}
                title="Videoanruf"
                onClick={() => start(channelId, true)}
              >
                <Icon name="video" size={20} />
              </button>
            </>
          ) : null
        }
        top={
          <>
            {!open && (
              <p className="call-note muted" data-testid="dm-readonly">
                Ihr seid nicht mehr befreundet – die Unterhaltung kann nur noch gelesen werden.
              </p>
            )}
            <CallPanel dm={dm} />
          </>
        }
      />
      {info && <GroupInfoDialog dm={dm} onClose={() => setInfo(false)} />}
    </>
  );
}
