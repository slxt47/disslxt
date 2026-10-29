import { create } from 'zustand';
import { findTheme, PRESET_THEMES, themeVars, type ThemeDef } from '../theme/themes';

/**
 * Per-device preferences (localStorage). Storage can be unavailable (private mode, blocked
 * site data), so every access is guarded and the app works with the defaults.
 */
const KEY = 'disslxt:prefs';

/** 'system' / 'light' / 'dark', or the id of a preset or custom colour theme. */
export type Theme = 'system' | 'light' | 'dark' | (string & {});

export interface Prefs {
  /** Appearance; 'system' follows the device's light/dark setting. */
  theme: Theme;
  /** Read new messages in the open channel aloud. */
  autoRead: boolean;
  /** Speech rate for read-aloud (0.5–2). */
  speechRate: number;
  /** The "add to home screen" banner was closed. */
  installHintDismissed: boolean;
  /** Chosen microphone / speaker for voice channels ('' = system default). */
  audioInputId: string;
  audioOutputId: string;
  /** Member list next to the chat (wide screens). */
  showMembers: boolean;
  /** Colour themes made in the settings (this device). */
  customThemes: ThemeDef[];
}

const defaults: Prefs = {
  theme: 'system',
  autoRead: false,
  speechRate: 1,
  installHintDismissed: false,
  audioInputId: '',
  audioOutputId: '',
  showMembers: true,
  customThemes: [],
};

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...defaults, ...(JSON.parse(raw) as Partial<Prefs>) } : defaults;
  } catch {
    return defaults;
  }
}

const THEME_COLORS = { light: '#eaeaf3', dark: '#09090e' } as const;
/** Derived tokens of the active colour theme, read by /theme-init.js before the first paint. */
export const THEME_VARS_KEY = 'disslxt:theme-vars';
/** Every token a colour theme sets (the same for all of them), cleared before applying another. */
const THEME_VAR_NAMES = Object.keys(themeVars(PRESET_THEMES[0]!));

/**
 * Sets data-theme on <html> (read by the CSS) and the browser/status bar colour. A colour theme
 * also sets its derived tokens as inline custom properties on top of its light/dark base.
 */
export function applyTheme(theme: Theme, custom: ThemeDef[] = usePrefs.getState().customThemes) {
  if (theme === 'light' || theme === 'dark' || theme === 'system') {
    applyThemeDef(theme as 'light' | 'dark' | 'system');
  } else applyThemeDef(findTheme(theme, custom) ?? 'system');
}

/** Applies a theme (also a not-yet-saved one, for the live preview in the editor). */
export function applyThemeDef(theme: 'system' | 'light' | 'dark' | ThemeDef): void {
  const root = document.documentElement;
  for (const name of THEME_VAR_NAMES) root.style.removeProperty(name);
  const def = typeof theme === 'string' ? null : theme;
  const base = def ? def.base : (theme as 'system' | 'light' | 'dark');
  if (base === 'system') delete root.dataset.theme;
  else root.dataset.theme = base;
  let vars: Record<string, string> | null = null;
  if (def) {
    vars = themeVars(def);
    for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  }
  try {
    if (vars) localStorage.setItem(THEME_VARS_KEY, JSON.stringify({ base, vars }));
    else localStorage.removeItem(THEME_VARS_KEY);
  } catch {
    // Not stored: the first paint after a reload uses the base colours for a moment.
  }
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const scheme = meta.media.includes('dark') ? 'dark' : 'light';
    meta.content = vars?.['--bg-tertiary'] ?? THEME_COLORS[base === 'system' ? scheme : base];
  }
}

interface PrefsState extends Prefs {
  set: (patch: Partial<Prefs>) => void;
}

export const usePrefs = create<PrefsState>()((set, get) => ({
  ...load(),
  set: (patch) => {
    set(patch);
    const {
      theme,
      autoRead,
      speechRate,
      installHintDismissed,
      audioInputId,
      audioOutputId,
      customThemes,
    } = {
      ...get(),
      ...patch,
    };
    if (patch.theme || patch.customThemes) applyTheme(theme, customThemes);
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({
          theme,
          autoRead,
          speechRate,
          installHintDismissed,
          audioInputId,
          audioOutputId,
          customThemes,
        }),
      );
    } catch {
      // Not persisted; the setting still applies for this session.
    }
  },
}));
