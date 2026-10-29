import { useState, type CSSProperties } from 'react';
import { applyTheme, applyThemeDef, usePrefs, type Theme } from '../store/prefs';
import {
  contrast,
  CUSTOM_PREFIX,
  MAX_CUSTOM_THEMES,
  PRESET_THEMES,
  readableOn,
  themeVars,
  type ThemeDef,
} from '../theme/themes';
import { Icon, type IconName } from './Icon';

const OPTIONS: { value: Theme; label: string; icon: IconName }[] = [
  { value: 'system', label: 'Automatisch', icon: 'auto' },
  { value: 'light', label: 'Hell', icon: 'sun' },
  { value: 'dark', label: 'Dunkel', icon: 'moon' },
];

/** Small preview of a theme: its background, a bubble and the accent gradient. */
function Swatch({ theme }: { theme: ThemeDef }) {
  const v = themeVars(theme);
  return (
    <span
      className="theme-swatch"
      aria-hidden="true"
      style={
        {
          '--sw-bg': v['--bg-secondary'],
          '--sw-card': v['--bg-elevated'],
          '--sw-text': v['--text'],
          '--sw-a': theme.accent,
          '--sw-b': theme.accent2,
        } as CSSProperties
      }
    >
      <i />
      <i />
      <i />
    </span>
  );
}

function newTheme(): ThemeDef {
  return {
    id: `${CUSTOM_PREFIX}${Date.now().toString(36)}`,
    name: 'Mein Theme',
    base: 'dark',
    accent: '#7c5cff',
    accent2: '#4f8cff',
    hue: 262,
    tint: 0.4,
  };
}

/** Editor for a custom theme; every change is previewed live on the whole app. */
function ThemeEditor({
  initial,
  isNew,
  onDone,
}: {
  initial: ThemeDef;
  isNew: boolean;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const set = usePrefs((s) => s.set);
  const update = (patch: Partial<ThemeDef>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    applyThemeDef(next);
  };
  const cancel = () => {
    applyTheme(usePrefs.getState().theme);
    onDone();
  };
  const save = () => {
    const name = draft.name.trim().slice(0, 30) || 'Mein Theme';
    const theme = { ...draft, name };
    const list = usePrefs.getState().customThemes.filter((t) => t.id !== theme.id);
    set({ customThemes: [...list, theme], theme: theme.id });
    onDone();
  };
  const remove = () => {
    const prefs = usePrefs.getState();
    set({
      customThemes: prefs.customThemes.filter((t) => t.id !== draft.id),
      theme: prefs.theme === draft.id ? 'system' : prefs.theme,
    });
    applyTheme(usePrefs.getState().theme);
    onDone();
  };
  const v = themeVars(draft);
  // The accent as written on the background, adjusted for readability if needed.
  const adjusted = readableOn(draft.accent, v['--bg-secondary']!) !== draft.accent;

  return (
    <div className="theme-editor" data-testid="theme-editor">
      <label>
        Name
        <input
          value={draft.name}
          maxLength={30}
          data-testid="theme-name"
          onChange={(e) => update({ name: e.target.value })}
        />
      </label>
      <div className="segmented" role="radiogroup" aria-label="Grundton">
        {(['dark', 'light'] as const).map((b) => (
          <button
            key={b}
            type="button"
            role="radio"
            aria-checked={draft.base === b}
            onClick={() => update({ base: b })}
          >
            <Icon name={b === 'dark' ? 'moon' : 'sun'} size={18} />
            {b === 'dark' ? 'Dunkel' : 'Hell'}
          </button>
        ))}
      </div>
      <div className="color-row">
        <label className="color-field">
          <input
            type="color"
            value={draft.accent}
            data-testid="theme-accent"
            onChange={(e) => update({ accent: e.target.value })}
          />
          Akzent
        </label>
        <label className="color-field">
          <input
            type="color"
            value={draft.accent2}
            data-testid="theme-accent2"
            onChange={(e) => update({ accent2: e.target.value })}
          />
          Verlauf
        </label>
        <label className="color-field">
          <input
            type="checkbox"
            checked={!!draft.oled}
            onChange={(e) => update({ oled: e.target.checked })}
            disabled={draft.base === 'light'}
          />
          Echtes Schwarz
        </label>
      </div>
      <label>
        Hintergrund-Farbton
        <input
          type="range"
          className="hue-range"
          min={0}
          max={359}
          value={draft.hue}
          data-testid="theme-hue"
          onChange={(e) => update({ hue: Number(e.target.value) })}
        />
      </label>
      <label>
        Stärke der Tönung
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(draft.tint * 100)}
          onChange={(e) => update({ tint: Number(e.target.value) / 100 })}
        />
      </label>
      <p className="settings-hint">
        Du siehst die Änderungen sofort in der ganzen App.
        {adjusted
          ? ' Akzent-Text wird etwas angepasst, damit er gut lesbar bleibt.'
          : ` Kontrast Akzent/Hintergrund: ${contrast(v['--accent-text']!, v['--bg-secondary']!).toFixed(1)} : 1.`}
      </p>
      <div className="settings-row">
        <button className="btn primary" type="button" data-testid="theme-save" onClick={save}>
          Speichern
        </button>
        <button className="btn" type="button" onClick={cancel}>
          Abbrechen
        </button>
        {!isNew && (
          <button className="btn danger-outline" type="button" onClick={remove}>
            Löschen
          </button>
        )}
      </div>
    </div>
  );
}

/** "Darstellung": light, dark, follow the device – or a colour theme, also self-made. */
export function AppearanceSettings() {
  const theme = usePrefs((s) => s.theme);
  const custom = usePrefs((s) => s.customThemes);
  const set = usePrefs((s) => s.set);
  const [editing, setEditing] = useState<{ theme: ThemeDef; isNew: boolean } | null>(null);

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

      <h4 className="settings-subheading">
        <Icon name="palette" size={16} />
        Themes
      </h4>
      <div className="theme-grid" role="radiogroup" aria-label="Farbthemes">
        {[...PRESET_THEMES, ...custom].map((t) => (
          <div key={t.id} className="theme-card-wrap">
            <button
              type="button"
              role="radio"
              aria-checked={theme === t.id}
              className="theme-card"
              data-testid={`theme-${t.id}`}
              onClick={() => set({ theme: t.id })}
            >
              <Swatch theme={t} />
              <span>{t.name}</span>
            </button>
            {t.id.startsWith(CUSTOM_PREFIX) && (
              <button
                type="button"
                className="icon-btn theme-edit"
                aria-label={`${t.name} bearbeiten`}
                title="Bearbeiten"
                onClick={() => setEditing({ theme: t, isNew: false })}
              >
                <Icon name="edit" size={16} />
              </button>
            )}
          </div>
        ))}
        {custom.length < MAX_CUSTOM_THEMES && (
          <button
            type="button"
            className="theme-card add"
            data-testid="theme-create"
            onClick={() => {
              const t = newTheme();
              applyThemeDef(t);
              setEditing({ theme: t, isNew: true });
            }}
          >
            <span className="theme-swatch add" aria-hidden="true">
              <Icon name="plus" size={22} />
            </span>
            <span>Eigenes Theme</span>
          </button>
        )}
      </div>
      {editing && (
        <ThemeEditor
          key={editing.theme.id}
          initial={editing.theme}
          isNew={editing.isNew}
          onDone={() => setEditing(null)}
        />
      )}
    </section>
  );
}
