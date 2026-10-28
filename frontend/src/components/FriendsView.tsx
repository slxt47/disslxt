import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { FriendDto } from '@disslxt/shared';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import { nameOf } from '../profile';
import { useChatStore } from '../store/chat';
import { voiceSupported } from '../voice/VoiceProvider';
import { ConnectionBanner } from './ConnectionBanner';
import { useStartCall } from './DmView';
import { Avatar, Icon } from './Icon';

type Tab = 'all' | 'online' | 'requests';

/** Friends: add by username, answer requests, open a conversation or call. */
export function FriendsView({ onOpenMenu }: { onOpenMenu: () => void }) {
  const friends = useChatStore((s) => s.friends);
  const loaded = useChatStore((s) => s.friendsLoaded);
  const requests = friends.filter((f) => f.status !== 'friend');
  const incoming = requests.filter((f) => f.status === 'incoming').length;
  const [tab, setTab] = useState<Tab>(incoming > 0 ? 'requests' : 'all');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The last request was answered: show the friends again instead of an empty list.
  useEffect(() => {
    if (tab === 'requests' && requests.length === 0) setTab('all');
  }, [tab, requests.length]);

  const shown =
    tab === 'requests'
      ? requests
      : friends.filter((f) =>
          tab === 'all'
            ? f.status !== 'outgoing' // open requests to you stay visible on top
            : f.status === 'friend' && f.online,
        );

  async function add(e: FormEvent) {
    e.preventDefault();
    const name = username.trim().replace(/^@/, '');
    if (!name) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const { friend } = await api.requestFriend(name);
      useChatStore.getState().upsertFriend(friend);
      setUsername('');
      setInfo(
        friend.status === 'friend'
          ? `Ihr seid jetzt befreundet: ${nameOf(friend.user)}.`
          : `Anfrage an @${friend.user.username} geschickt.`,
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="chat-view friends-view" aria-label="Freunde">
      <header className="chat-header">
        <button
          className="icon-btn mobile-only"
          data-testid="mobile-menu-button"
          aria-label="Menü öffnen"
          onClick={onOpenMenu}
        >
          <Icon name="menu" />
        </button>
        <h1 className="chat-title">
          <Icon name="users" size={18} />
          Freunde
        </h1>
      </header>
      <ConnectionBanner />
      <div className="friends-body">
        <form className="add-friend" onSubmit={(e) => void add(e)}>
          <label className="field">
            <span>Freund hinzufügen</span>
            <input
              value={username}
              placeholder="Benutzername, z. B. @anna"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              data-testid="add-friend-input"
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <button
            className="btn primary"
            type="submit"
            disabled={busy || !username.trim()}
            data-testid="add-friend-submit"
          >
            <Icon name="user-plus" size={18} />
            Anfrage senden
          </button>
        </form>
        {info && <p className="form-info">{info}</p>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="segmented three" role="tablist" aria-label="Freunde filtern">
          {(
            [
              ['all', 'Alle'],
              ['online', 'Online'],
              ['requests', `Anfragen${incoming ? ` (${incoming})` : ''}`],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              aria-checked={tab === value}
              data-testid={`friends-tab-${value}`}
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </div>

        {!loaded ? (
          <p className="muted">Lädt…</p>
        ) : shown.length === 0 ? (
          <div className="empty-state" data-testid="friends-empty">
            <h2>
              {tab === 'requests'
                ? 'Keine offenen Anfragen'
                : tab === 'online'
                  ? 'Gerade niemand online'
                  : 'Noch keine Freunde'}
            </h2>
            <p className="muted">
              {tab === 'all'
                ? 'Füge oben jemanden über den Benutzernamen hinzu. Mit Freunden kannst du privat schreiben, Dateien teilen und telefonieren – auch mit Video.'
                : ''}
            </p>
          </div>
        ) : (
          <ul className="friend-list" data-testid="friend-list">
            {shown.map((f) => (
              <FriendRow key={f.user.id} friend={f} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

const STATUS_TEXT = { incoming: 'Möchte mit dir befreundet sein', outgoing: 'Anfrage gesendet' };

function FriendRow({ friend }: { friend: FriendDto }) {
  const navigate = useNavigate();
  const start = useStartCall();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const { user } = friend;
  const name = nameOf(user);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (err) {
      useChatStore.getState().setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const openDm = (then?: (channelId: string) => void) =>
    run(async () => {
      const { dm } = await api.openDm(user.id);
      useChatStore.getState().upsertDm(dm);
      navigate(`/me/${dm.channel.id}`);
      then?.(dm.channel.id);
    });

  return (
    <li className="friend-row" data-testid={`friend-${user.username}`} data-status={friend.status}>
      <span className={`member-avatar${friend.online ? ' online' : ''}`}>
        <Avatar name={name} url={user.avatarUrl} />
        <span className="presence-dot" aria-hidden="true" />
      </span>
      <span className="friend-names">
        <strong>{name}</strong>
        <span className="muted">
          @{user.username}
          {friend.status === 'friend'
            ? friend.online
              ? ' · online'
              : ''
            : ` · ${STATUS_TEXT[friend.status]}`}
        </span>
      </span>
      <span className="friend-actions">
        {friend.status === 'incoming' && (
          <>
            <button
              className="btn small primary"
              disabled={busy}
              data-testid="friend-accept"
              onClick={() =>
                void run(async () => {
                  useChatStore.getState().upsertFriend((await api.acceptFriend(user.id)).friend);
                })
              }
            >
              Annehmen
            </button>
            <button
              className="btn small"
              disabled={busy}
              data-testid="friend-decline"
              onClick={() =>
                void run(async () => {
                  await api.removeFriend(user.id);
                  useChatStore.getState().removeFriend(user.id);
                })
              }
            >
              Ablehnen
            </button>
          </>
        )}
        {friend.status === 'outgoing' && (
          <button
            className="btn small"
            disabled={busy}
            data-testid="friend-cancel"
            onClick={() =>
              void run(async () => {
                await api.removeFriend(user.id);
                useChatStore.getState().removeFriend(user.id);
              })
            }
          >
            Zurückziehen
          </button>
        )}
        {friend.status === 'friend' &&
          (confirm ? (
            <>
              <span className="muted">Entfernen?</span>
              <button
                className="btn small danger"
                disabled={busy}
                data-testid="friend-remove-confirm"
                onClick={() =>
                  void run(async () => {
                    await api.removeFriend(user.id);
                    useChatStore.getState().removeFriend(user.id);
                  })
                }
              >
                Ja
              </button>
              <button className="btn small" onClick={() => setConfirm(false)}>
                Nein
              </button>
            </>
          ) : (
            <>
              <button
                className="icon-btn"
                disabled={busy}
                data-testid="friend-message"
                aria-label={`Nachricht an ${name}`}
                title="Nachricht"
                onClick={() => void openDm()}
              >
                <Icon name="message" size={20} />
              </button>
              {voiceSupported() && (
                <button
                  className="icon-btn"
                  disabled={busy}
                  data-testid="friend-call"
                  aria-label={`${name} anrufen`}
                  title="Anrufen"
                  onClick={() => {
                    // Known conversation: call right inside the click (iOS needs the gesture
                    // for audio); otherwise open it first.
                    const known = useChatStore.getState().dms.find((d) => d.peer.id === user.id);
                    if (known) {
                      start(known.channel.id, false);
                      navigate(`/me/${known.channel.id}`);
                    } else {
                      void openDm((id) => start(id, false));
                    }
                  }}
                >
                  <Icon name="phone" size={20} />
                </button>
              )}
              <button
                className="icon-btn"
                disabled={busy}
                data-testid="friend-remove"
                aria-label={`${name} als Freund entfernen`}
                title="Entfernen"
                onClick={() => setConfirm(true)}
              >
                <Icon name="close" size={20} />
              </button>
            </>
          ))}
      </span>
    </li>
  );
}
