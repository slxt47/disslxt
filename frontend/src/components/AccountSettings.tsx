import { useState, type FormEvent } from 'react';
import { errorMessage } from '../api/client';
import { useAuthStore } from '../store/auth';
import { useChatStore } from '../store/chat';

/**
 * "Konto löschen" at the end of the settings. Unfolds in place (no second dialog on top of the
 * settings): says what goes with it – naming the servers you own – and asks for the password.
 */
export function AccountSettings() {
  const me = useAuthStore((s) => s.user);
  const deleteAccount = useAuthStore((s) => s.deleteAccount);
  const guilds = useChatStore((s) => s.guilds);
  const owned = guilds.filter((g) => g.ownerId === me?.id);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      // Signed out now: the app's guard takes this browser to the sign-in page.
      await deleteAccount(password);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <section className="settings-section" aria-labelledby="settings-account">
      <h3 id="settings-account">Konto</h3>
      {!open ? (
        <div className="account-row">
          <p className="muted">Dein Konto mit allen Nachrichten und Dateien endgültig löschen.</p>
          <button
            className="btn danger-outline"
            data-testid="account-delete-open"
            onClick={() => setOpen(true)}
          >
            Konto löschen…
          </button>
        </div>
      ) : (
        <form
          className="dialog-form danger-zone"
          onSubmit={onSubmit}
          noValidate
          data-testid="account-delete-form"
        >
          <p>
            <strong>Das lässt sich nicht rückgängig machen.</strong> Gelöscht werden dein Profil,
            alle deine Nachrichten, Bilder, Dateien und Sprachnachrichten – auch in fremden Servern
            –, deine privaten Chats und Freundschaften.
          </p>
          {owned.length > 0 && (
            <p data-testid="account-delete-owned">
              Diese Server gehören dir und werden für alle Mitglieder gelöscht:{' '}
              <strong>{owned.map((g) => g.name).join(', ')}</strong>
            </p>
          )}
          <label>
            Zum Bestätigen dein Passwort
            <input
              type="password"
              autoComplete="current-password"
              data-testid="account-delete-password"
              value={password}
              autoFocus
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setOpen(false);
                setPassword('');
                setError(null);
              }}
            >
              Abbrechen
            </button>
            <button
              type="submit"
              className="btn danger"
              data-testid="account-delete-confirm"
              disabled={!password || busy}
            >
              {busy ? 'Wird gelöscht…' : 'Konto endgültig löschen'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
