import { useEffect, useState } from 'react';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import { isIos } from '../pwa/platform';
import { currentPushState, disablePush, enablePush, type PushState } from '../pwa/push';
import { usePushStore } from '../store/push';
import { InstallGuide } from './InstallGuide';
import { Modal } from './Modal';
import { AccountSettings } from './AccountSettings';
import { LegalLinks } from './LegalLinks';

const STATE_TEXT: Record<PushState, string> = {
  'server-disabled': 'Mitteilungen sind auf diesem Server noch nicht eingerichtet.',
  'needs-install':
    'Auf iPhone und iPad gibt es Mitteilungen nur für Apps auf dem Home-Bildschirm (ab iOS 16.4).',
  unsupported: 'Dieser Browser unterstützt keine Mitteilungen.',
  denied: isIos()
    ? 'Mitteilungen sind blockiert. Erlaube sie unter Einstellungen › Mitteilungen › disslxt.'
    : 'Mitteilungen sind blockiert. Erlaube sie in den Website-Einstellungen deines Browsers.',
  off: 'Erhalte eine Mitteilung bei neuen Nachrichten, Erwähnungen und Sprachkanälen – auch wenn disslxt geschlossen ist.',
  on: 'Mitteilungen sind auf diesem Gerät aktiv.',
};

export function SettingsDialog({
  onClose,
  extra,
}: {
  onClose: () => void;
  /** Further sections (speech settings). */
  extra?: React.ReactNode;
}) {
  const loadConfig = usePushStore((s) => s.load);
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadConfig()
      .then(currentPushState)
      .then(
        (s) => !cancelled && setState(s),
        (err: unknown) => !cancelled && setError(errorMessage(err)),
      );
    return () => {
      cancelled = true;
    };
  }, [loadConfig]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // Called directly from the click: the permission prompt needs the user gesture (iOS).
  const turnOn = () =>
    run(async () => {
      const config = usePushStore.getState().config ?? (await loadConfig());
      setState(await enablePush(config));
    });
  const turnOff = () =>
    run(async () => {
      await disablePush();
      setState('off');
    });
  const test = () =>
    run(async () => {
      const { delivered } = await api.testPush();
      setInfo(
        delivered > 0
          ? 'Testmitteilung verschickt.'
          : 'Kein Gerät erreicht – aktiviere Mitteilungen erneut.',
      );
    });

  return (
    <Modal title="Einstellungen" onClose={onClose} testId="settings-dialog">
      <section className="settings-section" aria-labelledby="settings-push">
        <h3 id="settings-push">Mitteilungen</h3>
        <p className="muted" data-testid="push-state" data-state={state ?? 'loading'}>
          {state ? STATE_TEXT[state] : 'Lädt…'}
        </p>
        {state === 'needs-install' && <InstallGuide />}
        {state === 'off' && (
          <button
            className="btn primary"
            data-testid="push-enable"
            disabled={busy}
            onClick={() => void turnOn()}
          >
            Mitteilungen aktivieren
          </button>
        )}
        {state === 'on' && (
          <div className="settings-row">
            <button
              className="btn"
              data-testid="push-test"
              disabled={busy}
              onClick={() => void test()}
            >
              Testmitteilung senden
            </button>
            <button
              className="btn danger-outline"
              data-testid="push-disable"
              disabled={busy}
              onClick={() => void turnOff()}
            >
              Deaktivieren
            </button>
          </div>
        )}
        {info && <p className="form-info">{info}</p>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <p className="settings-hint">
          Einzelne Server stummschalten: Glocke neben dem Servernamen. @Erwähnungen kommen trotzdem
          an.
        </p>
      </section>
      {extra}
      <AccountSettings />
      <LegalLinks className="legal-links in-settings" />
      <div className="dialog-actions">
        <button className="btn" onClick={onClose}>
          Fertig
        </button>
      </div>
    </Modal>
  );
}
