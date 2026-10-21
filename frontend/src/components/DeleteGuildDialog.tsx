import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GuildDto } from '@disslxt/shared';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import { useChatStore } from '../store/chat';
import { Modal } from './Modal';

/** Deleting needs the guild name typed again: it removes every channel and message for everyone. */
export function DeleteGuildDialog({ guild, onClose }: { guild: GuildDto; onClose: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = name.trim() === guild.name;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!matches) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteGuild(guild.id, name.trim());
      useChatStore.getState().removeGuild(guild.id);
      onClose();
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal title="Server löschen?" onClose={onClose} testId="delete-guild-dialog">
      <form className="dialog-form" onSubmit={onSubmit} noValidate>
        <p>
          <strong>{guild.name}</strong> wird für alle Mitglieder gelöscht – mit allen Kanälen,
          Nachrichten und Sprachnachrichten. Das lässt sich nicht rückgängig machen.
        </p>
        <label>
          Zum Bestätigen den Servernamen eingeben
          <input
            data-testid="delete-guild-name"
            value={name}
            autoFocus
            autoComplete="off"
            placeholder={guild.name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
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
            className="btn danger"
            data-testid="delete-guild-confirm"
            disabled={!matches || busy}
          >
            Endgültig löschen
          </button>
        </div>
      </form>
    </Modal>
  );
}
