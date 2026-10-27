import { create } from 'zustand';

/**
 * Per-device preferences (localStorage). Storage can be unavailable (private mode, blocked
 * site data), so every access is guarded and the app works with the defaults.
 */
const KEY = 'disslxt:prefs';

export type Theme = 'system' | 'light' | 'dark';

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
}

const defaults: Prefs = {
  theme: 'system',
  autoRead: false,
  speechRate: 1,
  installHintDismissed: false,
  audioInputId: '',
  audioOutputId: '',
};

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...defaults, ...(JSON.parse(raw) as Partial<Prefs>) } : defaults;
  } catch {
    return defaults;
  }
}

const THEME_COLORS = { light: '#f5f5f7', dark: '#161617' } as const;

/** Sets data-theme on <html> (read by the CSS) and the browser/status bar colour. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const scheme = meta.media.includes('dark') ? 'dark' : 'light';
    meta.content = THEME_COLORS[theme === 'system' ? scheme : theme];
  }
}

interface PrefsState extends Prefs {
  set: (patch: Partial<Prefs>) => void;
}

export const usePrefs = create<PrefsState>()((set, get) => ({
  ...load(),
  set: (patch) => {
    set(patch);
    const { theme, autoRead, speechRate, installHintDismissed, audioInputId, audioOutputId } = {
      ...get(),
      ...patch,
    };
    if (patch.theme) applyTheme(patch.theme);
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
        }),
      );
    } catch {
      // Not persisted; the setting still applies for this session.
    }
  },
}));
