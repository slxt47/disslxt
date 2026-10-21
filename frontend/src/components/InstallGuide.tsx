import { Icon } from './Icon';

/** Three-step "add to home screen" guide for iOS Safari (needed for push on iOS 16.4+). */
export function InstallGuide() {
  return (
    <ol className="install-guide" data-testid="install-guide">
      <li>
        <span className="step-icon">
          <Icon name="share" />
        </span>
        <span>
          Tippe in Safari unten auf <strong>Teilen</strong>.
        </span>
      </li>
      <li>
        <span className="step-icon">
          <Icon name="plus-square" />
        </span>
        <span>
          Wähle <strong>Zum Home-Bildschirm</strong> und tippe auf <strong>Hinzufügen</strong>.
        </span>
      </li>
      <li>
        <span className="step-icon app">
          <img src="/icons/icon-192.png" alt="" width={28} height={28} />
        </span>
        <span>
          Öffne <strong>disslxt</strong> vom Home-Bildschirm und aktiviere dort die Mitteilungen.
        </span>
      </li>
    </ol>
  );
}
