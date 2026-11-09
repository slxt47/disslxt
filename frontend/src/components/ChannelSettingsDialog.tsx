import { useState, type FormEvent } from 'react';
import { updateChannelSchema, type ChannelDto } from '@disslxt/shared';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import { useChatStore } from '../store/chat';
import { Modal } from './Modal';
import { WebhookSettings } from './WebhookSettings';

const NO_CATEGORIES: never[] = [];

/** Name, description and category of a channel, and deleting it. */
export function ChannelSettingsDialog({
  channel,
  onClose,
}: {
  channel: ChannelDto;
  onClose: () => void;
}) {
  const categories = useChatStore(
    (s) => s.categoriesByGuild[channel.guildId ?? ''] ?? NO_CATEGORIES,
  );
  const [name, setName] = useState(channel.name);
  const [description, setDescription] = useState(channel.description ?? '');
  const [categoryId, setCategoryId] = useState(channel.categoryId ?? '');
  const [confirm, setConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  function save(e: FormEvent) {
    e.preventDefault();
    const parsed = updateChannelSchema.safeParse({
      name,
      description,
      categoryId: categoryId || null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Ungültige Eingabe');
      return;
    }
    void run(() => api.updateChannel(channel.id, parsed.data));
  }

  return (
    <Modal title={`Kanal #${channel.name}`} onClose={onClose} testId="channel-settings">
      <form className="two-factor-form" onSubmit={save}>
        <label className="field">
          <span>Name</span>
          <input
            value={name}
            maxLength={32}
            data-testid="channel-edit-name"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Beschreibung</span>
          <input
            value={description}
            maxLength={200}
            placeholder="Worum geht es hier?"
            data-testid="channel-edit-description"
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Kategorie</span>
          <select
            className="plain-select"
            value={categoryId}
            data-testid="channel-edit-category"
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">Keine</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p className="form-error" role="alert" data-testid="channel-edit-error">
            {error}
          </p>
        )}
        <div className="inline-actions">
          <button className="btn primary" data-testid="channel-edit-save" disabled={busy}>
            Speichern
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
        </div>
      </form>

      {channel.kind === 'text' && <WebhookSettings channelId={channel.id} />}
      <h3 className="settings-subheading">Kanal löschen</h3>
      {deleting ? (
        <form
          className="two-factor-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api.deleteChannel(channel.id, confirm));
          }}
        >
          <p className="settings-hint">
            Alle Nachrichten und Dateien in diesem Kanal sind dann weg, für alle. Gib zur
            Bestätigung <strong>{channel.name}</strong> ein.
          </p>
          <input
            value={confirm}
            aria-label="Kanalname zur Bestätigung"
            data-testid="channel-delete-name"
            onChange={(e) => setConfirm(e.target.value)}
          />
          <button
            className="btn danger"
            data-testid="channel-delete-confirm"
            disabled={busy || confirm.trim() !== channel.name}
          >
            Endgültig löschen
          </button>
        </form>
      ) : (
        <button
          className="btn danger-outline"
          data-testid="channel-delete"
          onClick={() => setDeleting(true)}
        >
          Kanal löschen
        </button>
      )}
    </Modal>
  );
}
