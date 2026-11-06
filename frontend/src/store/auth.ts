import { clearDrafts } from '../lib/drafts';
import { startAuthentication } from '@simplewebauthn/browser';
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
  /** True after the account was deleted (the sign-in page says so). */
  accountDeleted: boolean;
  loadMe: () => Promise<void>;
  /** Null: signed in. Otherwise the ticket for the second step. */
  login: (email: string, password: string) => Promise<string | null>;
  loginTwoFactor: (ticket: string, code: string) => Promise<void>;
  loginPasskey: () => Promise<void>;
  /** Starts a sign-up; the account exists only after the e-mail link is confirmed. */
  register: (email: string, username: string, password: string, next?: string) => Promise<void>;
  /** Redeems a confirmation link and logs in. Returns the in-app path to continue at. */
  verifyEmail: (token: string) => Promise<string | null>;
  logout: () => Promise<void>;
  /** Deletes the account for good (password as confirmation) and ends up signed out. */
  deleteAccount: (password: string) => Promise<void>;
  /** Session is gone (401 / WS 4401). */
  setGuest: () => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  status: 'unknown',
  loggedOut: false,
  accountDeleted: false,

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
    const result = await api.login({ email, password });
    if ('twoFactor' in result) return result.ticket;
    set({ user: result.user, status: 'authenticated', loggedOut: false });
    return null;
  },

  loginPasskey: async () => {
    const { challengeId, options } = await api.passkeyLoginOptions();
    const response = await startAuthentication({ optionsJSON: options });
    const { user } = await api.loginPasskey(challengeId, response);
    set({ user, status: 'authenticated', loggedOut: false, accountDeleted: false });
  },
  loginTwoFactor: async (ticket, code) => {
    const { user } = await api.loginTwoFactor(ticket, code);
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
    clearDrafts();
    try {
      await api.logout();
    } catch {
      // The session may already be gone; the client state is reset either way.
    }
    set({ user: null, status: 'guest', loggedOut: true });
  },

  deleteAccount: async (password) => {
    await api.deleteAccount(password);
    clearDrafts();
    set({ user: null, status: 'guest', loggedOut: true, accountDeleted: true });
  },

  setGuest: () => set({ user: null, status: 'guest' }),
}));

onUnauthorized(() => {
  if (useAuthStore.getState().status === 'authenticated') useAuthStore.getState().setGuest();
});
