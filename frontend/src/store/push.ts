import { create } from 'zustand';
import type { PushConfigDto } from '@disslxt/shared';
import { api } from '../api/endpoints';

interface PushStore {
  config: PushConfigDto | null;
  load: () => Promise<PushConfigDto>;
  setMuted: (guildId: string, muted: boolean) => Promise<void>;
  reset: () => void;
}

export const usePushStore = create<PushStore>()((set, get) => ({
  config: null,
  load: async () => {
    const config = await api.pushConfig();
    set({ config });
    return config;
  },
  setMuted: async (guildId, muted) => {
    await api.setGuildMuted(guildId, muted);
    const config = get().config;
    if (!config) return;
    const others = config.mutedGuildIds.filter((id) => id !== guildId);
    set({ config: { ...config, mutedGuildIds: muted ? [...others, guildId] : others } });
  },
  reset: () => set({ config: null }),
}));
