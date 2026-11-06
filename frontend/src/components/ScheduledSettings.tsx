import { useCallback, useEffect, useState } from 'react';
import type { ScheduledDto } from '@disslxt/shared';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import { useChatStore } from '../store/chat';

const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

/** What is waiting to be sent or to remind you. */
export function ScheduledSettings() {
  const [list, setList] = useState<ScheduledDto[]>([]);
  const load = useCallback(() => {
    api.listScheduled().then(
      (r) => setList(r.scheduled),
      () => undefined,
    );
  }, []);
  useEffect(load, [load]);

  async function cancel(id: string) {
    try {
      await api.cancelScheduled(id);
      load();
    } catch (err) {
      useChatStore.getState().setError(errorMessage(err));
    }
  }

  return (
    <section className="settings-section" aria-labelledby="settings-scheduled">
      <h3 id="settings-scheduled">Geplant</h3>
      {list.length === 0 ? (
        <p className="settings-hint">
          Nichts geplant. Im Chat: <code>/später 30m Text</code> oder <code>/erinnern 1h Text</code>
          .
        </p>
      ) : (
        <ul className="session-list" data-testid="scheduled-list">
          {list.map((s) => (
            <li key={s.id}>
              <span>
                <strong>{s.content}</strong>
                <small>
                  {s.kind === 'remind' ? 'Erinnerung' : 'Wird gesendet'}{' '}
                  {dateFormat.format(new Date(s.sendAt))}
                </small>
              </span>
              <button className="btn small" onClick={() => void cancel(s.id)}>
                Abbrechen
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
