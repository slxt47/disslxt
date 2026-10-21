import { create } from 'zustand';

/**
 * Per-device preferences (localStorage). Storage can be unavailable (private mode, blocked
 * site data), so every access is guarded and the app works with the defaults.
 */
const KEY = 'disslxt:prefs';

export interface Prefs {
  /** Read new messages in the open channel aloud. */
  autoRead: boolean;
  /** Speech rate for read-aloud (0.5–2). */
  speechRate: number;
  /** The "add to home screen" banner was closed. */
  installHintDismissed: boolean;
}

const defaults: Prefs = { autoRead: false, speechRate: 1, installHintDismissed: false };

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...defaults, ...(JSON.parse(raw) as Partial<Prefs>) } : defaults;
  } catch {
    return defaults;
  }
}

interface PrefsState extends Prefs {
  set: (patch: Partial<Prefs>) => void;
}

export const usePrefs = create<PrefsState>()((set, get) => ({
  ...load(),
  set: (patch) => {
    set(patch);
    const { autoRead, speechRate, installHintDismissed } = { ...get(), ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify({ autoRead, speechRate, installHintDismissed }));
    } catch {
      // Not persisted; the setting still applies for this session.
    }
  },
}));
