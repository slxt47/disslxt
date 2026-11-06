import { useNavigate } from 'react-router-dom';
import { nameOf } from '../profile';
import { useAuthStore } from '../store/auth';
import { usePrefs } from '../store/prefs';
import { findTheme } from '../theme/themes';
import { useVoiceStore } from '../store/voice';
import { Avatar, Icon } from './Icon';
import { StatusLine, UserBadges } from './Social';

/** Bottom of the sidebars: who is signed in, settings and sign-out. */
export function UserFooter({ onOpenSettings }: { onOpenSettings: () => void }) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const theme = usePrefs((s) => s.theme);
  const customThemes = usePrefs((s) => s.customThemes);
  const setPrefs = usePrefs((s) => s.set);
  const dark = (findTheme(theme, customThemes)?.base ?? theme) !== 'light';
  const navigate = useNavigate();
  const inCall = useVoiceStore((s) => s.channelId !== null);

  async function onLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <footer className="user-footer">
      <button
        type="button"
        className="who"
        data-testid="profile-button"
        title="Profil bearbeiten"
        onClick={onOpenSettings}
      >
        <span className="member-avatar online" data-presence={inCall ? 'call' : 'online'}>
          <Avatar name={nameOf(user)} url={user?.avatarUrl} size="sm" />
          <span className="presence-dot" aria-hidden="true" />
        </span>
        <span className="who-names">
          <span className="who-line">
            <span className="current-user" data-testid="current-user">
              {nameOf(user)}
            </span>
            {user && <UserBadges user={user} />}
          </span>
          {user?.status ? (
            <StatusLine status={user.status} />
          ) : (
            user?.displayName && <span className="who-handle">@{user.username}</span>
          )}
        </span>
      </button>
      <span className="footer-actions">
        <button
          className="icon-btn"
          data-testid="mode-switch"
          aria-label={dark ? 'Zum hellen Modus wechseln' : 'Zum dunklen Modus wechseln'}
          title={dark ? 'Zum hellen Modus wechseln' : 'Zum dunklen Modus wechseln'}
          onClick={() => setPrefs({ theme: dark ? 'light' : 'dark' })}
        >
          <Icon name={dark ? 'sun' : 'moon'} size={20} />
        </button>
        <button
          className="icon-btn"
          data-testid="settings-button"
          aria-label="Einstellungen"
          title="Einstellungen"
          onClick={onOpenSettings}
        >
          <Icon name="gear" size={20} />
        </button>
        <button
          className="icon-btn"
          data-testid="logout-button"
          aria-label="Abmelden"
          title="Abmelden"
          onClick={() => void onLogout()}
        >
          <Icon name="logout" size={20} />
        </button>
      </span>
    </footer>
  );
}
