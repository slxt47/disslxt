import { create } from 'zustand';
import type { UserDto } from '@disslxt/shared';
import { ApiRequestError, onUnauthorized } from '../api/client';
import { api } from '../api/endpoints';
import { detachPushSubscription } from '../pwa/push';

export type AuthStatus = 'unknown' | 'authenticated' | 'guest';

interface AuthState {
  user: UserDto | null;
  status: AuthStatus;
  /** True right after an explicit logout (redirect to /login without a `next`). */
  loggedOut: boolean;
  loadMe: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  /** Starts a sign-up; the account exists only after the e-mail link is confirmed. */
  register: (email: string, username: string, password: string, next?: string) => Promise<void>;
  /** Redeems a confirmation link and logs in. Returns the in-app path to continue at. */
  verifyEmail: (token: string) => Promise<string | null>;
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

  register: async (email, username, password, next) => {
    await api.register({ email, username, password, ...(next ? { next } : {}) });
  },

  verifyEmail: async (token) => {
    const { user, next } = await api.verifyEmail(token);
    set({ user, status: 'authenticated', loggedOut: false });
    return next;
  },

  logout: async () => {
    // While the session still exists: a logged-out device must not receive this user's pushes.
    await detachPushSubscription().catch(() => undefined);
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
