import { create } from 'zustand';
import type { UserDto } from '@chat-mvp/shared';
import { ApiRequestError, onUnauthorized } from '../api/client';
import { api } from '../api/endpoints';

export type AuthStatus = 'unknown' | 'authenticated' | 'guest';

interface AuthState {
  user: UserDto | null;
  status: AuthStatus;
  /** True right after an explicit logout (redirect to /login without a `next`). */
  loggedOut: boolean;
  loadMe: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Session is gone (401 / WS 4401). */
  setGuest: () => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  status: 'unknown',
  loggedOut: false,

  loadMe: async () => {
    try {
      const { user } = await api.me();
      set({ user, status: 'authenticated', loggedOut: false });
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) {
        set({ user: null, status: 'guest' });
        return;
      }
      // Server unreachable: treat as guest so the login page can show the error.
      set({ user: null, status: 'guest' });
    }
  },

  login: async (email, password) => {
    const { user } = await api.login({ email, password });
    set({ user, status: 'authenticated', loggedOut: false });
  },

  register: async (email, username, password) => {
    const { user } = await api.register({ email, username, password });
    set({ user, status: 'authenticated', loggedOut: false });
  },

  logout: async () => {
    try {
      await api.logout();
    } catch {
      // The session may already be gone; the client state is reset either way.
    }
    set({ user: null, status: 'guest', loggedOut: true });
  },

  setGuest: () => set({ user: null, status: 'guest' }),
}));

onUnauthorized(() => {
  if (useAuthStore.getState().status === 'authenticated') useAuthStore.getState().setGuest();
});
