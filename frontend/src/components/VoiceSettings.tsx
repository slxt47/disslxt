import { useEffect, useState } from 'react';
import type { TurnUsageDto } from '@disslxt/shared';
import { api } from '../api/endpoints';

const gb = (bytes: number) =>
  (bytes / 1e9).toLocaleString('de-DE', { maximumFractionDigits: bytes < 1e10 ? 2 : 0 });
const monthName = (month: string) =>
  new Date(`${month}-01T12:00:00Z`).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });

/** "Sprachkanäle": how much of this month's TURN quota is used. */
export function VoiceSettings() {
  const [usage, setUsage] = useState<TurnUsageDto | null>(null);
  useEffect(() => {
    api.turnUsage().then(setUsage, () => undefined);
  }, []);
  if (!usage?.configured) return null;
  const share = Math.min(1, usage.usedBytes / usage.limitBytes);
  return (
    <section className="settings-section" aria-labelledby="settings-voice">
      <h3 id="settings-voice">Sprachkanäle</h3>
      <div className="quota" data-testid="turn-usage">
        <div
          className="quota-bar"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(share * 100)}
          aria-label="TURN-Kontingent"
        >
          <span style={{ width: `${share * 100}%` }} className={usage.exhausted ? 'full' : ''} />
        </div>
        <p className="settings-hint">
          {usage.exhausted
            ? `Das TURN-Kontingent für ${monthName(usage.month)} ist aufgebraucht. Sprachkanäle funktionieren weiter, wo eine direkte Verbindung möglich ist.`
            : `${gb(usage.usedBytes)} GB von ${gb(usage.limitBytes)} GB Relay-Datenvolumen im ${monthName(usage.month)} genutzt. Nur nötig, wenn keine direkte Verbindung zustande kommt.`}
        </p>
      </div>
    </section>
  );
}
