import { useEffect } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AppLayout } from './pages/AppLayout';
import { InvitePage } from './pages/InvitePage';
import { LoginPage } from './pages/LoginPage';
import { NotFound } from './pages/NotFound';
import { RegisterPage } from './pages/RegisterPage';
import { RealtimeProvider } from './realtime/RealtimeProvider';
import { useAuthStore } from './store/auth';
import { useChatStore } from './store/chat';

function Loading() {
  return (
    <div className="center-page" data-testid="loading">
      Lädt…
    </div>
  );
}

/** Guests are redirected to /login?next=<current path>; nothing is readable without a session. */
export function RequireAuth() {
  const status = useAuthStore((s) => s.status);
  const loggedOut = useAuthStore((s) => s.loggedOut);
  const location = useLocation();
  if (status === 'unknown') return <Loading />;
  if (status === 'guest') {
    const next = `${location.pathname}${location.search}`;
    const target = loggedOut || next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`;
    return <Navigate to={target} replace />;
  }
  return (
    <RealtimeProvider>
      <Outlet />
    </RealtimeProvider>
  );
}

/** Returns a safe in-app redirect target from `?next=` (only same-origin paths). */
export function safeNext(search: string): string {
  const next = new URLSearchParams(search).get('next');
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  return next;
}

function GuestOnly() {
  const status = useAuthStore((s) => s.status);
  const location = useLocation();
  if (status === 'unknown') return <Loading />;
  if (status === 'authenticated') return <Navigate to={safeNext(location.search)} replace />;
  return <Outlet />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<GuestOnly />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>
      <Route element={<RequireAuth />}>
        <Route path="/" element={<AppLayout />} />
        <Route path="/guilds/:guildId" element={<AppLayout />} />
        <Route path="/guilds/:guildId/channels/:channelId" element={<AppLayout />} />
        <Route path="/invite/:code" element={<InvitePage />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export function App() {
  const loadMe = useAuthStore((s) => s.loadMe);
  const status = useAuthStore((s) => s.status);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  // Drop all cached chat data when the session ends.
  useEffect(() => {
    if (status === 'guest') useChatStore.getState().reset();
  }, [status]);

  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppRoutes />
    </BrowserRouter>
  );
}
