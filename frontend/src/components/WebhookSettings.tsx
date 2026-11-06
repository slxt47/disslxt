import { useCallback, useEffect, useState } from 'react';
import type { WebhookDto } from '@disslxt/shared';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';

/** Programs that may post here. The secret is shown once, right after creating a hook. */
export function WebhookSettings({ channelId }: { channelId: string }) {
  const [hooks, setHooks] = useState<WebhookDto[]>([]);
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState<{ url: string; token: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.listWebhooks(channelId).then(
      (r) => setHooks(r.webhooks),
      () => undefined,
    );
  }, [channelId]);
  useEffect(load, [load]);

  async function run(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <>
      <h3 className="settings-subheading">Webhooks</h3>
      <p className="settings-hint">Programme können hier als Bot schreiben.</p>
      <ul className="session-list" data-testid="webhook-list">
        {hooks.map((h) => (
          <li key={h.id}>
            <span>
              <strong>{h.name}</strong>
            </span>
            <button
              className="btn small"
              data-testid="webhook-delete"
              onClick={() => void run(() => api.deleteWebhook(channelId, h.id))}
            >
              Löschen
            </button>
          </li>
        ))}
      </ul>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const { webhook, token } = await api.createWebhook(channelId, name.trim());
            setFresh({ url: `${window.location.origin}/api/hooks/${webhook.id}`, token });
            setName('');
          });
        }}
      >
        <input
          aria-label="Name des Webhooks"
          placeholder="Name, z. B. Server"
          maxLength={32}
          value={name}
          data-testid="webhook-name"
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn" data-testid="webhook-add" disabled={!name.trim()}>
          Anlegen
        </button>
      </form>
      {fresh && (
        <p className="settings-hint" data-testid="webhook-secret">
          Nur jetzt sichtbar. POST an <code>{fresh.url}</code> mit Kopfzeile{' '}
          <code>Authorization: Bearer {fresh.token}</code> und JSON{' '}
          <code>{'{"content":"Text"}'}</code>.
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
