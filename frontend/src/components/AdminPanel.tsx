import { useCallback, useEffect, useState } from 'react';
import type { AdminUserDto, UserRole } from '@disslxt/shared';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import { nameOf } from '../profile';
import { useAuthStore } from '../store/auth';
import { Avatar } from './Icon';
import { ProfileLink } from './Social';

const ROLE_TEXT: Record<UserRole, string> = { owner: 'Owner', admin: 'Admin', user: 'User' };

/**
 * Admin area for admins and the owner: user list, kick, and (owner only) making admins. The
 * buttons only mirror what the server allows – every action is checked there again.
 */
export function AdminPanel() {
  const me = useAuthStore((s) => s.user);
  const role = me?.role ?? 'user';
  const moderator = role === 'owner' || role === 'admin';
  const [list, setList] = useState<AdminUserDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(
    () =>
      api.adminUsers().then(
        (r) => setList(r.users),
        (err) => setError(errorMessage(err)),
      ),
    [],
  );
  useEffect(() => {
    if (moderator) void reload();
  }, [moderator, reload]);
  // A role change of mine (live) must refresh what I may see.
  if (!moderator || !me) return null;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  const canKick = (target: UserRole) =>
    target !== 'owner' && (role === 'owner' || (role === 'admin' && target === 'user'));

  return (
    <section className="admin-panel" aria-labelledby="admin-panel-title" data-testid="admin-panel">
      <h3 id="admin-panel-title" className="sidebar-heading">
        Admin – Userliste{list ? ` (${list.length})` : ''}
      </h3>
      {error && (
        <p className="form-error small" role="alert">
          {error}
        </p>
      )}
      {!list && !error && <p className="muted">Lädt…</p>}
      <ul className="admin-users">
        {list?.map((u) => (
          <li key={u.id} className="admin-user" data-testid={`admin-user-${u.username}`}>
            <Avatar name={nameOf(u)} url={u.avatarUrl} size="sm" />
            <span className="admin-user-text">
              <ProfileLink userId={u.id} title={`@${u.username}`}>
                {nameOf(u)}
              </ProfileLink>
              <span className="muted small">
                {ROLE_TEXT[u.role]}
                {u.online ? ' · online' : ''}
              </span>
            </span>
            {u.id !== me.id && (
              <span className="admin-actions">
                {role === 'owner' && u.role !== 'owner' && (
                  <button
                    type="button"
                    className="btn small"
                    disabled={busy}
                    data-testid={u.role === 'admin' ? 'admin-demote' : 'admin-promote'}
                    onClick={() =>
                      void run(() => api.adminSetRole(u.id, u.role === 'admin' ? 'user' : 'admin'))
                    }
                  >
                    {u.role === 'admin' ? 'Admin entziehen' : 'Zum Admin ernennen'}
                  </button>
                )}
                {canKick(u.role) &&
                  (confirming === u.id ? (
                    <button
                      type="button"
                      className="btn small danger"
                      disabled={busy}
                      data-testid="admin-kick-confirm"
                      onClick={() => void run(() => api.adminKick(u.id))}
                    >
                      Wirklich rauswerfen?
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn small danger-outline"
                      disabled={busy}
                      data-testid="admin-kick"
                      onClick={() => setConfirming(u.id)}
                    >
                      Rauswerfen
                    </button>
                  ))}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
