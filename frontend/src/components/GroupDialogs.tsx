import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  GROUP_MAX_MEMBERS,
  GROUP_NAME_MAX_LEN,
  type DmChannelDto,
  type PublicUserDto,
} from '@disslxt/shared';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import { conversationName, nameOf } from '../profile';
import { useAuthStore } from '../store/auth';
import { useChatStore } from '../store/chat';
import { Avatar, Icon } from './Icon';
import { Modal } from './Modal';

/** Two overlapping pictures for a group (or one, when only one other person is left). */
export function GroupAvatar({ members }: { members: PublicUserDto[] }) {
  const [a, b] = members;
  if (!a) {
    return (
      <span className="group-avatar single">
        <Avatar name="?" size="sm" />
      </span>
    );
  }
  return (
    <span className={`group-avatar${b ? '' : ' single'}`} aria-hidden="true">
      <Avatar name={nameOf(a)} url={a.avatarUrl} size="sm" />
      {b && <Avatar name={nameOf(b)} url={b.avatarUrl} size="sm" />}
    </span>
  );
}

/** Pick friends (at least two) and optionally a name. */
export function CreateGroupDialog({ onClose }: { onClose: () => void }) {
  const allFriends = useChatStore((s) => s.friends);
  const friends = allFriends.filter((f) => f.status === 'friend');
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const full = picked.length >= GROUP_MAX_MEMBERS - 1;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { dm } = await api.createGroup(picked, name.trim() || undefined);
      useChatStore.getState().upsertDm(dm);
      onClose();
      navigate(`/me/${dm.channel.id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Neue Gruppe" onClose={onClose} testId="create-group-dialog">
      <form className="group-form" onSubmit={(e) => void submit(e)}>
        <label>
          Name (optional)
          <input
            value={name}
            maxLength={GROUP_NAME_MAX_LEN}
            placeholder="z. B. Spieleabend"
            data-testid="group-name-input"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <fieldset className="pick-list">
          <legend>
            Freunde wählen ({picked.length}/{GROUP_MAX_MEMBERS - 1})
          </legend>
          {friends.length < 2 && (
            <p className="muted">Für eine Gruppe brauchst du mindestens zwei Freunde.</p>
          )}
          {friends.map((f) => {
            const on = picked.includes(f.user.id);
            return (
              <label key={f.user.id} className={`pick-row${on ? ' on' : ''}`}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!on && full}
                  data-testid={`group-pick-${f.user.username}`}
                  onChange={() =>
                    setPicked((p) => (on ? p.filter((id) => id !== f.user.id) : [...p, f.user.id]))
                  }
                />
                <Avatar name={nameOf(f.user)} url={f.user.avatarUrl} size="sm" />
                <span>{nameOf(f.user)}</span>
                <span className="muted">@{f.user.username}</span>
              </label>
            );
          })}
        </fieldset>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button
            type="submit"
            className="btn primary"
            disabled={busy || picked.length < 2}
            data-testid="group-create-submit"
          >
            Gruppe erstellen
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Members, name, adding friends, removing (owner) and leaving. */
export function GroupInfoDialog({ dm, onClose }: { dm: DmChannelDto; onClose: () => void }) {
  const me = useAuthStore((s) => s.user);
  const live = useChatStore((s) => s.dms.find((d) => d.channel.id === dm.channel.id)) ?? dm;
  const allFriends = useChatStore((s) => s.friends);
  const friends = allFriends.filter((f) => f.status === 'friend');
  const [name, setName] = useState(live.channel.name);
  const [adding, setAdding] = useState('');
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const id = live.channel.id;
  const isOwner = live.ownerId === me?.id;
  const memberIds = new Set(live.members.map((m) => m.id));
  const addable = friends.filter((f) => !memberIds.has(f.user.id));
  const full = live.members.length + 1 >= GROUP_MAX_MEMBERS;

  async function run(action: () => Promise<DmChannelDto | void>) {
    setBusy(true);
    setError(null);
    try {
      const dmNext = await action();
      if (dmNext) useChatStore.getState().upsertDm(dmNext);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={conversationName(live)} onClose={onClose} testId="group-info-dialog">
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => (await api.renameGroup(id, name.trim())).dm);
        }}
      >
        <label className="field">
          <span>Gruppenname</span>
          <input
            value={name}
            maxLength={GROUP_NAME_MAX_LEN}
            placeholder="Ohne Namen: die Namen der Mitglieder"
            data-testid="group-rename-input"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button
          type="submit"
          className="btn primary"
          disabled={busy || name.trim() === live.channel.name}
        >
          Speichern
        </button>
      </form>

      <h3 className="settings-subheading">
        <Icon name="users" size={16} />
        {live.members.length + 1} Personen
      </h3>
      <ul className="friend-list" data-testid="group-members">
        {me && (
          <li className="friend-row">
            <Avatar name={nameOf(me)} url={me.avatarUrl} />
            <span className="friend-names">
              <strong>{nameOf(me)} (du)</strong>
              {isOwner && <span className="muted">hat die Gruppe erstellt</span>}
            </span>
          </li>
        )}
        {live.members.map((m) => (
          <li key={m.id} className="friend-row" data-testid={`group-member-${m.username}`}>
            <Avatar name={nameOf(m)} url={m.avatarUrl} />
            <span className="friend-names">
              <strong>{nameOf(m)}</strong>
              <span className="muted">
                @{m.username}
                {live.ownerId === m.id ? ' · hat die Gruppe erstellt' : ''}
              </span>
            </span>
            {isOwner && (
              <button
                className="icon-btn"
                disabled={busy}
                aria-label={`${nameOf(m)} entfernen`}
                title="Aus der Gruppe entfernen"
                data-testid={`group-remove-${m.username}`}
                onClick={() => void run(() => api.removeGroupMember(id, m.id))}
              >
                <Icon name="close" size={18} />
              </button>
            )}
          </li>
        ))}
      </ul>

      {!full && addable.length > 0 && (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (adding)
              void run(async () => (await api.addGroupMember(id, adding)).dm).then(() =>
                setAdding(''),
              );
          }}
        >
          <label className="field">
            <span>Freund hinzufügen</span>
            <select
              value={adding}
              data-testid="group-add-select"
              onChange={(e) => setAdding(e.target.value)}
            >
              <option value="">Freund wählen…</option>
              {addable.map((f) => (
                <option key={f.user.id} value={f.user.id}>
                  {nameOf(f.user)} (@{f.user.username})
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="btn"
            disabled={busy || !adding}
            data-testid="group-add-submit"
          >
            <Icon name="user-plus" size={16} />
            Hinzufügen
          </button>
        </form>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        {confirmLeave ? (
          <>
            <span className="muted">Gruppe wirklich verlassen?</span>
            <button
              className="btn danger"
              disabled={busy}
              data-testid="group-leave-confirm"
              onClick={() =>
                void run(async () => {
                  await api.removeGroupMember(id, 'me');
                  useChatStore.getState().removeDm(id);
                  onClose();
                  navigate('/me');
                })
              }
            >
              Verlassen
            </button>
            <button className="btn" onClick={() => setConfirmLeave(false)}>
              Nein
            </button>
          </>
        ) : (
          <>
            <button
              className="btn danger-outline"
              data-testid="group-leave"
              onClick={() => setConfirmLeave(true)}
            >
              <Icon name="door" size={16} />
              Gruppe verlassen
            </button>
            <button className="btn" onClick={onClose}>
              Fertig
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
