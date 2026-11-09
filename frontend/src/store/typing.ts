import { create } from 'zustand';
import { TYPING_SHOW_MS } from '@disslxt/shared';

interface TypingState {
  /** channelId → userId → name of who is writing. */
  byChannel: Record<string, Record<string, string>>;
  started: (channelId: string, userId: string, name: string) => void;
  stopped: (channelId: string, userId: string) => void;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const useTypingStore = create<TypingState>()((set, get) => ({
  byChannel: {},
  started: (channelId, userId, name) => {
    const key = `${channelId}:${userId}`;
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => get().stopped(channelId, userId), TYPING_SHOW_MS),
    );
    set((s) => ({
      byChannel: {
        ...s.byChannel,
        [channelId]: { ...s.byChannel[channelId], [userId]: name },
      },
    }));
  },
  stopped: (channelId, userId) => {
    const key = `${channelId}:${userId}`;
    clearTimeout(timers.get(key));
    timers.delete(key);
    set((s) => {
      const channel = s.byChannel[channelId];
      if (!channel?.[userId]) return {};
      const { [userId]: _gone, ...others } = channel;
      return { byChannel: { ...s.byChannel, [channelId]: others } };
    });
  },
}));

/** "Anna schreibt gerade…" – up to two names, then a count. */
export function typingText(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} schreibt gerade…`;
  if (names.length === 2) return `${names[0]} und ${names[1]} schreiben gerade…`;
  return `${names.length} Personen schreiben gerade…`;
}
