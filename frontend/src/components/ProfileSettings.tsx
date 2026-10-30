import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  BADGES_SHOWN_MAX,
  DISPLAY_NAME_MAX_LEN,
  STATUS_TEXT_MAX_LEN,
  textLength,
  type BadgeDto,
} from '@disslxt/shared';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import { squareImage } from '../lib/image';
import { nameOf } from '../profile';
import { useAuthStore } from '../store/auth';
import { useChatStore } from '../store/chat';
import { EmojiPicker, UserBadges } from './Social';
import { Avatar, Icon } from './Icon';

/** Larger originals are not even decoded; they are shrunk to 256 px before the upload anyway. */
const AVATAR_SOURCE_MAX_BYTES = 20 * 1024 * 1024;

/** "Profil": picture and display name, seen by everyone in your servers and your friends. */
export function ProfileSettings() {
  const user = useAuthStore((s) => s.user);
  const [name, setName] = useState(user?.displayName ?? '');
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [statusEmoji, setStatusEmoji] = useState<string | null>(user?.status?.emoji ?? null);
  const [statusText, setStatusText] = useState(user?.status?.text ?? '');
  const [available, setAvailable] = useState<BadgeDto[]>([]);
  const role = user?.role;
  useEffect(() => {
    api.myBadges().then(
      (r) => setAvailable(r.available),
      () => undefined,
    );
  }, [role]);
  const guilds = useChatStore((s) => s.guilds);
  const tagged = guilds.filter((g) => g.tag);
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
      const { user: u } = await api.updateProfile({ displayName: name.trim() || null });
      apply(u);
      setName(u.displayName ?? '');
      return u.displayName ? 'Anzeigename gespeichert.' : 'Anzeigename entfernt.';
    });
  }

  function pickImage(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setInfo(null);
      setError('Bitte ein Bild wählen (JPEG, PNG, WebP oder GIF).');
      return;
    }
    if (file.size > AVATAR_SOURCE_MAX_BYTES) {
      setInfo(null);
      setError('Das Bild ist zu groß (höchstens 20 MB).');
      return;
    }
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
      <h4 className="settings-subheading">Abzeichen</h4>
      <fieldset className="badge-picker" disabled={busy} data-testid="badge-picker">
        <legend className="settings-hint">
          Wähle bis zu {BADGES_SHOWN_MAX} Abzeichen, die neben deinem Namen stehen.
        </legend>
        {available.map((b) => {
          const checked = (user.badges ?? []).includes(b.id);
          const full = !checked && (user.badges ?? []).length >= BADGES_SHOWN_MAX;
          return (
            <label key={b.id} className="badge-option" title={b.description}>
              <input
                type="checkbox"
                checked={checked}
                disabled={full}
                data-testid={`badge-option-${b.id}`}
                onChange={() => {
                  const now = user.badges ?? [];
                  const next = checked ? now.filter((id) => id !== b.id) : [...now, b.id];
                  void run(async () => {
                    apply((await api.setBadges(next)).user);
                    return 'Abzeichen gespeichert.';
                  });
                }}
              />
              <span aria-hidden="true">{b.emoji}</span> {b.label}
            </label>
          );
        })}
      </fieldset>

      <h4 className="settings-subheading">Status</h4>
      <form
        className="inline-form status-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const { user: u } = await api.updateProfile({
              statusEmoji,
              statusText: statusText.trim(),
            });
            apply(u);
            return u.status ? 'Status gespeichert.' : 'Status entfernt.';
          });
        }}
      >
        <EmojiPicker
          value={statusEmoji}
          onChange={setStatusEmoji}
          label="Status-Emoji"
          testId="status-emoji"
        />
        <label className="field">
          <span className="sr-only">Status-Text</span>
          <input
            value={statusText}
            maxLength={STATUS_TEXT_MAX_LEN}
            placeholder="Was machst du gerade?"
            data-testid="status-text"
            onChange={(e) => setStatusText(e.target.value)}
          />
        </label>
        <button className="btn primary" type="submit" disabled={busy} data-testid="status-save">
          Speichern
        </button>
      </form>

      <h4 className="settings-subheading">Server-Tag</h4>
      {tagged.length === 0 ? (
        <p className="settings-hint">
          Keiner deiner Server hat einen Tag. Besitzer:innen legen ihn in den Server-Einstellungen
          fest.
        </p>
      ) : (
        <label className="field">
          <span>Diesen Server neben deinem Namen zeigen</span>
          <select
            value={user.tag?.guildId ?? ''}
            disabled={busy}
            data-testid="tag-select"
            onChange={(e) =>
              void run(async () => {
                const { user: u } = await api.updateProfile({ tagGuildId: e.target.value || null });
                apply(u);
                return u.tag ? `Du zeigst jetzt ${u.tag.text}.` : 'Kein Server-Tag mehr.';
              })
            }
          >
            <option value="">Keinen</option>
            {tagged.map((g) => (
              <option key={g.id} value={g.id}>
                {g.tagEmoji ? `${g.tagEmoji} ` : ''}
                {g.tag} – {g.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {(user.tag || (user.badges?.length ?? 0) > 0) && (
        <p className="settings-hint">
          So sehen dich andere: <strong>{nameOf(user)}</strong> <UserBadges user={user} />
        </p>
      )}

      <p className="settings-hint">
        Dein Benutzername <strong>@{user.username}</strong> bleibt gleich – damit können dich andere
        als Freund hinzufügen. Leer lassen, um ihn auch als Namen zu zeigen.
      </p>
    </section>
  );
}
