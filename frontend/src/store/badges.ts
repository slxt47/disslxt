import { create } from 'zustand';
import type { BadgeDto } from '@disslxt/shared';
import { api } from '../api/endpoints';

interface BadgeState {
  /** Badge id → definition; empty until loaded (badges without a definition are not shown). */
  byId: Record<string, BadgeDto>;
  loaded: boolean;
  load: () => Promise<void>;
}

export const useBadgeStore = create<BadgeState>()((set, get) => ({
  byId: {},
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    try {
      const { badges } = await api.badgeCatalogue();
      set({ byId: Object.fromEntries(badges.map((b) => [b.id, b])), loaded: true });
    } catch {
      // Names are still shown without badges; the next page load tries again.
    }
  },
}));
