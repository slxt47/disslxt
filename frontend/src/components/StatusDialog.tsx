import { useEffect, useState } from 'react';
import type { StatusEntryDto } from '@disslxt/shared';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import { Modal } from './Modal';
import { LineSkeleton } from './Skeleton';

/** /dienste: which of the operator's services answer right now. */
export function StatusDialog({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<StatusEntryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      api.statusBoard().then(
        (r) => setEntries(r.entries),
        (err: unknown) => setError(errorMessage(err)),
      );
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, []);

  const down = entries?.filter((e) => !e.up).length ?? 0;
  return (
    <Modal title="Dienste" onClose={onClose} testId="status-dialog">
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!entries && !error && <LineSkeleton rows={4} />}
      {entries?.length === 0 && <p className="muted">Keine Dienste eingetragen.</p>}
      {entries && entries.length > 0 && (
        <p className="muted" data-testid="status-summary">
          {down === 0 ? 'Alles läuft.' : `${down} von ${entries.length} antworten nicht.`}
        </p>
      )}
      <ul className="status-list">
        {entries?.map((e) => (
          <li key={e.name} data-up={e.up}>
            <span className="status-dot" aria-hidden="true" />
            <span>{e.name}</span>
            <small>{e.up ? `${e.ms} ms` : 'keine Antwort'}</small>
          </li>
        ))}
      </ul>
      <div className="dialog-actions">
        <button className="btn" onClick={onClose}>
          Fertig
        </button>
      </div>
    </Modal>
  );
}
