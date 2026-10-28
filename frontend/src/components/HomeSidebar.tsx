import { Link } from 'react-router-dom';
import { nameOf } from '../profile';
import { useChatStore } from '../store/chat';
import { useVoiceStore } from '../store/voice';
import { Avatar, Icon } from './Icon';
import { UserFooter } from './UserFooter';
import { VoiceBar } from './VoiceBar';

/** Sidebar of the home view: friends and the list of private conversations. */
export function HomeSidebar({
  activeChannelId,
  onNavigate,
  onOpenSettings,
}: {
  activeChannelId: string | null;
  onNavigate: () => void;
  onOpenSettings: () => void;
}) {
  const dms = useChatStore((s) => s.dms);
  const unread = useChatStore((s) => s.unreadDms);
  const requests = useChatStore((s) => s.friends.filter((f) => f.status === 'incoming').length);
  const participants = useVoiceStore((s) => s.participants);

  return (
    <div className="channel-sidebar home-sidebar">
      <header className="sidebar-header">
        <h2 className="guild-name">Direktnachrichten</h2>
      </header>
      <div className="sidebar-section">
        <ul className="channels">
          <li>
            <Link
              to="/me"
              className={`channel-link${activeChannelId ? '' : ' active'}`}
              data-testid="friends-link"
              aria-current={activeChannelId ? undefined : 'page'}
              onClick={onNavigate}
            >
              <Icon name="users" size={18} />
              Freunde
              {requests > 0 && (
                <span className="badge inline" aria-label={`${requests} offene Anfragen`}>
                  {requests}
                </span>
              )}
            </Link>
          </li>
        </ul>
      </div>
      <div className="sidebar-section">
        <div className="sidebar-heading-row">
          <h3 className="sidebar-heading">Unterhaltungen</h3>
        </div>
        {dms.length === 0 ? (
          <p className="settings-hint sidebar-note">
            Noch keine. Öffne eine über „Freunde“ → Nachricht.
          </p>
        ) : (
          <ul className="channels" data-testid="dm-list">
            {dms.map((dm) => {
              const id = dm.channel.id;
              const name = nameOf(dm.peer);
              const count = unread[id] ?? 0;
              const calling = (participants[id]?.length ?? 0) > 0;
              return (
                <li key={id}>
                  <Link
                    to={`/me/${id}`}
                    className={`channel-link dm-link${id === activeChannelId ? ' active' : ''}${count ? ' unread' : ''}`}
                    data-testid={`dm-item-${dm.peer.username}`}
                    aria-current={id === activeChannelId ? 'page' : undefined}
                    onClick={onNavigate}
                  >
                    <span className={`member-avatar${dm.online ? ' online' : ''}`}>
                      <Avatar name={name} url={dm.peer.avatarUrl} size="sm" />
                      <span className="presence-dot" aria-hidden="true" />
                    </span>
                    <span className="dm-name">{name}</span>
                    {calling && <Icon name="phone" size={14} />}
                    {count > 0 && (
                      <span className="badge inline" aria-label={`${count} ungelesen`}>
                        {count > 99 ? '99+' : count}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <VoiceBar onNavigate={onNavigate} />
      <UserFooter onOpenSettings={onOpenSettings} />
    </div>
  );
}
