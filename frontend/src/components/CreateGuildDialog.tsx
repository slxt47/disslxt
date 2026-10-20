import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { createGuildSchema } from '@chat-mvp/shared';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import { useChatStore } from '../store/chat';
import { Modal } from './Modal';

export function CreateGuildDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = createGuildSchema.safeParse({ name });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Ungültiger Name');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { guild, channels } = await api.createGuild(parsed.data.name);
      const chat = useChatStore.getState();
      chat.upsertGuild(guild);
      chat.setChannels(guild.id, channels);
      onClose();
      const first = channels[0];
      navigate(first ? `/guilds/${guild.id}/channels/${first.id}` : `/guilds/${guild.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal title="Server erstellen" onClose={onClose} testId="create-guild-dialog">
      <form onSubmit={onSubmit} noValidate className="dialog-form">
        <label>
          Name
          <input
            data-testid="guild-name-input"
            value={name}
            maxLength={100}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {error && (
          <p className="form-error" role="alert" data-testid="form-error">
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
            data-testid="create-guild-submit"
            disabled={busy}
          >
            Erstellen
          </button>
        </div>
      </form>
    </Modal>
  );
}
