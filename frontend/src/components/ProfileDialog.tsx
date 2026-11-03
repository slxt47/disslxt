import { useEffect, useState } from 'react';
import type { ProfileDto, UserRole } from '@disslxt/shared';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import { nameOf } from '../profile';
import { useAuthStore } from '../store/auth';
import { useBadgeStore } from '../store/badges';
import { useProfileView } from '../store/profile';
import { Avatar } from './Icon';
import { Modal } from './Modal';
import { StatusLine } from './Social';

const ROLE_TEXT: Record<UserRole, string> = { owner: 'Owner', admin: 'Admin', user: 'User' };
const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'long' });

/** Profile page of whoever was clicked (opened through useProfileView). */
export function ProfileDialog({ onEditOwn }: { onEditOwn: () => void }) {
  const userId = useProfileView((s) => s.userId);
  const close = useProfileView((s) => s.close);
  const selfId = useAuthStore((s) => s.user?.id);
  const catalogue = useBadgeStore((s) => s.byId);
  const [loaded, setLoaded] = useState<{
    id: string;
    profile: ProfileDto | null;
    error?: string;
  }>();

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    api.getProfile(userId).then(
      (r) => !cancelled && setLoaded({ id: userId, profile: r.profile }),
      (err: unknown) =>
        !cancelled && setLoaded({ id: userId, profile: null, error: errorMessage(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!userId) return null;
  const state = loaded?.id === userId ? loaded : undefined;
  const profile = state?.profile;
  return (
    <Modal title={profile ? nameOf(profile) : 'Profil'} onClose={close} testId="profile-dialog">
      {state?.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      {!state && <p className="muted">Lädt…</p>}
      {profile && (
        <div className="profile-card">
          <Avatar name={nameOf(profile)} url={profile.avatarUrl} size="lg" />
          <p className="profile-card-name" data-testid="profile-display-name">
            {nameOf(profile)}
          </p>
          <p className="muted" data-testid="profile-username">
            @{profile.username} · {ROLE_TEXT[profile.role]}
          </p>
          <StatusLine status={profile.status} />
          {profile.tag && (
            <p className="muted small">
              Server-Tag: {profile.tag.emoji} {profile.tag.text}
            </p>
          )}
          <ul className="profile-badges" aria-label="Abzeichen">
            {profile.badges.flatMap((id) => {
              const b = catalogue[id];
              return b
                ? [
                    <li key={id} className="profile-badge" data-testid="profile-badge">
                      <span aria-hidden="true">{b.emoji}</span>
                      <span>
                        <strong>{b.label}</strong>
                        <span className="muted small"> {b.description}</span>
                      </span>
                    </li>,
                  ]
                : [];
            })}
            {profile.badges.length === 0 && (
              <li className="muted small">Keine Abzeichen gezeigt.</li>
            )}
          </ul>
          <p className="muted small">Dabei seit {dateFormat.format(new Date(profile.createdAt))}</p>
        </div>
      )}
      <div className="dialog-actions">
        {userId === selfId && (
          <button
            type="button"
            className="btn primary"
            data-testid="profile-edit"
            onClick={() => {
              close();
              onEditOwn();
            }}
          >
            Profil bearbeiten
          </button>
        )}
        <button type="button" className="btn" onClick={close}>
          Schließen
        </button>
      </div>
    </Modal>
  );
}
