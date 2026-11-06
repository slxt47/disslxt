import { useEffect, useState } from 'react';
import type { TurnUsageDto } from '@disslxt/shared';
import { api } from '../api/endpoints';
import { usePrefs } from '../store/prefs';

const gb = (bytes: number) =>
  (bytes / 1e9).toLocaleString('de-DE', { maximumFractionDigits: bytes < 1e10 ? 2 : 0 });
const monthName = (month: string) =>
  new Date(`${month}-01T12:00:00Z`).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });

/** "KeyV" → "V", "Space" → "Leertaste". */
const keyName = (code: string): string =>
  code === 'Space' ? 'Leertaste' : code.replace(/^Key|^Digit/, '');

/** Hold-to-talk with its key, and the microphone's noise filter. */
function MicrophoneOptions() {
  const pushToTalk = usePrefs((s) => s.pushToTalk);
  const key = usePrefs((s) => s.pushToTalkKey);
  const noiseSuppression = usePrefs((s) => s.noiseSuppression);
  const set = usePrefs((s) => s.set);
  const [choosing, setChoosing] = useState(false);

  useEffect(() => {
    if (!choosing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== 'Escape') set({ pushToTalkKey: e.code });
      setChoosing(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [choosing, set]);

  return (
    <>
      <label className="switch-row">
        <span>Rauschunterdrückung (gilt ab dem nächsten Beitritt)</span>
        <input
          type="checkbox"
          role="switch"
          className="switch"
          data-testid="noise-toggle"
          checked={noiseSuppression}
          onChange={(e) => set({ noiseSuppression: e.target.checked })}
        />
      </label>
      <label className="switch-row">
        <span>Push-to-Talk: Mikrofon nur offen, solange die Taste gedrückt ist</span>
        <input
          type="checkbox"
          role="switch"
          className="switch"
          data-testid="ptt-toggle"
          checked={pushToTalk}
          onChange={(e) => set({ pushToTalk: e.target.checked })}
        />
      </label>
      {pushToTalk && (
        <p className="settings-hint">
          Taste:{' '}
          <button
            className="btn small"
            data-testid="ptt-key"
            onClick={() => setChoosing((c) => !c)}
          >
            {choosing ? 'Taste drücken…' : keyName(key)}
          </button>{' '}
          Am Handy hältst du den Mikrofon-Knopf in der Leiste.
        </p>
      )}
    </>
  );
}

/** "Sprachkanäle": microphone options and how much of this month's TURN quota is used. */
export function VoiceSettings() {
  const [usage, setUsage] = useState<TurnUsageDto | null>(null);
  useEffect(() => {
    api.turnUsage().then(setUsage, () => undefined);
  }, []);
  const share = usage ? Math.min(1, usage.usedBytes / usage.limitBytes) : 0;
  return (
    <section className="settings-section" aria-labelledby="settings-voice">
      <h3 id="settings-voice">Sprachkanäle</h3>
      <MicrophoneOptions />
      {usage?.configured && (
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
      )}
    </section>
  );
}
