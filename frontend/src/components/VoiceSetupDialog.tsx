import { useEffect, useRef, useState } from 'react';
import { usePrefs } from '../store/prefs';
import {
  audioConstraints,
  deviceLabel,
  listAudioDevices,
  outputSelectable,
  playTestTone,
  type AudioDevices,
} from '../voice/devices';
import { useVoice } from '../voice/VoiceProvider';
import { Icon } from './Icon';
import { Modal } from './Modal';

const MIC_ERRORS: Record<string, string> = {
  NotAllowedError: 'Mikrofon-Zugriff verweigert. Erlaube ihn in den Einstellungen deines Browsers.',
  NotFoundError: 'Kein Mikrofon gefunden.',
  NotReadableError: 'Das Mikrofon wird gerade von einer anderen App benutzt.',
};

/**
 * Microphone and speaker selection, shown before joining a voice channel ("join") and from the
 * gear in a call ("call", applies immediately). The microphone is previewed with a level meter.
 */
export function VoiceSetupDialog({
  mode,
  channelName,
  onJoin,
  onClose,
}: {
  mode: 'join' | 'call';
  channelName: string;
  onJoin?: (devices: { inputId: string; outputId: string }) => void;
  onClose: () => void;
}) {
  const voice = useVoice();
  const inputId = usePrefs((s) => s.audioInputId);
  const outputId = usePrefs((s) => s.audioOutputId);
  const setPrefs = usePrefs((s) => s.set);
  const [devices, setDevices] = useState<AudioDevices>({ inputs: [], outputs: [] });
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const canPickOutput = outputSelectable();
  const meterRef = useRef<number | null>(null);

  // Preview the chosen microphone (also triggers the permission prompt, which fills in labels).
  useEffect(() => {
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(inputId) });
      } catch (err) {
        if (!cancelled) {
          setError(
            MIC_ERRORS[err instanceof DOMException ? err.name : ''] ?? 'Mikrofon nicht verfügbar.',
          );
          setReady(false);
        }
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      setReady(true);
      setDevices(await listAudioDevices());
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      ctx = new Ctx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Float32Array(analyser.fftSize);
      let shown = 0;
      const tick = () => {
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += v * v;
        // Peak hold with a slow fall, like a VU meter: short sounds stay visible.
        shown = Math.max(Math.min(1, Math.sqrt(sum / data.length) * 6), shown * 0.92);
        setLevel(shown < 0.01 ? 0 : shown);
        meterRef.current = requestAnimationFrame(tick);
      };
      tick();
    })();
    return () => {
      cancelled = true;
      if (meterRef.current) cancelAnimationFrame(meterRef.current);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close().catch(() => undefined);
    };
  }, [inputId]);

  function pickInput(id: string) {
    setPrefs({ audioInputId: id });
    if (mode === 'call') void voice?.setInputDevice(id);
  }
  function pickOutput(id: string) {
    setPrefs({ audioOutputId: id });
    if (mode === 'call') void voice?.setOutputDevice(id);
  }

  return (
    <Modal
      title={mode === 'join' ? `${channelName} beitreten` : 'Audio-Geräte'}
      onClose={onClose}
      testId="voice-setup"
    >
      <div className="dialog-form">
        <label>
          Mikrofon
          <select
            data-testid="voice-input-select"
            value={inputId}
            onChange={(e) => pickInput(e.target.value)}
            disabled={devices.inputs.length === 0}
          >
            <option value="">Systemstandard</option>
            {devices.inputs
              .filter((d) => d.deviceId && d.deviceId !== 'default')
              .map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {deviceLabel(d, i, 'Mikrofon')}
                </option>
              ))}
          </select>
        </label>
        <div
          className="mic-level"
          aria-hidden="true"
          data-testid="mic-level"
          data-active={level > 0.05}
        >
          <Icon name="mic" size={16} />
          <span className="mic-level-bar">
            <span style={{ transform: `scaleX(${level})` }} />
          </span>
        </div>

        <label>
          Ausgabe
          {canPickOutput ? (
            <select
              data-testid="voice-output-select"
              value={outputId}
              onChange={(e) => pickOutput(e.target.value)}
              disabled={devices.outputs.length === 0}
            >
              <option value="">Systemstandard</option>
              {devices.outputs
                .filter((d) => d.deviceId && d.deviceId !== 'default')
                .map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {deviceLabel(d, i, 'Ausgabe')}
                  </option>
                ))}
            </select>
          ) : (
            <span className="settings-hint" data-testid="voice-output-hint">
              In diesem Browser bestimmt das System die Ausgabe – auf dem iPhone über das
              Kontrollzentrum (AirPlay-Symbol), am Mac über die Menüleiste.
            </span>
          )}
        </label>
        <button type="button" className="btn small" onClick={() => void playTestTone(outputId)}>
          <Icon name="speaker" size={16} />
          Testton abspielen
        </button>

        {error && (
          <p className="form-error" role="alert" data-testid="voice-setup-error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          {mode === 'join' ? (
            <>
              <button type="button" className="btn" onClick={onClose}>
                Abbrechen
              </button>
              <button
                type="button"
                className="btn primary"
                data-testid="voice-setup-join"
                disabled={!ready}
                onClick={() => {
                  onJoin?.({ inputId, outputId });
                  onClose();
                }}
              >
                <Icon name="headphones" size={18} />
                Beitreten
              </button>
            </>
          ) : (
            <button type="button" className="btn primary" onClick={onClose}>
              Fertig
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
