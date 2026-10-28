import { useNavigate } from 'react-router-dom';
import { nameOf } from '../profile';
import { useAuthStore } from '../store/auth';
import { Avatar, Icon } from './Icon';

/** Bottom of the sidebars: who is signed in, settings and sign-out. */
export function UserFooter({ onOpenSettings }: { onOpenSettings: () => void }) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

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
        <Avatar name={nameOf(user)} url={user?.avatarUrl} size="sm" />
        <span className="who-names">
          <span className="current-user" data-testid="current-user">
            {nameOf(user)}
          </span>
          {user?.displayName && <span className="who-handle">@{user.username}</span>}
        </span>
      </button>
      <span className="footer-actions">
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
