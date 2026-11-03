import { create } from 'zustand';

interface ProfileViewState {
  /** The user whose profile is open (null: closed). */
  userId: string | null;
  open: (userId: string) => void;
  close: () => void;
}

export const useProfileView = create<ProfileViewState>()((set) => ({
  userId: null,
  open: (userId) => set({ userId }),
  close: () => set({ userId: null }),
}));
