import { useEffect, useState } from 'react';
import { api } from '../api/endpoints';
import { useAuthStore } from '../store/auth';

const gb = (b: number) => (b / 1e9).toLocaleString('de-DE', { maximumFractionDigits: 2 });

/** Only for the 'admin' badge: how much of the storage cap is used. */
export function AdminSettings() {
  const admin = useAuthStore((s) => s.user?.badge === 'admin');
  const [use, setUse] = useState<{ usedBytes: number; limitBytes: number } | null>(null);
  useEffect(() => {
    if (admin) api.adminStorage().then(setUse, () => undefined);
  }, [admin]);
  if (!admin) return null;
  const share = use ? Math.min(1, use.usedBytes / use.limitBytes) : 0;
  return (
    <section className="settings-section" aria-labelledby="settings-admin">
      <h3 id="settings-admin">Admin</h3>
      {use ? (
        <div className="quota" data-testid="admin-storage">
          <span>
            Speicher: {gb(use.usedBytes)} GB von {gb(use.limitBytes)} GB ({Math.round(share * 100)}{' '}
            %)
          </span>
          <span className="quota-bar" aria-hidden="true">
            <span style={{ transform: `scaleX(${share})` }} />
          </span>
        </div>
      ) : (
        <p className="muted">Lädt…</p>
      )}
      <p className="settings-hint">
        Nachrichten, Dateien, Sprachnachrichten und Bilder zusammen. Ist die Grenze erreicht, nimmt
        disslxt nichts Neues mehr an, bis etwas gelöscht wird.
      </p>
    </section>
  );
}
