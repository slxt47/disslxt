import { usePrefs, type Theme } from '../store/prefs';
import { Icon, type IconName } from './Icon';

const OPTIONS: { value: Theme; label: string; icon: IconName }[] = [
  { value: 'system', label: 'Automatisch', icon: 'auto' },
  { value: 'light', label: 'Hell', icon: 'sun' },
  { value: 'dark', label: 'Dunkel', icon: 'moon' },
];

/** "Darstellung": light, dark or follow the device. */
export function AppearanceSettings() {
  const theme = usePrefs((s) => s.theme);
  const set = usePrefs((s) => s.set);
  return (
    <section className="settings-section" aria-labelledby="settings-appearance">
      <h3 id="settings-appearance">Darstellung</h3>
      <div className="segmented three" role="radiogroup" aria-label="Darstellung">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={theme === o.value}
            data-testid={`theme-${o.value}`}
            onClick={() => set({ theme: o.value })}
          >
            <Icon name={o.icon} size={18} />
            {o.label}
          </button>
        ))}
      </div>
      <p className="settings-hint">
        „Automatisch“ folgt der Einstellung deines Geräts. Gilt für dieses Gerät.
      </p>
    </section>
  );
}
