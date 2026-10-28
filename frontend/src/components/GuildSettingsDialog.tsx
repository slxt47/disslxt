import { useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { GUILD_NAME_MAX_LEN, type GuildDto } from '@disslxt/shared';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import { squareImage } from '../lib/image';
import { useChatStore } from '../store/chat';
import { Icon, nameHue } from './Icon';
import { Modal } from './Modal';
import { EmojiPicker } from './Social';
import { guildInitials } from './ServerList';

/** Owner only: name and picture of a server. Changes show up for every member right away. */
export function GuildSettingsDialog({ guild, onClose }: { guild: GuildDto; onClose: () => void }) {
  const current = useChatStore((s) => s.guilds.find((g) => g.id === guild.id)) ?? guild;
  const [name, setName] = useState(current.name);
  const [tag, setTag] = useState(current.tag ?? '');
  const [tagEmoji, setTagEmoji] = useState<string | null>(current.tagEmoji);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function run(action: () => Promise<GuildDto>) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      useChatStore.getState().upsertGuild(await action());
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed === current.name) return;
    void run(async () => (await api.updateGuild(guild.id, { name: trimmed })).guild);
  }

  return (
    <Modal title="Server-Einstellungen" onClose={onClose} testId="guild-settings-dialog">
      <div className="profile-row">
        {current.iconUrl ? (
          <img className="guild-icon-preview" src={current.iconUrl} alt="" />
        ) : (
          <span
            className="guild-icon-preview initials"
            style={{ '--hue': nameHue(current.name) } as CSSProperties}
            aria-hidden="true"
          >
            {guildInitials(current.name)}
          </span>
        )}
        <div className="profile-actions">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            data-testid="guild-icon-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file)
                void run(
                  async () => (await api.uploadGuildIcon(guild.id, await squareImage(file))).guild,
                );
            }}
          />
          <button
            type="button"
            className="btn small"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            <Icon name="image" size={16} />
            {current.iconUrl ? 'Bild ändern' : 'Bild wählen'}
          </button>
          {current.iconUrl && (
            <button
              type="button"
              className="btn small danger-outline"
              disabled={busy}
              onClick={() => void run(async () => (await api.removeGuildIcon(guild.id)).guild)}
            >
              Entfernen
            </button>
          )}
        </div>
      </div>
      <form className="inline-form" onSubmit={submit}>
        <label className="field">
          <span>Servername</span>
          <input
            value={name}
            maxLength={GUILD_NAME_MAX_LEN}
            data-testid="guild-name-input"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button
          className="btn primary"
          type="submit"
          data-testid="guild-name-save"
          disabled={busy || !name.trim() || name.trim() === current.name}
        >
          Speichern
        </button>
      </form>
      <h3 className="settings-subheading">Server-Tag</h3>
      <p className="settings-hint">
        2–4 Buchstaben oder Ziffern und ein Emoji. Mitglieder können ihn in ihrem Profil neben ihrem
        Namen zeigen und so euren Server vertreten.
      </p>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            async () => (await api.updateGuild(guild.id, { tag: tag.trim(), tagEmoji })).guild,
          );
        }}
      >
        <EmojiPicker
          value={tagEmoji}
          onChange={setTagEmoji}
          label="Tag-Emoji"
          testId="guild-tag-emoji"
        />
        <label className="field">
          <span className="sr-only">Tag</span>
          <input
            value={tag}
            maxLength={4}
            placeholder="z. B. GAME"
            autoCapitalize="characters"
            data-testid="guild-tag-input"
            onChange={(e) => setTag(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          />
        </label>
        <button
          className="btn primary"
          type="submit"
          data-testid="guild-tag-save"
          disabled={busy || (tag.length > 0 && tag.length < 2)}
        >
          {tag ? 'Tag speichern' : 'Tag entfernen'}
        </button>
      </form>
      {saved && <p className="form-info">Gespeichert – alle Mitglieder sehen es sofort.</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button className="btn" onClick={onClose}>
          Fertig
        </button>
      </div>
    </Modal>
  );
}
