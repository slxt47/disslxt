import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { createChannelSchema } from '@chat-mvp/shared';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import { useChatStore } from '../store/chat';
import { Modal } from './Modal';

export function CreateChannelDialog({
  guildId,
  onClose,
}: {
  guildId: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = createChannelSchema.safeParse({ name });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Ungültiger Name');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { channel } = await api.createChannel(guildId, parsed.data.name);
      useChatStore.getState().addChannel(channel);
      onClose();
      navigate(`/guilds/${guildId}/channels/${channel.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal title="Kanal erstellen" onClose={onClose} testId="create-channel-dialog">
      <form onSubmit={onSubmit} noValidate className="dialog-form">
        <label>
          Kanalname
          <input
            data-testid="channel-name-input"
            value={name}
            maxLength={32}
            autoFocus
            placeholder="z. B. off-topic"
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
            data-testid="create-channel-submit"
            disabled={busy}
          >
            Erstellen
          </button>
        </div>
      </form>
    </Modal>
  );
}
