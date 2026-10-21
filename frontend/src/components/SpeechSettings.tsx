import { dictationSupported } from '../speech/dictation';
import { speak, stopSpeaking, ttsSupported } from '../speech/tts';
import { usePrefs } from '../store/prefs';

/** "Sprache" section of the settings: read-aloud options and what dictation does. */
export function SpeechSettings() {
  const autoRead = usePrefs((s) => s.autoRead);
  const rate = usePrefs((s) => s.speechRate);
  const set = usePrefs((s) => s.set);
  const tts = ttsSupported();

  return (
    <section className="settings-section" aria-labelledby="settings-speech">
      <h3 id="settings-speech">Sprache</h3>
      {tts ? (
        <>
          <label className="switch-row">
            <span>
              Neue Nachrichten vorlesen
              <small>Im geöffneten Kanal, solange disslxt offen ist.</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              className="switch"
              data-testid="auto-read-toggle"
              checked={autoRead}
              onChange={(e) => {
                set({ autoRead: e.target.checked });
                // Speaking once inside the click unlocks speech output on iOS.
                if (e.target.checked) speak('Vorlesen ist an.', { rate, interrupt: true });
                else stopSpeaking();
              }}
            />
          </label>
          <label>
            Sprechtempo
            <input
              type="range"
              min={0.6}
              max={1.6}
              step={0.1}
              value={rate}
              data-testid="speech-rate"
              onChange={(e) => set({ speechRate: Number(e.target.value) })}
              onPointerUp={() => speak('So schnell lese ich vor.', { rate, interrupt: true })}
            />
          </label>
          <p className="settings-hint">
            Einzelne Nachrichten: Nachricht antippen (bzw. mit der Maus darüberfahren) und auf den
            Lautsprecher tippen. Die Stimme kommt vom Gerät, nichts wird hochgeladen.
          </p>
        </>
      ) : (
        <p className="muted">Dieser Browser kann nicht vorlesen.</p>
      )}
      <p className="settings-hint" data-testid="dictation-note">
        {dictationSupported()
          ? 'Diktieren (Mikrofon im Eingabefeld) nutzt die Spracherkennung deines Browsers: Chrome und Edge senden die Aufnahme dafür an Google bzw. Microsoft, Safari an Apple. Erst nach dem Tippen auf das Mikrofon wird zugehört.'
          : 'Diktieren wird von diesem Browser nicht unterstützt (z. B. Firefox). Auf dem iPhone geht auch die Diktiertaste der Tastatur.'}
      </p>
    </section>
  );
}
