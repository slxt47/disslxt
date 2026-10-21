import { needsHomeScreenForPush } from '../pwa/platform';
import { usePrefs } from '../store/prefs';
import { Icon } from './Icon';

/** Shown in iOS Safari once: explains that disslxt can be installed (and only then push). */
export function InstallBanner({ onShowGuide }: { onShowGuide: () => void }) {
  const dismissed = usePrefs((s) => s.installHintDismissed);
  const setPrefs = usePrefs((s) => s.set);
  if (dismissed || !needsHomeScreenForPush()) return null;
  return (
    <div className="install-banner" role="note" data-testid="install-banner">
      <img src="/icons/icon-192.png" alt="" width={36} height={36} />
      <p>
        <strong>disslxt als App</strong>
        <span>Zum Home-Bildschirm hinzufügen – für Mitteilungen und Vollbild.</span>
      </p>
      <button className="btn small primary" onClick={onShowGuide}>
        So geht’s
      </button>
      <button
        className="icon-btn"
        aria-label="Hinweis schließen"
        onClick={() => setPrefs({ installHintDismissed: true })}
      >
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}
