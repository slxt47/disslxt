import { useRef, useState, type FormEvent } from 'react';
import { DISPLAY_NAME_MAX_LEN, textLength } from '@disslxt/shared';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import { squareImage } from '../lib/image';
import { nameOf } from '../profile';
import { useAuthStore } from '../store/auth';
import { Avatar, Icon } from './Icon';

/** "Profil": picture and display name, seen by everyone in your servers and your friends. */
export function ProfileSettings() {
  const user = useAuthStore((s) => s.user);
  const [name, setName] = useState(user?.displayName ?? '');
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  if (!user) return null;

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      setInfo(await action());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const apply = (u: typeof user) => useAuthStore.setState({ user: u });

  function saveName(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      const { user: u } = await api.updateProfile(name.trim() || null);
      apply(u);
      setName(u.displayName ?? '');
      return u.displayName ? 'Anzeigename gespeichert.' : 'Anzeigename entfernt.';
    });
  }

  function pickImage(file: File | undefined) {
    if (!file) return;
    void run(async () => {
      const { user: u } = await api.uploadAvatar(await squareImage(file));
      apply(u);
      return 'Profilbild gespeichert.';
    });
  }

  const tooLong = textLength(name.trim()) > DISPLAY_NAME_MAX_LEN;
  const unchanged = name.trim() === (user.displayName ?? '');

  return (
    <section className="settings-section" aria-labelledby="settings-profile">
      <h3 id="settings-profile">Profil</h3>
      <div className="profile-row">
        <Avatar name={nameOf(user)} url={user.avatarUrl} size="lg" />
        <div className="profile-actions">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            data-testid="avatar-input"
            onChange={(e) => {
              pickImage(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="btn small"
            disabled={busy}
            data-testid="avatar-change"
            onClick={() => fileRef.current?.click()}
          >
            <Icon name="image" size={16} />
            {user.avatarUrl ? 'Bild ändern' : 'Bild wählen'}
          </button>
          {user.avatarUrl && (
            <button
              type="button"
              className="btn small danger-outline"
              disabled={busy}
              data-testid="avatar-remove"
              onClick={() =>
                void run(async () => {
                  apply((await api.removeAvatar()).user);
                  return 'Profilbild entfernt.';
                })
              }
            >
              Entfernen
            </button>
          )}
        </div>
      </div>
      <form className="inline-form" onSubmit={saveName}>
        <label className="field">
          <span>Anzeigename</span>
          <input
            value={name}
            placeholder={user.username}
            maxLength={64}
            autoComplete="nickname"
            data-testid="display-name-input"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button
          className="btn primary"
          type="submit"
          disabled={busy || tooLong || unchanged}
          data-testid="display-name-save"
        >
          Speichern
        </button>
      </form>
      {tooLong && <p className="form-error small">Höchstens {DISPLAY_NAME_MAX_LEN} Zeichen.</p>}
      {info && <p className="form-info">{info}</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <p className="settings-hint">
        Dein Benutzername <strong>@{user.username}</strong> bleibt gleich – damit können dich andere
        als Freund hinzufügen. Leer lassen, um ihn auch als Namen zu zeigen.
      </p>
    </section>
  );
}
